use crate::{AppRuntime, AppState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Listener, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub(crate) const WINDOW_LABEL: &str = "glimpse";

const DEFAULT_WIDTH: f64 = 900.0;
const DEFAULT_HEIGHT: f64 = 720.0;
const MIN_WIDTH: f64 = 625.0;
const MIN_HEIGHT: f64 = 500.0;
const ABOUT_EVENTS: &[(u64, &str)] = &[(0, "navigate:about")];
const MODELS_EVENTS: &[(u64, &str)] = &[(0, "navigate:models")];
const WHATS_NEW_EVENTS: &[(u64, &str)] = &[(0, "navigate:about"), (100, "open_whats_new")];
const READY_EVENT: &str = "glimpse-ready";
const READY_TIMEOUT: Duration = Duration::from_secs(3);
static GLIMPSE_READY: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());
static GLIMPSE_READY_LISTENER_REGISTERED: AtomicBool = AtomicBool::new(false);

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

    ensure_ready_listener(&window);

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

    let window = builder.build()?;
    *GLIMPSE_READY.0.lock().unwrap() = false;
    GLIMPSE_READY_LISTENER_REGISTERED.store(false, Ordering::SeqCst);
    ensure_ready_listener(&window);

    #[cfg(target_os = "windows")]
    if let Err(err) = crate::platform::windows::glimpse_window::configure_window(&window) {
        eprintln!("Failed to initialize Windows Glimpse window: {err}");
    }

    Ok(window)
}

fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    let builder = crate::platform::macos::glimpse_window::configure_builder(builder);

    #[cfg(target_os = "windows")]
    let builder = crate::platform::windows::glimpse_window::configure_builder(builder);

    builder
}

fn prepare_to_show(_app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_show(_app) {
        eprintln!("Failed to prepare Glimpse window for display: {err}");
    }
}

fn prepare_to_hide(_app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_hide(_app) {
        eprintln!("Failed to prepare Glimpse window for hiding: {err}");
    }
}

fn show_and_emit_events(
    app: &AppHandle<AppRuntime>,
    events: &'static [(u64, &'static str)],
) -> tauri::Result<()> {
    show(app)?;

    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return Ok(());
    };

    let window = window.clone();
    std::thread::spawn(move || {
        if !wait_for_glimpse_ready(READY_TIMEOUT) {
            eprintln!("Timed out waiting for {WINDOW_LABEL} readiness signal");
            return;
        }

        for &(delay_ms, event_name) in events {
            std::thread::sleep(Duration::from_millis(delay_ms));
            if let Err(err) = window.emit(event_name, ()) {
                eprintln!("Failed to emit {event_name}: {err}");
                break;
            }
        }
    });

    Ok(())
}

fn ensure_ready_listener(window: &WebviewWindow<AppRuntime>) {
    if GLIMPSE_READY_LISTENER_REGISTERED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let _ = window.listen(READY_EVENT, |_| {
        let mut ready = GLIMPSE_READY.0.lock().unwrap();
        *ready = true;
        GLIMPSE_READY.1.notify_all();
    });
}

fn wait_for_glimpse_ready(timeout: Duration) -> bool {
    let (lock, cvar) = &GLIMPSE_READY;
    let guard = lock.lock().unwrap();
    if *guard {
        return true;
    }
    let (guard, _) = cvar.wait_timeout(guard, timeout).unwrap();
    *guard
}
