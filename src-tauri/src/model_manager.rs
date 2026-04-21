use std::fs;
use std::path::{Path, PathBuf};

use crate::AppRuntime;
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::downloader::{download_model_files, ModelFileDescriptor};
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use crate::model_language_table::{nemotron_supported_languages, parakeet_v3_supported_languages};
use crate::model_language_table::{whisper_supported_languages, SupportedLanguageInfo};

const MODELS_ROOT: &str = "models";
pub const MODEL_CAPABILITY_DICTIONARY: &str = "dictionary";
pub const MODEL_CAPABILITY_TIMESTAMPS: &str = "timestamps";
pub const MODEL_CAPABILITY_STREAMING: &str = "streaming";

#[derive(Debug, Clone)]
pub enum ModelStorage {
    #[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), allow(dead_code))]
    Directory,
    File {
        artifact: &'static str,
    },
}

#[derive(Debug, Clone)]
pub enum LocalModelEngine {
    #[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), allow(dead_code))]
    Nemotron,
    #[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), allow(dead_code))]
    Parakeet,
    Whisper,
}

#[derive(Debug, Clone)]
pub struct ModelDefinition {
    pub key: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub size_mb: f32,
    pub files: &'static [ModelFileDescriptor],
    pub engine: LocalModelEngine,
    pub variant: &'static str,
    pub storage: ModelStorage,
    pub tags: &'static [&'static str],
    pub capabilities: &'static [&'static str],
}

#[derive(Debug, Clone)]
pub struct ReadyModel {
    pub key: String,
    pub path: PathBuf,
    pub engine: LocalModelEngine,
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const PARAKEET_TDT_INT8_FILES: [ModelFileDescriptor; 3] = [
    ModelFileDescriptor {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/encoder-model.int8.onnx",
        name: "encoder-model.int8.onnx",
    },
    ModelFileDescriptor {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/decoder_joint-model.int8.onnx",
        name: "decoder_joint-model.int8.onnx",
    },
    ModelFileDescriptor {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/vocab.txt",
        name: "vocab.txt",
    },
];

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const NEMOTRON_STREAMING_FILES: [ModelFileDescriptor; 4] = [
    ModelFileDescriptor {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/encoder.onnx",
        name: "encoder.onnx",
    },
    ModelFileDescriptor {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/encoder.onnx.data",
        name: "encoder.onnx.data",
    },
    ModelFileDescriptor {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/decoder_joint.onnx",
        name: "decoder_joint.onnx",
    },
    ModelFileDescriptor {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/tokenizer.model",
        name: "tokenizer.model",
    },
];

const WHISPER_SMALL_Q5_FILES: [ModelFileDescriptor; 1] = [ModelFileDescriptor {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    name: "ggml-small-q5_1.bin",
}];

const WHISPER_LARGE_V3_TURBO_Q8_FILES: [ModelFileDescriptor; 1] = [ModelFileDescriptor {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
    name: "ggml-large-v3-turbo-q8_0.bin",
}];

pub const MODEL_DEFINITIONS: &[ModelDefinition] = &[
    ModelDefinition {
        key: "whisper_large_v3_turbo_q8",
        label: "Whisper Large V3 Turbo",
        description:
            "Great quality local Whisper model with multilingual support and dictionary support.",
        size_mb: 880.0,
        files: &WHISPER_LARGE_V3_TURBO_Q8_FILES,
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        storage: ModelStorage::File {
            artifact: "ggml-large-v3-turbo-q8_0.bin",
        },
        tags: &["Recommended", "Dictionary", "Multilingual"],
        capabilities: &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    ModelDefinition {
        key: "parakeet_tdt_int8",
        label: "Parakeet TDT 0.6B (Int8)",
        description:
            "Fast, multilingual and accurate. Based on ONNX for everyday local transcription.",
        size_mb: 670.0,
        files: &PARAKEET_TDT_INT8_FILES,
        engine: LocalModelEngine::Parakeet,
        variant: "Int8",
        storage: ModelStorage::Directory,
        tags: &["Multilingual", "Fast"],
        capabilities: &[MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    ModelDefinition {
        key: "nemotron_streaming_en",
        label: "Nemotron Streaming 0.6B",
        description: "Real-time streaming transcription. Text appears as you speak.",
        size_mb: 895.0,
        files: &NEMOTRON_STREAMING_FILES,
        engine: LocalModelEngine::Nemotron,
        variant: "Int8",
        storage: ModelStorage::Directory,
        tags: &["English", "Streaming"],
        capabilities: &[MODEL_CAPABILITY_STREAMING],
    },
    ModelDefinition {
        key: "whisper_small_q5",
        label: "Whisper Small",
        description: "Small & fast with dictionary support.",
        size_mb: 190.0,
        files: &WHISPER_SMALL_Q5_FILES,
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        storage: ModelStorage::File {
            artifact: "ggml-small-q5_1.bin",
        },
        tags: &["English", "Dictionary", "Compute Friendly"],
        capabilities: &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS],
    },
];

pub fn definition(key: &str) -> Option<&'static ModelDefinition> {
    MODEL_DEFINITIONS.iter().find(|def| def.key == key)
}

pub fn get_model_dir<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<PathBuf> {
    let mut dir = app
        .path()
        .app_data_dir()
        .context("Unable to resolve app data directory")?;
    dir.push(MODELS_ROOT);
    dir.push(key);
    Ok(dir)
}

fn ensure_models_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let mut dir = app
        .path()
        .app_data_dir()
        .context("Unable to resolve app data directory")?;
    dir.push(MODELS_ROOT);
    fs::create_dir_all(&dir).context("Failed to prepare models directory")?;
    Ok(dir)
}

fn artifact_path(dir: &Path, storage: &ModelStorage) -> PathBuf {
    match storage {
        ModelStorage::Directory => dir.to_path_buf(),
        ModelStorage::File { artifact } => dir.join(artifact),
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
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
}

pub fn model_supports_capability(model_key: &str, capability: &str) -> bool {
    definition(model_key)
        .map(|def| {
            def.capabilities
                .iter()
                .any(|entry| entry.eq_ignore_ascii_case(capability))
        })
        .unwrap_or(false)
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelStatus {
    pub key: String,
    pub installed: bool,
    pub bytes_on_disk: u64,
    pub missing_files: Vec<String>,
    pub directory: String,
}

fn supported_languages(engine: &LocalModelEngine) -> Vec<SupportedLanguageInfo> {
    match engine {
        LocalModelEngine::Whisper => whisper_supported_languages(),
        LocalModelEngine::Nemotron => {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                nemotron_supported_languages()
            }

            #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
            {
                Vec::new()
            }
        }
        LocalModelEngine::Parakeet => {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                parakeet_v3_supported_languages()
            }

            #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
            {
                Vec::new()
            }
        }
    }
}

impl ModelStatus {
    fn from_definition(dir: &Path, def: &ModelDefinition) -> Self {
        let missing_files = missing_files(dir, def);
        let installed = missing_files.is_empty() && dir.exists();
        let bytes_on_disk = if dir.exists() {
            calculate_dir_size(dir).unwrap_or(0)
        } else {
            0
        };
        let artifact = artifact_path(dir, &def.storage);

        Self {
            key: def.key.to_string(),
            installed,
            bytes_on_disk,
            missing_files,
            directory: artifact.display().to_string(),
        }
    }
}

fn missing_files(dir: &Path, def: &ModelDefinition) -> Vec<String> {
    def.files
        .iter()
        .filter_map(|descriptor| {
            let file_path = dir.join(descriptor.name);
            if file_path.exists() {
                None
            } else {
                Some(descriptor.name.to_string())
            }
        })
        .collect()
}

fn calculate_dir_size(dir: &Path) -> Result<u64> {
    let mut total = 0u64;
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            if metadata.is_dir() {
                total += calculate_dir_size(&entry.path())?;
            } else {
                total += metadata.len();
            }
        }
    }
    Ok(total)
}

fn engine_label(engine: &LocalModelEngine) -> &'static str {
    match engine {
        LocalModelEngine::Nemotron => "NVIDIA",
        LocalModelEngine::Parakeet => "NVIDIA",
        LocalModelEngine::Whisper => "Whisper",
    }
}

fn engine_id(engine: &LocalModelEngine) -> &'static str {
    match engine {
        LocalModelEngine::Nemotron => "nvidia",
        LocalModelEngine::Parakeet => "nvidia",
        LocalModelEngine::Whisper => "whisper",
    }
}

pub fn is_streaming_model(model_key: &str) -> bool {
    model_supports_capability(model_key, MODEL_CAPABILITY_STREAMING)
}

#[tauri::command]
pub fn list_models() -> Vec<ModelInfo> {
    MODEL_DEFINITIONS
        .iter()
        .map(|def| ModelInfo {
            key: def.key.to_string(),
            label: def.label.to_string(),
            description: def.description.to_string(),
            size_mb: def.size_mb,
            file_count: def.files.len(),
            engine_id: engine_id(&def.engine).to_string(),
            engine: engine_label(&def.engine).to_string(),
            variant: def.variant.to_string(),
            tags: def.tags.iter().map(|s| s.to_string()).collect(),
            capabilities: def.capabilities.iter().map(|s| s.to_string()).collect(),
            supported_languages: supported_languages(&def.engine),
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct EngineGroup {
    pub name: String,
    pub models: Vec<ModelInfo>,
}

pub fn group_models_by_engine(models: &[ModelInfo]) -> Vec<EngineGroup> {
    let mut groups: std::collections::HashMap<String, Vec<ModelInfo>> =
        std::collections::HashMap::new();

    for model in models {
        groups
            .entry(model.engine_id.clone())
            .or_default()
            .push(model.clone());
    }

    let mut result: Vec<_> = groups
        .into_values()
        .map(|models| EngineGroup {
            name: models
                .first()
                .map(|m| m.engine.clone())
                .unwrap_or_else(|| "Unknown".to_string()),
            models,
        })
        .collect();

    result.sort_by_key(|g| match g.models.first().map(|m| m.engine_id.as_str()) {
        Some("whisper") => 0,
        Some("nvidia") => 1,
        _ => 2,
    });

    result
}

#[tauri::command]
pub fn check_model_status<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<ModelStatus, String> {
    let def = definition(&model).ok_or_else(|| "Unknown model".to_string())?;
    let dir = get_model_dir(&app, &model).map_err(|err| err.to_string())?;
    Ok(ModelStatus::from_definition(&dir, def))
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, crate::AppState>,
    model: String,
) -> Result<ModelStatus, String> {
    let def = definition(&model).ok_or_else(|| "Unknown model".to_string())?;
    ensure_models_root(&app).map_err(|err| err.to_string())?;
    let dir = get_model_dir(&app, &model).map_err(|err| err.to_string())?;
    let client = state.http();
    let cancel_token = state.create_download_token(&model);

    let result = download_model_files(&app, &client, &model, def.files, &dir, &cancel_token).await;

    state.clear_download_token(&model);

    result.map_err(|err| err.to_string())?;

    crate::analytics::track_model_downloaded(&app, &model);

    let status = ModelStatus::from_definition(&dir, def);

    let settings = state.current_settings();
    if let Err(err) = crate::tray::refresh_tray_menu(&app, &settings) {
        eprintln!("Failed to refresh tray menu after download: {err}");
    }

    Ok(status)
}

#[tauri::command]
pub fn delete_model(app: AppHandle<AppRuntime>, model: String) -> Result<ModelStatus, String> {
    let def = definition(&model).ok_or_else(|| "Unknown model".to_string())?;
    let dir = get_model_dir(&app, &model).map_err(|err| err.to_string())?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|err| err.to_string())?;
    }
    let status = ModelStatus::from_definition(&dir, def);

    if let Some(state) = app.try_state::<crate::AppState>() {
        let settings = state.current_settings();
        if let Err(err) = crate::tray::refresh_tray_menu(&app, &settings) {
            eprintln!("Failed to refresh tray menu after delete: {err}");
        }
    }

    Ok(status)
}

#[tauri::command]
pub fn cancel_download(
    model: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    Ok(state.cancel_download(&model))
}

pub fn ensure_model_ready<R: Runtime>(app: &AppHandle<R>, model: &str) -> Result<ReadyModel> {
    let def = definition(model).ok_or_else(|| anyhow!("Unknown model"))?;
    let dir = get_model_dir(app, model)?;
    let status = ModelStatus::from_definition(&dir, def);
    if !status.installed {
        return Err(anyhow!(
            "{} is not fully installed. Missing: {}",
            def.label,
            status.missing_files.join(", ")
        ));
    }

    Ok(ReadyModel {
        key: def.key.to_string(),
        path: artifact_path(&dir, &def.storage),
        engine: def.engine.clone(),
    })
}
