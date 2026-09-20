use crate::{AppRuntime, AppState, pill};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewWindow};

pub const WINDOW_LABEL: &str = "toast";
/// Size from tauri.conf.json; the frontend shrinks the window to fit the card.
const WINDOW_WIDTH: f64 = 420.0;
const WINDOW_HEIGHT: f64 = 200.0;
pub const EVENT_SHOW: &str = "toast:show";
pub const EVENT_HIDE: &str = "toast:hide";

#[derive(Serialize, Clone, Default)]
pub struct Payload {
    #[serde(rename = "type")]
    pub toast_type: String,
    pub title: Option<String>,
    pub message: String,
    #[serde(rename = "autoDismiss")]
    pub auto_dismiss: Option<bool>,
    pub duration: Option<u64>,
    #[serde(rename = "retryId")]
    pub retry_id: Option<String>,
    #[serde(rename = "mode")]
    pub mode: Option<String>,
    pub action: Option<String>,
    #[serde(rename = "actionLabel")]
    pub action_label: Option<String>,
    #[serde(rename = "secondaryAction")]
    pub secondary_action: Option<String>,
    #[serde(rename = "secondaryActionLabel")]
    pub secondary_action_label: Option<String>,
}

pub fn emit_toast(app: &AppHandle<AppRuntime>, payload: Payload) {
    if let Some(toast_window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = toast_window.set_size(tauri::LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT));
        position_toast_window(app, &toast_window, WINDOW_WIDTH, WINDOW_HEIGHT);
        crate::platform::toast::show(app, &toast_window);
    }
    let _ = app.emit(EVENT_SHOW, payload);
}

pub fn native(app: &AppHandle<AppRuntime>, key: &'static str) -> String {
    let settings = app.state::<AppState>().current_settings();
    crate::native_i18n::MenuStrings::resolve(&settings)
        .get(key)
        .to_string()
}

pub fn native_format(
    app: &AppHandle<AppRuntime>,
    key: &'static str,
    args: &[(&str, &str)],
) -> String {
    let settings = app.state::<AppState>().current_settings();
    crate::native_i18n::MenuStrings::resolve(&settings).format(key, args)
}

pub fn show(app: &AppHandle<AppRuntime>, toast_type: &str, title: Option<&str>, message: &str) {
    emit_toast(
        app,
        Payload {
            toast_type: toast_type.to_string(),
            title: title.map(String::from),
            message: message.to_string(),
            ..Default::default()
        },
    );
}

pub fn show_with_action(
    app: &AppHandle<AppRuntime>,
    toast_type: &str,
    title: Option<&str>,
    message: &str,
    action: &str,
    action_label: &str,
) {
    emit_toast(
        app,
        Payload {
            toast_type: toast_type.to_string(),
            title: title.map(String::from),
            message: message.to_string(),
            action: Some(action.to_string()),
            action_label: Some(action_label.to_string()),
            ..Default::default()
        },
    );
}

pub fn hide(app: &AppHandle<AppRuntime>) {
    let _ = app.emit(EVENT_HIDE, ());

    // Best-effort: also hide the toast surface at the platform level.
    if let Some(toast_window) = app.get_webview_window(WINDOW_LABEL) {
        crate::platform::toast::hide(app, &toast_window);
    }
}

/// Size is passed in because `set_size` applies asynchronously on macOS.
fn position_toast_window(
    app: &AppHandle<AppRuntime>,
    toast_window: &WebviewWindow<AppRuntime>,
    width: f64,
    height: f64,
) {
    let state = app.state::<AppState>();
    let is_expanded = state.pill().is_expanded();
    let pill_is_visible = state.pill().status() != pill::PillStatus::Idle;
    let base_margin = if is_expanded { 180.0 } else { 100.0 };

    let Some(monitor) = target_toast_monitor(app, toast_window, pill_is_visible) else {
        return;
    };

    let scale_factor = monitor.scale_factor();
    let window_width = (width * scale_factor) as i32;
    let window_height = (height * scale_factor) as i32;
    let bottom_margin = (base_margin * scale_factor) as i32;

    let screen = monitor.size();
    let mon_pos = monitor.position();
    let x = mon_pos.x + (screen.width as i32 - window_width) / 2;
    let y = mon_pos.y + screen.height as i32 - bottom_margin - window_height;
    let _ = toast_window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
pub fn resize_toast_window(width: f64, height: f64, app: AppHandle<AppRuntime>) {
    if let Some(toast_window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = toast_window.set_size(tauri::LogicalSize::new(width, height));
        position_toast_window(&app, &toast_window, width, height);
    }
}

fn target_toast_monitor(
    app: &AppHandle<AppRuntime>,
    toast_window: &WebviewWindow<AppRuntime>,
    pill_is_visible: bool,
) -> Option<Monitor> {
    if pill_is_visible {
        app.get_webview_window(crate::MAIN_WINDOW_LABEL)
            .and_then(|pill_window| pill_window.current_monitor().ok().flatten())
            .or_else(|| monitor_containing_cursor(toast_window))
            .or_else(|| toast_window.current_monitor().ok().flatten())
    } else {
        monitor_containing_cursor(toast_window)
            .or_else(|| toast_window.current_monitor().ok().flatten())
    }
}

pub(crate) fn monitor_containing_cursor(window: &WebviewWindow<AppRuntime>) -> Option<Monitor> {
    let cursor_pos = window.cursor_position().ok()?;
    window
        .available_monitors()
        .ok()?
        .into_iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            cursor_pos.x >= pos.x as f64
                && cursor_pos.x < (pos.x + size.width as i32) as f64
                && cursor_pos.y >= pos.y as f64
                && cursor_pos.y < (pos.y + size.height as i32) as f64
        })
}

#[tauri::command]
pub fn toast_dismissed(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if state.pill().status() == pill::PillStatus::Error {
        state.pill().reset(&app);
    }
    hide(&app);
}

#[tauri::command]
pub fn debug_show_toast(
    toast_type: String,
    message: String,
    action: Option<String>,
    action_label: Option<String>,
    app: AppHandle<AppRuntime>,
) {
    emit_toast(
        &app,
        Payload {
            toast_type,
            message,
            auto_dismiss: Some(true),
            duration: Some(8000),
            action,
            action_label,
            ..Default::default()
        },
    );
}

/// Lifetime word counts that earn a celebration toast.
pub const WORD_MILESTONES: [u64; 4] = [1_000, 10_000, 100_000, 1_000_000];

/// Celebrates the highest milestone crossed between `before` and `after` lifetime words.
pub fn show_word_milestone(app: &AppHandle<AppRuntime>, before: u64, after: u64) {
    let Some(milestone) = WORD_MILESTONES
        .iter()
        .rev()
        .find(|m| before < **m && **m <= after)
    else {
        return;
    };
    let settings = app.state::<AppState>().current_settings();
    let strings = crate::native_i18n::MenuStrings::resolve(&settings);
    emit_toast(
        app,
        Payload {
            toast_type: "celebration".to_string(),
            message: strings.format(
                "native.toast.milestone",
                &[("count", &format_thousands(*milestone))],
            ),
            auto_dismiss: Some(true),
            duration: Some(6000),
            ..Default::default()
        },
    );
}

fn format_thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}
