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
    reason: &'static str,
}

#[derive(Serialize, Clone)]
struct DownloadCancelledPayload {
    model: String,
}

const MODELS_ROOT: &str = "models";

pub fn local_resolver(models_dir: PathBuf) -> glimpse_speech::service::ModelResolver {
    let manager = speech_models::ModelInstallManager::new(models_dir);
    std::sync::Arc::new(move |model| {
        definition(model)?;
        installed_spec(model, &manager).ok()
    })
}

/// `local_resolver` for request-driven callers like the API server. When a
/// resolver returns `None`, glimpse-speech falls back to treating the model id
/// as a file path and loads whatever it points at, so a client could make the
/// engine parse any file on disk. Ids outside the catalog get a spec whose id
/// fails glimpse-speech's validation instead, which rejects them before any
/// disk access.
pub fn catalog_only_resolver(models_dir: PathBuf) -> glimpse_speech::service::ModelResolver {
    let resolver = local_resolver(models_dir);
    std::sync::Arc::new(move |model| {
        resolver(model).or_else(|| {
            Some(speech_models::InstallSpec {
                id: format!("{model} (not a Glimpse model id)"),
                engine: speech_models::ModelEngine::Whisper,
                storage: speech_models::ModelStorage::Directory,
                files: Vec::new(),
                variant: None,
            })
        })
    })
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
    if let Some(bin) = super::catalog::whisper_bin_install_spec(model, false)
        && !manager.status(&base)?.installed
        && manager.status(&bin)?.installed
    {
        return Ok(bin);
    }
    Ok(base)
}

/// Adding the Neural Engine encoder to a Whisper `.bin` install keeps the
/// `.bin` instead of downloading the GGUF.
fn download_spec(
    model: &str,
    ane: bool,
    manager: &speech_models::ModelInstallManager,
) -> Result<speech_models::InstallSpec> {
    if ane
        && let Some(bin) = super::catalog::whisper_bin_install_spec(model, true)
        && installed_spec(model, manager)?.files == bin.files[..1]
    {
        return Ok(bin);
    }
    spec_for(model, ane)
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

/// Installed with every file matching its checksum.
pub(crate) fn verify_model_installed_at(models_dir: &Path, model: &str) -> bool {
    let manager = speech_models::ModelInstallManager::new(models_dir.to_path_buf());
    installed_spec(model, &manager)
        .and_then(|spec| manager.verify(&spec))
        .is_ok_and(|status| status.installed)
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
        && (dir.join("model.mil").is_file() && dir.join("weights").join("weight.bin").is_file()
            // A pipeline encoder keeps its stages in model0, model1, ...
            || dir.join("model0").join("model.mil").is_file())
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
    let mut models = super::catalog::list_local_models();
    models.push(super::catalog::diarizer_model_info());
    models
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

/// Legacy models stay downloadable while selected or partly downloaded.
pub(crate) fn model_download_allowed(
    app: &AppHandle<AppRuntime>,
    models_dir: &Path,
    model: &str,
) -> bool {
    if super::catalog::model_is_downloadable(model)
        || super::replaces_onnx_install(models_dir, model)
    {
        return true;
    }
    let Ok(spec) = spec_for(model, false) else {
        return false;
    };
    let settings = app.state::<crate::AppState>().current_settings();
    let dir = models_dir.join(model);
    settings.local_model == model
        || spec
            .files
            .iter()
            .any(|file| dir.join(format!("{}.part", file.path)).is_file())
}

fn ensure_model_downloadable(
    app: &AppHandle<AppRuntime>,
    model: &str,
    ane: bool,
    manager: &speech_models::ModelInstallManager,
) -> Result<(), String> {
    if model_download_allowed(app, manager.cache_dir(), model) {
        return Ok(());
    }
    if !ane {
        return Err(MODEL_UNAVAILABLE.to_string());
    }
    let base_spec = installed_spec(model, manager).map_err(|err| err.to_string())?;
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
        model_manager(&app).map_err(|err| download_failed(&app, &model, "resolve", err))?;
    let ane = ane.unwrap_or_else(|| super::catalog::ane_encoder_dir(&model).is_some());
    ensure_model_downloadable(&app, &model, ane, &manager)
        .map_err(|err| download_failed(&app, &model, "resolve", anyhow!(err)))?;
    let spec = download_spec(&model, ane, &manager)
        .map_err(|err| download_failed(&app, &model, "resolve", err))?;
    ensure_models_root(&app).map_err(|err| download_failed(&app, &model, "install", err))?;
    ensure_disk_space(&manager.model_dir(&model), &spec)
        .map_err(|err| download_failed(&app, &model, "install", err))?;
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
            tracing::error!("[speech] download {model} failed: {err:#}");
            return Err(download_failed(&app, &model, "download", err));
        }
    };

    let replaces_files = super::catalog::ane_replaces_model_files(&model);
    let status = if replaces_files || ane {
        let handle = app.clone();
        let spec = spec.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // Release the loaded engine before replacing package files, so
            // warm-up reloads the selected package.
            if replaces_files && let Some(state) = handle.try_state::<crate::AppState>() {
                let transcriber = state.local_transcriber();
                if transcriber.loaded_model_id().as_deref() == Some(spec.id.as_str()) {
                    transcriber.unload();
                }
            }
            finish_model_install(&model_manager(&handle)?, &spec, ane)
        })
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err: anyhow::Error| format!("{err:#}"))?
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

    if ane && !replaces_files && super::catalog::ane_encoder_dir(&model).is_some() {
        super::compile_ane_encoder(&app, status.id.clone());
    } else if definition(&model).is_some() {
        super::warm_model(&app, status.id.clone());
    }

    let settings = state.current_settings();
    crate::tray::refresh_menus(&app, &settings);

    Ok(map_status(status, &manager))
}

/// Downloads `model` and checks every file, since a cancelled download also
/// returns Ok.
pub(crate) async fn download_verified(
    app: &AppHandle<AppRuntime>,
    models_dir: &Path,
    model: &str,
) -> bool {
    if let Err(err) = download_model_now(app.clone(), model.to_string(), None).await {
        tracing::warn!("[speech] {model} download failed: {err}");
        return false;
    }
    let (dir, key) = (models_dir.to_path_buf(), model.to_string());
    let verified =
        tauri::async_runtime::spawn_blocking(move || verify_model_installed_at(&dir, &key))
            .await
            .unwrap_or(false);
    if !verified {
        tracing::warn!("[speech] {model} download did not finish");
    }
    verified
}

/// Free space a download must leave behind, so a model never fills the disk.
const DISK_HEADROOM_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// Refuses a download that would leave less than `DISK_HEADROOM_BYTES` free.
/// Archives count twice: the zip and its extracted copy exist together.
pub(super) fn ensure_disk_space(dir: &Path, spec: &speech_models::InstallSpec) -> Result<()> {
    let needed: u64 = spec
        .files
        .iter()
        .filter(|file| !dir.join(&file.path).exists())
        .map(|file| {
            let size = file.size_bytes.unwrap_or(0);
            let partial = dir.join(format!(
                "{}.{}",
                file.path,
                if file.extract { "zip" } else { "part" }
            ));
            let remaining = size.saturating_sub(std::fs::metadata(partial).map_or(0, |m| m.len()));
            if file.extract {
                remaining + size
            } else {
                remaining
            }
        })
        .sum();
    let volume = dir.ancestors().find(|path| path.exists()).unwrap_or(dir);
    let available = crate::platform::available_space(volume)
        .with_context(|| format!("read free space for {}", volume.display()))?;
    if available < needed + DISK_HEADROOM_BYTES {
        return Err(anyhow::Error::new(std::io::Error::from(
            std::io::ErrorKind::StorageFull,
        ))
        .context(format!(
            "Not enough disk space: needs {needed} bytes plus {DISK_HEADROOM_BYTES} spare, {available} available"
        )));
    }
    Ok(())
}

fn download_failed(
    app: &AppHandle<AppRuntime>,
    model: &str,
    stage: &str,
    err: anyhow::Error,
) -> String {
    let detail = crate::analytics::error_detail(&err);
    let reason = download_failure_reason(&err, &detail);
    let stage = match (stage, detail.reason) {
        ("download", "verification") => "verify",
        ("download", "storage") => "install",
        _ => stage,
    };
    crate::analytics::track_model_download_failed(app, model, stage, detail);
    let message = format!("{err:#}");
    let _ = app.emit(
        "download:error",
        DownloadErrorPayload {
            model: model.to_string(),
            error: message.clone(),
            reason,
        },
    );
    message
}

/// The reason shown to the user; the raw message stays in the payload.
fn download_failure_reason(
    err: &anyhow::Error,
    detail: &crate::analytics::ErrorDetail,
) -> &'static str {
    if crate::platform::is_disk_full(err) {
        return "disk_full";
    }
    match (detail.error_type, detail.reason) {
        ("io", "not_found") => "failed",
        (_, "not_found" | "unauthorized" | "http_4xx") => "unavailable",
        (_, "network" | "timeout" | "http_5xx" | "rate_limited") => "network",
        (_, "blocked") => "blocked",
        (_, "verification" | "decode") => "damaged",
        _ => "failed",
    }
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
    // Background deletes (Automatic moving to a newer model) bypass the
    // window's own mutation, so it refreshes from this.
    let _ = app.emit(
        "model:deleted",
        DownloadCompletePayload {
            model: status.key.clone(),
        },
    );

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
    definition(model).ok_or_else(|| anyhow!("Not a transcription model: {model}"))?;
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

#[cfg(test)]
mod catalog_only_resolver_tests {
    use super::*;
    use glimpse_speech::service::{SpeechConfig, SpeechService};

    fn scratch_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("glimpse-resolver-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn service(resolver: glimpse_speech::service::ModelResolver, dir: &Path) -> SpeechService {
        SpeechService::new(SpeechConfig {
            resolver,
            model_cache_dir: dir.to_path_buf(),
        })
    }

    #[test]
    fn rejects_file_paths_and_unknown_ids() {
        let dir = scratch_dir("strict");
        let models = dir.join("models");
        let planted = dir.join("planted.gguf");
        std::fs::write(&planted, b"not a model").unwrap();
        std::fs::create_dir_all(models.join("stray")).unwrap();
        std::fs::write(models.join("stray/model.gguf"), b"not a model").unwrap();
        let service = service(catalog_only_resolver(models.clone()), &models);

        for model in [
            planted.to_str().unwrap(),
            "../planted.gguf",
            "stray",
            "whisper-1",
        ] {
            let err = service.resolve(model).unwrap_err().to_string();
            assert!(err.contains("not a Glimpse model id"), "{model}: {err}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_installing_unknown_ids_without_touching_disk() {
        let dir = scratch_dir("install");
        let models = dir.join("models");
        let service = service(catalog_only_resolver(models.clone()), &models);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        assert!(
            runtime
                .block_on(service.install("whisper-1", Default::default()))
                .is_err()
        );
        assert!(!models.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn still_resolves_catalog_models() {
        let dir = scratch_dir("catalog");
        let resolver = catalog_only_resolver(dir.clone());
        let spec = resolver("whisper_small_q5").unwrap();
        assert_eq!(spec.id, "whisper_small_q5");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
