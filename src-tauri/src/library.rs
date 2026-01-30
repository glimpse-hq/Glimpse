use std::env;
use std::fs;
use std::io::{BufWriter, ErrorKind};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};
use tauri::{async_runtime, AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::transcribe::count_words;
use crate::{
    dictionary, model_manager,
    recorder::speech_percentage_i16_with_mode,
    storage::StorageManager,
    toast, transcribe, AppRuntime, AppState,
    LibraryJob, LibraryJobKind,
};
use webrtc_vad::VadMode;

const SUPPORTED_AUDIO_FORMATS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "flac"];
const SUPPORTED_VIDEO_FORMATS: &[&str] = &["mp4", "mov", "webm", "mkv"];
const MAX_CHUNK_MINUTES: u32 = 5;
const CHUNK_OVERLAP_SECONDS: u32 = 5;
const DIRECT_TRANSCRIBE_MINUTES: u32 = 10;
const WHISPER_CHUNK_SECONDS: u32 = 28;
const WHISPER_CHUNK_OVERLAP_SECONDS: u32 = 2;
const MOONSHINE_CHUNK_SECONDS: u32 = 60;
const MOONSHINE_CHUNK_OVERLAP_SECONDS: u32 = 2;
const VAD_MIN_SPEECH_PERCENT_FILE: f32 = 2.0;
const VAD_MIN_SPEECH_PERCENT_CHUNK: f32 = 5.0;
const TARGET_SAMPLE_RATE: u32 = 16_000;

fn is_cancelled_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("cancelled") || lower.contains("canceled")
}

fn is_ffmpeg_error_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("ffmpeg not found")
        || lower.contains("install ffmpeg")
        || lower.contains("ffmpeg is required")
}

pub const EVENT_LIBRARY_PROGRESS: &str = "library:transcription_progress";
pub const EVENT_LIBRARY_COMPLETE: &str = "library:transcription_complete";
pub const EVENT_LIBRARY_ERROR: &str = "library:transcription_error";
pub const EVENT_LIBRARY_OPEN_IMPORT: &str = "library:open_import";
pub const EVENT_LIBRARY_IMPORTING: &str = "library:importing";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LibraryItemStatus {
    Pending,
    Importing,
    Transcribing { progress: f32 },
    Complete,
    Cancelling,
    Cancelled,
    Error { message: String },
}

impl LibraryItemStatus {
    pub fn as_fields(&self) -> (String, f32, Option<String>) {
        match self {
            Self::Pending => ("pending".to_string(), 0.0, None),
            Self::Importing => ("importing".to_string(), 0.0, None),
            Self::Transcribing { progress } => ("transcribing".to_string(), *progress, None),
            Self::Complete => ("complete".to_string(), 1.0, None),
            Self::Cancelling => ("cancelling".to_string(), 0.0, None),
            Self::Cancelled => ("cancelled".to_string(), 0.0, None),
            Self::Error { message } => ("error".to_string(), 0.0, Some(message.clone())),
        }
    }

    pub fn from_fields(
        status: &str,
        progress: f32,
        error_message: Option<String>,
    ) -> LibraryItemStatus {
        match status {
            "pending" => Self::Pending,
            "importing" => Self::Importing,
            "transcribing" => Self::Transcribing { progress },
            "complete" => Self::Complete,
            "cancelling" => Self::Cancelling,
            "cancelled" => Self::Cancelled,
            "error" => {
                let message = error_message.unwrap_or_else(|| "Transcription failed".to_string());
                if is_cancelled_message(&message) {
                    Self::Cancelled
                } else {
                    Self::Error { message }
                }
            }
            _ => Self::Error {
                message: "Unknown status".to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
    pub id: String,
    pub name: String,
    pub audio_path: String,
    pub source_path: String,
    pub store_original: bool,
    pub status: LibraryItemStatus,
    pub transcript: Option<String>,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub duration_seconds: f32,
    pub file_size_bytes: u64,
    pub original_format: String,
    pub created_at: String,
    pub transcribed_at: Option<String>,
    pub tags: Vec<String>,
    pub llm_cleanup_enabled: bool,
    pub speech_model: String,
    pub show_timestamps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryFilter {
    pub search: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
    pub since_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItemsPage {
    pub items: Vec<LibraryItem>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryItemPatch {
    pub name: Option<String>,
    pub transcript: Option<String>,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub tags: Option<Vec<String>>,
    pub status: Option<LibraryItemStatus>,
    pub llm_cleanup_enabled: Option<bool>,
    pub speech_model: Option<String>,
    pub transcribed_at: Option<String>,
    pub show_timestamps: Option<bool>,
    pub duration_seconds: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryImportOptions {
    pub store_original: bool,
    pub model_key: String,
    pub llm_cleanup_enabled: bool,
    pub show_timestamps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryProgressPayload {
    pub id: String,
    pub progress: f32,
    pub current_chunk: u32,
    pub total_chunks: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_segments: Option<Vec<TranscriptSegment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Txt,
    Md,
    Srt,
    Vtt,
}

#[tauri::command]
pub fn create_library_item(
    path: String,
    options: LibraryImportOptions,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    let source_path = PathBuf::from(path);
    let storage = state.storage();
    let item = create_item_from_path(&app, storage, &source_path, &options)
        .map_err(|err| err.to_string())?;
    schedule_library_job(
        &app,
        &state,
        LibraryJob {
            id: item.id.clone(),
            kind: LibraryJobKind::Import {
                source_path,
                store_original: options.store_original,
            },
        },
    );
    Ok(item)
}

#[tauri::command]
pub fn get_library_items_page(
    filter: Option<LibraryFilter>,
    limit: u32,
    offset: u32,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItemsPage, String> {
    let filter = filter.unwrap_or_default();
    let limit = limit.clamp(1, 200) as usize;
    let offset = offset as usize;
    state
        .storage()
        .get_library_items_page(filter, limit, offset)
        .map(|(items, has_more)| LibraryItemsPage { items, has_more })
        .map_err(|err| format!("Failed to load library items page: {err}"))
}

#[tauri::command]
pub fn update_library_item(
    id: String,
    patch: LibraryItemPatch,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    let storage = state.storage();
    let updated = storage
        .update_library_item(&id, patch.clone())
        .map_err(|err| format!("Failed to update library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_library_item(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage();
    let item = storage
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))?;
    let Some(item) = item else {
        return Ok(());
    };

    let path = PathBuf::from(&item.audio_path);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Invalid library file path; delete aborted.".to_string());
    }

    let root = match library_root(&app) {
        Ok(root) => root,
        Err(err) => {
            eprintln!("Failed to resolve library root for delete: {err}");
            return Err("Failed to resolve library storage location.".to_string());
        }
    };
    let root = root
        .canonicalize()
        .map_err(|_| "Failed to resolve library storage location.".to_string())?;
    let safe_path = path
        .canonicalize()
        .map_err(|_| "Library item path could not be resolved; delete aborted.".to_string())?;
    if !safe_path.starts_with(&root) {
        return Err("Library item is stored outside the library folder; delete aborted.".to_string());
    }

    if let Some(parent) = safe_path.parent() {
        if parent == root {
            if safe_path.exists() {
                fs::remove_file(&safe_path)
                    .map_err(|err| format!("Failed to delete library file: {err}"))?;
            }
        } else if parent.exists() {
            fs::remove_dir_all(parent)
                .map_err(|err| format!("Failed to delete library files: {err}"))?;
        } else if safe_path.exists() {
            fs::remove_file(&safe_path)
                .map_err(|err| format!("Failed to delete library file: {err}"))?;
        }
    } else if safe_path.exists() {
        fs::remove_file(&safe_path)
            .map_err(|err| format!("Failed to delete library file: {err}"))?;
    }

    storage
        .delete_library_item(&id)
        .map_err(|err| format!("Failed to delete library item: {err}"))?;
    Ok(())
}

#[tauri::command]
pub fn cancel_library_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.remove_library_job(&id) {
        let _ = state.storage().update_library_item(
            &id,
            LibraryItemPatch {
                status: Some(LibraryItemStatus::Cancelled),
                ..Default::default()
            },
        );
        let _ = app.emit(
            EVENT_LIBRARY_ERROR,
            LibraryErrorPayload {
                id,
                message: "Transcription cancelled".to_string(),
            },
        );
        return Ok(());
    }
    state.cancel_library_transcription(&id);
    let _ = state.storage().update_library_item(
        &id,
        LibraryItemPatch {
            status: Some(LibraryItemStatus::Cancelling),
            ..Default::default()
        },
    );
    Ok(())
}

#[tauri::command]
pub fn retry_library_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage();
    let item = storage
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    let audio_exists = PathBuf::from(&item.audio_path).exists();
    let mut job = LibraryJobKind::TranscribeExisting;

    if !audio_exists {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(path) = stored_original_path(&item) {
            candidates.push(path);
        }
        let source = item.source_path.trim();
        if !source.is_empty() {
            candidates.push(PathBuf::from(source));
        }

        if let Some(source_path) = candidates.into_iter().find(|path| path.exists()) {
            job = LibraryJobKind::Import {
                source_path,
                store_original: item.store_original,
            };
        } else {
            let message =
                "Original file not found. Re-import the file to try again.".to_string();
            let _ = storage.update_library_item(
                &id,
                LibraryItemPatch {
                    status: Some(LibraryItemStatus::Error {
                        message: message.clone(),
                    }),
                    ..Default::default()
                },
            );
            let _ = app.emit(
                EVENT_LIBRARY_ERROR,
                LibraryErrorPayload {
                    id,
                    message: message.clone(),
                },
            );
            return Err(message);
        }
    }

    let _ = storage.update_library_item(
        &id,
        LibraryItemPatch {
            status: Some(LibraryItemStatus::Pending),
            ..Default::default()
        },
    );
    schedule_library_job(&app, &state, LibraryJob { id, kind: job });
    Ok(())
}

#[tauri::command]
pub fn export_library_item_to_path(
    id: String,
    format: ExportFormat,
    output_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let item = state
        .storage()
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    let content = build_export_content(&item, format.clone())
        .map_err(|err| format!("Failed to build export: {err}"))?;

    let output_path = PathBuf::from(output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create export directory at {}", parent.display()))
            .map_err(|err| err.to_string())?;
    }

    fs::write(&output_path, content.as_bytes()).with_context(|| {
        format!(
            "Failed to write export file to {}",
            output_path.display()
        )
    }).map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_library_tags(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .storage()
        .get_library_tags()
        .map_err(|err| format!("Failed to load tags: {err}"))
}

pub fn handle_opened_paths(app: &AppHandle<AppRuntime>, urls: Vec<PathBuf>) -> Result<()> {
    let paths: Vec<String> = urls
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    if let Err(err) = crate::tray::toggle_settings_window(app) {
        eprintln!("Failed to open settings window: {err}");
    }
    let _ = app.emit(EVENT_LIBRARY_OPEN_IMPORT, paths);
    Ok(())
}

fn create_item_from_path(
    app: &AppHandle<AppRuntime>,
    storage: Arc<StorageManager>,
    source_path: &Path,
    options: &LibraryImportOptions,
) -> Result<LibraryItem> {
    let status = model_manager::check_model_status(app.clone(), options.model_key.clone())
        .map_err(|err| anyhow!(err))?;
    if !status.installed {
        return Err(anyhow!("Selected model is not installed"));
    }
    if !source_path.exists() {
        return Err(anyhow!("File not found"));
    }
    let ext = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_supported_format(&ext) {
        return Err(anyhow!("Unsupported file format: {ext}"));
    }

    let file_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled");

    let id = Uuid::new_v4().to_string();
    let folder_name = build_folder_name(file_name, &id);
    let library_dir = library_root(app)?;
    let item_dir = library_dir.join(folder_name);
    let audio_path = item_dir.join(format!("{id}.wav"));
    let metadata = fs::metadata(source_path)?;

    let show_timestamps = options.show_timestamps && model_supports_timestamps(&options.model_key);

    let item = LibraryItem {
        id,
        name: file_name.to_string(),
        audio_path: audio_path.display().to_string(),
        source_path: source_path.display().to_string(),
        store_original: options.store_original,
        status: LibraryItemStatus::Pending,
        transcript: None,
        segments: None,
        duration_seconds: 0.0,
        file_size_bytes: metadata.len(),
        original_format: ext,
        created_at: Utc::now().to_rfc3339(),
        transcribed_at: None,
        tags: Vec::new(),
        llm_cleanup_enabled: false,
        speech_model: options.model_key.clone(),
        show_timestamps,
    };

    storage.insert_library_item(item.clone())?;
    Ok(item)
}

fn start_library_job_internal(app: &AppHandle<AppRuntime>, job: LibraryJob) {
    let app_handle = app.clone();
    async_runtime::spawn(async move {
        let state_handle = app_handle.state::<AppState>();
        let job_id = job.id.clone();
        let token = state_handle.register_library_transcription(job_id.clone());

        match job.kind {
            LibraryJobKind::Import {
                source_path,
                store_original,
            } => {
                let app_for_task = app_handle.clone();
                let token_for_task = token.clone();
                let job_id_for_task = job_id.clone();
                let result = async_runtime::spawn_blocking(move || {
                    let state_for_task = app_for_task.state::<AppState>();
                    convert_library_item(
                        &app_for_task,
                        &state_for_task,
                        &job_id_for_task,
                        &source_path,
                        store_original,
                        &token_for_task,
                    )
                })
                .await;

                match result {
                    Ok(Ok(())) => {
                        if token.is_cancelled() {
                            handle_library_job_error(
                                &app_handle,
                                &state_handle,
                                &job_id,
                                anyhow!("Transcription cancelled"),
                            );
                            return;
                        }
                        start_library_transcription_internal(&app_handle, &state_handle, job_id);
                    }
                    Ok(Err(err)) => {
                        handle_library_job_error(&app_handle, &state_handle, &job_id, err);
                    }
                    Err(err) => {
                        handle_library_job_error(
                            &app_handle,
                            &state_handle,
                            &job_id,
                            anyhow!("Library import task failed: {err}"),
                        );
                    }
                }
            }
            LibraryJobKind::TranscribeExisting => {
                if token.is_cancelled() {
                    handle_library_job_error(
                        &app_handle,
                        &state_handle,
                        &job_id,
                        anyhow!("Transcription cancelled"),
                    );
                    return;
                }
                start_library_transcription_internal(&app_handle, &state_handle, job_id);
            }
        }
    });
}

fn convert_library_item(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
    id: &str,
    source_path: &Path,
    store_original: bool,
    token: &CancellationToken,
) -> Result<()> {
    if token.is_cancelled() {
        return Err(anyhow!("Transcription cancelled"));
    }
    let storage = state.storage();
    let item = storage
        .get_library_item(id)?
        .ok_or_else(|| anyhow!("Library item not found"))?;

    if !source_path.exists() {
        return Err(anyhow!("File not found"));
    }

    let ext = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_supported_format(&ext) {
        return Err(anyhow!("Unsupported file format: {ext}"));
    }

    let audio_path = PathBuf::from(&item.audio_path);
    let item_dir = audio_path
        .parent()
        .ok_or_else(|| anyhow!("Library folder not found"))?;

    fs::create_dir_all(item_dir)
        .with_context(|| format!("Failed to create library folder at {}", item_dir.display()))?;

    let result = (|| -> Result<f32> {
        let _ = storage.update_library_item(
            id,
            LibraryItemPatch {
                status: Some(LibraryItemStatus::Importing),
                ..Default::default()
            },
        );
        let _ = app.emit(
            EVENT_LIBRARY_IMPORTING,
            LibraryImportPayload { id: id.to_string() },
        );

        if token.is_cancelled() {
            return Err(anyhow!("Transcription cancelled"));
        }

        if store_original {
            let original_target = item_dir.join(format!("source.{}", ext));
            let source_size = fs::metadata(source_path)
                .with_context(|| format!("Failed to read file size for {}", source_path.display()))?
                .len();
            let available = fs2::available_space(item_dir).with_context(|| {
                format!(
                    "Failed to read available disk space for {}",
                    item_dir.display()
                )
            })?;
            if available < source_size {
                return Err(anyhow!(
                    "Insufficient disk space to store original file (need {} bytes, have {} bytes)",
                    source_size,
                    available
                ));
            }
            fs::copy(source_path, &original_target).with_context(|| {
                format!(
                    "Failed to copy original file to {}",
                    original_target.display()
                )
            })?;
        }

        convert_to_wav(source_path, &audio_path, &ext)?;
        let duration_seconds = wav_duration_seconds(&audio_path)?;
        Ok(duration_seconds)
    })();

    let duration_seconds = match result {
        Ok(duration_seconds) => duration_seconds,
        Err(err) => {
            let _ = fs::remove_dir_all(item_dir);
            return Err(err);
        }
    };
    let _ = storage.update_library_item(
        id,
        LibraryItemPatch {
            duration_seconds: Some(duration_seconds),
            ..Default::default()
        },
    );

    Ok(())
}

fn start_library_transcription_internal(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    id: String,
) {
    let storage = state.storage();
    let item = match storage.get_library_item(&id) {
        Ok(Some(item)) => item,
        Ok(None) => {
            eprintln!("Library item not found for transcription: {id}");
            release_library_slot(app, state, &id);
            return;
        }
        Err(err) => {
            eprintln!("Failed to load library item {id}: {err}");
            release_library_slot(app, state, &id);
            return;
        }
    };

    if matches!(item.status, LibraryItemStatus::Cancelling | LibraryItemStatus::Cancelled) {
        release_library_slot(app, state, &id);
        return;
    }

    if matches!(item.status, LibraryItemStatus::Transcribing { .. }) {
        release_library_slot(app, state, &id);
        return;
    }

    let _ = storage.update_library_item(
        &id,
        LibraryItemPatch {
            status: Some(LibraryItemStatus::Transcribing { progress: 0.0 }),
            transcript: Some(String::new()),
            segments: Some(Vec::new()),
            ..Default::default()
        },
    );
    let _ = app.emit(
        EVENT_LIBRARY_PROGRESS,
        LibraryProgressPayload {
            id: id.clone(),
            progress: 0.0,
            current_chunk: 0,
            total_chunks: 0,
            chunk_text: None,
            chunk_segments: None,
        },
    );

    let token = state.register_library_transcription(id.clone());
    let app_handle = app.clone();
    let item_for_task = item.clone();
    async_runtime::spawn(async move {
        let id_for_release = id.clone();
        let token_handle = token.clone();
        let app_for_task = app_handle.clone();
        let result = async_runtime::spawn_blocking(move || {
            let state_handle = app_for_task.state::<AppState>();
            transcribe_library_item(&app_for_task, &state_handle, &item_for_task, &token_handle)
        })
        .await;

        let state_handle = app_handle.state::<AppState>();

        match result {
            Ok(Ok(mut result)) => {
                let mut final_transcript = result.transcript.clone();
                let settings = state_handle.current_settings();
                final_transcript =
                    dictionary::apply_replacements(&final_transcript, &settings.replacements);

                if count_words(&final_transcript) == 0 {
                    let _ = storage.update_library_item(
                        &id,
                        LibraryItemPatch {
                            status: Some(LibraryItemStatus::Error {
                                message: "No speech detected".to_string(),
                            }),
                            ..Default::default()
                        },
                    );
                    let _ = app_handle.emit(
                        EVENT_LIBRARY_ERROR,
                        LibraryErrorPayload {
                            id: id.clone(),
                            message: "No speech detected".to_string(),
                        },
                    );
                } else {
                    let _ = storage.update_library_item(
                        &id,
                        LibraryItemPatch {
                            status: Some(LibraryItemStatus::Complete),
                            transcript: Some(final_transcript),
                            segments: result.segments.take(),
                            transcribed_at: Some(Utc::now().to_rfc3339()),
                            ..Default::default()
                        },
                    );

                    let _ = app_handle.emit(
                        EVENT_LIBRARY_COMPLETE,
                        LibraryCompletePayload { id: id.clone() },
                    );
                }
            }
            Ok(Err(err)) => {
                let message = err.to_string();
                let status = if is_cancelled_message(&message) {
                    LibraryItemStatus::Cancelled
                } else {
                    LibraryItemStatus::Error {
                        message: message.clone(),
                    }
                };
                let _ = storage.update_library_item(
                    &id,
                    LibraryItemPatch {
                        status: Some(status),
                        ..Default::default()
                    },
                );
                let _ = app_handle.emit(
                    EVENT_LIBRARY_ERROR,
                    LibraryErrorPayload {
                        id: id.clone(),
                        message,
                    },
                );
            }
            Err(err) => {
                let message = format!("Library transcription task failed: {err}");
                let status = if is_cancelled_message(&message) {
                    LibraryItemStatus::Cancelled
                } else {
                    LibraryItemStatus::Error {
                        message: message.clone(),
                    }
                };
                let _ = storage.update_library_item(
                    &id,
                    LibraryItemPatch {
                        status: Some(status),
                        ..Default::default()
                    },
                );
                let _ = app_handle.emit(
                    EVENT_LIBRARY_ERROR,
                    LibraryErrorPayload {
                        id: id.clone(),
                        message,
                    },
                );
            }
        }

        release_library_slot(&app_handle, &state_handle, &id_for_release);
    });
}

fn handle_library_job_error(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    id: &str,
    err: anyhow::Error,
) {
    let message = err.to_string();
    let status = if is_cancelled_message(&message) {
        LibraryItemStatus::Cancelled
    } else {
        LibraryItemStatus::Error {
            message: message.clone(),
        }
    };
    if is_ffmpeg_error_message(&message) && state.should_show_ffmpeg_toast() {
        toast::show_with_action(
            app,
            "error",
            Some("FFmpeg Required"),
            "FFmpeg is required to import this file.",
            "open_ffmpeg_install",
            "FFmpeg Help",
        );
    }
    let _ = state.storage().update_library_item(
        id,
        LibraryItemPatch {
            status: Some(status),
            ..Default::default()
        },
    );
    let _ = app.emit(
        EVENT_LIBRARY_ERROR,
        LibraryErrorPayload {
            id: id.to_string(),
            message,
        },
    );
    release_library_slot(app, state, id);
}

fn schedule_library_job(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    job: LibraryJob,
) {
    if !state.enqueue_library_job(job) {
        return;
    }
    start_next_library_job(app, state);
}

fn start_next_library_job(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
) {
    let Some(job) = state.claim_next_library_job() else {
        return;
    };
    start_library_job_internal(app, job);
}

fn release_library_slot(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    id: &str,
) {
    state.clear_active_library_job(id);
    state.clear_library_transcription(id);
    start_next_library_job(app, state);
}

fn transcribe_library_item(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
    item: &LibraryItem,
    token: &CancellationToken,
) -> Result<LibraryTranscriptionResult> {
    if token.is_cancelled() {
        return Err(anyhow!("Transcription cancelled"));
    }

    let audio_path = PathBuf::from(&item.audio_path);
    if !audio_path.exists() {
        return Err(anyhow!("Audio file not found"));
    }

    let (samples, sample_rate) = transcribe::load_audio_for_transcription(&audio_path)?;
    let duration_seconds = samples.len() as f32 / sample_rate as f32;

    let speech_percent =
        speech_percentage_i16_with_mode(&samples, sample_rate, VadMode::VeryAggressive);
    if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
        return Ok(LibraryTranscriptionResult {
            transcript: String::new(),
            segments: None,
        });
    }

    let settings = state.current_settings();
    let ready_model = model_manager::ensure_model_ready(app, &item.speech_model)?;
    let dictionary_prompt = dictionary::dictionary_prompt_for_model(&ready_model, &settings);
    let language = settings.language.clone();
    let transcriber = state.local_transcriber();
    let use_whisper_chunking = matches!(
        ready_model.engine,
        model_manager::LocalModelEngine::Whisper
    );
    let use_moonshine_chunking = matches!(
        ready_model.engine,
        model_manager::LocalModelEngine::Moonshine { .. }
    );

    if use_whisper_chunking {
        let chunk_size = (WHISPER_CHUNK_SECONDS as usize * sample_rate as usize).max(1);
        let overlap =
            (WHISPER_CHUNK_OVERLAP_SECONDS as usize * sample_rate as usize).min(chunk_size.saturating_sub(1));
        let step = chunk_size.saturating_sub(overlap).max(1);

        let mut chunks: Vec<(usize, usize)> = Vec::new();
        let mut start = 0usize;
        while start < samples.len() {
            let end = (start + chunk_size).min(samples.len());
            chunks.push((start, end));
            if end == samples.len() {
                break;
            }
            start += step;
        }

        let total_chunks = chunks.len().max(1) as u32;
        let mut full_text = String::new();
        let mut merged_segments: Vec<TranscriptSegment> = Vec::new();
        let mut last_end_ms: u64 = 0;
        let mut used_prompt = false;

        for (index, (start_idx, end_idx)) in chunks.iter().enumerate() {
            if token.is_cancelled() {
                return Err(anyhow!("Transcription cancelled"));
            }

            let chunk = &samples[*start_idx..*end_idx];
            let chunk_speech_percent =
                speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
            if chunk_speech_percent < VAD_MIN_SPEECH_PERCENT_CHUNK {
                let progress = (index as f32 + 1.0) / total_chunks as f32;
                report_progress(
                    app,
                    state.storage(),
                    &item.id,
                    progress,
                    index as u32 + 1,
                    total_chunks,
                    None,
                    None,
                    None,
                    None,
                );
                continue;
            }
            let prompt = if !used_prompt {
                dictionary_prompt.as_deref()
            } else {
                None
            };
            let result = transcriber.transcribe_with_segments(
                &ready_model,
                chunk,
                sample_rate,
                prompt,
                Some(&language),
            )?;
            if token.is_cancelled() {
                return Err(anyhow!("Transcription cancelled"));
            }
            if prompt.is_some() {
                used_prompt = true;
            }

            let chunk_text = result.transcript;
            let mut appended_text = None;
            if !chunk_text.trim().is_empty() {
                let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
                if !deduped.trim().is_empty() {
                    if !full_text.is_empty() {
                        full_text.push('\n');
                    }
                    full_text.push_str(&deduped);
                    appended_text = Some(deduped);
                }
            }

            let mut new_segments: Vec<TranscriptSegment> = Vec::new();
            if let Some(segments) = result.segments {
                let offset_ms = ((*start_idx as f64) / sample_rate as f64 * 1000.0) as u64;
                for seg in convert_segments_to_ms(&segments) {
                    let start_ms = seg.start_ms + offset_ms;
                    let end_ms = seg.end_ms + offset_ms;
                    if end_ms <= last_end_ms {
                        continue;
                    }
                    let new_segment = TranscriptSegment {
                        start_ms,
                        end_ms,
                        text: seg.text,
                    };
                    merged_segments.push(new_segment.clone());
                    new_segments.push(new_segment);
                    last_end_ms = end_ms;
                }
            }

            let progress = (index as f32 + 1.0) / total_chunks as f32;
            let transcript_patch = appended_text.as_ref().map(|_| full_text.clone());
            let segments_patch = if new_segments.is_empty() {
                None
            } else {
                Some(merged_segments.clone())
            };
            let chunk_segments = if new_segments.is_empty() {
                None
            } else {
                Some(new_segments)
            };

            report_progress(
                app,
                state.storage(),
                &item.id,
                progress,
                index as u32 + 1,
                total_chunks,
                transcript_patch,
                segments_patch,
                appended_text,
                chunk_segments,
            );
        }

        return Ok(LibraryTranscriptionResult {
            transcript: full_text.trim().to_string(),
            segments: if merged_segments.is_empty() {
                None
            } else {
                Some(merged_segments)
            },
        });
    }

    if use_moonshine_chunking && duration_seconds > MOONSHINE_CHUNK_SECONDS as f32 {
        let chunk_size = (MOONSHINE_CHUNK_SECONDS as usize * sample_rate as usize).max(1);
        let overlap = (MOONSHINE_CHUNK_OVERLAP_SECONDS as usize * sample_rate as usize)
            .min(chunk_size.saturating_sub(1));
        let step = chunk_size.saturating_sub(overlap).max(1);

        let mut chunks: Vec<(usize, usize)> = Vec::new();
        let mut start = 0usize;
        while start < samples.len() {
            let end = (start + chunk_size).min(samples.len());
            chunks.push((start, end));
            if end == samples.len() {
                break;
            }
            start += step;
        }

        let total_chunks = chunks.len().max(1) as u32;
        let mut full_text = String::new();

        for (index, (start_idx, end_idx)) in chunks.iter().enumerate() {
            if token.is_cancelled() {
                return Err(anyhow!("Transcription cancelled"));
            }

            let chunk = &samples[*start_idx..*end_idx];
            let chunk_speech_percent =
                speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
            if chunk_speech_percent < VAD_MIN_SPEECH_PERCENT_CHUNK {
                let progress = (index as f32 + 1.0) / total_chunks as f32;
                report_progress(
                    app,
                    state.storage(),
                    &item.id,
                    progress,
                    index as u32 + 1,
                    total_chunks,
                    None,
                    None,
                    None,
                    None,
                );
                continue;
            }
            let result = transcriber.transcribe(
                &ready_model,
                chunk,
                sample_rate,
                dictionary_prompt.as_deref(),
                Some(&language),
            )?;
            if token.is_cancelled() {
                return Err(anyhow!("Transcription cancelled"));
            }

            let chunk_text = result.transcript;
            if !chunk_text.trim().is_empty() {
                let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
                if !deduped.trim().is_empty() {
                    if !full_text.is_empty() {
                        full_text.push('\n');
                    }
                    full_text.push_str(&deduped);
                }
            }

            let progress = (index as f32 + 1.0) / total_chunks as f32;
            report_progress(
                app,
                state.storage(),
                &item.id,
                progress,
                index as u32 + 1,
                total_chunks,
                None,
                None,
                None,
                None,
            );
        }

        return Ok(LibraryTranscriptionResult {
            transcript: full_text.trim().to_string(),
            segments: None,
        });
    }

    if duration_seconds <= (DIRECT_TRANSCRIBE_MINUTES as f32 * 60.0) {
        let result = transcriber.transcribe_with_segments(
            &ready_model,
            &samples,
            sample_rate,
            dictionary_prompt.as_deref(),
            Some(&language),
        )?;
        if token.is_cancelled() {
            return Err(anyhow!("Transcription cancelled"));
        }

        return Ok(LibraryTranscriptionResult {
            transcript: result.transcript,
            segments: result.segments.as_deref().map(convert_segments_to_ms),
        });
    }

    let chunk_size = (MAX_CHUNK_MINUTES as usize * 60 * sample_rate as usize).max(1);
    let overlap = (CHUNK_OVERLAP_SECONDS as usize * sample_rate as usize).min(chunk_size);
    let step = chunk_size.saturating_sub(overlap).max(1);

    let mut chunks: Vec<(usize, usize)> = Vec::new();
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + chunk_size).min(samples.len());
        chunks.push((start, end));
        if end == samples.len() {
            break;
        }
        start += step;
    }

    let total_chunks = chunks.len().max(1) as u32;
    let mut full_text = String::new();
    let mut merged_segments: Vec<TranscriptSegment> = Vec::new();
    let mut last_end_ms: u64 = 0;

    for (index, (start_idx, end_idx)) in chunks.iter().enumerate() {
        if token.is_cancelled() {
            return Err(anyhow!("Transcription cancelled"));
        }

        let chunk = &samples[*start_idx..*end_idx];
        let chunk_speech_percent =
            speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
        if chunk_speech_percent < VAD_MIN_SPEECH_PERCENT_CHUNK {
            let progress = (index as f32 + 1.0) / total_chunks as f32;
            report_progress(
                app,
                state.storage(),
                &item.id,
                progress,
                index as u32 + 1,
                total_chunks,
                None,
                None,
                None,
                None,
            );
            continue;
        }
        let result = transcriber.transcribe_with_segments(
            &ready_model,
            chunk,
            sample_rate,
            dictionary_prompt.as_deref(),
            Some(&language),
        )?;
        if token.is_cancelled() {
            return Err(anyhow!("Transcription cancelled"));
        }

        let chunk_text = result.transcript;
        if !chunk_text.trim().is_empty() {
            let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
            if !deduped.trim().is_empty() {
                if !full_text.is_empty() {
                    full_text.push('\n');
                }
                full_text.push_str(&deduped);
            }
        }

        if let Some(segments) = result.segments {
            let offset_ms = ((*start_idx as f64) / sample_rate as f64 * 1000.0) as u64;
            for seg in convert_segments_to_ms(&segments) {
                let start_ms = seg.start_ms + offset_ms;
                let end_ms = seg.end_ms + offset_ms;
                if end_ms <= last_end_ms {
                    continue;
                }
                merged_segments.push(TranscriptSegment {
                    start_ms,
                    end_ms,
                    text: seg.text,
                });
                last_end_ms = end_ms;
            }
        }

        let progress = (index as f32 + 1.0) / total_chunks as f32;
        report_progress(
            app,
            state.storage(),
            &item.id,
            progress,
            index as u32 + 1,
            total_chunks,
            None,
            None,
            None,
            None,
        );
    }

    Ok(LibraryTranscriptionResult {
        transcript: full_text.trim().to_string(),
        segments: if merged_segments.is_empty() {
            None
        } else {
            Some(merged_segments)
        },
    })
}

fn report_progress(
    app: &AppHandle<AppRuntime>,
    storage: Arc<StorageManager>,
    id: &str,
    progress: f32,
    current_chunk: u32,
    total_chunks: u32,
    transcript: Option<String>,
    segments: Option<Vec<TranscriptSegment>>,
    chunk_text: Option<String>,
    chunk_segments: Option<Vec<TranscriptSegment>>,
) {
    let _ = storage.update_library_item(
        id,
        LibraryItemPatch {
            status: Some(LibraryItemStatus::Transcribing { progress }),
            transcript,
            segments,
            ..Default::default()
        },
    );
    let _ = app.emit(
        EVENT_LIBRARY_PROGRESS,
        LibraryProgressPayload {
            id: id.to_string(),
            progress,
            current_chunk,
            total_chunks,
            chunk_text,
            chunk_segments,
        },
    );
}

#[derive(Debug)]
struct LibraryTranscriptionResult {
    transcript: String,
    segments: Option<Vec<TranscriptSegment>>,
}

#[derive(Debug, Clone, Serialize)]
struct LibraryCompletePayload {
    id: String,
}

#[derive(Debug, Clone, Serialize)]
struct LibraryErrorPayload {
    id: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct LibraryImportPayload {
    id: String,
}

fn is_supported_format(ext: &str) -> bool {
    SUPPORTED_AUDIO_FORMATS.contains(&ext) || SUPPORTED_VIDEO_FORMATS.contains(&ext)
}

fn model_supports_timestamps(model_key: &str) -> bool {
    match model_manager::definition(model_key) {
        Some(def) => !matches!(def.engine, model_manager::LocalModelEngine::Moonshine { .. }),
        None => false,
    }
}

fn build_folder_name(base: &str, id: &str) -> String {
    let sanitized = sanitize_folder_name(base);
    if sanitized.is_empty() {
        format!("library-item-{}", &id[..8])
    } else {
        format!("{}-{}", sanitized, &id[..8])
    }
}

fn sanitize_folder_name(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if ch == ' ' || ch == '-' || ch == '_' {
            if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        }
    }
    out.trim_matches('-').to_string()
}

fn library_root(app: &AppHandle<AppRuntime>) -> Result<PathBuf> {
    let mut dir = app
        .path()
        .app_data_dir()
        .context("App data directory not found")?;
    dir.push("library");
    Ok(dir)
}

fn stored_original_path(item: &LibraryItem) -> Option<PathBuf> {
    if !item.store_original {
        return None;
    }
    let ext = item.original_format.trim();
    if ext.is_empty() {
        return None;
    }
    let audio_path = PathBuf::from(&item.audio_path);
    let item_dir = audio_path.parent()?;
    Some(item_dir.join(format!("source.{ext}")))
}

fn convert_to_wav(input: &Path, output: &Path, ext: &str) -> Result<()> {
    if SUPPORTED_AUDIO_FORMATS.contains(&ext) {
        return convert_audio_to_wav(input, output);
    }
    if SUPPORTED_VIDEO_FORMATS.contains(&ext) {
        return convert_video_to_wav(input, output);
    }
    Err(anyhow!("Unsupported file format: {ext}"))
}

fn convert_audio_to_wav(input: &Path, output: &Path) -> Result<()> {
    let is_wav = input
        .extension()
        .and_then(|value| value.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if is_wav && try_copy_wav_if_compatible(input, output)? {
        return Ok(());
    }

    match decode_audio_to_wav(input, output) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(output);
            if let Some(ffmpeg) = find_ffmpeg_in_path() {
                convert_with_ffmpeg(&ffmpeg, input, output)
            } else {
                Err(anyhow!(
                    "Audio decode failed: {err}. Install ffmpeg to import this file."
                ))
            }
        }
    }
}

fn try_copy_wav_if_compatible(input: &Path, output: &Path) -> Result<bool> {
    let file = fs::File::open(input)
        .with_context(|| format!("Failed to open WAV file at {}", input.display()))?;
    let reader = match hound::WavReader::new(file) {
        Ok(reader) => reader,
        Err(_) => return Ok(false),
    };
    let spec = reader.spec();
    if spec.sample_rate == TARGET_SAMPLE_RATE
        && spec.channels == 1
        && spec.bits_per_sample == 16
        && spec.sample_format == hound::SampleFormat::Int
    {
        drop(reader);
        fs::copy(input, output).with_context(|| {
            format!(
                "Failed to copy WAV file from {} to {}",
                input.display(),
                output.display()
            )
        })?;
        return Ok(true);
    }
    Ok(false)
}

fn decode_audio_to_wav(input: &Path, output: &Path) -> Result<()> {
    let file = fs::File::open(input)
        .with_context(|| format!("Failed to open audio file at {}", input.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = input.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|err| anyhow!("Failed to read audio container: {err}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .or_else(|| {
            format.tracks().iter().find(|track| {
                track.codec_params.sample_rate.is_some()
                    && track.codec_params.channels.is_some()
            })
        })
        .ok_or_else(|| anyhow!("No supported audio tracks found"))?;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("Unknown sample rate"))?;
    if sample_rate == 0 {
        return Err(anyhow!("Invalid sample rate"));
    }
    let channels = track
        .codec_params
        .channels
        .ok_or_else(|| anyhow!("Unknown channel count"))?
        .count();
    if channels == 0 {
        return Err(anyhow!("Unknown channel count"));
    }

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|err| anyhow!("Unsupported audio codec: {err}"))?;
    let track_id = track.id;

    let output_file = fs::File::create(output)
        .with_context(|| format!("Failed to create WAV file at {}", output.display()))?;
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(BufWriter::new(output_file), spec)
        .map_err(|err| anyhow!("WAV writer init failed: {err}"))?;

    let mut resampler = if sample_rate == TARGET_SAMPLE_RATE {
        None
    } else {
        Some(LinearResampler::new(sample_rate, TARGET_SAMPLE_RATE))
    };

    let mut mono = Vec::new();
    let mut resampled = Vec::new();
    let mut wrote_any = false;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(err)) if err.kind() == ErrorKind::UnexpectedEof => {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => return Err(anyhow!("Audio packet read failed: {err}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::IoError(err)) if err.kind() == ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => return Err(anyhow!("Audio decode failed: {err}")),
        };

        let spec = *decoded.spec();
        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        downmix_interleaved_to_mono(sample_buf.samples(), channels, &mut mono);
        if mono.is_empty() {
            continue;
        }

        if let Some(resampler) = resampler.as_mut() {
            resampler.push(&mono, &mut resampled);
            if !resampled.is_empty() {
                write_wav_samples(&mut writer, &resampled)?;
                wrote_any = true;
            }
        } else {
            write_wav_samples(&mut writer, &mono)?;
            wrote_any = true;
        }
    }

    if let Some(resampler) = resampler.as_mut() {
        resampler.finish(&mut resampled);
        if !resampled.is_empty() {
            write_wav_samples(&mut writer, &resampled)?;
            wrote_any = true;
        }
    }

    writer
        .finalize()
        .map_err(|err| anyhow!("WAV finalize error: {err}"))?;

    if !wrote_any {
        return Err(anyhow!("No audio samples decoded"));
    }

    Ok(())
}

fn write_wav_samples(
    writer: &mut hound::WavWriter<BufWriter<fs::File>>,
    samples: &[f32],
) -> Result<()> {
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        writer
            .write_sample((clamped * i16::MAX as f32).round() as i16)
            .map_err(|err| anyhow!("WAV write error: {err}"))?;
    }
    Ok(())
}

fn downmix_interleaved_to_mono(samples: &[f32], channels: usize, output: &mut Vec<f32>) {
    output.clear();
    if samples.is_empty() {
        return;
    }
    if channels <= 1 {
        output.extend_from_slice(samples);
        return;
    }
    let frames = samples.len() / channels;
    output.reserve(frames);
    for frame in 0..frames {
        let mut acc = 0f32;
        for ch in 0..channels {
            acc += samples[frame * channels + ch];
        }
        output.push(acc / channels as f32);
    }
}

// Streaming resampler to avoid buffering entire files in memory.
struct LinearResampler {
    step: f64,
    pos: f64,
    buffer: Vec<f32>,
    start: usize,
}

impl LinearResampler {
    fn new(in_rate: u32, out_rate: u32) -> Self {
        Self {
            step: in_rate as f64 / out_rate as f64,
            pos: 0.0,
            buffer: Vec::new(),
            start: 0,
        }
    }

    fn push(&mut self, input: &[f32], output: &mut Vec<f32>) {
        output.clear();
        if input.is_empty() {
            return;
        }
        self.buffer.extend_from_slice(input);
        self.drain(output, false);
    }

    fn finish(&mut self, output: &mut Vec<f32>) {
        output.clear();
        self.drain(output, true);
    }

    fn drain(&mut self, output: &mut Vec<f32>, flush: bool) {
        let available = self.buffer.len().saturating_sub(self.start);
        if available == 0 {
            return;
        }
        let available_f = available as f64;
        while self.pos + 1.0 < available_f || (flush && self.pos < available_f) {
            let idx_offset = self.pos.floor() as usize;
            if idx_offset >= available {
                break;
            }
            let idx = self.start + idx_offset;
            let frac = self.pos - idx_offset as f64;
            let a = self.buffer[idx] as f64;
            let b = if idx + 1 < self.buffer.len() {
                self.buffer[idx + 1] as f64
            } else {
                a
            };
            output.push((a + (b - a) * frac) as f32);
            self.pos += self.step;
        }

        let max_drop = if flush {
            available
        } else {
            available.saturating_sub(1)
        };
        let drop = (self.pos.floor() as usize).min(max_drop);
        if drop > 0 {
            self.start += drop;
            self.pos -= drop as f64;
            if self.start > 8192 {
                self.buffer.drain(0..self.start);
                self.start = 0;
            }
        }

        if flush {
            self.buffer.clear();
            self.start = 0;
            self.pos = 0.0;
        }
    }
}

fn convert_video_to_wav(input: &Path, output: &Path) -> Result<()> {
    let ffmpeg = find_ffmpeg_in_path().ok_or_else(|| {
        anyhow!("FFmpeg is required to import video files. Install ffmpeg and ensure it is on your PATH.")
    })?;
    convert_with_ffmpeg(&ffmpeg, input, output)
}

fn convert_with_ffmpeg(ffmpeg: &Path, input: &Path, output: &Path) -> Result<()> {
    let input_str = input.to_str()
        .ok_or_else(|| anyhow!("Invalid input path"))?;
    let output_str = output.to_str()
        .ok_or_else(|| anyhow!("Invalid output path"))?;
    
    let status = Command::new(ffmpeg)
        .arg("-y")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input_str)
        .arg("-vn")
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg("-ar")
        .arg(TARGET_SAMPLE_RATE.to_string())
        .arg("-ac")
        .arg("1")
        .arg(output_str)
        .status()
        .map_err(|err| match err.kind() {
            ErrorKind::NotFound => anyhow!("FFmpeg not found on PATH."),
            _ => anyhow!("Failed to run ffmpeg: {err}"),
        })?;
    if !status.success() {
        let _ = fs::remove_file(output);
        return Err(anyhow!("ffmpeg conversion failed"));
    }
    Ok(())
}

fn find_ffmpeg_in_path() -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    let file_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn wav_duration_seconds(path: &Path) -> Result<f32> {
    let file = fs::File::open(path)
        .with_context(|| format!("Failed to open WAV file at {}", path.display()))?;
    let reader = hound::WavReader::new(file).map_err(|err| anyhow!("WAV read error: {err}"))?;
    let spec = reader.spec();
    if spec.sample_rate == 0 {
        return Err(anyhow!("Invalid sample rate"));
    }
    let samples = reader.duration() as f32;
    Ok(samples / spec.sample_rate as f32)
}

fn convert_segments_to_ms(
    segments: &[transcribe_rs::TranscriptionSegment],
) -> Vec<TranscriptSegment> {
    segments
        .iter()
        .map(|segment| TranscriptSegment {
            start_ms: (segment.start * 1000.0).max(0.0) as u64,
            end_ms: (segment.end * 1000.0).max(0.0) as u64,
            text: segment.text.trim().to_string(),
        })
        .collect()
}

fn build_export_content(item: &LibraryItem, format: ExportFormat) -> Result<String> {
    let title = item.name.clone();
    let transcript = item.transcript.clone().unwrap_or_default();
    match format {
        ExportFormat::Txt => Ok(format!(
            "{}\nTranscribed: {}\n\n{}",
            title,
            item.transcribed_at
                .clone()
                .unwrap_or_else(|| item.created_at.clone()),
            transcript
        )),
        ExportFormat::Md => Ok(format!(
            "# {}\n\n**Duration:** {}  \n**Transcribed:** {}  \n**Tags:** {}\n\n---\n\n{}",
            title,
            format_duration(item.duration_seconds),
            item.transcribed_at
                .clone()
                .unwrap_or_else(|| item.created_at.clone()),
            if item.tags.is_empty() {
                "None".to_string()
            } else {
                item.tags.join(", ")
            },
            transcript
        )),
        ExportFormat::Srt => build_srt(item),
        ExportFormat::Vtt => build_vtt(item),
    }
}

fn build_srt(item: &LibraryItem) -> Result<String> {
    let segments = item
        .segments
        .as_ref()
        .ok_or_else(|| anyhow!("No timestamp segments available"))?;
    let mut out = String::new();
    for (idx, segment) in segments.iter().enumerate() {
        out.push_str(&(idx + 1).to_string());
        out.push('\n');
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_srt_timestamp(segment.start_ms),
            format_srt_timestamp(segment.end_ms),
            segment.text.trim()
        ));
    }
    Ok(out.trim().to_string())
}

fn build_vtt(item: &LibraryItem) -> Result<String> {
    let segments = item
        .segments
        .as_ref()
        .ok_or_else(|| anyhow!("No timestamp segments available"))?;
    let mut out = String::from("WEBVTT\n\n");
    for segment in segments {
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_timestamp(segment.start_ms),
            format_vtt_timestamp(segment.end_ms),
            segment.text.trim()
        ));
    }
    Ok(out.trim().to_string())
}

fn format_srt_timestamp(ms: u64) -> String {
    let total_seconds = ms / 1000;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

fn format_vtt_timestamp(ms: u64) -> String {
    let total_seconds = ms / 1000;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let millis = ms % 1000;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

fn format_duration(seconds: f32) -> String {
    if seconds <= 0.0 {
        return "0:00".to_string();
    }
    let total = seconds.round() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let secs = total % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}
