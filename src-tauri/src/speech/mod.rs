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

/// The speaker diarization model, once fully downloaded.
/// Nemotron-3 once downloaded, otherwise the Sortformer v2.1 diarizer a
/// previous version installed, which still works until the upgrade lands.
pub(crate) fn installed_diarizer_path(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let models_dir = install::model_cache_dir(app).ok()?;
    current_diarizer_path(&models_dir).or_else(|| {
        let retired = models_dir
            .join(catalog::RETIRED_DIARIZER_MODEL)
            .join(catalog::RETIRED_DIARIZER_FILE);
        retired.is_file().then_some(retired)
    })
}

/// The Nemotron-3 diarizer, once fully downloaded. Sortformer v2.1 has no live mode.
pub(crate) fn live_diarizer_path(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    current_diarizer_path(&install::model_cache_dir(app).ok()?)
}

fn current_diarizer_path(models_dir: &std::path::Path) -> Option<PathBuf> {
    let manager = glimpse_speech::models::ModelInstallManager::new(models_dir);
    let spec = catalog::install_spec(catalog::DIARIZER_MODEL, false)?;
    manager.resolve(&spec).ok().map(|resolved| resolved.path)
}

/// People who installed the Sortformer v2.1 diarizer chose speaker detection,
/// so download its replacement in the background, then remove the old one.
pub(crate) fn upgrade_retired_diarizer(app: &AppHandle<AppRuntime>) {
    let Ok(models_dir) = install::model_cache_dir(app) else {
        return;
    };
    let retired = models_dir.join(catalog::RETIRED_DIARIZER_MODEL);
    if !retired.exists() {
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
                tracing::warn!("[speech] speaker model upgrade failed, keeping Sortformer: {err}");
                return;
            }
            // A cancelled download also returns Ok, so only a verified install replaces Sortformer.
            if current_diarizer_path(&models_dir).is_none() {
                tracing::warn!("[speech] speaker model upgrade did not finish, keeping Sortformer");
                return;
            }
        }
        if let Err(err) = crate::platform::remove_dir_all_compat(&retired) {
            tracing::warn!("[speech] could not remove {}: {err}", retired.display());
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

/// The Parakeet TDT V3 encoder earlier versions installed runs on the CPU; the
/// Neural Engine one is a pipeline in model0..model3. Only the selected model upgrades.
pub(crate) fn upgrade_parakeet_encoder(app: &AppHandle<AppRuntime>) {
    const MODEL: &str = "parakeet_tdt_v3_gguf";
    let (Some(dir_name), Some(mut spec), Ok(models_dir)) = (
        catalog::ane_encoder_dir(MODEL),
        catalog::install_spec(MODEL, true),
        install::model_cache_dir(app),
    ) else {
        return;
    };
    let model_dir = models_dir.join(MODEL);
    let encoder = model_dir.join(&dir_name);
    let is_old = |encoder: &Path| encoder.join("model.mil").is_file();
    let staging = model_dir.join(".encoder-upgrade");
    if !is_old(&encoder) || app.state::<AppState>().current_settings().local_model != MODEL {
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
            if is_old(&encoder) {
                // Keeps the old encoder loaded for dictation until the new one compiles,
                // and waits out an in-flight load so the rename can't land mid-load.
                if app.state::<AppState>().current_settings().local_model == MODEL
                    && let Ok(ready) = install::ensure_model_ready(&app, MODEL)
                {
                    let transcriber = app.state::<AppState>().local_transcriber();
                    let _ = transcriber.preload_and_warm(&ready);
                }
                let manifest = format!(".{dir_name}.manifest.json");
                let backup = model_dir.join(format!("{dir_name}.old"));
                crate::platform::remove_dir_all_compat(&backup)?;
                std::fs::rename(&encoder, &backup)?;
                if let Err(err) = std::fs::rename(staged_dir.join(&dir_name), &encoder) {
                    std::fs::rename(&backup, &encoder)?;
                    return Err(err);
                }
                if let Err(err) =
                    std::fs::rename(staged_dir.join(&manifest), model_dir.join(&manifest))
                {
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
            {
                if let Err(err) =
                    install::download_model_now(app.clone(), replacement.to_string(), None).await
                {
                    tracing::warn!("[speech] {replacement} download failed, keeping ONNX: {err}");
                    continue;
                }
                let dir = models_dir.clone();
                let verified = tauri::async_runtime::spawn_blocking(move || {
                    install::verify_model_installed_at(&dir, replacement)
                })
                .await
                .unwrap_or(false);
                // A cancelled download also returns Ok.
                if !verified {
                    tracing::warn!("[speech] {replacement} is not installed, keeping ONNX");
                    continue;
                }
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
