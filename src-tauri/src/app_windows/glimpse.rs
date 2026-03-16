use crate::{AppRuntime, AppState};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub(crate) const WINDOW_LABEL: &str = "glimpse";

const DEFAULT_WIDTH: f64 = 900.0;
const DEFAULT_HEIGHT: f64 = 720.0;
const MIN_WIDTH: f64 = 625.0;
const MIN_HEIGHT: f64 = 500.0;
const ABOUT_EVENTS: &[(u64, &str)] = &[(150, "navigate:about")];
const MODELS_EVENTS: &[(u64, &str)] = &[(150, "navigate:models")];
const WHATS_NEW_EVENTS: &[(u64, &str)] = &[(500, "navigate:about"), (400, "open_whats_new")];

pub(crate) fn show(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let mut reset_close_handler_registration = false;

    let window = if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        existing
    } else {
        reset_close_handler_registration = true;
        build_window(app)?
    };

    if reset_close_handler_registration {
        state
            .glimpse_window_close_handler_registered
            .store(false, Ordering::SeqCst);
    }

    prepare_to_show(app);
    window.show()?;
    window.set_focus()?;

    let already_registered = state
        .glimpse_window_close_handler_registered
        .swap(true, Ordering::SeqCst);
    if !already_registered {
        let app_handle = app.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_clone.hide();
                prepare_to_hide(&app_handle);
            }
        });
    }

    Ok(())
}

pub(crate) fn show_about(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, ABOUT_EVENTS)
}

pub(crate) fn show_models(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, MODELS_EVENTS)
}

pub(crate) fn show_whats_new(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, WHATS_NEW_EVENTS)
}

fn build_window(app: &AppHandle<AppRuntime>) -> tauri::Result<WebviewWindow<AppRuntime>> {
    let builder = configure_builder(
        WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::default())
            .title("Glimpse")
            .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
            .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
            .resizable(true)
            .visible(false),
    );

    builder.build()
}

fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    let builder = crate::platform::macos::glimpse_window::configure_builder(builder);

    builder
}

fn prepare_to_show(app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_show(app) {
        eprintln!("Failed to prepare Glimpse window for display: {err}");
    }
}

fn prepare_to_hide(app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_hide(app) {
        eprintln!("Failed to prepare Glimpse window for hiding: {err}");
    }
}

fn show_and_emit_events(
    app: &AppHandle<AppRuntime>,
    events: &'static [(u64, &'static str)],
) -> tauri::Result<()> {
    show(app)?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for &(delay_ms, event_name) in events {
            std::thread::sleep(Duration::from_millis(delay_ms));
            if let Err(err) = app_handle.emit(event_name, ()) {
                eprintln!("Failed to emit {event_name}: {err}");
            }
        }
    });

    Ok(())
}
