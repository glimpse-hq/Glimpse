use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::model_language_table::SupportedLanguageInfo;
use crate::settings::UserSettings;
use crate::speech::{install, remote};
use crate::{AppRuntime, AppState};

#[derive(Debug, Serialize, Clone)]
pub struct SpeechModel {
    pub id: String,
    pub key: String,
    pub label: String,
    pub description: String,
    pub size_mb: f32,
    pub file_count: usize,
    pub engine_id: String,
    pub engine: String,
    pub variant: String,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
    pub supported_languages: Vec<SupportedLanguageInfo>,
    pub remote: bool,
    pub installed: bool,
    pub loaded: bool,
}

pub fn list_models(app: &AppHandle<AppRuntime>, settings: &UserSettings) -> Vec<SpeechModel> {
    let loaded_id = app
        .state::<AppState>()
        .local_transcriber()
        .loaded_model_id();
    let mut models = Vec::new();

    if remote::is_configured(settings) {
        models.push(remote_entry(settings));
    }

    for info in install::list_models() {
        let installed = install::check_model_status(app.clone(), info.key.clone())
            .map(|status| status.installed)
            .unwrap_or(false);
        let loaded = loaded_id.as_deref() == Some(info.key.as_str());
        models.push(from_local(info, installed, loaded));
    }

    models
}

fn from_local(info: install::ModelInfo, installed: bool, loaded: bool) -> SpeechModel {
    SpeechModel {
        id: info.key.clone(),
        key: info.key,
        label: info.label,
        description: info.description,
        size_mb: info.size_mb,
        file_count: info.file_count,
        engine_id: info.engine_id,
        engine: info.engine,
        variant: info.variant,
        tags: info.tags,
        capabilities: info.capabilities,
        supported_languages: info.supported_languages,
        remote: false,
        installed,
        loaded,
    }
}

fn remote_entry(settings: &UserSettings) -> SpeechModel {
    let id = remote::speech_model_storage_label(settings, None);
    SpeechModel {
        label: label(&id),
        key: id.clone(),
        id,
        description: "Transcribes through your configured remote speech provider.".to_string(),
        size_mb: 0.0,
        file_count: 0,
        engine_id: "remote".to_string(),
        engine: "Remote".to_string(),
        variant: String::new(),
        tags: vec!["Remote".to_string()],
        capabilities: vec![
            install::MODEL_CAPABILITY_TIMESTAMPS.to_string(),
            install::MODEL_CAPABILITY_DICTIONARY.to_string(),
        ],
        supported_languages: Vec::new(),
        remote: true,
        installed: true,
        loaded: false,
    }
}

pub fn label(model_id: &str) -> String {
    if remote::is_remote_model(model_id) {
        token_label(model_id)
    } else {
        install::model_label(model_id)
    }
}

fn token_label(token: &str) -> String {
    let rest = token
        .trim()
        .strip_prefix(remote::SPEECH_MODEL_REMOTE_PREFIX)
        .unwrap_or(token);
    let mut parts = rest.splitn(2, ':');
    let provider = parts.next().unwrap_or_default();
    let model = parts.next().filter(|value| !value.is_empty());
    let provider_label = provider_display(provider);
    match model {
        Some(model) => format!("{provider_label} · {model}"),
        None => provider_label,
    }
}

fn provider_display(provider: &str) -> String {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai" => "OpenAI".to_string(),
        "groq" => "Groq".to_string(),
        "mistral" => "Mistral".to_string(),
        "fireworks" => "Fireworks".to_string(),
        "openrouter" => "OpenRouter".to_string(),
        "litellm" => "LiteLLM".to_string(),
        "deepgram" => "Deepgram".to_string(),
        "elevenlabs" => "ElevenLabs".to_string(),
        "huggingface" => "Hugging Face".to_string(),
        "vllm" => "vLLM".to_string(),
        "localai" => "LocalAI".to_string(),
        "whisper-cpp" => "whisper.cpp".to_string(),
        "llamaedge" => "LlamaEdge".to_string(),
        "custom" => "Custom".to_string(),
        "" => "Remote".to_string(),
        other => other.to_string(),
    }
}
