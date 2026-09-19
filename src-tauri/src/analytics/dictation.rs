// Dictation events: stalls, cancels, language model failures, paste edits.

use std::sync::atomic::{AtomicBool, Ordering};

use glimpse_speech::remote::{RemoteError, RemoteErrorKind};
use serde_json::json;

use super::*;
use crate::settings::{Personality, UserSettings};

// Ids of the personalities every install starts with (see `default_personalities`).
const BUILTIN_PERSONALITIES: &[(&str, &str)] = &[
    ("messaging", "builtin:messaging"),
    ("email", "builtin:email"),
    ("notes", "builtin:notes"),
    ("coding", "builtin:coding"),
];

const LLM_PROVIDERS: &[&str] = &[
    "apple",
    "lmstudio",
    "ollama",
    "openai",
    "anthropic",
    "google",
    "xai",
    "groq",
    "cerebras",
    "sambanova",
    "together",
    "openrouter",
    "perplexity",
    "deepseek",
    "fireworks",
    "mistral",
];

/// The configured language model provider as a fixed id; anything not built
/// in is "custom". Never the endpoint or the typed model name.
pub fn llm_provider_kind(settings: &UserSettings) -> &'static str {
    let provider = settings.llm_provider.trim();
    LLM_PROVIDERS
        .iter()
        .find(|id| **id == provider)
        .copied()
        .unwrap_or("custom")
}

/// "none", "builtin:<id>" for the shipped personalities, or "custom".
pub fn personality_label(personality: Option<&Personality>) -> &'static str {
    let Some(personality) = personality else {
        return "none";
    };
    BUILTIN_PERSONALITIES
        .iter()
        .find(|(id, _)| *id == personality.id)
        .map_or("custom", |(_, label)| *label)
}

/// A language code from the known language table, "auto", or "other".
pub fn language_label(code: &str) -> &'static str {
    let code = code.trim();
    // An empty setting means the model detects the language.
    if code.is_empty() || code.eq_ignore_ascii_case("auto") {
        return "auto";
    }
    let primary = code.split(['-', '_']).next().unwrap_or_default();
    crate::model_language_table::known_language_code(&primary.to_ascii_lowercase())
        .unwrap_or("other")
}

/// Speech engine family for the selected model: whisper, parakeet, nemotron,
/// apple, transcribe, remote, or unknown.
pub fn speech_engine(settings: &UserSettings) -> &'static str {
    if crate::remote_speech::is_configured(settings) {
        return "remote";
    }
    crate::speech::catalog::definition(&settings.local_model)
        .map_or("unknown", |model| model.engine.as_str())
}

/// Buckets a recording's RMS level around the too-quiet rejection threshold.
pub fn level_bucket(rms: Option<f32>) -> &'static str {
    let threshold = crate::recorder::MIN_RMS_ENERGY;
    match rms {
        None => "unknown",
        Some(rms) if rms < threshold => "silent",
        Some(rms) if rms < threshold * 10.0 => "low",
        Some(rms) if rms < threshold * 250.0 => "normal",
        Some(_) => "loud",
    }
}

fn llm_failure_reason(err: &RemoteError) -> &'static str {
    let kind = match err.kind {
        RemoteErrorKind::RateLimited => "rate_limited",
        RemoteErrorKind::QuotaExceeded => "quota_exceeded",
        RemoteErrorKind::Unauthorized => "unauthorized",
        RemoteErrorKind::InvalidRequest => "invalid_request",
        RemoteErrorKind::NotFound => "not_found",
        RemoteErrorKind::UpstreamUnavailable => "upstream_unavailable",
        RemoteErrorKind::Other => "other",
    };
    // Without an HTTP status the message is the only hint of timeout vs connect.
    if err.status == 0
        && matches!(
            err.kind,
            RemoteErrorKind::UpstreamUnavailable | RemoteErrorKind::Other
        )
    {
        match classify_failure_reason(&err.message) {
            "unknown" => kind,
            reason => reason,
        }
    } else {
        kind
    }
}

/// Records that the language model step of a dictation failed: cleanup or
/// edit, the provider as a fixed id, a bounded reason, the HTTP status code,
/// and whether the error looked temporary. Never the prompt, text, or endpoint.
pub fn track_llm_failed(
    app: &tauri::AppHandle<AppRuntime>,
    kind: &str,
    provider_kind: &str,
    err: &RemoteError,
    transient: bool,
) {
    capture_event(
        app,
        "llm_failed",
        json!({
            "kind": kind,
            "provider_kind": provider_kind,
            "reason": llm_failure_reason(err),
            "status": (err.status != 0).then_some(err.status),
            "transient": transient,
        }),
    );
}

static CLEANUP_SKIP_REPORTED: AtomicBool = AtomicBool::new(false);
static EDIT_SKIP_REPORTED: AtomicBool = AtomicBool::new(false);

/// Records, at most once per app session for each kind (cleanup or edit),
/// that the language model step was skipped because the last check found the
/// provider unreachable.
pub fn track_llm_skipped(app: &tauri::AppHandle<AppRuntime>, kind: &str) {
    let reported = if kind == "edit" {
        &EDIT_SKIP_REPORTED
    } else {
        &CLEANUP_SKIP_REPORTED
    };
    if reported.swap(true, Ordering::Relaxed) {
        return;
    }
    capture_event(
        app,
        "llm_skipped",
        json!({ "kind": kind, "reason": "preflight_unavailable" }),
    );
}

/// Records that a dictation was still unfinished well past its expected time:
/// the step it was on, the speech model, local or remote, and the audio
/// length as a bucket. Sent at most once per dictation.
pub fn track_dictation_stalled(
    app: &tauri::AppHandle<AppRuntime>,
    model: &str,
    mode: &str,
    audio_seconds: f32,
) {
    capture_event(
        app,
        "dictation_stalled",
        json!({
            "stage": activity().as_str(),
            "model": model,
            "mode": mode,
            "audio_length": audio_length_bucket(Some(audio_seconds)),
        }),
    );
}

/// Records that you cancelled a dictation: the step it was on (recording,
/// transcribing, or cleanup), how (escape or shortcut), and the audio length
/// as a bucket.
pub fn track_dictation_cancelled(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    how: &str,
    audio_seconds: Option<f32>,
) {
    capture_event(
        app,
        "dictation_cancelled",
        json!({
            "stage": stage,
            "how": how,
            "audio_length": audio_length_bucket(audio_seconds),
        }),
    );
}

/// Records how much of a pasted dictation you changed in the field shortly
/// after: none, small (up to a tenth of the words), or large, plus the speech
/// model. Only the bucket is sent, never the text.
pub fn track_paste_edited(app: &tauri::AppHandle<AppRuntime>, edit: &str, model: &str) {
    capture_event(app, "paste_edited", json!({ "edit": edit, "model": model }));
}

/// Records that inserting a dictation failed, as `transcription_failed` with
/// stage `auto_paste`: speech model, local or remote, a bounded reason, audio
/// duration, and whether accessibility access was granted when last checked.
pub fn track_auto_paste_failed(
    app: &tauri::AppHandle<AppRuntime>,
    mode: &str,
    model: &str,
    reason: impl Into<ErrorDetail>,
    audio_duration_seconds: f32,
    accessibility_granted: Option<bool>,
) {
    let mut props = json!({
        "stage": "auto_paste",
        "mode": mode,
        "model": model,
        "audio_duration_seconds": audio_duration_seconds,
        "audio_source": "microphone",
    });
    if let Some(granted) = accessibility_granted {
        props["accessibility_granted"] = granted.into();
    }
    reason.into().insert_into(&mut props);
    capture_event(app, "transcription_failed", props);
}
