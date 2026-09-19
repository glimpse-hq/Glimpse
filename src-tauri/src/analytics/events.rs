// Product events. Each function says in plain English what it records.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::Manager;

use super::*;
use crate::{AppRuntime, AppState, settings::UserSettings};

/// Records, only on the opt-out click, that this install opted out.
/// Final event sent; bypasses the enabled check since the setting is already off.
pub fn track_analytics_opt_out(app: &tauri::AppHandle<AppRuntime>) {
    if let Some(event) = build_event(app, "analytics_opt_out", json!({}), false) {
        send(event);
    }
}

/// Records that you opened the app (fires on every launch). Also refreshes
/// your profile with license status, the selected speech model, lifetime
/// dictation counts, the dictation language (auto, a supported language code,
/// or other), the app and OS display languages, and on macOS whether the
/// microphone and accessibility permissions are granted.
pub fn track_app_started(app: &tauri::AppHandle<AppRuntime>) {
    let Some(mut event) = build_event(app, "app_started", json!({}), true) else {
        return;
    };
    let state = app.state::<AppState>();
    let settings = state.current_settings();
    let license = state.license_snapshot();
    let stats = state.storage().lifetime_stats().ok();
    let mut profile = json!({
        "license_status": license.as_ref().map(|l| l.status),
        "license_edition": license.as_ref().and_then(|l| l.edition),
        "speech_model": crate::speech::selected_model(&settings),
        "lifetime_words": stats.as_ref().map(|s| s.words),
        "lifetime_dictations": stats.as_ref().map(|s| s.dictations),
        "speech_language": language_label(&settings.language),
        "ui_locale": crate::native_i18n::ui_locale(&settings),
        "system_language": crate::native_i18n::system_language()
            .unwrap_or_else(|| "other".to_string()),
    });
    // The cached mic grant only: a fresh TCC check can block for minutes.
    #[cfg(target_os = "macos")]
    {
        let mic = match crate::permissions::microphone_permission_known() {
            Some(true) => "granted",
            Some(false) => "denied",
            None => "unknown",
        };
        let accessibility = if crate::permissions::check_accessibility_permission() {
            "granted"
        } else {
            "denied"
        };
        for (key, value) in [
            ("mic_permission", mic),
            ("accessibility_permission", accessibility),
        ] {
            profile[key] = value.into();
            let _ = event.insert_prop(key, value);
        }
    }
    bound_remote_labels(&mut profile);
    let _ = event.insert_prop("$set", profile);
    send(event);
}

/// Records the very first time you ever run the app, once per install.
pub fn track_app_installed(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "app_installed", json!({}));
}

/// What `transcription_completed` records. Every field is a bounded code,
/// a number, or a flag; the transcribed text itself is never included.
#[derive(Default, serde::Serialize)]
pub struct TranscriptionEvent<'a> {
    /// local, local_streaming, or remote.
    pub mode: &'a str,
    pub model: &'a str,
    pub llm_cleaned: bool,
    pub audio_duration_seconds: f32,
    /// Whole processing time: speech model, language model, and insertion.
    pub transcription_duration_seconds: f32,
    pub word_count: u32,
    /// microphone, uploaded_file, recording, or cli.
    pub audio_source: &'a str,
    /// True when re-running a transcription that failed earlier.
    pub retry: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asr_seconds: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_seconds: Option<f32>,
    /// off, ok, failed, or skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_outcome: Option<&'a str>,
    /// Key release to text inserted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_latency_seconds: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<&'a str>,
    /// Language the speech model detected, when the setting is auto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_language: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracks: Option<u8>,
}

/// Records that a transcription succeeded, with the fields described on
/// `TranscriptionEvent`. The transcribed text itself is never included.
pub fn track_transcription_completed(
    app: &tauri::AppHandle<AppRuntime>,
    props: TranscriptionEvent,
) {
    let props = serde_json::to_value(&props).unwrap_or_else(|_| json!({}));
    capture_event(app, "transcription_completed", props);
}

/// Records that a transcription failed: stage, mode, speech model, bounded
/// reason, audio source, and audio duration.
pub fn track_transcription_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    mode: &str,
    model: &str,
    reason: impl Into<ErrorDetail>,
    audio_duration_seconds: Option<f32>,
    audio_source: &str,
) {
    let mut props = json!({
        "stage": stage,
        "mode": mode,
        "model": model,
        "audio_duration_seconds": audio_duration_seconds,
        "audio_source": audio_source,
    });
    reason.into().insert_into(&mut props);
    capture_event(app, "transcription_failed", props);
}

/// Records a dictation the app threw away before it reached you: a bounded
/// reason code, the audio length and input level as buckets, the speech model,
/// and its engine family. Never records audio or transcript content.
pub fn track_dictation_discarded(
    app: &tauri::AppHandle<AppRuntime>,
    reason: &str,
    audio_seconds: Option<f32>,
    rms: Option<f32>,
) {
    let settings = app.state::<AppState>().current_settings();
    capture_event(
        app,
        "dictation_discarded",
        json!({
            "reason": reason,
            "audio_length": audio_length_bucket(audio_seconds),
            "level": level_bucket(rms),
            "model": crate::speech::selected_model(&settings),
            "engine": speech_engine(&settings),
        }),
    );
}

const KEY_FIRST_DICTATION_REPORTED: &str = "analytics_first_dictation_reported";
// Keeps the store read off the keypress path after the first check.
static FIRST_DICTATION_REPORTED: AtomicBool = AtomicBool::new(false);

/// Records the very first time you press a dictation shortcut, once per
/// install, with a bounded outcome: recording started, the microphone was
/// blocked, or the device failed to open.
pub fn track_first_dictation_attempted(app: &tauri::AppHandle<AppRuntime>, outcome: &str) {
    if FIRST_DICTATION_REPORTED.load(Ordering::Relaxed) {
        return;
    }
    // Build first so an opted-out attempt never burns the marker.
    let Some(event) = build_event(
        app,
        "first_dictation_attempted",
        json!({ "outcome": outcome }),
        true,
    ) else {
        return;
    };
    let store = &app.state::<AppState>().settings_store;
    let already = store
        .read_app_value::<String>(KEY_FIRST_DICTATION_REPORTED, String::new())
        .map(|v| !v.is_empty())
        .unwrap_or(true);
    FIRST_DICTATION_REPORTED.store(true, Ordering::Relaxed);
    if already
        || store
            .write_app_value(KEY_FIRST_DICTATION_REPORTED, &"1".to_string())
            .is_err()
    {
        return;
    }
    send(event);
}

/// Records that a bounded feature was used, never what it was used with.
pub fn track_feature_used(app: &tauri::AppHandle<AppRuntime>, feature: &str) {
    let feature = match feature {
        "dictionary" | "replacements" | "import" | "library" => feature,
        _ => "other",
    };
    capture_event(app, "feature_used", json!({ "feature": feature }));
}

/// Frontend entry for `track_feature_used`.
#[tauri::command]
pub fn track_feature_used_command(app: tauri::AppHandle<AppRuntime>, feature: String) {
    track_feature_used(&app, &feature);
}

/// Records a bounded onboarding screen identifier without form contents.
#[tauri::command]
pub fn track_onboarding_step_viewed(app: tauri::AppHandle<AppRuntime>, step: String) {
    let step = match step.as_str() {
        "welcome" | "import" | "model" | "model_downloading" | "permissions" | "license"
        | "done" | "practice" => step.as_str(),
        _ => "unknown",
    };
    capture_event(&app, "onboarding_step_viewed", json!({ "step": step }));
}

/// Records that a one-time ask appeared, with usage as coarse
/// buckets rather than exact counts. Never records any answer.
pub fn track_ask_prompt_shown(
    app: &tauri::AppHandle<AppRuntime>,
    kind: &str,
    dictations: &str,
    days_installed: &str,
) {
    capture_event(
        app,
        &format!("{kind}_prompt_shown"),
        json!({ "dictations": dictations, "days_installed": days_installed }),
    );
}

/// Records that an ask sent someone to its destination. The form itself
/// is anonymous and carries nothing from the app.
pub fn track_ask_prompt_opened(app: &tauri::AppHandle<AppRuntime>, kind: &str) {
    capture_event(app, &format!("{kind}_prompt_opened"), json!({}));
}

/// Records that an ask was declined.
pub fn track_ask_prompt_dismissed(app: &tauri::AppHandle<AppRuntime>, kind: &str) {
    capture_event(app, &format!("{kind}_prompt_dismissed"), json!({}));
}

/// Records that the trial ran out, once per install.
pub fn track_trial_expired(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "trial_expired", json!({}));
}

/// Records that a license was activated, which edition it granted, on which
/// day of the trial, and how: after returning from checkout (deep_link), or by
/// pasting a key (pasted_key) or an order id (pasted_order_id). The key itself
/// is never recorded.
pub fn track_license_activated(
    app: &tauri::AppHandle<AppRuntime>,
    edition: Option<&str>,
    trial_day: Option<i64>,
    input_shape: &str,
) {
    let via = match input_shape {
        _ if crate::license::checkout_returned_this_session() => "deep_link",
        "key" => "pasted_key",
        "order_id" => "pasted_order_id",
        _ => "other",
    };
    capture_event(
        app,
        "license_activated",
        json!({
            "edition": edition.unwrap_or("unknown"),
            "trial_day": trial_day,
            "via": via,
        }),
    );
}

/// Records that an activation attempt failed, as a bounded reason plus what
/// the typed text looked like. The text itself is never recorded.
pub fn track_license_activation_failed(
    app: &tauri::AppHandle<AppRuntime>,
    message: &str,
    input_shape: &'static str,
) {
    capture_event(
        app,
        "license_activation_failed",
        json!({ "reason": classify_activation_failure(message), "input_shape": input_shape }),
    );
}

/// Classifies activation input by shape only: a key, a Polar order id (a bare
/// UUID), the masked key from the portal, a discount code, or something else.
pub fn activation_input_shape(raw: &str) -> &'static str {
    let trimmed = raw.trim();
    if crate::license::find_license_key(trimmed).is_some() {
        return "key";
    }
    let is_uuid = trimmed.len() == 36
        && trimmed.split('-').map(str::len).eq([8, 4, 4, 4, 12])
        && trimmed.chars().all(|c| c == '-' || c.is_ascii_hexdigit());
    if is_uuid {
        "order_id"
    } else if trimmed.contains('*') {
        "masked_key"
    } else if (3..=24).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == '-')
        && trimmed.matches('-').count() < 2
    {
        "discount_code"
    } else {
        "unknown"
    }
}

/// Records that the checkout deep link brought the user back into the app.
pub fn track_checkout_returned(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "checkout_returned", json!({}));
}

/// Records which locked feature an unlicensed user ran into.
#[tauri::command]
pub fn track_gate_blocked(app: tauri::AppHandle<AppRuntime>, feature: String) {
    let feature = match feature.as_str() {
        "personalization" | "library" | "record" | "cleanup" | "providers" | "api" => {
            feature.as_str()
        }
        _ => "other",
    };
    capture_event(&app, "gate_blocked", json!({ "feature": feature }));
}

/// Records that a locked feature was shown, and where.
#[tauri::command]
pub fn track_paywall_shown(app: tauri::AppHandle<AppRuntime>, source: String) {
    capture_event(&app, "paywall_shown", json!({ "source": source }));
}

/// Records that a locked feature or buy button was clicked, where, and for which tier.
#[tauri::command]
pub fn track_paywall_clicked(
    app: tauri::AppHandle<AppRuntime>,
    source: String,
    tier: Option<String>,
) {
    let tier = match tier.as_deref() {
        Some("personal") => Some("personal"),
        Some("commercial") => Some("commercial"),
        _ => None,
    };
    capture_event(
        &app,
        "paywall_clicked",
        json!({ "source": source, "tier": tier }),
    );
}

/// Records selected product-setting toggles after settings persist.
pub fn track_setting_changed(
    app: &tauri::AppHandle<AppRuntime>,
    setting: &str,
    from_value: bool,
    to_value: bool,
) {
    capture_event(
        app,
        "settings_changed",
        json!({
            "setting": setting,
            "from_value": from_value,
            "to_value": to_value,
        }),
    );
}

/// Compares persisted settings and records changes to product-feature toggles
/// and to the selected speech model.
pub fn track_settings_changes(
    app: &tauri::AppHandle<AppRuntime>,
    previous: &UserSettings,
    next: &UserSettings,
) {
    for (setting, from_value, to_value) in [
        (
            "shortcut_cleanup_enabled",
            previous.shortcut_bindings.any_cleanup_enabled(),
            next.shortcut_bindings.any_cleanup_enabled(),
        ),
        (
            "remote_speech_enabled",
            previous.remote_speech_enabled,
            next.remote_speech_enabled,
        ),
        (
            "auto_dictionary_enabled",
            previous.auto_dictionary_enabled,
            next.auto_dictionary_enabled,
        ),
    ] {
        if from_value != to_value {
            track_setting_changed(app, setting, from_value, to_value);
        }
    }

    // Compared after bounding, so edits to a typed remote model name that
    // all reduce to the same label don't count as switches.
    let mut models = json!([
        crate::speech::selected_model(previous),
        crate::speech::selected_model(next),
    ]);
    bound_remote_labels(&mut models);
    if let [from, to] = models.as_array().map(Vec::as_slice).unwrap_or_default()
        && from != to
    {
        track_model_changed(
            app,
            from.as_str().unwrap_or_default(),
            to.as_str().unwrap_or_default(),
        );
    }
}

/// Records the recording phase, a bounded failure reason, and whether the
/// default or a selected microphone was requested. Never records its name.
pub fn track_recording_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    reason: impl Into<ErrorDetail>,
    input: &str,
) {
    let mut props = json!({ "stage": stage, "input": input });
    reason.into().insert_into(&mut props);
    capture_event(app, "recording_failed", props);
}

/// Records when remote speech falls back to a local model, including the
/// bounded provider failure reason and whether fallback was available.
pub fn track_transcription_fallback(
    app: &tauri::AppHandle<AppRuntime>,
    remote_model: &str,
    local_model: &str,
    reason: &str,
    outcome: &str,
) {
    capture_event(
        app,
        "transcription_fallback",
        json!({
            "remote_model": remote_model,
            "local_model": local_model,
            "reason": reason,
            "outcome": outcome,
        }),
    );
}

/// Records the name of a speech model you downloaded.
pub fn track_model_downloaded(app: &tauri::AppHandle<AppRuntime>, model: &str) {
    capture_event(app, "model_downloaded", json!({ "model": model }));
}

/// Records a model download/install phase and bounded failure reason.
pub fn track_model_download_failed(
    app: &tauri::AppHandle<AppRuntime>,
    model: &str,
    stage: &str,
    reason: impl Into<ErrorDetail>,
) {
    let mut props = json!({ "model": model, "stage": stage });
    reason.into().insert_into(&mut props);
    capture_event(app, "model_download_failed", props);
}

/// Records a manual or automatic update phase and bounded failure reason.
pub fn track_update_failed(
    app: &tauri::AppHandle<AppRuntime>,
    source: &str,
    stage: &str,
    version: Option<&str>,
    reason: impl Into<ErrorDetail>,
) {
    let mut props = json!({
        "source": source,
        "stage": stage,
        "version": version.unwrap_or("unknown"),
    });
    reason.into().insert_into(&mut props);
    capture_event(app, "update_failed", props);
}

/// Reduces a shortcut to its canonical parsed form so only values the parser
/// can produce reach analytics.
pub fn canonical_shortcut(shortcut: &str) -> String {
    crate::core::hotkeys::parse_shortcut(shortcut)
        .map(|hotkey| hotkey.to_string())
        .unwrap_or_else(|_| "invalid".to_string())
}

/// Records that you finished the first-run setup, which dictation shortcut
/// you ended up on, whether you completed the practice dictation, and whether
/// the microphone and accessibility permissions were granted at that point.
pub fn track_onboarding_completed(
    app: &tauri::AppHandle<AppRuntime>,
    smart_shortcut: &str,
    first_dictation: bool,
) {
    capture_event(
        app,
        "onboarding_completed",
        json!({
            "smart_shortcut": smart_shortcut,
            "first_dictation": first_dictation,
            "mic_granted": crate::permissions::check_microphone_permission(),
            "accessibility_granted": crate::permissions::check_accessibility_permission(),
        }),
    );
}

/// Flushes PostHog's global worker on app exit; `capture` only enqueues.
pub fn track_app_exited(
    app: &tauri::AppHandle<AppRuntime>,
    uptime_seconds: f64,
    transcription_count: u32,
) {
    if let Some(event) = build_event(
        app,
        "app_exited",
        json!({
            "uptime_seconds": uptime_seconds,
            "transcription_count": transcription_count,
        }),
        true,
    ) {
        send(event);
    }
    let _ = tauri::async_runtime::block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(2), posthog_rs::shutdown()).await
    });
}
