pub mod catalog;
pub mod engine;
pub mod install;
pub mod menu;
pub mod remote;

use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use glimpse_speech::service::{SpeechConfig, SpeechService};
use reqwest::Client;
use tauri::{AppHandle, Manager};

use crate::settings::UserSettings;
use crate::transcription_api::TranscriptionSuccess;
use crate::{AppRuntime, AppState};

pub use catalog::{SpeechModel, list_models};

pub const WHISPER_CHUNK_SECONDS: u32 = 28;
pub const WHISPER_CHUNK_OVERLAP_SECONDS: u32 = 2;
pub const WHISPER_LEADING_PAD_SECONDS: f32 = 0.2;
pub const PARAKEET_CHUNK_SECONDS: u32 = 180;
pub const PARAKEET_CHUNK_OVERLAP_SECONDS: u32 = 3;
pub const VAD_MIN_SPEECH_PERCENT_FILE: f32 = 2.0;
pub const VAD_MIN_SPEECH_PERCENT_CHUNK: f32 = 5.0;

pub fn selected_model(settings: &UserSettings) -> String {
    if remote::is_configured(settings) {
        remote::speech_model_storage_label(settings, None)
    } else {
        settings.local_model.clone()
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn transcribe<T, Fut>(
    app: &AppHandle<AppRuntime>,
    client: &Client,
    settings: &UserSettings,
    model_id: &str,
    wav_path: &Path,
    local_fallback_model: &str,
    wants_timestamps: bool,
    is_cancelled: impl Fn() -> bool,
    map_remote: impl FnOnce(TranscriptionSuccess) -> T,
    local: impl FnOnce() -> Fut,
) -> Result<T>
where
    Fut: std::future::Future<Output = Result<T>>,
{
    if !(remote::is_remote_model(model_id) && remote::is_configured(settings)) {
        return local().await;
    }

    match remote::attempt_remote(
        app,
        client,
        settings,
        wav_path,
        local_fallback_model,
        remote::TranscribeOptions {
            timestamps: wants_timestamps,
            diarization: false,
        },
        is_cancelled,
    )
    .await
    {
        remote::RemoteAttempt::Success(success) => Ok(map_remote(success.transcription)),
        remote::RemoteAttempt::Fallback => local().await,
        remote::RemoteAttempt::Cancelled => Err(anyhow!("Transcription cancelled")),
        remote::RemoteAttempt::Unavailable(message) => Err(anyhow!(message)),
    }
}

/// The current speaker model once fully downloaded, else a retired one that
/// still works until the upgrade lands.
pub(crate) fn installed_diarizer_path(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let models_dir = install::model_cache_dir(app).ok()?;
    current_diarizer_path(&models_dir).or_else(|| {
        catalog::RETIRED_DIARIZERS
            .iter()
            .map(|(dir, file)| models_dir.join(dir).join(file))
            .find(|path| path.is_file())
    })
}

/// Only the current speaker model runs live; retired ones may have no live mode.
pub(crate) fn live_diarizer_path(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    current_diarizer_path(&install::model_cache_dir(app).ok()?)
}

fn current_diarizer_path(models_dir: &std::path::Path) -> Option<PathBuf> {
    let manager = glimpse_speech::models::ModelInstallManager::new(models_dir);
    let spec = catalog::install_spec(catalog::DIARIZER_MODEL, false)?;
    manager.resolve(&spec).ok().map(|resolved| resolved.path)
}

/// Speaker detection is hard to find in Settings, so new installs get the
/// diarizer in the background once setup is done.
pub(crate) fn install_diarizer_in_background(app: &AppHandle<AppRuntime>) {
    if installed_diarizer_path(app).is_some() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) =
            install::download_model_now(app, catalog::DIARIZER_MODEL.into(), Some(false)).await
        {
            tracing::warn!("[speech] speaker model download failed: {err}");
        }
    });
}

/// People who installed a retired speaker model chose speaker detection, so
/// download the current one in the background, then remove the old ones.
pub(crate) fn upgrade_retired_diarizers(app: &AppHandle<AppRuntime>) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let retired: Vec<PathBuf> = catalog::RETIRED_DIARIZERS
        .iter()
        .map(|(dir, _)| models_dir.join(dir))
        .filter(|dir| dir.exists())
        .collect();
    if retired.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let upgraded = current_diarizer_path(&models_dir).is_none();
        if upgraded {
            if let Err(err) = install::download_model_now(
                app.clone(),
                catalog::DIARIZER_MODEL.into(),
                Some(false),
            )
            .await
            {
                tracing::warn!("[speech] speaker model upgrade failed, keeping the old one: {err}");
                return;
            }
            // A cancelled download also returns Ok, so only a verified install replaces it.
            if current_diarizer_path(&models_dir).is_none() {
                tracing::warn!(
                    "[speech] speaker model upgrade did not finish, keeping the old one"
                );
                return;
            }
        }
        for dir in retired {
            if let Err(err) = crate::platform::remove_dir_all_compat(&dir) {
                tracing::warn!("[speech] could not remove {}: {err}", dir.display());
            }
        }
        if upgraded {
            crate::toast::show(
                &app,
                "success",
                None,
                &crate::toast::native(&app, "native.toast.speaker_model_upgraded"),
            );
        }
    });
}

/// Turning Automatic off keeps the current model and stops a switch in progress.
#[tauri::command]
pub(crate) fn set_local_model_auto(
    app: AppHandle<AppRuntime>,
    enabled: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut settings = state.current_settings_unmasked();
    if !enabled && let Some(target) = catalog::model_upgrade_target(&settings) {
        state.cancel_download(target);
    }
    settings.local_model_auto = enabled;
    menu::persist_menu_settings(&app, settings).ok_or("Failed to save settings")?;
    follow_model_upgrade(&app);
    Ok(())
}

/// Moves the user to [`catalog::model_upgrade_target`] in the background. The
/// current model keeps working until the new one is installed and verified.
pub(crate) fn follow_model_upgrade(app: &AppHandle<AppRuntime>) {
    let settings = app.state::<AppState>().current_settings();
    if !settings.onboarding_completed {
        return;
    }
    let Some(target) = catalog::model_upgrade_target(&settings) else {
        return;
    };
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !install::check_model_installed_at(&models_dir, target)
            && !install::download_verified(&app, &models_dir, target).await
        {
            return;
        }

        let state = app.state::<AppState>();
        // Loading during a Neural Engine compile would compile the encoder twice.
        let compiling = ane_compile_marker(&models_dir, target);
        while state.pill().status() != crate::pill::PillStatus::Idle
            || !state.is_backend_idle()
            || compiling.as_ref().is_some_and(|marker| marker.is_file())
        {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }

        // Switch only to a model that loads: the old one is deleted below, so a
        // failure here keeps it and retries on the next launch.
        let loader = app.clone();
        let loaded = tauri::async_runtime::spawn_blocking(move || {
            let ready = install::ensure_model_ready(&loader, target)?;
            loader
                .state::<AppState>()
                .local_transcriber()
                .preload_and_warm_if_needed(&ready)
        })
        .await;
        match loaded {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                tracing::error!("[speech] not moving to {target}: it failed to load: {err:#}");
                return;
            }
            Err(err) => {
                tracing::error!("[speech] not moving to {target}: {err}");
                return;
            }
        }

        let mut settings = state.current_settings_unmasked();
        // The user may have picked a model while this downloaded.
        if catalog::model_upgrade_target(&settings) != Some(target) {
            return;
        }
        let previous = std::mem::replace(&mut settings.local_model, target.to_string());
        let Some(saved) = menu::persist_menu_settings(&app, settings) else {
            return;
        };
        crate::tray::refresh_menus(&app, &saved);
        crate::toast::show(
            &app,
            "success",
            None,
            &crate::toast::native_format(
                &app,
                "native.toast.model_switched",
                &[("model", &catalog::model_label(target))],
            ),
        );
        if previous != saved.local_api_model
            && let Err(err) = install::delete_model(app.clone(), previous.clone()).await
        {
            tracing::warn!("[speech] could not remove {previous}: {err}");
        }
    });
}

/// Frees whisper.cpp Core ML encoders, which transcribe.cpp can't load, and stale
/// `.bin` partials. The selected model keeps its encoder until the new one is installed.
pub(crate) fn remove_whisper_cpp_files(app: &AppHandle<AppRuntime>) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let selected = app.state::<AppState>().current_settings().local_model;
        for manifest in catalog::local_manifests() {
            let model_dir = models_dir.join(manifest.id);
            if let Some(partial) = catalog::whisper_bin_partial(manifest) {
                let _ = std::fs::remove_file(model_dir.join(partial));
            }
            if !catalog::ANE_SUPPORTED {
                continue;
            }
            let Some(dir_name) = catalog::whisper_cpp_encoder_dir(manifest) else {
                continue;
            };
            let _ = std::fs::remove_file(model_dir.join(format!("{dir_name}.zip")));
            if model_dir.join(&dir_name).symlink_metadata().is_err() {
                continue;
            }
            if manifest.id != selected || catalog::ane_encoder_dir(manifest.id).is_none() {
                remove_encoder(&model_dir, &dir_name);
                continue;
            }
            let app = app.clone();
            let model = manifest.id.to_string();
            tauri::async_runtime::spawn(async move {
                match install::download_model_now(app, model.clone(), Some(true)).await {
                    // A cancelled download also returns Ok.
                    Ok(status) if status.ane_installed => remove_encoder(&model_dir, &dir_name),
                    Ok(_) => tracing::warn!("[speech] {model} encoder download did not finish"),
                    Err(err) => tracing::warn!("[speech] {model} encoder download failed: {err}"),
                }
            });
        }
    });
}

fn remove_encoder(model_dir: &Path, dir_name: &str) {
    let encoder = model_dir.join(dir_name);
    let Ok(metadata) = encoder.symlink_metadata() else {
        return;
    };
    // Unlink a symlinked encoder instead of emptying its target.
    let removed = if metadata.file_type().is_symlink() {
        std::fs::remove_file(&encoder)
    } else {
        crate::platform::remove_dir_all_compat(&encoder)
    };
    match removed {
        Ok(()) => {
            let _ = std::fs::remove_file(model_dir.join(format!(".{dir_name}.manifest.json")));
            tracing::info!("[speech] removed whisper.cpp encoder {}", encoder.display());
        }
        Err(err) => tracing::warn!("[speech] could not remove {}: {err}", encoder.display()),
    }
}

fn ane_compile_marker(models_dir: &Path, model: &str) -> Option<PathBuf> {
    let dir_name = catalog::ane_encoder_dir(model)?;
    Some(
        models_dir
            .join(model)
            .join(format!(".{dir_name}.compiling")),
    )
}

/// The first Neural Engine load compiles the encoder, which can take minutes.
/// It runs on its own service; other loads skip the encoder until it finishes.
pub(crate) fn compile_ane_encoder(app: &AppHandle<AppRuntime>, model: String) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let Some(marker) = ane_compile_marker(&models_dir, &model) else {
        return;
    };
    // Retries at the next launch if the app quits first. A decoder-only
    // model's next load compiles its encoder anyway, so it gets no retry.
    if !catalog::ane_replaces_model_files(&model) {
        let _ = std::fs::write(&marker, b"");
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let service = SpeechService::new(SpeechConfig {
            resolver: install::local_resolver(models_dir.clone()),
            model_cache_dir: models_dir,
        })
        .loading_compiling_encoders();
        let started = std::time::Instant::now();
        if let Err(err) = service.preload_and_warm(&model) {
            tracing::warn!("[speech] {model} encoder compile failed: {err:#}");
            return;
        }
        drop(service);
        let _ = std::fs::remove_file(&marker);
        tracing::info!(
            "[speech] {model} encoder compiled in {:.1}s",
            started.elapsed().as_secs_f32()
        );
        let transcriber = app.state::<AppState>().local_transcriber();
        if transcriber.loaded_model_id().as_deref() == Some(model.as_str()) {
            transcriber.unload();
            warm_model(&app, model);
        }
    });
}

pub(crate) fn compile_pending_ane_encoders(app: &AppHandle<AppRuntime>) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    for manifest in catalog::local_manifests() {
        if !catalog::ane_replaces_model_files(manifest.id)
            && ane_compile_marker(&models_dir, manifest.id).is_some_and(|marker| marker.is_file())
        {
            compile_ane_encoder(app, manifest.id.to_string());
        }
    }
}

/// Sum of the file sizes an extraction manifest lists.
fn unpacked_bytes(manifest: &Path) -> Option<u64> {
    let entries: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(manifest).ok()?).ok()?;
    entries.iter().map(|entry| entry["size"].as_u64()).sum()
}

/// Replaces a Parakeet TDT V3 encoder that isn't this build's (older CPU or fp16
/// ones, or the other macOS variant). Only the selected model upgrades.
pub(crate) fn upgrade_parakeet_encoder(app: &AppHandle<AppRuntime>) {
    const MODEL: &str = "parakeet_tdt_v3_gguf";
    let (Some(dir_name), Some(expected), Some(mut spec), Ok(models_dir)) = (
        catalog::ane_encoder_dir(MODEL),
        catalog::ane_encoder_unpacked_bytes(MODEL),
        catalog::install_spec(MODEL, true),
        install::model_cache_dir(app),
    ) else {
        return;
    };
    let model_dir = models_dir.join(MODEL);
    let encoder = model_dir.join(&dir_name);
    let manifest = format!(".{dir_name}.manifest.json");
    let installed_manifest = model_dir.join(&manifest);
    let is_old =
        move |manifest: &Path| unpacked_bytes(manifest).is_some_and(|bytes| bytes != expected);
    let staging = model_dir.join(".encoder-upgrade");
    let settings = app.state::<AppState>().current_settings();
    // A model about to be replaced is deleted, staging directory included.
    if !is_old(&installed_manifest)
        || settings.local_model != MODEL
        || catalog::model_upgrade_target(&settings).is_some()
    {
        // A partial download from an upgrade that no longer applies.
        let _ = crate::platform::remove_dir_all_compat(&staging);
        return;
    }
    spec.files.retain(|file| file.extract);
    let manager = glimpse_speech::models::ModelInstallManager::new(staging.clone());
    let staged_dir = manager.model_dir(MODEL);
    if let Err(err) = install::ensure_disk_space(&staged_dir, &spec) {
        return tracing::warn!("[speech] {MODEL} encoder upgrade skipped: {err:#}");
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match manager.install(&spec, Default::default()).await {
            Ok(status) if status.installed => {}
            Ok(_) => return tracing::warn!("[speech] {MODEL} encoder upgrade did not finish"),
            Err(err) => return tracing::warn!("[speech] {MODEL} encoder upgrade failed: {err:#}"),
        }
        let swapped = tauri::async_runtime::spawn_blocking(move || {
            if is_old(&installed_manifest) {
                // Keeps the old encoder loaded for dictation until the new one compiles,
                // and waits out an in-flight load so the rename can't land mid-load.
                if app.state::<AppState>().current_settings().local_model == MODEL
                    && let Ok(ready) = install::ensure_model_ready(&app, MODEL)
                {
                    let transcriber = app.state::<AppState>().local_transcriber();
                    let _ = transcriber.preload_and_warm(&ready);
                }
                let backup = model_dir.join(format!("{dir_name}.old"));
                crate::platform::remove_dir_all_compat(&backup)?;
                std::fs::rename(&encoder, &backup)?;
                if let Err(err) = std::fs::rename(staged_dir.join(&dir_name), &encoder) {
                    std::fs::rename(&backup, &encoder)?;
                    return Err(err);
                }
                if let Err(err) = std::fs::rename(staged_dir.join(&manifest), &installed_manifest) {
                    std::fs::rename(&encoder, staged_dir.join(&dir_name))?;
                    std::fs::rename(&backup, &encoder)?;
                    return Err(err);
                }
                let _ = crate::platform::remove_dir_all_compat(&backup);
                compile_ane_encoder(&app, MODEL.to_string());
            }
            crate::platform::remove_dir_all_compat(&staging)
        })
        .await;
        if let Ok(Err(err)) = swapped {
            tracing::warn!("[speech] {MODEL} encoder swap failed: {err}");
        }
    });
}

const NEMOTRON_ONNX_FILES: &[&str] = &[
    "encoder.onnx",
    "encoder.onnx.data",
    "decoder_joint.onnx",
    "tokenizer.model",
];

/// Models earlier versions ran from ONNX files, the transcribe.cpp model that
/// replaces each, and the files they downloaded.
const ONNX_MODELS: &[(&str, &str, &[&str])] = &[
    (
        "parakeet_tdt_int8",
        "parakeet_tdt_v3_gguf",
        &[
            "encoder-model.int8.onnx",
            "decoder_joint-model.int8.onnx",
            "vocab.txt",
        ],
    ),
    (
        "parakeet_unified_en_int8",
        "parakeet_unified_en_int8",
        &[
            "encoder.int8.onnx",
            "encoder.int8.onnx.data",
            "decoder_joint.int8.onnx",
            "tokenizer.model",
        ],
    ),
    (
        "nemotron_streaming_en",
        "nemotron_streaming_en",
        NEMOTRON_ONNX_FILES,
    ),
    (
        "nemotron_35_streaming_multilingual",
        "nemotron_35_streaming_multilingual",
        NEMOTRON_ONNX_FILES,
    ),
];

fn onnx_installed(models_dir: &Path, id: &str, files: &[&str]) -> bool {
    files
        .iter()
        .any(|file| models_dir.join(id).join(file).is_file())
}

/// The ONNX files and their interrupted `.part` downloads. Empty for a
/// symlinked model directory, so deleting never reaches outside the models dir.
fn onnx_leftovers(models_dir: &Path, id: &str, files: &[&str]) -> Vec<PathBuf> {
    let dir = models_dir.join(id);
    if !dir.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
        return Vec::new();
    }
    files
        .iter()
        .flat_map(|file| [dir.join(file), dir.join(format!("{file}.part"))])
        .filter(|path| path.symlink_metadata().is_ok_and(|meta| !meta.is_dir()))
        .collect()
}

/// Whether an earlier version's ONNX install of the model that `model`
/// replaces is still on disk, so its download stays allowed.
pub(crate) fn replaces_onnx_install(models_dir: &Path, model: &str) -> bool {
    ONNX_MODELS.iter().any(|(id, replacement, files)| {
        *replacement == model && onnx_installed(models_dir, id, files)
    })
}

/// ONNX models no longer load. The selected model keeps its ONNX files until
/// its replacement is installed and verified; other ONNX installs are removed.
pub(crate) fn replace_onnx_models(app: &AppHandle<AppRuntime>) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let selected = app.state::<AppState>().current_settings().local_model;
        for (id, replacement, files) in ONNX_MODELS {
            let leftovers = onnx_leftovers(&models_dir, id, files);
            if leftovers.is_empty() {
                continue;
            }
            if *replacement == selected
                && onnx_installed(&models_dir, id, files)
                && !install::check_model_installed_at(&models_dir, replacement)
                && !install::download_verified(&app, &models_dir, replacement).await
            {
                continue;
            }
            for path in leftovers {
                if let Err(err) = std::fs::remove_file(&path) {
                    tracing::warn!("[speech] could not remove {}: {err}", path.display());
                }
            }
            // Only removes a directory left empty.
            let _ = std::fs::remove_dir(models_dir.join(id));
            tracing::info!("[speech] removed ONNX model {id}");
        }
    });
}

pub fn warm(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if remote::is_configured(settings) {
        return;
    }

    warm_model(app, settings.local_model.clone());
}

/// Loads a model off-thread. The idle monitor unloads it again if it goes unused.
pub fn warm_model(app: &AppHandle<AppRuntime>, model_key: String) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let ready = match install::ensure_model_ready(&app_handle, &model_key) {
            Ok(model) => model,
            Err(err) => {
                tracing::error!("[speech] skipping warm: {err}");
                return;
            }
        };
        let transcriber = app_handle.state::<AppState>().local_transcriber();
        if let Err(err) = transcriber.preload_and_warm_if_needed(&ready) {
            tracing::error!("[speech] warm failed: {err}");
        }
    });
}
