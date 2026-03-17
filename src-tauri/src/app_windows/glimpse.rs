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

/// Ensures the Glimpse window exists, makes it visible and focused, and registers a close handler.
///
/// If the Glimpse window does not exist this creates it. The window is then shown and focused.
/// A single close-request handler is registered (if not already) which prevents the window from
/// closing, hides it instead, and runs platform-specific hide preparation.
///
/// # Returns
///
/// `Ok(())` on success, or a `tauri::Error` if window creation, showing, or focus operations fail.
///
/// # Examples
///
/// ```no_run
/// // `app` is an existing `AppHandle<AppRuntime>` obtained from your Tauri command or setup.
/// // show(&app).expect("failed to show glimpse window");
/// ```
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

/// Show the Glimpse window and emit the "about" navigation events with their configured delays.
///
/// This will ensure the Glimpse window is displayed, focused, and then emit the sequence of
/// about-related events defined by `ABOUT_EVENTS`.
///
/// # Returns
///
/// `Ok(())` if the window was shown and the emit scheduling was started; a `tauri::Error` if
/// window operations fail.
///
/// # Examples
///
/// ```no_run
/// // `app` is an existing `AppHandle<AppRuntime>`
/// show_about(&app)?;
/// ```
pub(crate) fn show_about(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, ABOUT_EVENTS)
}

/// Displays the Glimpse window and schedules emission of model-related navigation events.
///
/// # Returns
///
/// `Ok(())` on success, otherwise the underlying `tauri::Error`.
///
/// # Examples
///
/// ```no_run
/// // `app` is an `AppHandle<AppRuntime>` available in your context
/// let _ = show_models(&app);
/// ```
pub(crate) fn show_models(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, MODELS_EVENTS)
}

/// Show the Glimpse window and schedule emission of the "what's new" navigation events.
///
/// Returns `Ok(())` if the window was shown and the event emissions were scheduled, or an `Err` if window operations fail.
///
/// # Examples
///
/// ```no_run
/// // `app` is an `AppHandle<AppRuntime>`
/// show_whats_new(&app).unwrap();
/// ```
pub(crate) fn show_whats_new(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    show_and_emit_events(app, WHATS_NEW_EVENTS)
}

/// Constructs a Glimpse `WebviewWindow` with the module's default sizing and platform-specific configuration.
///
/// The created window is configured with the label `WINDOW_LABEL`, title "Glimpse", default inner size, minimum inner size,
/// is resizable, and is initially hidden. On Windows a platform-specific runtime configuration is attempted and any failure
/// is printed to stderr.
///
/// On success returns the built `WebviewWindow`; returns an error if the window builder fails.
///
/// # Examples
///
/// ```no_run
/// # use tauri::{AppHandle, Runtime};
/// // `app` would be provided by your Tauri runtime in real usage.
/// let app: AppHandle<_> = /* obtain AppHandle from runtime */;
/// let window = crate::app_windows::glimpse::build_window(&app)?;
/// // window is created but not shown
/// # Ok::<(), tauri::Error>(())
/// ```
fn build_window(app: &AppHandle<AppRuntime>) -> tauri::Result<WebviewWindow<AppRuntime>> {
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

    #[cfg(target_os = "windows")]
    if let Err(err) = crate::platform::windows::glimpse_window::configure_window(&window) {
        eprintln!("Failed to initialize Windows Glimpse window: {err}");
    }

    Ok(window)
}

/// Apply platform-specific configuration to a `WebviewWindowBuilder`.

///

/// On supported platforms this forwards the builder to the platform-specific

/// `configure_builder` implementation; on other platforms the builder is

/// returned unchanged.

///

/// # Examples

///

/// ```

/// use tauri::{WebviewWindowBuilder, Runtime, Manager};

///

/// // `builder` would typically be created via `WebviewWindowBuilder::new(...)`.

/// // Here we illustrate the call site only.

/// fn use_builder<'a, R: Runtime, M: Manager<R>>(builder: WebviewWindowBuilder<'a, R, M>) {

///     let builder = crate::app_windows::glimpse::configure_builder(builder);

///     // continue configuring or build the window...

///     let _ = builder;

/// }

/// ```
fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    let builder = crate::platform::macos::glimpse_window::configure_builder(builder);

    #[cfg(target_os = "windows")]
    let builder = crate::platform::windows::glimpse_window::configure_builder(builder);

    builder
}

/// Perform platform-specific preparation before showing the Glimpse window.
///
/// On macOS this runs the platform-specific preparation and logs any error to stderr; failures are not propagated.
///
/// # Examples
///
/// ```no_run
/// // Obtain an AppHandle<AppRuntime> from your Tauri application context and pass it here.
/// // let app_handle: AppHandle<AppRuntime> = /* ... */;
/// // prepare_to_show(&app_handle);
/// ```
fn prepare_to_show(_app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_show(_app) {
        eprintln!("Failed to prepare Glimpse window for display: {err}");
    }
}

/// Run platform-specific preparation before hiding the Glimpse window.
///
/// On macOS this calls the macOS-specific hide preparation routine; failures are written to stderr.
///
/// # Examples
///
/// ```no_run
/// // Obtain an AppHandle in your application and pass it here:
/// let app: tauri::AppHandle<AppRuntime> = unimplemented!();
/// prepare_to_hide(&app);
/// ```
fn prepare_to_hide(_app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::platform::macos::glimpse_window::prepare_to_hide(_app) {
        eprintln!("Failed to prepare Glimpse window for hiding: {err}");
    }
}

/// Shows the Glimpse window and schedules a sequence of events to be emitted to the webview after specified delays.
///
/// The `events` slice contains pairs of `(delay_ms, event_name)`; each `event_name` will be emitted after waiting `delay_ms` milliseconds. Emissions are performed on a spawned thread and failures to emit are logged to stderr.
///
/// # Returns
///
/// `Ok(())` if the window was shown successfully, or an error from `tauri` if showing the window failed.
///
/// # Examples
///
/// ```no_run
/// // Emits "navigate:about" after 100ms and "navigate:details" after 300ms.
/// let events: &[(u64, &str)] = &[(100, "navigate:about"), (300, "navigate:details")];
/// show_and_emit_events(&app_handle, events)?;
/// ```
fn show_and_emit_events(
    app: &AppHandle<AppRuntime>,
    events: &'static [(u64, &'static str)],
) -> tauri::Result<()> {
    show(app)?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for &(delay_ms, event_name) in events {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let emit_result = app_handle
                .get_webview_window(WINDOW_LABEL)
                .map(|w| w.emit(event_name, ()))
                .unwrap_or_else(|| app_handle.emit(event_name, ()));
            if let Err(err) = emit_result {
                eprintln!("Failed to emit {event_name}: {err}");
            }
        }
    });

    Ok(())
}
