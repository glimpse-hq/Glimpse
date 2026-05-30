use std::path::Path;

use glimpse_speech::provider::remote_config;
use glimpse_speech::remote::{RemoteEngine, RemoteError, RemoteErrorKind, RemoteRequestParams};
use glimpse_speech::TimestampGranularity;
use reqwest::Client;
use tauri::AppHandle;

use crate::{
    model_manager,
    settings::UserSettings,
    toast, AppRuntime,
    transcription_api::{normalize_transcript, TranscriptionSuccess},
};

pub(crate) fn is_configured(settings: &UserSettings) -> bool {
    settings.remote_speech_enabled
        && !settings.remote_speech_endpoint.trim().is_empty()
        && resolved_model_name(settings).is_some()
}

pub(crate) fn resolved_endpoint(settings: &UserSettings) -> String {
    settings.remote_speech_endpoint.trim().to_string()
}

pub(crate) fn provider_default_model(provider: &str) -> Option<&'static str> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai" | "custom" => Some("gpt-4o-mini-transcribe"),
        "groq" => Some("whisper-large-v3-turbo"),
        "mistral" => Some("voxtral-mini-latest"),
        "fireworks" => Some("whisper-v3"),
        "openrouter" | "litellm" => Some("openai/gpt-4o-mini-transcribe"),
        "deepgram" => Some("nova-3"),
        "elevenlabs" => Some("scribe_v1"),
        "huggingface" | "vllm" => Some("openai/whisper-large-v3-turbo"),
        "localai" | "whisper-cpp" | "llamaedge" => Some("whisper-1"),
        _ => None,
    }
}

pub(crate) fn resolve_model(provider: &str, model: &str) -> Option<String> {
    let model = model.trim();
    if !model.is_empty() && !model.eq_ignore_ascii_case("auto") {
        return Some(model.to_string());
    }
    provider_default_model(provider).map(str::to_string)
}

pub(crate) fn resolved_model_name(settings: &UserSettings) -> Option<String> {
    resolve_model(&settings.remote_speech_provider, &settings.remote_speech_model)
}

pub(crate) async fn transcribe_file(
    client: &Client,
    wav_path: &Path,
    settings: &UserSettings,
    wants_timestamps: bool,
) -> Result<TranscriptionSuccess, RemoteError> {
    let model = resolved_model_name(settings).unwrap_or_default();
    let language = settings.language.trim();
    let dictionary: Vec<String> = settings
        .dictionary
        .iter()
        .map(|term| term.trim().to_string())
        .filter(|term| !term.is_empty())
        .collect();
    let config = remote_config(
        resolved_endpoint(settings),
        settings.remote_speech_api_key.clone(),
        Some(model.clone()),
    );
    let engine = RemoteEngine::new(client.clone(), config);
    let response = engine
        .transcribe_file(
            wav_path,
            RemoteRequestParams {
                model: &model,
                language: (!language.is_empty()).then_some(language),
                dictionary: &dictionary,
                prompt: None,
                timestamps: wants_timestamps,
                timestamp_granularity: wants_timestamps.then_some(TimestampGranularity::Segment),
            },
        )
        .await?;

    Ok(TranscriptionSuccess {
        transcript: normalize_transcript(&response.text),
        speech_model: Some(speech_model_storage_label(
            settings,
            Some(response.model_id.as_str()),
        )),
        segments: response.segments,
        words: response.words,
    })
}

pub(crate) enum RemoteAttempt {
    Success(TranscriptionSuccess),
    Cancelled,
    Fallback,
    Unavailable,
}

pub(crate) async fn attempt_remote(
    app: &AppHandle<AppRuntime>,
    client: &Client,
    settings: &UserSettings,
    wav_path: &Path,
    local_fallback_model: &str,
    wants_timestamps: bool,
    is_cancelled: impl Fn() -> bool,
) -> RemoteAttempt {
    match transcribe_file(client, wav_path, settings, wants_timestamps).await {
        Ok(result) => RemoteAttempt::Success(result),
        Err(_) if is_cancelled() => RemoteAttempt::Cancelled,
        Err(error) => {
            eprintln!("Remote speech failed, falling back to local model: {error}");
            if model_manager::ensure_local_fallback_model(app, local_fallback_model).is_err() {
                emit_fallback_unavailable_toast(app, &error);
                RemoteAttempt::Unavailable
            } else {
                emit_fallback_toast(app, &error);
                RemoteAttempt::Fallback
            }
        }
    }
}

pub(crate) const SPEECH_MODEL_REMOTE_PREFIX: &str = "remote:";

pub(crate) fn is_remote_model(value: &str) -> bool {
    value.trim().starts_with(SPEECH_MODEL_REMOTE_PREFIX)
}

pub(crate) fn speech_model_storage_label(
    settings: &UserSettings,
    model_used: Option<&str>,
) -> String {
    let provider = settings.remote_speech_provider.trim();
    let model = model_used
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| resolved_model_name(settings))
        .unwrap_or_default();
    if model.is_empty() {
        format!("{SPEECH_MODEL_REMOTE_PREFIX}{provider}")
    } else {
        format!("{SPEECH_MODEL_REMOTE_PREFIX}{provider}:{model}")
    }
}

pub(crate) fn fallback_toast_message(error: &RemoteError) -> String {
    let lead = remote_issue_message(error);
    format!("{lead} Defaulting to local model.")
}

pub(crate) fn fallback_unavailable_toast_message(error: &RemoteError) -> String {
    format!(
        "{} No local model is installed for fallback.",
        remote_issue_message(error)
    )
}

pub(crate) fn emit_fallback_toast(app: &AppHandle<AppRuntime>, error: &RemoteError) {
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "warning".to_string(),
            title: Some("Speech Provider".to_string()),
            message: fallback_toast_message(error),
            auto_dismiss: Some(true),
            duration: None,
            retry_id: None,
            mode: None,
            action: None,
            action_label: None,
            secondary_action: None,
            secondary_action_label: None,
        },
    );
}

pub(crate) fn emit_not_configured_toast(app: &AppHandle<AppRuntime>) {
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "warning".to_string(),
            title: Some("Speech Provider".to_string()),
            message: "Add an endpoint and model in Settings before enabling a remote speech provider.".to_string(),
            auto_dismiss: Some(true),
            duration: None,
            retry_id: None,
            mode: None,
            action: None,
            action_label: None,
            secondary_action: None,
            secondary_action_label: None,
        },
    );
}

pub(crate) fn emit_fallback_unavailable_toast(app: &AppHandle<AppRuntime>, error: &RemoteError) {
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "error".to_string(),
            title: Some("Speech Provider".to_string()),
            message: fallback_unavailable_toast_message(error),
            auto_dismiss: Some(true),
            duration: None,
            retry_id: None,
            mode: None,
            action: None,
            action_label: None,
            secondary_action: None,
            secondary_action_label: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::resolve_model;

    #[test]
    fn concrete_model_is_passed_through() {
        assert_eq!(
            resolve_model("openai", "whisper-1").as_deref(),
            Some("whisper-1")
        );
    }

    #[test]
    fn auto_resolves_to_provider_default() {
        assert_eq!(
            resolve_model("groq", "auto").as_deref(),
            Some("whisper-large-v3-turbo")
        );
        assert_eq!(
            resolve_model("mistral", "  ").as_deref(),
            Some("voxtral-mini-latest")
        );
        assert_eq!(
            resolve_model("custom", "auto").as_deref(),
            Some("gpt-4o-mini-transcribe")
        );
    }

    #[test]
    fn unknown_provider_without_model_is_unresolved() {
        assert_eq!(resolve_model("nope", "auto"), None);
    }
}

fn remote_issue_message(error: &RemoteError) -> String {
    match error.kind {
        RemoteErrorKind::RateLimited => {
            if let Some(retry_after) = error.retry_after {
                let seconds = retry_after.as_secs().max(1);
                format!(
                    "Speech provider rate limit reached (retry in about {seconds} second{}).",
                    if seconds == 1 { "" } else { "s" }
                )
            } else {
                "Speech provider rate limit reached.".to_string()
            }
        }
        RemoteErrorKind::QuotaExceeded => "Speech provider quota exceeded.".to_string(),
        RemoteErrorKind::Unauthorized => {
            "Speech provider API key is invalid or expired.".to_string()
        }
        RemoteErrorKind::InvalidRequest => {
            let detail = error.message.trim();
            if detail.is_empty() {
                "Speech provider rejected the request.".to_string()
            } else {
                const MAX_DETAIL_CHARS: usize = 160;
                let mut snippet: String = detail.chars().take(MAX_DETAIL_CHARS).collect();
                if detail.chars().count() > MAX_DETAIL_CHARS {
                    snippet.push('…');
                }
                format!("Speech provider rejected the request: {snippet}")
            }
        }
        RemoteErrorKind::NotFound => "Speech provider endpoint or model was not found.".to_string(),
        RemoteErrorKind::UpstreamUnavailable | RemoteErrorKind::Other => {
            "Speech provider unreachable.".to_string()
        }
    }
}
