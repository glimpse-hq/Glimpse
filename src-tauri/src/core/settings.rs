use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use super::hotkeys;
use crate::settings::{
    canonicalize_app_locale, canonicalize_app_locale_or_default, LlmProvider, RecordingPrunePolicy,
    ThemeMode, TranscriptionMode, UserSettings,
};

use crate::{analytics, model_manager, pill, tray, AppRuntime, AppState, EVENT_SETTINGS_CHANGED};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub app_locale: String,
    pub theme_mode: ThemeMode,
    pub llm_enabled: bool,

    pub cleanup_enabled: bool,
    pub llm_provider: LlmProvider,
    pub llm_endpoint: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub edit_mode_enabled: bool,
    pub media_control_enabled: bool,
    pub auto_update_enabled: bool,
    pub auto_launch_enabled: bool,
    pub recording_prune_policy: RecordingPrunePolicy,
    pub analytics_enabled: bool,
}

fn canonicalize_shortcut_for_storage(shortcut: &str) -> Result<String, String> {
    hotkeys::normalize_recording_shortcut(shortcut)
        .map(|shortcut| shortcut.trim().to_string())
        .map_err(|err| err.to_string())
}

fn validate_update_settings_args(args: &UpdateSettingsArgs) -> Result<(), String> {
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

    let mut enabled_shortcuts: Vec<(&str, handy_keys::Hotkey)> = vec![];
    if args.smart_enabled {
        let raw = args.smart_shortcut.trim();
        let normalized = hotkeys::parse_shortcut(raw)
            .map_err(|err| format!("Smart shortcut is invalid: {err}"))?;
        enabled_shortcuts.push(("Smart", normalized));
    }
    if args.hold_enabled {
        let raw = args.hold_shortcut.trim();
        let normalized = hotkeys::parse_shortcut(raw)
            .map_err(|err| format!("Hold shortcut is invalid: {err}"))?;
        enabled_shortcuts.push(("Hold", normalized));
    }
    if args.toggle_enabled {
        let raw = args.toggle_shortcut.trim();
        let normalized = hotkeys::parse_shortcut(raw)
            .map_err(|err| format!("Toggle shortcut is invalid: {err}"))?;
        enabled_shortcuts.push(("Toggle", normalized));
    }

    for i in 0..enabled_shortcuts.len() {
        for j in (i + 1)..enabled_shortcuts.len() {
            let (name1, normalized1) = &enabled_shortcuts[i];
            let (name2, normalized2) = &enabled_shortcuts[j];
            if normalized1 == normalized2 {
                return Err(format!(
                    "{} and {} shortcuts cannot be the same",
                    name1, name2
                ));
            }

            if hotkeys::shortcuts_conflict(normalized1, normalized2) {
                return Err(format!(
                    "{} shortcut overlaps {} shortcut. Choose a more specific combination.",
                    name1, name2
                ));
            }
        }
    }

    if model_manager::definition(&args.local_model).is_none() {
        return Err("Unknown model selection".into());
    }

    if canonicalize_app_locale(&args.app_locale).is_none() {
        return Err("Unknown app language selection".into());
    }

    if args.llm_enabled && matches!(args.llm_provider, LlmProvider::None) {
        return Err("LLM cannot be enabled when provider is None".into());
    }

    if args.cleanup_enabled && !args.llm_enabled {
        return Err("AI Cleanup cannot be enabled without an active language model".into());
    }

    if args.llm_enabled {
        if matches!(args.llm_provider, LlmProvider::Custom) && args.llm_endpoint.trim().is_empty() {
            return Err("Custom LLM endpoint cannot be empty".into());
        }
        if matches!(args.llm_provider, LlmProvider::OpenAI) && args.llm_api_key.trim().is_empty() {
            return Err("OpenAI API key is required".into());
        }
        if args.llm_model.trim().is_empty() {
            return Err("Choose a language model before enabling AI features".into());
        }
    }

    Ok(())
}

pub(crate) fn complete_onboarding(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<(), String> {
    let mut settings = state.current_settings();
    settings.onboarding_completed = true;
    let next = state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

    analytics::track_onboarding_completed(app);
    Ok(())
}

pub(crate) fn reset_onboarding(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<(), String> {
    let mut settings = state.current_settings();
    settings.onboarding_completed = false;
    let next = state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

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
    validate_update_settings_args(&args)?;

    let mut next = state.current_settings();
    let prev = next.clone();
    next.smart_shortcut = if args.smart_enabled {
        canonicalize_shortcut_for_storage(&args.smart_shortcut)?
    } else {
        args.smart_shortcut
    };
    next.smart_enabled = args.smart_enabled;
    next.hold_shortcut = if args.hold_enabled {
        canonicalize_shortcut_for_storage(&args.hold_shortcut)?
    } else {
        args.hold_shortcut
    };
    next.hold_enabled = args.hold_enabled;
    next.toggle_shortcut = if args.toggle_enabled {
        canonicalize_shortcut_for_storage(&args.toggle_shortcut)?
    } else {
        args.toggle_shortcut
    };
    next.toggle_enabled = args.toggle_enabled;
    next.transcription_mode = args.transcription_mode;
    next.local_model = args.local_model;
    next.microphone_device = args.microphone_device;
    next.language = args.language;
    next.app_locale = canonicalize_app_locale_or_default(&args.app_locale);
    next.theme_mode = args.theme_mode;
    next.llm_enabled = args.llm_enabled;

    next.cleanup_enabled = args.cleanup_enabled;
    next.llm_provider = args.llm_provider;
    next.llm_endpoint = args.llm_endpoint;
    next.llm_api_key = args.llm_api_key;
    next.llm_model = args.llm_model.trim().to_string();
    next.edit_mode_enabled = args.edit_mode_enabled;
    next.media_control_enabled = args.media_control_enabled;
    next.auto_update_enabled = args.auto_update_enabled;
    next.auto_launch_enabled = args.auto_launch_enabled;
    next.recording_prune_policy = args.recording_prune_policy;
    next.analytics_enabled = args.analytics_enabled;

    let launch_changed = prev.auto_launch_enabled != next.auto_launch_enabled;
    if launch_changed {
        crate::sync_launch_at_login(app, next.auto_launch_enabled)?;
    }
    let requested_auto_launch_enabled = next.auto_launch_enabled;

    let next = match state.persist_settings(next) {
        Ok(next) => next,
        Err(err) => {
            if launch_changed {
                if let Err(rollback_err) =
                    crate::sync_launch_at_login(app, prev.auto_launch_enabled)
                {
                    return Err(format!(
                        "{} (also failed to roll back launch at login from {} back to {}: {})",
                        err, requested_auto_launch_enabled, prev.auto_launch_enabled, rollback_err
                    ));
                }
            }
            return Err(err.to_string());
        }
    };

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

    if prev.recording_prune_policy != next.recording_prune_policy {
        crate::schedule_recording_prune(app.clone(), next.clone());
    }

    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::default_local_model;

    fn base_args() -> UpdateSettingsArgs {
        UpdateSettingsArgs {
            smart_shortcut: "Control+Space".to_string(),
            smart_enabled: true,
            hold_shortcut: "Control+Shift+Space".to_string(),
            hold_enabled: false,
            toggle_shortcut: "Control+Alt+Space".to_string(),
            toggle_enabled: false,
            transcription_mode: TranscriptionMode::Local,
            local_model: default_local_model(),
            microphone_device: None,
            language: "en".to_string(),
            app_locale: "system".to_string(),
            theme_mode: ThemeMode::default(),
            llm_enabled: false,

            cleanup_enabled: false,
            llm_provider: LlmProvider::None,
            llm_endpoint: String::new(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            edit_mode_enabled: false,
            media_control_enabled: true,
            auto_update_enabled: true,
            auto_launch_enabled: false,
            recording_prune_policy: RecordingPrunePolicy::Never,
            analytics_enabled: true,
        }
    }

    #[test]
    fn rejects_enabling_llm_without_provider() {
        let mut args = base_args();
        args.llm_enabled = true;

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(err, "LLM cannot be enabled when provider is None");
    }

    #[test]
    fn rejects_enabling_cleanup_without_llm() {
        let mut args = base_args();
        args.cleanup_enabled = true;

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(
            err,
            "AI Cleanup cannot be enabled without an active language model"
        );
    }

    #[test]
    fn rejects_shortcut_collisions_after_normalization() {
        let mut args = base_args();
        args.hold_enabled = true;
        args.hold_shortcut = "Ctrl+Space".to_string();

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(err, "Smart and Hold shortcuts cannot be the same");
    }

    #[test]
    fn accepts_modifier_only_recording_shortcut() {
        let mut args = base_args();
        args.smart_shortcut = "Ctrl".to_string();

        validate_update_settings_args(&args).unwrap();
    }

    #[test]
    fn rejects_enabling_llm_without_explicit_model_selection() {
        let mut args = base_args();
        args.llm_enabled = true;
        args.llm_provider = LlmProvider::Ollama;

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(err, "Choose a language model before enabling AI features");
    }
}
