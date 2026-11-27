//! The pill and toasts share one window of our own and one clock, so a toast can grow out of
//! the pill and both move together. The window never resizes; clicks pass through it except
//! over a toast.

use super::a11y::A11y;
use super::gpu::{self, Gpu};
use super::text::{Style, TextEngine};
use super::window::NativeWindow;
use super::{Pace, pill, toast};
use crate::{AppRuntime, AppState};
use accesskit::{Node, NodeId, Role, TreeId, TreeInfo, TreeUpdate};
use parking_lot::{Condvar, Mutex};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Points: the widest toast, and the tallest one above an expanded pill.
pub(super) const SIZE: (f64, f64) = (436.0, 420.0);
/// The window's bottom edge above the screen's bottom, where the pill window's was.
const BOTTOM_MARGIN: f64 = 69.0;
/// The pill's bottom center, in window points.
pub(super) const PILL_ANCHOR: (f32, f32) = (SIZE.0 as f32 / 2.0, SIZE.1 as f32 - 24.0);
const CURSOR_POLL: Duration = Duration::from_millis(33);
const RETRY: Duration = Duration::from_secs(2);

pub(super) struct Overlay {
    pub app: AppHandle<AppRuntime>,
    pub window: NativeWindow,
    a11y: Option<A11y>,
    state: Mutex<State>,
    wake: Condvar,
    pub engine: Mutex<TextEngine>,
}

#[derive(Default)]
pub(super) struct State {
    pub pill: pill::Input,
    pub toast: toast::State,
    /// Asked to be on screen, until it's hidden.
    shown: bool,
    /// On screen and allowed to draw. Frames drawn while off screen hold drawables on macOS,
    /// which stalls the next show.
    pub on_screen: bool,
    interactive: bool,
}

impl State {
    fn wanted(&self) -> bool {
        self.pill.status != crate::pill::PillStatus::Idle || self.toast.is_showing()
    }
}

static OVERLAY: OnceLock<Overlay> = OnceLock::new();

pub(super) fn get() -> Option<&'static Overlay> {
    OVERLAY.get()
}

/// Changes the shared state and wakes the render and cursor threads. A no-op before start.
pub(super) fn update<R: Default>(apply: impl FnOnce(&mut State) -> R) -> R {
    let Some(o) = get() else {
        return R::default();
    };
    let result = apply(&mut o.state.lock());
    o.wake.notify_all();
    result
}

pub fn init(app: &AppHandle<AppRuntime>) {
    if let Err(err) = start(app) {
        tracing::error!("[Overlay] couldn't start: {err:#}");
    }
}

fn start(app: &AppHandle<AppRuntime>) -> anyhow::Result<()> {
    let window = NativeWindow::new(app, SIZE)?;
    let a11y = A11y::attach(app, &window, Arc::new(tree), Arc::new(on_a11y_action))
        .inspect_err(|err| tracing::error!("[Overlay] no screen reader access: {err:#}"))
        .ok();
    let settings = app.state::<AppState>().current_settings();
    let locale = crate::native_i18n::ui_locale(&settings);
    let overlay = Overlay {
        app: app.clone(),
        window: window.clone(),
        a11y,
        state: Mutex::new(State::default()),
        wake: Condvar::new(),
        engine: Mutex::new(TextEngine::new(locale)),
    };
    if OVERLAY.set(overlay).is_err() {
        anyhow::bail!("already started");
    }
    window.set_handler(Arc::new(toast::on_window_event));
    toast::start()?;
    // A display that goes away or changes scale moves the window, so it's placed again.
    super::window::on_screens_changed(|| {
        if let Some(o) = get()
            && update(|s| s.shown)
        {
            o.window.place_bottom_center(BOTTOM_MARGIN);
            // A settled toast redraws at the new size and scale.
            update(|s| s.toast.mark_dirty());
        }
    });
    std::thread::Builder::new()
        .name("overlay-renderer".into())
        .spawn(render_loop)?;
    std::thread::Builder::new()
        .name("overlay-cursor".into())
        .spawn(watch_cursor)?;
    // Loads the system fonts now, so the first toast doesn't wait on them.
    std::thread::spawn(|| {
        if let Some(o) = get() {
            o.engine.lock().shape(" ", Style::Body, None);
        }
    });
    Ok(())
}

/// Puts the window up on the screen under the cursor. A starting pill moves a showing
/// window there too, so a toast left on another screen doesn't keep the pill away.
pub(super) fn show(follow_cursor: bool) {
    let Some(o) = get() else { return };
    let was_shown = update(|s| std::mem::replace(&mut s.shown, true));
    if !was_shown || follow_cursor {
        o.window.place_bottom_center(BOTTOM_MARGIN);
    }
    if !was_shown {
        super::spring::REDUCED.store(
            super::window::reduce_motion(),
            std::sync::atomic::Ordering::Relaxed,
        );
        // Runs after the move on the main thread, so drawing starts at the new size and scale.
        o.window.show(|| update(|s| s.on_screen = true));
    }
}

// Hides the window once nothing is left to draw, unless something asked for it meanwhile.
fn hide_if_unwanted(o: &'static Overlay) {
    o.window.hide(|| {
        update(|s| {
            let hide = !s.wanted();
            if hide {
                s.shown = false;
                s.on_screen = false;
            }
            hide
        })
    });
}

impl Overlay {
    pub fn refresh_a11y(&self) {
        if let Some(a11y) = &self.a11y {
            a11y.refresh();
        }
    }
}

fn tree() -> TreeUpdate {
    const ROOT: NodeId = NodeId(1);
    let mut root = Node::new(Role::Group);
    let mut nodes = Vec::new();
    if let Some(o) = get() {
        let scale = o.window.metrics().2;
        let s = o.state.lock();
        nodes.extend(pill::nodes(o, &s.pill));
        nodes.extend(toast::nodes(o, &s.toast, scale));
    }
    for (id, _) in &nodes {
        root.push_child(*id);
    }
    nodes.push((ROOT, root));
    TreeUpdate {
        nodes,
        tree: Some(TreeInfo::new(ROOT)),
        tree_id: TreeId::ROOT,
        focus: ROOT,
    }
}

fn on_a11y_action(request: accesskit::ActionRequest) {
    if request.action == accesskit::Action::Click {
        toast::on_a11y_action(&request);
    }
}

// Lets clicks through everywhere except over a toast, checking where the cursor is while one shows.
fn watch_cursor() {
    let Some(o) = get() else { return };
    loop {
        let card = {
            let mut s = o.state.lock();
            while !(s.on_screen && s.toast.is_showing()) {
                if s.interactive {
                    s.interactive = false;
                    o.window.set_interactive(false);
                }
                o.wake.wait(&mut s);
            }
            s.toast.clickable_card()
        };
        let inside = card
            .zip(o.window.cursor_point())
            .is_some_and(|(r, (x, y))| {
                let (x, y) = (x as f32, y as f32);
                x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
            });
        update(|s| {
            if s.interactive != inside {
                s.interactive = inside;
                o.window.set_interactive(inside);
                if !inside {
                    s.toast.cursor_left();
                }
            }
        });
        std::thread::sleep(CURSOR_POLL);
    }
}

/// The window's surface, made once: on macOS each surface made from a view adds a Metal
/// layer to it, and an old one would keep showing its last frame.
struct Target {
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
}

impl Target {
    fn new(o: &'static Overlay) -> anyhow::Result<Self> {
        let instance = gpu::instance();
        // AppKit only lets its views take a Metal layer on the main thread.
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let (for_main, window) = (instance.clone(), o.window.clone());
        o.app.run_on_main_thread(move || {
            let _ = sender.send(for_main.create_surface(window));
        })?;
        let surface = receiver.recv()??;
        Ok(Self { instance, surface })
    }
}

/// The device and everything drawn with it, made again when the device is lost.
struct Painter {
    gpu: Gpu,
    config: wgpu::SurfaceConfiguration,
    pill: pill::Painter,
    toasts: toast::Painter,
}

impl Painter {
    fn new(target: &Target) -> anyhow::Result<Self> {
        let gpu = gpu::create(&target.instance, &target.surface)?;
        let caps = target.surface.get_capabilities(&gpu.adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .ok_or_else(|| anyhow::anyhow!("no surface format"))?;
        // The shaders write premultiplied color; Metal only lists PostMultiplied but composites it the same way.
        let alpha_mode = [
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::PostMultiplied,
        ]
        .into_iter()
        .find(|m| caps.alpha_modes.contains(m))
        .ok_or_else(|| anyhow::anyhow!("surface can't be transparent"))?;
        let config = wgpu::SurfaceConfiguration {
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
        Ok(Self {
            pill: pill::Painter::new(&gpu.device, &gpu.queue, format)?,
            toasts: toast::Painter::new(&gpu.device, &gpu.queue, format),
            gpu,
            config,
        })
    }

    // False when the frame couldn't be drawn and should be tried again.
    fn draw(
        &mut self,
        surface: &wgpu::Surface,
        (width, height): (u32, u32),
        toasts: &[toast::Frame],
    ) -> bool {
        if width == 0 || height == 0 {
            return true;
        }
        let device = &self.gpu.device;
        if (self.config.width, self.config.height) != (width, height) {
            self.config.width = width;
            self.config.height = height;
            surface.configure(device, &self.config);
        }
        let texture = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated => {
                surface.configure(device, &self.config);
                return false;
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.gpu.mark_lost("the overlay's surface was lost");
                return false;
            }
            // Covered or not on screen yet: try again next frame instead of spinning.
            _ => {
                std::thread::sleep(Duration::from_millis(8));
                return false;
            }
        };
        let view = texture.texture.create_view(&Default::default());
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            self.pill.draw(&mut pass);
            self.toasts.draw(toasts, &mut pass);
        }
        self.gpu.queue.submit([encoder.finish()]);
        self.gpu.queue.present(texture);
        true
    }
}

// Fifo presentation paces this loop to the display; it sleeps once nothing moves.
fn render_loop() {
    let Some(o) = get() else { return };
    // Made before the first show, so the pill doesn't wait on the GPU.
    let target = loop {
        match Target::new(o) {
            Ok(target) => break target,
            Err(err) => {
                tracing::error!("[Overlay] no surface: {err:#}");
                std::thread::sleep(RETRY);
            }
        }
    };
    let mut painter = Painter::new(&target)
        .inspect_err(|err| tracing::error!("[Overlay] can't draw yet: {err:#}"))
        .ok();
    let mut pill_anim = pill::Anim::new();
    let mut toasts = toast::Motion::default();
    let mut last = Instant::now();
    let mut frame_start = None;
    let mut last_offsets = None;
    loop {
        let (input, snapshot, pace) = {
            let mut s = o.state.lock();
            let pace = loop {
                let now = Instant::now();
                pill_anim.observe(&s.pill, now);
                let text_moving = painter.as_ref().is_some_and(|p| p.pill.animating(now));
                let pace = if pill_anim.animating(&s.pill) || text_moving {
                    Pace::Moving
                } else {
                    toasts.pace(&s.toast)
                };
                if s.on_screen && pace != Pace::Still {
                    break pace;
                }
                if s.shown && pace == Pace::Still && !s.wanted() {
                    hide_if_unwanted(o);
                }
                o.wake.wait(&mut s);
                // The first frame after a wait already moves one frame on, so it isn't blank.
                last = Instant::now() - Pace::Moving.frame();
                frame_start = None;
            };
            (s.pill.clone(), toast::snapshot(&mut s.toast), pace)
        };
        super::pace(&mut frame_start, pace);
        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f32().min(0.05);
        last = now;

        if painter.as_ref().is_some_and(|p| p.gpu.lost()) {
            painter = None;
        }
        if painter.is_none() {
            match Painter::new(&target) {
                Ok(p) => painter = Some(p),
                Err(err) => {
                    tracing::error!("[Overlay] can't draw: {err:#}");
                    std::thread::sleep(RETRY);
                    continue;
                }
            }
        }
        let Some(p) = painter.as_mut() else { continue };

        let pill_frame = pill_anim.step(&input, now, dt);
        let shape = pill::PillShape::of(&pill_frame, input.status);
        let frames = toasts.step(&snapshot, &shape, now, dt);
        if let Some(offsets) = toast::offsets(&frames).filter(|o| Some(*o) != last_offsets) {
            last_offsets = Some(offsets);
            if update(|s| s.toast.set_offsets(offsets)) {
                o.refresh_a11y();
            }
        }

        // Read every frame, so a display scale change is followed.
        let (width, height, scale) = o.window.metrics();
        {
            let mut engine = o.engine.lock();
            p.pill.prepare(
                &pill_frame,
                &input,
                scale as f32,
                (width, height),
                &mut engine,
                now,
                dt,
            );
            p.toasts
                .prepare(&frames, scale as f32, (width, height), &mut engine);
        }
        if !p.draw(&target.surface, (width, height), &frames) {
            update(|s| s.toast.mark_dirty());
        }
    }
}

/// The window id, whether it is on screen, its frame and its scale, for `glimpse dev window overlay info`.
#[cfg(debug_assertions)]
pub fn info() -> Option<(i64, bool, tauri::PhysicalRect<i32, u32>, f64)> {
    let o = get()?;
    let on_screen = o.state.lock().on_screen;
    Some((
        o.window.native_id(),
        on_screen,
        o.window.frame_physical(),
        o.window.metrics().2,
    ))
}
