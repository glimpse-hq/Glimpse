//! Live view: a frameless sidebar that follows an active recording while the
//! main window is out of the way.

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::tray::SettingsPage;
use crate::{AppRuntime, AppState, SETTINGS_WINDOW_LABEL};

pub(crate) const WINDOW_LABEL: &str = "live";

const WIDTH: f64 = 340.0;
const MIN_WIDTH: f64 = 280.0;
const MAX_WIDTH: f64 = 520.0;
const MIN_HEIGHT: f64 = 360.0;
const MAX_HEIGHT: f64 = 620.0;
const HEIGHT_RATIO: f64 = 0.7;
const COMPACT_HEIGHT: f64 = 52.0;
const EDGE_INSET: f64 = 12.0;

static EXPANDED_HEIGHT: Mutex<Option<f64>> = Mutex::new(None);

fn build(app: &AppHandle<AppRuntime>) -> tauri::Result<WebviewWindow<AppRuntime>> {
    let settings = app.state::<crate::AppState>().current_settings();
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::default())
        .title("Glimpse Live")
        .inner_size(WIDTH, MAX_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .max_inner_size(MAX_WIDTH, 10_000.0)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .initialization_script(crate::tray::boot_script(&settings))
        .build()?;
    crate::platform::live::init(app, &window);
    Ok(window)
}

// Docks to the right edge of the screen the main window is on, centered vertically.
fn dock(app: &AppHandle<AppRuntime>, window: &WebviewWindow<AppRuntime>) -> tauri::Result<()> {
    let monitor = match app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        Some(settings) => settings.current_monitor()?,
        None => window.primary_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let position = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    let height = (size.height * HEIGHT_RATIO)
        .min(MAX_HEIGHT)
        .max(MIN_HEIGHT.min(size.height));
    window.set_size(tauri::LogicalSize::new(WIDTH, height))?;
    window.set_position(tauri::LogicalPosition::new(
        position.x + size.width - WIDTH - EDGE_INSET,
        position.y + (size.height - height) / 2.0,
    ))
}

fn hide_settings(app: &AppHandle<AppRuntime>) {
    if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = settings.hide();
    }
}

fn hide_window(app: &AppHandle<AppRuntime>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        crate::platform::live::hide(app, &window);
    }
}

#[tauri::command]
pub fn open_live_view(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let window = match app.get_webview_window(WINDOW_LABEL) {
        Some(existing) => existing,
        None => {
            let window = build(&app).map_err(|err| err.to_string())?;
            dock(&app, &window).map_err(|err| err.to_string())?;
            window
        }
    };
    app.state::<AppState>()
        .recording()
        .shared
        .live
        .set_requested(true);
    crate::platform::live::show(&app, &window);
    hide_settings(&app);
    Ok(())
}

/// `expand` brings the main window back on the Record screen.
#[tauri::command]
pub fn hide_live_view(app: AppHandle<AppRuntime>, expand: bool) -> Result<(), String> {
    hide_window(&app);
    if expand {
        crate::tray::open_settings_page(&app, SettingsPage::Record)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Stop from the live view: same path as the tray's Finish Recording, which
/// brings the main window back for naming.
#[tauri::command]
pub fn finish_from_live_view(app: AppHandle<AppRuntime>) -> Result<(), String> {
    hide_window(&app);
    super::request_finish_from_tray(&app);
    Ok(())
}

/// Collapses the live view to its control bar, or restores it. The top edge
/// stays put so the toggle stays under the pointer; the panel animates inside.
#[tauri::command]
pub fn set_live_view_compact(app: AppHandle<AppRuntime>, compact: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return Ok(());
    };
    let apply = || -> tauri::Result<()> {
        let scale = window.scale_factor()?;
        let size = window.inner_size()?.to_logical::<f64>(scale);
        let height = if compact {
            EXPANDED_HEIGHT.lock().get_or_insert(size.height);
            COMPACT_HEIGHT
        } else {
            EXPANDED_HEIGHT.lock().take().unwrap_or(MAX_HEIGHT)
        };
        window.set_min_size(Some(tauri::LogicalSize::new(
            MIN_WIDTH,
            if compact { COMPACT_HEIGHT } else { MIN_HEIGHT },
        )))?;
        window.set_resizable(!compact)?;
        window.set_size(tauri::LogicalSize::new(size.width, height))
    };
    apply().map_err(|err| err.to_string())
}
