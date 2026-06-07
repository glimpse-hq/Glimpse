use std::path::PathBuf;

use crate::AppRuntime;
use anyhow::{anyhow, Context, Result};
use glimpse_speech::models as speech_models;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub use super::catalog::{
    api_model_infos, definition, is_streaming_model, model_label, model_supports_capability,
    LocalModelEngine, ModelInfo, MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS,
};

#[derive(Debug, Clone)]
pub struct ReadyModel {
    pub key: String,
    pub path: PathBuf,
    pub engine: LocalModelEngine,
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
    verifying: bool,
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

#[derive(Serialize, Clone)]
struct DownloadCancelledPayload {
    model: String,
}

const MODELS_ROOT: &str = "models";

pub fn local_resolver() -> glimpse_speech::service::ModelResolver {
    std::sync::Arc::new(super::catalog::install_spec)
}

fn spec_for(model: &str) -> Result<speech_models::InstallSpec> {
    super::catalog::install_spec(model).ok_or_else(|| anyhow!("Unknown model: {model}"))
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
    super::catalog::list_local_models()
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
                verifying: event.verifying,
            },
        );
    };

    let result = manager
        .install(
            &spec,
            speech_models::InstallOptions {
                cancel_token: Some(cancel_token.clone()),
                progress: Some(&progress),
            },
        )
        .await;

    state.clear_download_token(&model);

    let status = match result {
        Ok(status) => status,
        Err(err) => {
            if cancel_token.is_cancelled() {
                let _ = app.emit(
                    "download:cancelled",
                    DownloadCancelledPayload {
                        model: model.clone(),
                    },
                );
                let status = manager.status(&spec).map_err(|err| err.to_string())?;
                return Ok(map_status(status));
            }
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

    for manifest in super::catalog::local_manifests() {
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
