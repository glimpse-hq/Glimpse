use std::path::PathBuf;

use crate::AppRuntime;
use anyhow::{anyhow, Context, Result};
use glimpse_speech::models::{self as speech_models, InstallSpec, ModelStorage, RemoteFile};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use crate::model_language_table::{nemotron_supported_languages, parakeet_v3_supported_languages};
use crate::model_language_table::{whisper_supported_languages, SupportedLanguageInfo};

pub const MODEL_CAPABILITY_DICTIONARY: &str = "dictionary";
pub const MODEL_CAPABILITY_TIMESTAMPS: &str = "timestamps";
pub const MODEL_CAPABILITY_STREAMING: &str = "streaming";

pub use speech_models::ModelEngine as LocalModelEngine;

#[derive(Debug, Clone)]
pub struct ReadyModel {
    pub key: String,
    pub path: PathBuf,
    pub engine: LocalModelEngine,
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

#[derive(Debug, Serialize, Clone)]
pub struct ModelStatus {
    pub key: String,
    pub installed: bool,
    pub bytes_on_disk: u64,
    pub missing_files: Vec<String>,
    pub directory: String,
}

#[derive(Serialize, Clone)]
struct DownloadProgressPayload {
    model: String,
    file: String,
    downloaded: u64,
    total: u64,
    percent: f64,
}

#[derive(Serialize, Clone)]
struct DownloadCompletePayload {
    model: String,
}

#[derive(Serialize, Clone)]
struct DownloadErrorPayload {
    model: String,
    error: String,
}

const MODELS_ROOT: &str = "models";

struct CatalogFile {
    url: &'static str,
    path: &'static str,
    size_bytes: Option<u64>,
    sha256: Option<&'static str>,
}

pub struct LocalModelManifest {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub tags: &'static [&'static str],
    pub engine: LocalModelEngine,
    pub variant: &'static str,
    artifact: Option<&'static str>,
    files: &'static [CatalogFile],
    pub size_bytes: Option<u64>,
    pub capabilities: &'static [&'static str],
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const PARAKEET_TDT_INT8_FILES: &[CatalogFile] = &[
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/encoder-model.int8.onnx",
        path: "encoder-model.int8.onnx",
        size_bytes: Some(652_183_999),
        sha256: Some("6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"),
    },
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/decoder_joint-model.int8.onnx",
        path: "decoder_joint-model.int8.onnx",
        size_bytes: Some(18_202_004),
        sha256: Some("eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"),
    },
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/vocab.txt",
        path: "vocab.txt",
        size_bytes: Some(93_939),
        sha256: Some("d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    },
];

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const NEMOTRON_STREAMING_FILES: &[CatalogFile] = &[
    CatalogFile {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/encoder.onnx",
        path: "encoder.onnx",
        size_bytes: Some(880_555_453),
        sha256: Some("d24be4aff18dd9d2aa3433cb89c5a457df5015abf79e06a63dde76b1cd6386bb"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/encoder.onnx.data",
        path: "encoder.onnx.data",
        size_bytes: Some(2_436_567_040),
        sha256: Some("44f65771e1570546f61106b3d0c604a60b398d061476fda8042bb05432601bd4"),
    },
    CatalogFile {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/decoder_joint.onnx",
        path: "decoder_joint.onnx",
        size_bytes: Some(10_962_697),
        sha256: Some("c86d527e4ae27251a741609eaddd4429ba5c32050e2f532cea1052d9e21f4f09"),
    },
    CatalogFile {
        url: "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main/tokenizer.model",
        path: "tokenizer.model",
        size_bytes: Some(251_056),
        sha256: Some("07d4e5a63840a53ab2d4d106d2874768143fb3fbdd47938b3910d2da05bfb0a9"),
    },
];

const WHISPER_SMALL_Q5_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    path: "ggml-small-q5_1.bin",
    size_bytes: Some(190_085_487),
    sha256: Some("ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"),
}];

const WHISPER_LARGE_V3_TURBO_Q8_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
    path: "ggml-large-v3-turbo-q8_0.bin",
    size_bytes: Some(874_188_075),
    sha256: Some("317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1"),
}];

const MODEL_MANIFESTS: &[LocalModelManifest] = &[
    LocalModelManifest {
        id: "whisper_large_v3_turbo_q8",
        label: "Whisper Large V3 Turbo",
        description:
            "Great quality local Whisper model with multilingual support and dictionary support.",
        tags: &["Recommended", "Dictionary", "Multilingual"],
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        artifact: Some("ggml-large-v3-turbo-q8_0.bin"),
        files: WHISPER_LARGE_V3_TURBO_Q8_FILES,
        size_bytes: Some(880_000_000),
        capabilities: &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    LocalModelManifest {
        id: "parakeet_tdt_int8",
        label: "Parakeet TDT 0.6B (Int8)",
        description:
            "Fast, multilingual and accurate. Based on ONNX for everyday local transcription.",
        tags: &["Multilingual", "Fast"],
        engine: LocalModelEngine::Parakeet,
        variant: "Int8",
        artifact: None,
        files: PARAKEET_TDT_INT8_FILES,
        size_bytes: Some(670_000_000),
        capabilities: &[MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    LocalModelManifest {
        id: "nemotron_streaming_en",
        label: "Nemotron Streaming 0.6B",
        description: "Real-time streaming transcription. Text appears as you speak.",
        tags: &["English", "Streaming"],
        engine: LocalModelEngine::Nemotron,
        variant: "Int8",
        artifact: None,
        files: NEMOTRON_STREAMING_FILES,
        size_bytes: Some(895_000_000),
        capabilities: &[MODEL_CAPABILITY_STREAMING],
    },
    LocalModelManifest {
        id: "whisper_small_q5",
        label: "Whisper Small",
        description: "Small & fast with dictionary support.",
        tags: &["English", "Dictionary", "Compute Friendly"],
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        artifact: Some("ggml-small-q5_1.bin"),
        files: WHISPER_SMALL_Q5_FILES,
        size_bytes: Some(190_000_000),
        capabilities: &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS],
    },
];

pub fn definition(key: &str) -> Option<&'static LocalModelManifest> {
    MODEL_MANIFESTS.iter().find(|manifest| manifest.id == key)
}

fn to_install_spec(manifest: &LocalModelManifest) -> InstallSpec {
    let storage = match manifest.artifact {
        Some(artifact) => ModelStorage::File {
            artifact: artifact.to_string(),
        },
        None => ModelStorage::Directory,
    };
    let files = manifest
        .files
        .iter()
        .map(|file| RemoteFile {
            url: file.url.to_string(),
            path: file.path.to_string(),
            size_bytes: file.size_bytes,
            sha256: file.sha256.map(str::to_string),
        })
        .collect();
    InstallSpec {
        id: manifest.id.to_string(),
        engine: manifest.engine,
        storage,
        files,
    }
}

pub fn local_resolver() -> glimpse_speech::service::ModelResolver {
    std::sync::Arc::new(|id| definition(id).map(to_install_spec))
}

fn spec_for(model: &str) -> Result<InstallSpec> {
    definition(model)
        .map(to_install_spec)
        .ok_or_else(|| anyhow!("Unknown model: {model}"))
}

pub fn model_label(key: &str) -> String {
    definition(key)
        .map(|model| model.label.to_string())
        .unwrap_or_else(|| key.to_string())
}

pub fn model_supports_capability(model_key: &str, capability: &str) -> bool {
    definition(model_key)
        .map(|manifest| {
            manifest
                .capabilities
                .iter()
                .any(|entry| entry.eq_ignore_ascii_case(capability))
        })
        .unwrap_or(false)
}

pub fn is_streaming_model(model_key: &str) -> bool {
    model_supports_capability(model_key, MODEL_CAPABILITY_STREAMING)
}

pub fn model_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let mut dir = app
        .path()
        .app_data_dir()
        .context("Unable to resolve app data directory")?;
    dir.push(MODELS_ROOT);
    Ok(dir)
}

fn model_manager<R: Runtime>(app: &AppHandle<R>) -> Result<speech_models::ModelInstallManager> {
    let dir = model_cache_dir(app)?;
    Ok(speech_models::ModelInstallManager::new(dir))
}

fn ensure_models_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let dir = model_cache_dir(app)?;
    std::fs::create_dir_all(&dir).context("Failed to prepare models directory")?;
    Ok(dir)
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

fn engine_label(engine: &LocalModelEngine) -> &'static str {
    match engine {
        LocalModelEngine::Nemotron | LocalModelEngine::Parakeet => "NVIDIA",
        LocalModelEngine::Whisper => "Whisper",
    }
}

fn engine_id(engine: &LocalModelEngine) -> &'static str {
    match engine {
        LocalModelEngine::Nemotron | LocalModelEngine::Parakeet => "nvidia",
        LocalModelEngine::Whisper => "whisper",
    }
}

fn capability_strings(capabilities: &[&str]) -> Vec<String> {
    capabilities.iter().map(|c| c.to_string()).collect()
}

fn map_status(status: speech_models::ModelStatus) -> ModelStatus {
    ModelStatus {
        key: status.id,
        installed: status.installed,
        bytes_on_disk: status.bytes_on_disk,
        missing_files: status.missing_files,
        directory: status.directory,
    }
}

fn manifest_to_model_info(manifest: &LocalModelManifest) -> ModelInfo {
    ModelInfo {
        key: manifest.id.to_string(),
        label: manifest.label.to_string(),
        description: manifest.description.to_string(),
        size_mb: manifest.size_bytes.unwrap_or(0) as f32 / 1_000_000.0,
        file_count: manifest.files.len(),
        engine_id: engine_id(&manifest.engine).to_string(),
        engine: engine_label(&manifest.engine).to_string(),
        variant: manifest.variant.to_string(),
        tags: manifest.tags.iter().map(|tag| tag.to_string()).collect(),
        capabilities: capability_strings(manifest.capabilities),
        supported_languages: supported_languages(&manifest.engine),
    }
}

pub fn api_model_infos() -> Vec<glimpse_speech::api::ApiModelInfo> {
    MODEL_MANIFESTS
        .iter()
        .map(|manifest| glimpse_speech::api::ApiModelInfo {
            id: manifest.id.to_string(),
            label: manifest.label.to_string(),
            description: manifest.description.to_string(),
            tags: manifest.tags.iter().map(|tag| tag.to_string()).collect(),
            capabilities: capability_strings(manifest.capabilities),
        })
        .collect()
}

#[tauri::command]
pub fn list_models() -> Vec<ModelInfo> {
    MODEL_MANIFESTS.iter().map(manifest_to_model_info).collect()
}

#[tauri::command]
pub fn check_model_status<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<ModelStatus, String> {
    let manager = model_manager(&app).map_err(|err| err.to_string())?;
    let spec = spec_for(&model).map_err(|err| err.to_string())?;
    let status = manager.status(&spec).map_err(|err| err.to_string())?;
    Ok(map_status(status))
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, crate::AppState>,
    model: String,
) -> Result<ModelStatus, String> {
    let manager = model_manager(&app).map_err(|err| err.to_string())?;
    let spec = spec_for(&model).map_err(|err| err.to_string())?;
    ensure_models_root(&app).map_err(|err| err.to_string())?;
    let cancel_token = state.create_download_token(&model);
    let progress_app = app.clone();
    let progress = |event: speech_models::ModelDownloadProgress| {
        let _ = progress_app.emit(
            "download:progress",
            DownloadProgressPayload {
                model: event.model,
                file: event.file,
                downloaded: event.downloaded,
                total: event.total,
                percent: event.percent,
            },
        );
    };

    let result = manager
        .install(
            &spec,
            speech_models::InstallOptions {
                cancel_token: Some(cancel_token),
                progress: Some(&progress),
            },
        )
        .await;

    state.clear_download_token(&model);

    let status = match result {
        Ok(status) => status,
        Err(err) => {
            let _ = app.emit(
                "download:error",
                DownloadErrorPayload {
                    model,
                    error: err.to_string(),
                },
            );
            return Err(err.to_string());
        }
    };

    let _ = app.emit(
        "download:complete",
        DownloadCompletePayload {
            model: status.id.clone(),
        },
    );

    crate::analytics::track_model_downloaded(&app, &status.id);

    let settings = state.current_settings();
    if let Err(err) = crate::tray::refresh_tray_menu(&app, &settings) {
        eprintln!("Failed to refresh tray menu after download: {err}");
    }

    Ok(map_status(status))
}

#[tauri::command]
pub fn delete_model(app: AppHandle<AppRuntime>, model: String) -> Result<ModelStatus, String> {
    let status = model_manager(&app)
        .and_then(|manager| manager.delete(&model))
        .map(map_status)
        .map_err(|err| err.to_string())?;

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
    let manager = model_manager(app)?;
    let spec = spec_for(model)?;
    let resolved = manager.resolve(&spec)?;
    Ok(ReadyModel {
        key: resolved.id,
        path: resolved.path,
        engine: resolved.engine,
    })
}

pub fn ensure_local_fallback_model<R: Runtime>(
    app: &AppHandle<R>,
    preferred: &str,
) -> Result<ReadyModel> {
    if let Ok(model) = ensure_model_ready(app, preferred) {
        return Ok(model);
    }

    for manifest in MODEL_MANIFESTS {
        if manifest.id == preferred {
            continue;
        }
        if let Ok(model) = ensure_model_ready(app, manifest.id) {
            eprintln!(
                "[LocalTranscriber] Using installed local model `{}` for remote fallback (preferred `{preferred}` is unavailable)",
                manifest.id
            );
            return Ok(model);
        }
    }

    Err(anyhow::anyhow!(
        "No local transcription model is installed for fallback"
    ))
}
