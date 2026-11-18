//! Toasts drawn with wgpu in a window of our own, replacing the webview toast's look and
//! behavior. Actions still run through the toast webview's IPC, so they reach the same
//! commands with the same permissions.

mod layout;
mod render;
mod text;

use super::a11y::{self, A11y};
use super::gpu::{self, Gpu};
use super::window::{NativeWindow, Options, ScreenChoice, WindowEvent};
use crate::toast::Payload;
use crate::{AppRuntime, AppState};
use accesskit::{Action, Node, NodeId, Role, TreeId, TreeInfo, TreeUpdate};
use layout::{Hit, Layout, ToastContent, ToastKind};
use parking_lot::{Condvar, Mutex};
use render::{ToastRenderer, ToastView};
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use text::TextEngine;

// The webview's dismiss waits this long for animate-toast-out.
const LEAVE: Duration = Duration::from_millis(120);
const COPIED: Duration = Duration::from_millis(1500);
const ACTION_TIMEOUT: Duration = Duration::from_secs(30);
const BOTTOM_MARGIN: f64 = 100.0;
const BOTTOM_MARGIN_EXPANDED: f64 = 180.0;
// copy_last_transcription shows its own "Copied" toast, which closing here would hide.
const REPLACES_ITSELF: &str = "copy_last_transcription";

struct Toasts {
    app: AppHandle<AppRuntime>,
    window: NativeWindow,
    a11y: A11y,
    engine: Mutex<TextEngine>,
    state: Mutex<State>,
    wake: Condvar,
}

#[derive(Default)]
struct State {
    current: Option<Current>,
    // Bumped per shown toast, so a timer or slow action can't touch a newer one.
    generation: u64,
    hovered: Option<Hit>,
    pressed: Option<Hit>,
    copied_at: Option<Instant>,
    scroll: f32,
    on_screen: bool,
}

struct Current {
    payload: Payload,
    content: ToastContent,
    layout: Layout,
    shown_at: Instant,
    leaving_since: Option<Instant>,
}

static TOASTS: OnceLock<Toasts> = OnceLock::new();

pub fn init(app: &AppHandle<AppRuntime>) {
    if let Err(err) = start(app) {
        tracing::error!("[NativeToast] falling back to the webview toast: {err:#}");
    }
}

fn start(app: &AppHandle<AppRuntime>) -> anyhow::Result<()> {
    let window = NativeWindow::new(
        app,
        Options {
            size: (436.0, 120.0),
            interactive: true,
        },
    )?;
    let gpu = gpu::get()?;
    let surface = gpu.instance.create_surface(window.clone())?;
    let caps = surface.get_capabilities(&gpu.adapter);
    let format = caps
        .formats
        .iter()
        .copied()
        .find(|f| !f.is_srgb())
        .ok_or_else(|| anyhow::anyhow!("no surface format"))?;
    // The shader writes premultiplied color; Metal only lists PostMultiplied but composites it the same way.
    let alpha_mode = [
        wgpu::CompositeAlphaMode::PreMultiplied,
        wgpu::CompositeAlphaMode::PostMultiplied,
    ]
    .into_iter()
    .find(|m| caps.alpha_modes.contains(m))
    .ok_or_else(|| anyhow::anyhow!("surface can't be transparent"))?;
    let renderer = ToastRenderer::new(gpu.device.clone(), gpu.queue.clone(), format);
    let settings = app.state::<AppState>().current_settings();
    let locale = crate::native_i18n::ui_locale(&settings);
    let a11y = A11y::attach(app, &window, Arc::new(tree), Arc::new(on_a11y_action))?;

    let toasts = Toasts {
        app: app.clone(),
        window: window.clone(),
        a11y,
        engine: Mutex::new(TextEngine::new(locale)),
        state: Mutex::new(State::default()),
        wake: Condvar::new(),
    };
    if TOASTS.set(toasts).is_err() {
        anyhow::bail!("native toasts already started");
    }
    window.set_handler(Arc::new(on_window_event));
    std::thread::Builder::new()
        .name("toast-renderer".into())
        .spawn(move || render_loop(gpu, surface, format, alpha_mode, renderer))?;
    // Loads the system fonts now, so the first toast doesn't wait on them.
    std::thread::spawn(|| {
        if let Some(t) = TOASTS.get() {
            t.engine.lock().shape(" ", text::Style::Body, None);
        }
    });
    Ok(())
}

fn toasts() -> Option<&'static Toasts> {
    TOASTS.get()
}

fn kind(toast_type: &str) -> ToastKind {
    match toast_type {
        "error" => ToastKind::Error,
        "success" => ToastKind::Success,
        "warning" => ToastKind::Warning,
        "update" => ToastKind::Update,
        "celebration" => ToastKind::Celebration,
        "ask" => ToastKind::Ask,
        _ => ToastKind::Info,
    }
}

// DURATIONS in the webview toast, in milliseconds; 0 stays until closed.
fn default_duration(kind: ToastKind) -> u64 {
    match kind {
        ToastKind::Error => 18_000,
        ToastKind::Info => 3_000,
        ToastKind::Success => 2_000,
        ToastKind::Warning => 5_000,
        ToastKind::Celebration => 6_000,
        ToastKind::Update | ToastKind::Ask => 0,
    }
}

fn content(payload: &Payload) -> ToastContent {
    let kind = kind(&payload.toast_type);
    let with_action =
        |label: &Option<String>, action: &Option<String>| action.as_ref().and(label.clone());
    ToastContent {
        kind,
        title: payload.title.clone(),
        message: payload.message.clone(),
        detail: payload.detail.clone(),
        action_label: with_action(&payload.action_label, &payload.action),
        secondary_label: with_action(&payload.secondary_action_label, &payload.secondary_action),
        secondary_is_copy: payload.secondary_action.as_deref() == Some(REPLACES_ITSELF),
        show_copy: kind == ToastKind::Error,
    }
}

/// Shows the toast natively; false leaves it to the webview toast.
pub fn show(payload: &Payload) -> bool {
    let Some(t) = toasts().filter(|_| gpu::usable()) else {
        return false;
    };
    let content = content(payload);
    let layout = layout::layout(&content, &mut t.engine.lock());
    let duration = payload
        .duration
        .unwrap_or_else(|| default_duration(content.kind));
    let generation = {
        let mut state = t.state.lock();
        state.generation += 1;
        state.current = Some(Current {
            payload: payload.clone(),
            content,
            layout: layout.clone(),
            shown_at: Instant::now(),
            leaving_since: None,
        });
        state.hovered = None;
        state.pressed = None;
        state.copied_at = None;
        state.scroll = 0.0;
        state.generation
    };
    if payload.auto_dismiss != Some(false) && duration > 0 {
        dismiss_after(generation, Duration::from_millis(duration));
    }
    present(t, &layout);
    t.a11y.refresh();
    a11y::announce(&t.app, spoken(payload), payload.toast_type == "error");
    true
}

// The card's text as a screen reader hears it.
fn spoken(payload: &Payload) -> String {
    [
        &payload.title,
        &Some(payload.message.clone()),
        &payload.detail,
    ]
    .into_iter()
    .flatten()
    .cloned()
    .collect::<Vec<_>>()
    .join("\n")
}

// Sizes and places the window for `layout`, then shows it if it isn't up yet.
fn present(t: &'static Toasts, layout: &Layout) {
    t.window
        .set_size(f64::from(layout.window.0), f64::from(layout.window.1));
    let state = t.app.state::<AppState>();
    let pill = state.pill();
    let margin = if pill.is_expanded() {
        BOTTOM_MARGIN_EXPANDED
    } else {
        BOTTOM_MARGIN
    };
    // Next to a showing pill, on its monitor; otherwise where the cursor is.
    let screen = match super::pill::placed_window() {
        Some(pill_window) if pill.status() != crate::pill::PillStatus::Idle => {
            ScreenChoice::SameAs(pill_window)
        }
        _ => ScreenChoice::UnderCursor,
    };
    t.window.place_bottom_center(screen, margin);
    t.window.show(|| {
        if let Some(t) = toasts() {
            t.state.lock().on_screen = true;
            t.wake.notify_one();
        }
    });
    t.wake.notify_one();
}

fn dismiss_after(generation: u64, delay: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        dismiss(Some(generation));
    });
}

/// Plays the exit animation, then hides; `toast:hide` in the webview toast. False when
/// the webview toast is the one in use.
pub fn hide() -> bool {
    if toasts().is_none() || !gpu::usable() {
        return false;
    }
    dismiss(None);
    true
}

fn dismiss(generation: Option<u64>) {
    let Some(t) = toasts() else { return };
    let generation = {
        let mut state = t.state.lock();
        if generation.is_some_and(|g| g != state.generation) {
            return;
        }
        let Some(current) = state.current.as_mut() else {
            return;
        };
        current.leaving_since.get_or_insert_with(Instant::now);
        state.generation
    };
    t.wake.notify_one();
    std::thread::spawn(move || {
        std::thread::sleep(LEAVE);
        hide_now(generation);
    });
}

/// Starting a recording closes the toast unless it asked to stay.
pub fn recording_started() {
    let Some(t) = toasts() else { return };
    let generation = {
        let state = t.state.lock();
        match &state.current {
            Some(current) if current.payload.keep_while_recording != Some(true) => state.generation,
            _ => return,
        }
    };
    hide_now(generation);
}

fn hide_now(generation: u64) {
    let Some(t) = toasts() else { return };
    {
        let mut state = t.state.lock();
        if state.generation != generation || state.current.is_none() {
            return;
        }
        state.current = None;
        state.hovered = None;
        state.pressed = None;
    }
    t.a11y.refresh();
    // The same bookkeeping as the webview toast's close; it can show the next question.
    let replaced = crate::toast::toast_dismissed(t.app.clone());
    if replaced {
        return;
    }
    // A newer toast may have been shown meanwhile, inline on the main thread.
    t.window.hide(move || {
        toasts().is_some_and(|t| {
            let mut state = t.state.lock();
            let same = state.generation == generation;
            if same {
                state.on_screen = false;
            }
            same
        })
    });
}

// Mouse input arrives on the main thread; anything that waits runs on its own thread.
fn on_window_event(event: WindowEvent) {
    let Some(t) = toasts() else { return };
    let mut state = t.state.lock();
    let Some(current) = state.current.as_ref() else {
        return;
    };
    if current.leaving_since.is_some() {
        return;
    }
    let hit_at =
        |x: f64, y: f64, scroll: f32| layout::hit_test(&current.layout, scroll, x as f32, y as f32);
    match event {
        WindowEvent::MouseMoved { x, y } => {
            let hit = hit_at(x, y, state.scroll);
            state.hovered =
                matches!(hit, Hit::Close | Hit::Copy | Hit::Action | Hit::Secondary).then_some(hit);
        }
        WindowEvent::MouseExited => {
            state.hovered = None;
            state.pressed = None;
        }
        WindowEvent::MouseDown { x, y } => state.pressed = Some(hit_at(x, y, state.scroll)),
        WindowEvent::MouseUp { x, y } => {
            let hit = hit_at(x, y, state.scroll);
            if state.pressed.take() == Some(hit) {
                let generation = state.generation;
                drop(state);
                activate(hit, generation);
                t.wake.notify_one();
                return;
            }
        }
        WindowEvent::Scroll { dy } => {
            let max = current.layout.max_scroll;
            state.scroll = (state.scroll - dy as f32).clamp(0.0, max);
        }
    }
    drop(state);
    t.wake.notify_one();
}

fn activate(hit: Hit, generation: u64) {
    match hit {
        Hit::Close | Hit::Outside => {
            std::thread::spawn(move || close_by_user(generation));
        }
        Hit::Copy => copy_message(generation),
        Hit::Action | Hit::Secondary => {
            std::thread::spawn(move || run_action(hit, generation));
        }
        Hit::Card => {}
    }
}

fn payload_of(generation: u64) -> Option<Payload> {
    let state = toasts()?.state.lock();
    (state.generation == generation)
        .then(|| state.current.as_ref().map(|c| c.payload.clone()))
        .flatten()
}

fn close_by_user(generation: u64) {
    let Some(payload) = payload_of(generation) else {
        return;
    };
    if let Some(action) = &payload.close_action
        && let Err(err) = invoke(action, payload.action_args.as_ref())
    {
        tracing::error!("[NativeToast] close action failed: {err}");
    }
    hide_now(generation);
}

fn copy_message(generation: u64) {
    let Some(t) = toasts() else { return };
    let Some(payload) = payload_of(generation) else {
        return;
    };
    match arboard::Clipboard::new().and_then(|mut c| c.set_text(payload.message)) {
        Ok(()) => {
            t.state.lock().copied_at = Some(Instant::now());
            t.a11y.refresh();
            // Redraws once the check mark goes back to the copy icon.
            std::thread::spawn(|| {
                std::thread::sleep(COPIED);
                if let Some(t) = toasts() {
                    t.wake.notify_one();
                    t.a11y.refresh();
                }
            });
        }
        Err(err) => tracing::error!("[NativeToast] copy failed: {err}"),
    }
}

fn run_action(hit: Hit, generation: u64) {
    let Some(t) = toasts() else { return };
    let Some(payload) = payload_of(generation) else {
        return;
    };
    let action = if hit == Hit::Action {
        payload.action.clone()
    } else {
        payload.secondary_action.clone()
    };
    let Some(action) = action else { return };
    match invoke(&action, payload.action_args.as_ref()) {
        Ok(()) if action != REPLACES_ITSELF => hide_now(generation),
        Ok(()) => {}
        Err(err) => {
            tracing::error!("[NativeToast] action {action} failed: {err}");
            if t.state.lock().generation != generation {
                return;
            }
            // The error gets its own full display time, not the old toast's deadline.
            let failed = Payload {
                toast_type: "error".to_string(),
                message: crate::toast::native(&t.app, "native.toast.action_failed"),
                duration: None,
                auto_dismiss: None,
                keep_while_recording: None,
                ..payload
            };
            show(&failed);
        }
    }
}

const ROOT: NodeId = NodeId(1);
// Ids change with each toast, so a screen reader announces every new one.
const IDS_PER_TOAST: u64 = 10;
const BUTTONS: [Hit; 4] = [Hit::Close, Hit::Copy, Hit::Action, Hit::Secondary];

fn node_id(generation: u64, slot: u64) -> NodeId {
    NodeId(IDS_PER_TOAST * (generation + 1) + slot)
}

// The card is a live alert or status, like the webview toast's role, with its buttons beside it
// so only the message is announced.
fn tree() -> TreeUpdate {
    let mut root = Node::new(Role::Group);
    let mut nodes = Vec::new();
    if let Some(t) = toasts() {
        let state = t.state.lock();
        if let Some(current) = &state.current {
            let scale = t.window.metrics().2;
            let px = |r: layout::Rect| accesskit::Rect {
                x0: f64::from(r.x) * scale,
                y0: f64::from(r.y) * scale,
                x1: f64::from(r.x + r.w) * scale,
                y1: f64::from(r.y + r.h) * scale,
            };
            let content = &current.content;
            let error = content.kind == ToastKind::Error;
            let mut card = Node::new(if error { Role::Alert } else { Role::Status });
            a11y::live(&mut card, error);
            card.set_label(spoken(&current.payload));
            card.set_bounds(px(current.layout.card));
            let id = node_id(state.generation, 0);
            root.push_child(id);
            nodes.push((id, card));
            let copied = state.copied_at.is_some_and(|at| at.elapsed() < COPIED);
            for (slot, hit) in (1..).zip(BUTTONS) {
                let layout = &current.layout;
                let (rect, label) = match hit {
                    Hit::Close => (Some(layout.close), Some(native(t, "native.toast.close"))),
                    Hit::Copy => (
                        layout.copy,
                        Some(native(
                            t,
                            if copied {
                                "native.toast.copy_done"
                            } else {
                                "native.toast.copy_message"
                            },
                        )),
                    ),
                    Hit::Action => (layout.action, content.action_label.clone()),
                    _ => (layout.secondary, content.secondary_label.clone()),
                };
                let (Some(rect), Some(label)) = (rect, label) else {
                    continue;
                };
                let mut button = Node::new(Role::Button);
                button.set_label(label);
                button.set_bounds(px(rect));
                button.add_action(Action::Click);
                let id = node_id(state.generation, slot);
                root.push_child(id);
                nodes.push((id, button));
            }
        }
    }
    nodes.push((ROOT, root));
    TreeUpdate {
        nodes,
        tree: Some(TreeInfo::new(ROOT)),
        tree_id: TreeId::ROOT,
        focus: ROOT,
    }
}

fn native(t: &Toasts, key: &'static str) -> String {
    crate::toast::native(&t.app, key)
}

fn on_a11y_action(request: accesskit::ActionRequest) {
    if request.action != Action::Click {
        return;
    }
    let id = request.target_node.0;
    let (generation, slot) = (id / IDS_PER_TOAST, id % IDS_PER_TOAST);
    if let (Some(generation), Some(&hit)) = (
        generation.checked_sub(1),
        slot.checked_sub(1).and_then(|i| BUTTONS.get(i as usize)),
    ) {
        activate(hit, generation);
    }
}

/// Runs a toast action command through the toast webview's IPC and waits for its result.
fn invoke(command: &str, args: Option<&Value>) -> Result<(), String> {
    let t = toasts().ok_or("native toasts are off")?;
    let webview = t
        .app
        .get_webview_window(crate::toast::WINDOW_LABEL)
        .ok_or("the toast webview is gone")?;
    let url = webview.url().map_err(|err| err.to_string())?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let request = tauri::webview::InvokeRequest {
        cmd: command.to_string(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url,
        body: tauri::ipc::InvokeBody::Json(args.cloned().unwrap_or_else(|| json!({}))),
        headers: Default::default(),
        invoke_key: t.app.invoke_key().to_string(),
    };
    webview.as_ref().clone().on_message(
        request,
        Box::new(move |_webview, _command, response, _callback, _error| {
            let _ = sender.send(response);
        }),
    );
    match receiver.recv_timeout(ACTION_TIMEOUT) {
        Ok(tauri::ipc::InvokeResponse::Ok(_)) => Ok(()),
        Ok(tauri::ipc::InvokeResponse::Err(err)) => Err(err.0.to_string()),
        Err(_) => Err(format!("{command} didn't answer")),
    }
}

/// The window id, whether it is on screen, its frame and its scale, for `glimpse dev window toast info`.
#[cfg(debug_assertions)]
pub fn info() -> Option<(i64, bool, tauri::PhysicalRect<i32, u32>, f64)> {
    let t = toasts()?;
    let on_screen = t.state.lock().on_screen;
    Some((
        t.window.native_id(),
        on_screen,
        t.window.frame_physical(),
        t.window.metrics().2,
    ))
}

/// The showing toast's buttons in window points, so scripted tests can aim at them.
#[cfg(debug_assertions)]
pub fn buttons() -> Value {
    let Some(t) = toasts() else {
        return Value::Null;
    };
    let state = t.state.lock();
    let Some(current) = &state.current else {
        return Value::Null;
    };
    let rect = |r: Option<layout::Rect>| r.map(|r| json!([r.x, r.y, r.w, r.h]));
    let layout = &current.layout;
    json!({
        "close": rect(Some(layout.close)),
        "copy": rect(layout.copy),
        "action": rect(layout.action),
        "secondary": rect(layout.secondary),
        "card": rect(Some(layout.card)),
    })
}

// Draws while a toast is on screen and anything can still change; sleeps otherwise.
fn render_loop(
    gpu: &'static Gpu,
    surface: wgpu::Surface<'static>,
    format: wgpu::TextureFormat,
    alpha_mode: wgpu::CompositeAlphaMode,
    mut renderer: ToastRenderer,
) {
    let Some(t) = toasts() else { return };
    let mut config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width: 1,
        height: 1,
        present_mode: wgpu::PresentMode::Fifo,
        alpha_mode,
        color_space: wgpu::SurfaceColorSpace::Auto,
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    let mut drawn: Option<(u64, ToastView)> = None;
    let mut frame_start = None;
    loop {
        let (generation, layout, content, view) = {
            let mut state = t.state.lock();
            loop {
                if state.on_screen
                    && gpu::usable()
                    && let Some(current) = &state.current
                {
                    let view = ToastView {
                        hovered: state.hovered,
                        copied: state.copied_at.is_some_and(|at| at.elapsed() < COPIED),
                        scroll: state.scroll,
                        age: current.shown_at.elapsed().as_secs_f32(),
                        leaving: current.leaving_since.map(|at| at.elapsed().as_secs_f32()),
                    };
                    let changed = drawn.as_ref().is_none_or(|(g, last)| {
                        *g != state.generation
                            || last.hovered != view.hovered
                            || last.copied != view.copied
                            || last.scroll != view.scroll
                            || last.leaving.is_some() != view.leaving.is_some()
                    });
                    if changed || ToastRenderer::animating(&current.content, &view) {
                        break (
                            state.generation,
                            current.layout.clone(),
                            current.content.clone(),
                            view,
                        );
                    }
                }
                t.wake.wait(&mut state);
                frame_start = None;
            }
        };
        super::pace(&mut frame_start);

        let (width, height, scale) = t.window.metrics();
        let expected = (
            (layout.window.0 * scale as f32).round() as u32,
            (layout.window.1 * scale as f32).round() as u32,
        );
        // The resize is applied on the main thread; wait for it rather than draw stretched.
        if width.abs_diff(expected.0) > 1 || height.abs_diff(expected.1) > 1 {
            std::thread::sleep(Duration::from_millis(4));
            continue;
        }
        if (config.width, config.height) != (width, height) {
            config.width = width;
            config.height = height;
            surface.configure(&gpu.device, &config);
        }
        let frame = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Outdated => {
                surface.configure(&gpu.device, &config);
                continue;
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                gpu::mark_lost("the toast's surface was lost");
                hide_now(generation);
                continue;
            }
            // Covered or not on screen yet: try again next frame instead of spinning.
            _ => {
                std::thread::sleep(Duration::from_millis(8));
                continue;
            }
        };
        let target = frame.texture.create_view(&Default::default());
        renderer.render(
            &target,
            &layout,
            &content,
            &view,
            scale as f32,
            &mut t.engine.lock(),
        );
        gpu.queue.present(frame);
        drawn = Some((generation, view));
    }
}
