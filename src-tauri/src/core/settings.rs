use tauri::{AppHandle, Emitter};

use crate::settings::{LlmProvider, TranscriptionMode, UserSettings};
use crate::{analytics, model_manager, pill, tray, AppRuntime, AppState, EVENT_SETTINGS_CHANGED};

#[derive(Debug)]
pub(crate) struct UpdateSettingsArgs {
    pub smart_shortcut: String,
    pub smart_enabled: bool,
    pub hold_shortcut: String,
    pub hold_enabled: bool,
    pub toggle_shortcut: String,
    pub toggle_enabled: bool,
    pub transcription_mode: TranscriptionMode,
    pub local_model: String,
    pub microphone_device: Option<String>,
    pub language: String,
    pub llm_cleanup_enabled: bool,
    pub llm_provider: LlmProvider,
    pub llm_endpoint: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub edit_mode_enabled: bool,
}

pub(crate) fn complete_onboarding(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<(), String> {
    let mut settings = state.current_settings();
    let model = settings.local_model.clone();
    settings.onboarding_completed = true;
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    analytics::track_onboarding_completed(app, &model);
    Ok(())
}

pub(crate) fn reset_onboarding(state: &AppState) -> Result<(), String> {
    let mut settings = state.current_settings();
    settings.onboarding_completed = false;
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn set_user_name(
    name: String,
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<UserSettings, String> {
    let mut settings = state.current_settings();
    settings.user_name = name.trim().to_string();
    let next = state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

    Ok(next)
}

pub(crate) fn update_settings(
    args: UpdateSettingsArgs,
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<UserSettings, String> {
    if args.smart_enabled && args.smart_shortcut.trim().is_empty() {
        return Err("Smart shortcut cannot be empty when enabled".into());
    }

    if args.hold_enabled && args.hold_shortcut.trim().is_empty() {
        return Err("Hold shortcut cannot be empty when enabled".into());
    }

    if args.toggle_enabled && args.toggle_shortcut.trim().is_empty() {
        return Err("Toggle shortcut cannot be empty when enabled".into());
    }

    if !args.smart_enabled && !args.hold_enabled && !args.toggle_enabled {
        return Err("At least one recording mode must be enabled".into());
    }

    let mut enabled_shortcuts: Vec<(&str, &str)> = vec![];
    if args.smart_enabled {
        enabled_shortcuts.push(("Smart", args.smart_shortcut.trim()));
    }
    if args.hold_enabled {
        enabled_shortcuts.push(("Hold", args.hold_shortcut.trim()));
    }
    if args.toggle_enabled {
        enabled_shortcuts.push(("Toggle", args.toggle_shortcut.trim()));
    }

    for i in 0..enabled_shortcuts.len() {
        for j in (i + 1)..enabled_shortcuts.len() {
            let (name1, shortcut1) = enabled_shortcuts[i];
            let (name2, shortcut2) = enabled_shortcuts[j];
            if shortcut1.to_lowercase() == shortcut2.to_lowercase() {
                return Err(format!(
                    "{} and {} shortcuts cannot be the same",
                    name1, name2
                ));
            }
        }
    }

    if model_manager::definition(&args.local_model).is_none() {
        return Err("Unknown model selection".into());
    }

    if args.llm_cleanup_enabled && !matches!(args.llm_provider, LlmProvider::None) {
        if matches!(args.llm_provider, LlmProvider::Custom) && args.llm_endpoint.trim().is_empty() {
            return Err("Custom LLM endpoint cannot be empty".into());
        }
        if matches!(args.llm_provider, LlmProvider::OpenAI) && args.llm_api_key.trim().is_empty() {
            return Err("OpenAI API key is required".into());
        }
    }

    let mut next = state.current_settings();
    let prev = next.clone();
    next.smart_shortcut = args.smart_shortcut;
    next.smart_enabled = args.smart_enabled;
    next.hold_shortcut = args.hold_shortcut;
    next.hold_enabled = args.hold_enabled;
    next.toggle_shortcut = args.toggle_shortcut;
    next.toggle_enabled = args.toggle_enabled;
    next.transcription_mode = args.transcription_mode;
    next.local_model = args.local_model;
    next.microphone_device = args.microphone_device;
    next.language = args.language;
    next.llm_cleanup_enabled = args.llm_cleanup_enabled;
    next.llm_provider = args.llm_provider;
    next.llm_endpoint = args.llm_endpoint;
    next.llm_api_key = args.llm_api_key;
    next.llm_model = args.llm_model;
    next.edit_mode_enabled = args.edit_mode_enabled;

    let next = state
        .persist_settings(next)
        .map_err(|err| err.to_string())?;

    state.request_preflight_refresh();

    pill::register_shortcuts(app).map_err(|err| err.to_string())?;

    if prev.transcription_mode != next.transcription_mode
        || prev.local_model != next.local_model
        || prev.microphone_device != next.microphone_device
    {
        if let Err(err) = tray::refresh_tray_menu(app, &next) {
            eprintln!("Failed to refresh tray menu: {err}");
        }
        #[cfg(target_os = "macos")]
        if let Err(err) = crate::set_app_menu(app, &next) {
            eprintln!("Failed to refresh app menu: {err}");
        }
    }

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

    Ok(next)
}
