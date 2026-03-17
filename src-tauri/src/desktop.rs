use std::time::Duration;

use crate::app_windows::glimpse as glimpse_window;
#[cfg(target_os = "macos")]
use crate::recent_transcriptions::{
    copy_transcription_to_clipboard, MENU_ID_RECENT_TRANSCRIPTION_PREFIX,
};
use crate::settings::{TranscriptionMode, UserSettings};
#[cfg(target_os = "macos")]
use crate::FEEDBACK_URL;
use crate::{
    pill, platform, toast, tray, AppRuntime, AppState, EVENT_SETTINGS_CHANGED, MAIN_WINDOW_LABEL,
};
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::{App, AppHandle, Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_opener::OpenerExt;

/// Attaches a macOS-specific app menu event handler to the given Tauri builder.
///
/// On macOS this registers a handler that forwards menu events to the internal
/// `handle_app_menu_event` dispatcher; on other platforms this is a no-op and
/// the builder is returned unchanged.
///
/// # Examples
///
/// ```
/// // Create a builder and attach platform menu handlers before building the app.
/// let builder = tauri::Builder::default();
/// let builder = attach_menu_handlers(builder);
/// // proceed to configure and run the app with `builder`
/// ```
pub(crate) fn attach_menu_handlers(
    builder: tauri::Builder<AppRuntime>,
) -> tauri::Builder<AppRuntime> {
    #[cfg(target_os = "macos")]
    let builder = builder.on_menu_event(|app, event| {
        handle_app_menu_event(app, event.id().as_ref());
    });

    builder
}

/// Prepare the application runtime and integrate platform UI components.
///
/// Performs platform-specific initialization and registers UI integrations:
/// - On macOS, sets the activation policy to Accessory.
/// - Applies the application menu based on current settings.
/// - Hides the main and toast webview windows and initializes the corresponding platform overlays.
/// - Builds and stores the system tray, if available.
/// - Registers global keyboard shortcuts used by the app.
/// - Schedules showing the Glimpse window shortly after startup.
///
/// Errors encountered while applying menus, building the tray, or registering shortcuts are logged but do not propagate.
///
/// # Examples
///
/// ```rust,no_run
/// use tauri::{App, AppHandle, Runtime};
///
/// // inside the setup or run callback where `app` is available:
/// // fn setup(app: &mut App<tauri::Wry>) { initialize(app); }
/// ```
pub(crate) fn initialize(app: &mut App<AppRuntime>) {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(ActivationPolicy::Accessory);

    let handle = app.handle();
    let settings = handle.state::<AppState>().current_settings();

    if let Err(err) = set_app_menu(&handle, &settings) {
        eprintln!("Failed to set app menu: {err}");
    }

    if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
        platform::overlay::init(&handle, &window);
    }

    if let Some(toast_window) = handle.get_webview_window(toast::WINDOW_LABEL) {
        let _ = toast_window.hide();
        platform::toast::init(&handle, &toast_window);
    }

    match tray::build_tray(&handle) {
        Ok(tray) => handle.state::<AppState>().store_tray(tray),
        Err(err) => eprintln!("Failed to build tray: {err}"),
    }

    if let Err(err) = pill::register_shortcuts(&handle) {
        eprintln!("Failed to register shortcuts: {err}");
    }

    let app_handle = handle.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = glimpse_window::show(&app_handle);
    });
}

/// Refreshes the system tray and application menus to reflect the provided settings.
///
/// This will attempt to update the tray menu and the app menu; any errors encountered while
/// refreshing are written to stderr.
///
/// # Examples
///
/// ```
/// // Assuming `app` is an `AppHandle<AppRuntime>` and `settings` is a `UserSettings` instance:
/// // refresh_menus(&app, &settings);
/// ```
pub(crate) fn refresh_menus(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if let Err(err) = tray::refresh_tray_menu(app, settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }
    if let Err(err) = set_app_menu(app, settings) {
        eprintln!("Failed to refresh app menu: {err}");
    }
}

/// Updates the persisted transcription mode, refreshes menus, and notifies the UI of the change.
///
/// If the provided mode is already set, the function returns without side effects. On successful
/// persistence it requests a preflight refresh, refreshes application menus, and emits a
/// settings-changed event; on failure it logs an error.
///
/// # Examples
///
/// ```no_run
/// use crate::desktop::select_transcription_mode;
/// use crate::settings::TranscriptionMode;
///
/// // `app` is a Tauri AppHandle obtained in a command handler or during setup.
/// select_transcription_mode(&app, TranscriptionMode::Local);
/// ```
pub(crate) fn select_transcription_mode(app: &AppHandle<AppRuntime>, mode: TranscriptionMode) {
    let state = app.state::<AppState>();
    let mut settings = state.current_settings();
    if settings.transcription_mode == mode {
        return;
    }

    settings.transcription_mode = mode;
    match state.persist_settings(settings.clone()) {
        Ok(saved) => {
            state.request_preflight_refresh();
            refresh_menus(app, &saved);
            emit_settings_changed(app, &saved);
        }
        Err(err) => eprintln!("Failed to update transcription mode: {err}"),
    }
}

/// Selects and persistently sets the local transcription model identified by `model_key`.
///
/// If the key is unknown, the model is not installed, or the model status check fails,
/// the function logs an error and returns without changing settings. On successful
/// update it refreshes application menus and emits a settings-changed event.
///
/// # Parameters
///
/// - `app`: Application handle used to access and modify shared state and emit events.
/// - `model_key`: Identifier of the local model to activate.
///
/// # Examples
///
/// ```
/// // Assuming `app` is available as an `AppHandle<AppRuntime>`
/// select_local_model(&app, "whisper-large");
/// ```
pub(crate) fn select_local_model(app: &AppHandle<AppRuntime>, model_key: &str) {
    if crate::model_manager::definition(model_key).is_none() {
        eprintln!("Ignoring unknown model selection: {model_key}");
        return;
    }

    match crate::model_manager::check_model_status(app.clone(), model_key.to_string()) {
        Ok(status) if status.installed => {}
        Ok(_) => {
            eprintln!("Model not installed: {model_key}");
            return;
        }
        Err(err) => {
            eprintln!("Failed to check model status for {model_key}: {err}");
            return;
        }
    }

    let state = app.state::<AppState>();
    let mut settings = state.current_settings();
    if settings.local_model == model_key {
        return;
    }

    settings.local_model = model_key.to_string();
    match state.persist_settings(settings.clone()) {
        Ok(saved) => {
            refresh_menus(app, &saved);
            emit_settings_changed(app, &saved);
        }
        Err(err) => eprintln!("Failed to update model selection: {err}"),
    }
}

/// Update the persisted microphone selection and notify the app of the change.
///
/// Sets the microphone device to `device_id` (`None` selects the system default). If the chosen
/// device differs from the current setting, the new settings are persisted; on success the app's
/// menus are refreshed and a settings-changed event is emitted. Failures are logged.
///
/// # Parameters
///
/// - `device_id`: `Some(device_id)` to select a specific microphone, `None` to use the default.
///
/// # Examples
///
/// ```no_run
/// // Select a specific device
/// select_microphone(&app.handle(), Some("built-in-mic-1"));
///
/// // Revert to system default
/// select_microphone(&app.handle(), None);
/// ```
pub(crate) fn select_microphone(app: &AppHandle<AppRuntime>, device_id: Option<&str>) {
    let state = app.state::<AppState>();
    let mut settings = state.current_settings();
    if settings.microphone_device.as_deref() == device_id {
        return;
    }

    settings.microphone_device = device_id.map(str::to_string);
    match state.persist_settings(settings.clone()) {
        Ok(saved) => {
            refresh_menus(app, &saved);
            emit_settings_changed(app, &saved);
        }
        Err(err) => eprintln!("Failed to update microphone selection: {err}"),
    }
}

/// Apply the macOS application menu constructed from the provided user settings to the running app.
///
/// The function builds the menu using the macOS-specific menu builder and sets it on the given AppHandle.
///
/// # Returns
///
/// `Ok(())` if the menu was built and applied successfully, `Err` with the underlying `tauri::Error` otherwise.
///
/// # Examples
///
/// ```no_run
/// use tauri::{AppHandle, AppRuntime};
/// // `app_handle` and `settings` would be obtained from your application state.
/// // set_app_menu(&app_handle, &settings)?;
/// ```
#[cfg(target_os = "macos")]
pub(crate) fn set_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> tauri::Result<()> {
    let menu = platform::macos::menu::build_app_menu(app, settings)?;
    app.set_menu(menu)?;
    Ok(())
}

/// No-op set_app_menu implementation for non-macOS targets.
///
/// This stub exists so callers can invoke `set_app_menu` on any platform; on non-macOS
/// builds it always succeeds and returns `Ok(())`.
///
/// # Examples
///
/// ```no_run
/// // On non-macOS targets this call is a no-op.
/// let app_handle = unimplemented!(); // obtain a tauri::AppHandle in real code
/// let settings = unimplemented!(); // provide actual UserSettings
/// let _ = crate::desktop::set_app_menu(&app_handle, &settings).unwrap();
/// ```
#[cfg(not(target_os = "macos"))]
pub(crate) fn set_app_menu(
    _app: &AppHandle<AppRuntime>,
    _settings: &UserSettings,
) -> tauri::Result<()> {
    Ok(())
}

/// Emits the global settings-changed event with the provided settings to the application runtime.
///
/// Sends `EVENT_SETTINGS_CHANGED` using the given `AppHandle`, with `settings` as the event payload; logs an error to stderr if emission fails.
///
/// # Examples
///
/// ```
/// // given `app: tauri::AppHandle<_>` and `settings: UserSettings`
/// emit_settings_changed(&app, &settings);
/// ```
fn emit_settings_changed(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, settings) {
        eprintln!("Failed to emit settings change: {err}");
    }
}

/// Dispatches a macOS app menu command identified by `id` and performs the corresponding action.
///
/// The `id` is matched against known menu identifiers; specific values trigger actions such as
/// opening the project website, showing the About/updates window, switching transcription mode,
/// or selecting the default microphone. Identifiers that start with known prefixes are treated
/// as parameterized commands:
/// - Prefix for recent transcriptions: the remainder is treated as a transcription id to copy.
/// - Prefix for models: the remainder is treated as a model key to select.
/// - Prefix for microphones: the remainder is treated as a device id; a `dev:` prefix (if present)
///   will be stripped before selection.
///
/// # Examples
///
/// ```no_run
/// // Called from a macOS-only handler with a valid AppHandle and a menu item id.
/// // handle_app_menu_event(&app_handle, "menu.check_updates");
/// ```
fn handle_app_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    use crate::platform::macos::menu::{
        MENU_ID_CHECK_UPDATES, MENU_ID_MIC_DEFAULT, MENU_ID_MIC_PREFIX, MENU_ID_MODEL_PREFIX,
        MENU_ID_MODE_LOCAL, MENU_ID_REPORT_ISSUE, MENU_ID_WEBSITE,
    };

    match id {
        MENU_ID_CHECK_UPDATES => {
            if let Err(err) = glimpse_window::show_about(app) {
                eprintln!("Failed to open Glimpse window for update check: {err}");
            }
        }
        MENU_ID_WEBSITE => {
            let _ = app
                .opener()
                .open_url("https://github.com/LegendarySpy/Glimpse", None::<&str>);
        }
        MENU_ID_REPORT_ISSUE => {
            let _ = app.opener().open_url(FEEDBACK_URL, None::<&str>);
        }
        MENU_ID_MODE_LOCAL => select_transcription_mode(app, TranscriptionMode::Local),
        MENU_ID_MIC_DEFAULT => select_microphone(app, None),
        _ => {
            if let Some(transcription_id) = id.strip_prefix(MENU_ID_RECENT_TRANSCRIPTION_PREFIX) {
                copy_transcription_to_clipboard(app, transcription_id);
            } else if let Some(model_key) = id.strip_prefix(MENU_ID_MODEL_PREFIX) {
                select_local_model(app, model_key);
            } else if let Some(device_id_raw) = id.strip_prefix(MENU_ID_MIC_PREFIX) {
                let device_id = device_id_raw.strip_prefix("dev:").unwrap_or(device_id_raw);
                select_microphone(app, Some(device_id));
            }
        }
    }
}
