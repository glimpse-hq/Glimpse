use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use super::hotkeys;
use crate::settings::{
    canonicalize_app_locale, canonicalize_app_locale_or_default, LlmProvider, RecordingPrunePolicy,
    ShortcutBinding, ShortcutBindings, ThemeMode, TranscriptionMode, UserSettings,
};

use crate::{
    analytics, auto_dictionary, model_manager, pill, tray, AppRuntime, AppState,
    EVENT_SETTINGS_CHANGED,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateSettingsArgs {
    pub smart_shortcut: String,
    pub smart_enabled: bool,
    pub hold_shortcut: String,
    pub hold_enabled: bool,
    pub toggle_shortcut: String,
    pub toggle_enabled: bool,
    pub shortcut_bindings: ShortcutBindings,
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
    pub auto_dictionary_enabled: bool,
    pub media_control_enabled: bool,
    pub auto_update_enabled: bool,
    pub auto_launch_enabled: bool,
    pub recording_prune_policy: RecordingPrunePolicy,
    pub analytics_enabled: bool,
}

fn canonicalize_shortcut_for_storage(shortcut: &str) -> Result<String, String> {
    let hotkey = hotkeys::parse_shortcut(shortcut).map_err(|err| err.to_string())?;
    hotkeys::validate_recording_shortcut(&hotkey).map_err(|err| err.to_string())?;
    Ok(hotkey.to_string())
}

fn canonicalize_shortcut_binding(binding: &ShortcutBinding) -> Result<ShortcutBinding, String> {
    Ok(ShortcutBinding {
        shortcut: canonicalize_shortcut_for_storage(&binding.shortcut)?,
        temporary: binding.temporary,
        cleanup_enabled: binding.cleanup_enabled,
    })
}

fn canonicalize_shortcut_bindings(args: &UpdateSettingsArgs) -> Result<ShortcutBindings, String> {
    let normalize_mode = |bindings: &[ShortcutBinding]| -> Result<Vec<ShortcutBinding>, String> {
        let mut normalized = Vec::new();
        for binding in bindings.iter().take(3) {
            if binding.shortcut.trim().is_empty() {
                continue;
            }
            normalized.push(canonicalize_shortcut_binding(binding)?);
        }
        Ok(normalized)
    };

    Ok(ShortcutBindings {
        smart: normalize_mode(&args.shortcut_bindings.smart)?,
        hold: normalize_mode(&args.shortcut_bindings.hold)?,
        toggle: normalize_mode(&args.shortcut_bindings.toggle)?,
    })
}

fn validate_update_settings_args(args: &UpdateSettingsArgs) -> Result<(), String> {
    if !args.smart_enabled && !args.hold_enabled && !args.toggle_enabled {
        return Err("At least one recording mode must be enabled".into());
    }

    let mut enabled_shortcuts: Vec<(&str, hotkeys::Hotkey)> = vec![];
    if args.smart_enabled {
        for binding in &args.shortcut_bindings.smart {
            let raw = binding.shortcut.trim();
            if raw.is_empty() {
                continue;
            }
            let normalized = hotkeys::parse_shortcut(raw)
                .map_err(|err| format!("Smart shortcut is invalid: {err}"))?;
            hotkeys::validate_recording_shortcut(&normalized)
                .map_err(|err| format!("Smart shortcut is invalid: {err}"))?;
            enabled_shortcuts.push(("Smart", normalized));
        }
    }
    if args.hold_enabled {
        for binding in &args.shortcut_bindings.hold {
            let raw = binding.shortcut.trim();
            if raw.is_empty() {
                continue;
            }
            let normalized = hotkeys::parse_shortcut(raw)
                .map_err(|err| format!("Hold shortcut is invalid: {err}"))?;
            hotkeys::validate_recording_shortcut(&normalized)
                .map_err(|err| format!("Hold shortcut is invalid: {err}"))?;
            enabled_shortcuts.push(("Hold", normalized));
        }
    }
    if args.toggle_enabled {
        for binding in &args.shortcut_bindings.toggle {
            let raw = binding.shortcut.trim();
            if raw.is_empty() {
                continue;
            }
            let normalized = hotkeys::parse_shortcut(raw)
                .map_err(|err| format!("Toggle shortcut is invalid: {err}"))?;
            hotkeys::validate_recording_shortcut(&normalized)
                .map_err(|err| format!("Toggle shortcut is invalid: {err}"))?;
            enabled_shortcuts.push(("Toggle", normalized));
        }
    }

    if args.smart_enabled && !enabled_shortcuts.iter().any(|(name, _)| *name == "Smart") {
        return Err("Smart shortcut cannot be empty when enabled".into());
    }
    if args.hold_enabled && !enabled_shortcuts.iter().any(|(name, _)| *name == "Hold") {
        return Err("Hold shortcut cannot be empty when enabled".into());
    }
    if args.toggle_enabled && !enabled_shortcuts.iter().any(|(name, _)| *name == "Toggle") {
        return Err("Toggle shortcut cannot be empty when enabled".into());
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

    let shortcut_cleanup_enabled = args
        .shortcut_bindings
        .smart
        .iter()
        .chain(args.shortcut_bindings.hold.iter())
        .chain(args.shortcut_bindings.toggle.iter())
        .any(|binding| binding.cleanup_enabled);
    if (args.cleanup_enabled || shortcut_cleanup_enabled) && !args.llm_enabled {
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
    let shortcut_bindings = canonicalize_shortcut_bindings(&args)?;

    let mut next = state.current_settings();
    let prev = next.clone();
    next.shortcut_bindings = shortcut_bindings;
    next.smart_shortcut = next
        .shortcut_bindings
        .smart
        .first()
        .map(|binding| binding.shortcut.clone())
        .unwrap_or(args.smart_shortcut);
    next.smart_enabled = args.smart_enabled;
    next.hold_shortcut = next
        .shortcut_bindings
        .hold
        .first()
        .map(|binding| binding.shortcut.clone())
        .unwrap_or(args.hold_shortcut);
    next.hold_enabled = args.hold_enabled;
    next.toggle_shortcut = next
        .shortcut_bindings
        .toggle
        .first()
        .map(|binding| binding.shortcut.clone())
        .unwrap_or(args.toggle_shortcut);
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
    next.auto_dictionary_enabled = args.auto_dictionary_enabled;
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
    auto_dictionary::sync_ignored_dictionary_entries(&next.dictionary);

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
    use crate::settings::{default_local_model, default_shortcut_bindings};

    fn base_args() -> UpdateSettingsArgs {
        UpdateSettingsArgs {
            smart_shortcut: "Control+Space".to_string(),
            smart_enabled: true,
            hold_shortcut: "Control+Shift+Space".to_string(),
            hold_enabled: false,
            toggle_shortcut: "Control+Alt+Space".to_string(),
            toggle_enabled: false,
            shortcut_bindings: default_shortcut_bindings(),
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
            auto_dictionary_enabled: false,
            media_control_enabled: true,
            auto_update_enabled: true,
            auto_launch_enabled: false,
            recording_prune_policy: RecordingPrunePolicy::Never,
            analytics_enabled: true,
        }
    }

    fn set_primary_shortcut(args: &mut UpdateSettingsArgs, mode: &str, shortcut: &str) {
        let binding = ShortcutBinding {
            shortcut: shortcut.to_string(),
            temporary: false,
            cleanup_enabled: false,
        };

        match mode {
            "Smart" => {
                args.smart_shortcut = shortcut.to_string();
                args.shortcut_bindings.smart = vec![binding];
            }
            "Hold" => {
                args.hold_shortcut = shortcut.to_string();
                args.shortcut_bindings.hold = vec![binding];
            }
            "Toggle" => {
                args.toggle_shortcut = shortcut.to_string();
                args.shortcut_bindings.toggle = vec![binding];
            }
            _ => unreachable!("unknown shortcut mode"),
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
        set_primary_shortcut(&mut args, "Hold", "Ctrl+Space");

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(err, "Smart and Hold shortcuts cannot be the same");
    }

    #[test]
    fn accepts_modifier_only_recording_shortcut() {
        let mut args = base_args();
        set_primary_shortcut(&mut args, "Smart", "Ctrl");

        validate_update_settings_args(&args).unwrap();
    }

    #[test]
    fn rejects_capslock_recording_shortcut() {
        let mut args = base_args();
        set_primary_shortcut(&mut args, "Smart", "CapsLock");

        let err = validate_update_settings_args(&args).unwrap_err();

        assert_eq!(
            err,
            "Smart shortcut is invalid: CapsLock cannot be used as a recording shortcut"
        );
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
