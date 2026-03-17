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

pub(crate) fn attach_menu_handlers(
    builder: tauri::Builder<AppRuntime>,
) -> tauri::Builder<AppRuntime> {
    #[cfg(target_os = "macos")]
    let builder = builder.on_menu_event(|app, event| {
        handle_app_menu_event(app, event.id().as_ref());
    });

    builder
}

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

    // Brief delay so the webview has time to render before the window appears.
    let app_handle = handle.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = glimpse_window::show(&app_handle);
    });
}

pub(crate) fn refresh_menus(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if let Err(err) = tray::refresh_tray_menu(app, settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }
    if let Err(err) = set_app_menu(app, settings) {
        eprintln!("Failed to refresh app menu: {err}");
    }
}

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

#[cfg(target_os = "macos")]
pub(crate) fn set_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> tauri::Result<()> {
    let menu = platform::macos::menu::build_app_menu(app, settings)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_app_menu(
    _app: &AppHandle<AppRuntime>,
    _settings: &UserSettings,
) -> tauri::Result<()> {
    Ok(())
}

fn emit_settings_changed(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, settings) {
        eprintln!("Failed to emit settings change: {err}");
    }
}

#[cfg(target_os = "macos")]
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
