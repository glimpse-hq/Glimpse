use std::path::PathBuf;

use crate::AppRuntime;
use anyhow::{Context, Result};
use glimpse_speech::models as speech_models;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use crate::model_language_table::{nemotron_supported_languages, parakeet_v3_supported_languages};
use crate::model_language_table::{whisper_supported_languages, SupportedLanguageInfo};

pub const MODEL_CAPABILITY_DICTIONARY: &str = "dictionary";
pub const MODEL_CAPABILITY_TIMESTAMPS: &str = speech_models::MODEL_CAPABILITY_TIMESTAMPS;
pub const MODEL_CAPABILITY_STREAMING: &str = speech_models::MODEL_CAPABILITY_STREAMING;

pub use speech_models::ModelEngine as LocalModelEngine;

#[derive(Debug, Clone)]
struct ModelPresentation {
    key: &'static str,
    label: &'static str,
    description: &'static str,
    tags: &'static [&'static str],
}

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

#[derive(Debug, Clone)]
pub struct EngineGroup {
    pub name: String,
    pub models: Vec<ModelInfo>,
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

const MODEL_PRESENTATION: &[ModelPresentation] = &[
    ModelPresentation {
        key: "whisper_large_v3_turbo_q8",
        label: "Whisper Large V3 Turbo",
        description:
            "Great quality local Whisper model with multilingual support and dictionary support.",
        tags: &["Recommended", "Dictionary", "Multilingual"],
    },
    ModelPresentation {
        key: "parakeet_tdt_int8",
        label: "Parakeet TDT 0.6B (Int8)",
        description:
            "Fast, multilingual and accurate. Based on ONNX for everyday local transcription.",
        tags: &["Multilingual", "Fast"],
    },
    ModelPresentation {
        key: "nemotron_streaming_en",
        label: "Nemotron Streaming 0.6B",
        description: "Real-time streaming transcription. Text appears as you speak.",
        tags: &["English", "Streaming"],
    },
    ModelPresentation {
        key: "whisper_small_q5",
        label: "Whisper Small",
        description: "Small & fast with dictionary support.",
        tags: &["English", "Dictionary", "Compute Friendly"],
    },
];

const MODELS_ROOT: &str = "models";

pub fn definition(key: &str) -> Option<&'static speech_models::ModelManifest> {
    speech_models::definition(key)
}

pub fn model_label(key: &str) -> String {
    presentation(key)
        .map(|entry| entry.label.to_string())
        .unwrap_or_else(|| key.to_string())
}

pub fn model_supports_capability(model_key: &str, capability: &str) -> bool {
    let backend_capability = match capability {
        MODEL_CAPABILITY_DICTIONARY => speech_models::MODEL_CAPABILITY_DICTIONARY_PROMPT,
        other => other,
    };
    speech_models::model_supports_capability(model_key, backend_capability)
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

fn presentation(key: &str) -> Option<&'static ModelPresentation> {
    MODEL_PRESENTATION.iter().find(|entry| entry.key == key)
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

fn map_capabilities(capabilities: &[&str]) -> Vec<String> {
    capabilities
        .iter()
        .map(|capability| match *capability {
            speech_models::MODEL_CAPABILITY_DICTIONARY_PROMPT => MODEL_CAPABILITY_DICTIONARY,
            other => other,
        })
        .map(str::to_string)
        .collect()
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

#[tauri::command]
pub fn list_models() -> Vec<ModelInfo> {
    speech_models::list_models()
        .iter()
        .filter_map(|manifest| {
            let presentation = presentation(manifest.id)?;
            Some(ModelInfo {
                key: manifest.id.to_string(),
                label: presentation.label.to_string(),
                description: presentation.description.to_string(),
                size_mb: manifest.size_bytes.unwrap_or(0) as f32 / 1_000_000.0,
                file_count: manifest.files.len(),
                engine_id: engine_id(&manifest.engine).to_string(),
                engine: engine_label(&manifest.engine).to_string(),
                variant: manifest.variant.to_string(),
                tags: presentation.tags.iter().map(|s| s.to_string()).collect(),
                capabilities: map_capabilities(manifest.capabilities),
                supported_languages: supported_languages(&manifest.engine),
            })
        })
        .collect()
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
    model_manager(&app)
        .and_then(|manager| manager.model_status(&model))
        .map(map_status)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, crate::AppState>,
    model: String,
) -> Result<ModelStatus, String> {
    let manager = model_manager(&app).map_err(|err| err.to_string())?;
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
        .install_model(
            &model,
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
        .and_then(|manager| manager.delete_model(&model))
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
    let resolved = model_manager(app)?.resolve_model(model)?;
    Ok(ReadyModel {
        key: resolved.id,
        path: resolved.path,
        engine: resolved.engine,
    })
}
