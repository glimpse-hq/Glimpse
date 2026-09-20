use std::path::{Path, PathBuf};

use crate::AppRuntime;
use anyhow::{Context, Result, anyhow};
use glimpse_speech::models as speech_models;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub use super::catalog::{
    LocalModelEngine, MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS, ModelInfo,
    api_model_infos, definition, is_streaming_model, model_label, model_supports_capability,
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
    pub ane_installed: bool,
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
    file_index: usize,
    file_count: usize,
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

#[derive(Serialize, Clone)]
struct AneCompilePayload {
    model: String,
    label: String,
    status: &'static str,
}

fn spawn_ane_compile(app: AppHandle<AppRuntime>, model: String) {
    std::thread::spawn(move || {
        let label = super::catalog::model_label(&model);
        let emit = |status: &'static str| {
            let _ = app.emit(
                "ane:compile",
                AneCompilePayload {
                    model: model.clone(),
                    label: label.clone(),
                    status,
                },
            );
        };

        let result = ensure_model_ready(&app, &model).and_then(|ready| {
            emit("start");
            let transcriber = app.state::<crate::AppState>().local_transcriber();
            let _ = glimpse_speech::take_coreml_log();
            if transcriber.loaded_model_id().as_deref() == Some(model.as_str()) {
                transcriber.preload_and_warm(&ready)
            } else {
                use glimpse_speech::TranscriptionEngine;
                let mut engine = glimpse_speech::engines::whisper::WhisperEngine::new();
                engine
                    .load_model(&ready.path)
                    .map_err(|err| anyhow!("{err}"))
            }
        });

        // whisper.cpp falls back to GPU when the Core ML load fails, so a
        // successful model load alone doesn't prove the encoder engaged.
        let coreml_failed = || {
            glimpse_speech::take_coreml_log()
                .iter()
                .any(|line| line.contains("failed to load Core ML model"))
        };

        let compiled = result.is_ok();

        match result {
            Ok(()) if coreml_failed() => {
                tracing::error!(
                    "[speech] Core ML encoder for {model} failed to load; whisper fell back to the GPU"
                );
                crate::toast::show(
                    &app,
                    "error",
                    None,
                    &format!(
                        "{label} couldn't use the Neural Engine and will run on the GPU instead."
                    ),
                );
                crate::analytics::track_model_download_failed(
                    &app,
                    &model,
                    "ane_compile",
                    "model_error",
                );
                emit("error");
            }
            Ok(()) => emit("done"),
            Err(err) => {
                tracing::error!("[speech] ANE compile warm-up failed: {err}");
                crate::analytics::track_model_download_failed(
                    &app,
                    &model,
                    "ane_compile",
                    crate::analytics::error_detail(&err),
                );
                crate::toast::show(
                    &app,
                    "error",
                    None,
                    &format!("Couldn't optimize {label} for the Neural Engine."),
                );
                emit("error");
            }
        }

        if compiled {
            super::warm_model(&app, model.clone());
        }
    });
}

const MODELS_ROOT: &str = "models";

pub fn local_resolver(models_dir: PathBuf) -> glimpse_speech::service::ModelResolver {
    let manager = speech_models::ModelInstallManager::new(models_dir);
    std::sync::Arc::new(move |model| installed_spec(model, &manager).ok())
}

fn installed_spec(
    model: &str,
    manager: &speech_models::ModelInstallManager,
) -> Result<speech_models::InstallSpec> {
    let base = spec_for(model, false)?;
    if super::catalog::ane_replaces_model_files(model) {
        let ane = spec_for(model, true)?;
        if manager.status(&ane)?.installed || !manager.status(&base)?.installed {
            return Ok(ane);
        }
    }
    Ok(base)
}

fn finish_model_install(
    manager: &speech_models::ModelInstallManager,
    spec: &speech_models::InstallSpec,
    ane: bool,
) -> Result<speech_models::ModelStatus> {
    let verified = manager.verify(spec)?;
    if !verified.installed {
        anyhow::bail!("Replacement model is incomplete");
    }
    if super::catalog::ane_replaces_model_files(&spec.id) {
        let other = spec_for(&spec.id, !ane)?;
        let dir = manager.model_dir(&spec.id);
        for file in other.files {
            if spec.files.iter().any(|keep| keep.path == file.path) {
                continue;
            }
            let path = dir.join(&file.path);
            if path.exists() {
                if file.extract {
                    crate::platform::remove_dir_all_compat(&path)?;
                } else {
                    std::fs::remove_file(&path)?;
                }
            }
            if file.extract {
                let manifest = path.with_file_name(format!(".{}.manifest.json", file.path));
                if manifest.exists() {
                    std::fs::remove_file(manifest)?;
                }
            }
        }
    }
    manager.status(spec)
}

fn spec_for(model: &str, ane: bool) -> Result<speech_models::InstallSpec> {
    super::catalog::install_spec(model, ane).ok_or_else(|| anyhow!("Unknown model: {model}"))
}

/// Headless installed-check against a models directory, without an `AppHandle`.
pub(crate) fn check_model_installed_at(models_dir: &std::path::Path, model: &str) -> bool {
    let manager = speech_models::ModelInstallManager::new(models_dir.to_path_buf());
    installed_spec(model, &manager)
        .ok()
        .and_then(|spec| manager.status(&spec).ok())
        .map(|status| status.installed)
        .unwrap_or(false)
}

pub fn installed_api_model_infos(models_dir: &Path) -> Vec<glimpse_speech::api::ApiModelInfo> {
    api_model_infos()
        .into_iter()
        .filter(|info| check_model_installed_at(models_dir, &info.id))
        .collect()
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

fn ane_encoder_complete(dir: &std::path::Path) -> bool {
    dir.join("coremldata.bin").is_file()
        && dir.join("model.mil").is_file()
        && dir.join("weights").join("weight.bin").is_file()
}

fn ane_installed_for(model: &str, manager: &speech_models::ModelInstallManager) -> bool {
    super::catalog::ane_encoder_dir(model)
        .is_some_and(|dir_name| ane_encoder_complete(&manager.model_dir(model).join(dir_name)))
}

fn map_status(
    status: speech_models::ModelStatus,
    manager: &speech_models::ModelInstallManager,
) -> ModelStatus {
    let ane_installed = ane_installed_for(&status.id, manager);
    ModelStatus {
        key: status.id,
        installed: status.installed,
        ane_installed,
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
    let spec = installed_spec(&model, &manager).map_err(|err| err.to_string())?;
    let status = manager.status(&spec).map_err(|err| err.to_string())?;
    Ok(map_status(status, &manager))
}

const MODEL_UNAVAILABLE: &str = "This model is no longer available for download.";

fn ensure_model_downloadable(
    model: &str,
    ane: bool,
    manager: &speech_models::ModelInstallManager,
) -> Result<(), String> {
    if super::catalog::model_is_downloadable(model) {
        return Ok(());
    }
    if !ane {
        return Err(MODEL_UNAVAILABLE.to_string());
    }
    let base_spec = spec_for(model, false).map_err(|err| err.to_string())?;
    let installed = manager
        .status(&base_spec)
        .map(|status| status.installed)
        .map_err(|err| err.to_string())?;
    if installed {
        Ok(())
    } else {
        Err(MODEL_UNAVAILABLE.to_string())
    }
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle<AppRuntime>,
    model: String,
    ane: Option<bool>,
) -> Result<ModelStatus, String> {
    download_model_now(app, model, ane).await
}

pub async fn download_model_now(
    app: AppHandle<AppRuntime>,
    model: String,
    ane: Option<bool>,
) -> Result<ModelStatus, String> {
    let state = app.state::<crate::AppState>();
    let manager =
        model_manager(&app).map_err(|err| track_download_error(&app, &model, "resolve", err))?;
    let ane = ane.unwrap_or_else(|| super::catalog::ane_encoder_dir(&model).is_some());
    ensure_model_downloadable(&model, ane, &manager)
        .map_err(|err| track_download_error(&app, &model, "resolve", anyhow!(err)))?;
    let spec =
        spec_for(&model, ane).map_err(|err| track_download_error(&app, &model, "resolve", err))?;
    ensure_models_root(&app).map_err(|err| track_download_error(&app, &model, "install", err))?;
    let ane_pending = ane
        && super::catalog::ane_needs_compile_step(&model)
        && super::catalog::ane_encoder_dir(&model).is_some()
        && !ane_installed_for(&model, &manager);
    let cancel_token = state.create_download_token(&model)?;
    struct DownloadGuard<'a>(&'a AppHandle<AppRuntime>, String);
    impl Drop for DownloadGuard<'_> {
        fn drop(&mut self) {
            refresh_model_readiness(self.0, &self.1);
            self.0
                .state::<crate::AppState>()
                .clear_download_token(&self.1);
        }
    }
    let _download_guard = DownloadGuard(&app, model.clone());
    let progress_app = app.clone();
    let files: Vec<(String, Option<u64>)> = spec
        .files
        .iter()
        .map(|file| (file.path.clone(), file.size_bytes))
        .collect();
    // Speech reports percent per file; report it across the whole model so
    // it doesn't restart at 0% on each file.
    let sizes: Option<Vec<u64>> = files.iter().map(|(_, size)| *size).collect();
    let total_size: u64 = sizes.iter().flatten().sum();
    let progress = |event: speech_models::ModelDownloadProgress| {
        let index = files.iter().position(|(path, _)| *path == event.file);
        let percent = match (index, &sizes) {
            (Some(index), Some(sizes)) if !event.verifying && total_size > 0 => {
                let done = sizes[..index].iter().sum::<u64>() + event.downloaded;
                (done as f64 / total_size as f64 * 100.0).clamp(0.0, 100.0)
            }
            _ => event.percent,
        };
        progress_app
            .state::<crate::AppState>()
            .note_download_percent(&event.model, percent.round().clamp(0.0, 100.0) as u8);
        let _ = progress_app.emit(
            "download:progress",
            DownloadProgressPayload {
                model: event.model.clone(),
                file: event.file,
                downloaded: event.downloaded,
                total: event.total,
                percent,
                verifying: event.verifying,
                file_index: index.map_or(0, |index| index + 1),
                file_count: files.len(),
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
                let installed = installed_spec(&model, &manager).map_err(|err| err.to_string())?;
                let status = manager.status(&installed).map_err(|err| err.to_string())?;
                return Ok(map_status(status, &manager));
            }
            let detail = crate::analytics::error_detail(&err);
            let stage = match detail.reason {
                "verification" => "verify",
                "storage" => "install",
                _ => "download",
            };
            crate::analytics::track_model_download_failed(&app, &model, stage, detail);
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

    // Release the loaded engine before replacing package files or adding an
    // encoder, so warm-up reloads the selected package and companion.
    let status = if super::catalog::ane_replaces_model_files(&model) || ane {
        let handle = app.clone();
        let spec = spec.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Some(state) = handle.try_state::<crate::AppState>() {
                let transcriber = state.local_transcriber();
                if transcriber.loaded_model_id().as_deref() == Some(spec.id.as_str()) {
                    transcriber.unload();
                }
            }
            finish_model_install(&model_manager(&handle)?, &spec, ane)
        })
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err: anyhow::Error| err.to_string())?
    } else {
        status
    };

    let _ = app.emit(
        "download:complete",
        DownloadCompletePayload {
            model: status.id.clone(),
        },
    );

    crate::analytics::track_model_downloaded(&app, &status.id);

    if ane_pending {
        // The compile loads the model itself and warms once it lands.
        spawn_ane_compile(app.clone(), model.clone());
    } else {
        super::warm_model(&app, status.id.clone());
    }

    let settings = state.current_settings();
    crate::tray::refresh_menus(&app, &settings);

    Ok(map_status(status, &manager))
}

fn track_download_error(
    app: &AppHandle<AppRuntime>,
    model: &str,
    stage: &str,
    err: anyhow::Error,
) -> String {
    crate::analytics::track_model_download_failed(
        app,
        model,
        stage,
        crate::analytics::error_detail(&err),
    );
    err.to_string()
}

/// The manager deletes with `remove_dir_all`, so clear the tree first.
fn delete_model_dir(
    manager: &speech_models::ModelInstallManager,
    model: &str,
) -> Result<speech_models::ModelStatus> {
    let dir = manager.model_dir(model);
    crate::platform::remove_dir_all_compat(&dir)
        .with_context(|| format!("remove model directory {}", dir.display()))?;
    manager.delete(model)
}

/// Windows can hold a file open for a moment after it closes (antivirus,
/// indexer), so retry before reporting failure.
fn delete_with_retry(
    manager: &speech_models::ModelInstallManager,
    model: &str,
) -> Result<speech_models::ModelStatus> {
    let mut attempts = 0;
    loop {
        match delete_model_dir(manager, model) {
            Ok(status) => return Ok(status),
            Err(err) => {
                attempts += 1;
                if attempts == 3 {
                    return Err(err);
                }
                tracing::warn!("[speech] delete {model} retrying after: {err:#}");
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }
}

#[tauri::command]
pub async fn delete_model(
    app: AppHandle<AppRuntime>,
    model: String,
) -> Result<ModelStatus, String> {
    let handle = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let manager = model_manager(&handle).map_err(|err| err.to_string())?;

        if let Some(state) = handle.try_state::<crate::AppState>() {
            state.ready_models.lock().remove(&model);
            let transcriber = state.local_transcriber();
            if transcriber.loaded_model_id().as_deref() == Some(model.as_str()) {
                transcriber.unload();
            }
        }

        let result = delete_with_retry(&manager, &model)
            .map(|status| map_status(status, &manager))
            .map_err(|err| {
                tracing::error!("[speech] delete {model} failed: {err:#}");
                format!("{err:#}")
            });
        refresh_model_readiness(&handle, &model);
        result
    })
    .await
    .map_err(|err| err.to_string())??;

    crate::analytics::track_model_deleted(&app, &status.key);

    if let Some(state) = app.try_state::<crate::AppState>() {
        let settings = state.current_settings();
        crate::tray::refresh_menus(&app, &settings);
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
    let spec = installed_spec(model, &manager)?;
    let resolved = manager.resolve(&spec)?;
    Ok(ReadyModel {
        key: resolved.id,
        path: resolved.path,
        engine: resolved.engine,
    })
}

fn refresh_model_readiness(app: &AppHandle<AppRuntime>, model: &str) {
    // Keep disk I/O outside the lock used by the shortcut.
    let ready = ensure_model_ready(app, model).is_ok();
    let state = app.state::<crate::AppState>();
    let mut models = state.ready_models.lock();
    if ready {
        models.insert(model.to_string());
    } else {
        models.remove(model);
    }
}

/// `preferred` when it's installed, else the first installed local model.
pub fn installed_local_model<R: Runtime>(
    app: &AppHandle<R>,
    preferred: &str,
) -> Option<ReadyModel> {
    std::iter::once(preferred)
        .chain(
            super::catalog::local_manifests()
                .iter()
                .map(|manifest| manifest.id)
                .filter(|id| *id != preferred),
        )
        .find_map(|id| ensure_model_ready(app, id).ok())
}

pub fn ensure_local_fallback_model<R: Runtime>(
    app: &AppHandle<R>,
    preferred: &str,
) -> Result<ReadyModel> {
    let model = installed_local_model(app, preferred)
        .ok_or_else(|| anyhow!("No local transcription model is installed for fallback"))?;
    if model.key != preferred {
        tracing::error!(
            "[LocalTranscriber] Using installed local model `{}` for remote fallback (preferred `{preferred}` is unavailable)",
            model.key
        );
    }
    Ok(model)
}

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod parakeet_package_tests {
    use super::*;

    #[test]
    #[ignore = "requires PARAKEET_ANE_TEST_CACHE and PARAKEET_ANE_TEST_ORIGIN"]
    fn switches_parakeet_packages_without_losing_working_download() -> Result<()> {
        let cache = PathBuf::from(std::env::var("PARAKEET_ANE_TEST_CACHE")?).join("switching");
        let origin = std::env::var("PARAKEET_ANE_TEST_ORIGIN")?;
        let manager = speech_models::ModelInstallManager::new(cache.clone());
        let model = "parakeet_tdt_v3_gguf";
        let fixture_spec = |ane| -> Result<speech_models::InstallSpec> {
            let mut spec = spec_for(model, ane)?;
            for file in &mut spec.files {
                file.url = format!("{origin}/{}", file.url.rsplit('/').next().unwrap());
            }
            Ok(spec)
        };
        let full = fixture_spec(false)?;
        let ane = fixture_spec(true)?;
        let runtime = tokio::runtime::Runtime::new()?;
        let resolver = local_resolver(cache);
        for use_ane in [false, true, false, true] {
            let spec = if use_ane { &ane } else { &full };
            runtime.block_on(manager.install(spec, Default::default()))?;
            assert!(finish_model_install(&manager, spec, use_ane)?.installed);
            let resolved = manager.resolve(&resolver(model).unwrap())?;
            assert_eq!(
                resolved.path,
                manager.model_dir(model).join(&spec.files[0].path)
            );
            let obsolete = if use_ane { &full } else { &ane };
            for file in &obsolete.files {
                assert!(!manager.model_dir(model).join(&file.path).exists());
            }
            assert_eq!(ane_installed_for(model, &manager), use_ane);

            let mut broken = obsolete.clone();
            broken.files[0].sha256 = Some("0".repeat(64));
            assert!(
                runtime
                    .block_on(manager.install(&broken, Default::default()))
                    .is_err()
            );
            assert!(manager.resolve(&resolver(model).unwrap()).is_ok());
            assert!(manager.verify(spec)?.installed);
        }
        Ok(())
    }
}
