use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::library::{LibraryJob, LibraryJobKind};
use crate::{AppRuntime, AppState};

use super::export::build_export_content;
use super::processing::{
    create_item_from_path, library_root, probe_media_duration_ms, stored_original_path,
};
use super::queue::{fail_library_item, schedule_library_job};
#[cfg(target_os = "macos")]
use super::types::EVENT_LIBRARY_OPEN_IMPORT;
use super::types::{
    EVENT_LIBRARY_COMPLETE, EVENT_LIBRARY_RESTORED, ExportFormat, JobSource,
    LibraryCompletePayload, LibraryFilter, LibraryImportOptions, LibraryItem, LibraryItemPatch,
    LibraryItemStatus, LibraryItemsPage, cancelled_error,
};

#[cfg(target_os = "macos")]
#[derive(Default)]
struct PendingLibraryImport {
    renderer_ready: bool,
    paths: Vec<String>,
}

#[cfg(target_os = "macos")]
fn pending_library_import() -> &'static Mutex<PendingLibraryImport> {
    static PENDING: OnceLock<Mutex<PendingLibraryImport>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(PendingLibraryImport::default()))
}

#[cfg(target_os = "macos")]
fn flush_pending_library_import(app: &AppHandle<AppRuntime>) {
    let paths = {
        let mut pending = pending_library_import().lock();
        if !pending.renderer_ready || pending.paths.is_empty() {
            return;
        }
        std::mem::take(&mut pending.paths)
    };

    let _ = app.emit(EVENT_LIBRARY_OPEN_IMPORT, paths);
}

// The window was freed; a new one announces itself again before imports flush.
#[cfg(target_os = "macos")]
pub(crate) fn reset_library_import_renderer() {
    pending_library_import().lock().renderer_ready = false;
}

#[cfg(target_os = "macos")]
pub(crate) fn mark_library_import_renderer_ready(app: &AppHandle<AppRuntime>) {
    pending_library_import().lock().renderer_ready = true;
    flush_pending_library_import(app);
}

const LIBRARY_JOB_STOP_TIMEOUT: Duration = Duration::from_secs(30);

enum LibraryDeleteScope {
    SkipFilesystemDeletion,
    DeleteFile(PathBuf),
    DeleteDirectory(PathBuf),
}

fn require_library_license(state: &AppState) -> Result<(), String> {
    crate::license::require_license_gate(&state.settings_store, "Library")
}

#[tauri::command]
pub fn create_library_item(
    path: String,
    options: LibraryImportOptions,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    let item = import_library_file(path, options, JobSource::Upload, &app, &state)?;
    crate::analytics::track_feature_used(&app, "library");
    Ok(item)
}

pub(crate) fn import_library_file(
    path: String,
    options: LibraryImportOptions,
    source: JobSource,
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    require_library_license(state)?;

    let source_path = PathBuf::from(path);
    let storage = state.storage();
    let item = create_item_from_path(app, storage, &source_path, &options)
        .map_err(|err| err.to_string())?;
    schedule_library_job(
        app,
        state,
        LibraryJob {
            id: item.id.clone(),
            kind: LibraryJobKind::Import {
                source_path,
                store_original: options.store_original,
            },
            source,
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
pub fn get_library_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<LibraryItem>, String> {
    state
        .storage()
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))
}

#[tauri::command]
pub fn update_library_item(
    id: String,
    patch: LibraryItemPatch,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    require_library_license(&state)?;

    let storage = state.storage();
    let updated = storage
        .update_library_item(&id, patch.clone())
        .map_err(|err| format!("Failed to update library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    Ok(updated)
}

// How long a deleted item can be restored before its files go to the Trash.
const LIBRARY_UNDO_WINDOW: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn delete_library_item(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let was_queued = state.remove_library_job(&id);
    state.cancel_library_transcription(&id);
    // A running job keeps the queue slot until it has actually stopped, and its
    // last status write needs the item still listed.
    let stop_deadline = Instant::now() + LIBRARY_JOB_STOP_TIMEOUT;
    while state.library_job_pending(&id) {
        if Instant::now() >= stop_deadline {
            return Err("The transcription is still stopping. Try again in a moment.".to_string());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let storage = state.storage();
    let deleted = match storage.delete_library_item(&id) {
        Ok(deleted) => deleted,
        Err(err) => {
            // The item stays; a job it lost from the queue shows as cancelled, like
            // the Cancel button, unless a retry has queued it again meanwhile.
            if was_queued && !state.library_job_pending(&id) {
                fail_library_item(&app, &storage, &id, cancelled_error().to_string(), true);
            }
            return Err(format!("Failed to delete library item: {err}"));
        }
    };
    if !deleted {
        return Ok(());
    }

    let deleted_at = Instant::now();
    undo_stack().lock().push((id.clone(), deleted_at));
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LIBRARY_UNDO_WINDOW).await;
        let still_deleted = {
            let mut stack = undo_stack().lock();
            let before = stack.len();
            stack.retain(|(entry_id, at)| !(*entry_id == id && *at == deleted_at));
            before != stack.len()
        };
        if still_deleted {
            let _ =
                tauri::async_runtime::spawn_blocking(move || trash_deleted_item(&app, &id)).await;
        }
    });
    Ok(())
}

// Deleted items that can still be restored, most recent last.
fn undo_stack() -> &'static Mutex<Vec<(String, Instant)>> {
    static STACK: OnceLock<Mutex<Vec<(String, Instant)>>> = OnceLock::new();
    STACK.get_or_init(Default::default)
}

/// Restores the most recently deleted item that is still in its undo window.
#[tauri::command]
pub fn restore_deleted_library_item(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(entry) = undo_stack().lock().pop() else {
        return Ok(None);
    };
    match reopen_deleted_item(&state.storage(), &entry.0) {
        Ok(true) => Ok(Some(entry.0)),
        Ok(false) => Ok(None),
        Err(err) => {
            undo_stack().lock().push(entry);
            Err(format!("Failed to restore library item: {err}"))
        }
    }
}

fn reopen_deleted_item(
    storage: &std::sync::Arc<crate::storage::StorageManager>,
    id: &str,
) -> Result<bool> {
    if !storage.restore_library_item(id)? {
        return Ok(false);
    }
    // Deleting dropped its queued or running job.
    if let Ok(Some(item)) = storage.get_library_item(id)
        && matches!(
            item.status,
            LibraryItemStatus::Pending
                | LibraryItemStatus::Importing { .. }
                | LibraryItemStatus::Transcribing { .. }
                | LibraryItemStatus::Cancelling
        )
    {
        set_library_status(storage, id, LibraryItemStatus::Cancelled);
    }
    Ok(true)
}

// Never deletes for good: when the move fails, the item comes back with its
// files.
fn trash_deleted_item(app: &AppHandle<AppRuntime>, id: &str) {
    let storage = app.state::<AppState>().storage();
    let item = match storage.get_deleted_library_items() {
        Ok(items) => items.into_iter().find(|item| item.id == id),
        Err(err) => {
            tracing::error!("Failed to load deleted library item {id}: {err}");
            return;
        }
    };
    let Some(item) = item else {
        return;
    };
    let trash_target = match determine_delete_scope(app, &item.audio_path) {
        LibraryDeleteScope::DeleteFile(path) if path.exists() => Some(path),
        LibraryDeleteScope::DeleteDirectory(path) => Some(path),
        _ => None,
    };
    if let Some(path) = trash_target
        && let Err(err) = crate::platform::move_to_trash(&path)
    {
        tracing::warn!("Couldn't move deleted library item {id} to the Trash: {err}");
        if let Err(err) = reopen_deleted_item(&storage, id) {
            tracing::error!("Failed to restore library item {id}: {err}");
            return;
        }
        let _ = app.emit(
            EVENT_LIBRARY_RESTORED,
            LibraryCompletePayload { id: id.to_string() },
        );
        crate::toast::show(
            app,
            "error",
            None,
            &crate::toast::native(app, "native.toast.library_trash_failed"),
        );
        return;
    }
    if let Err(err) = storage.purge_library_item(id) {
        tracing::error!("Failed to purge library item {id}: {err}");
    }
}

/// Moves the files of items left deleted by an earlier session to the Trash.
pub(crate) fn purge_deleted_library_items(app: &AppHandle<AppRuntime>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let items = match app
            .state::<AppState>()
            .storage()
            .get_deleted_library_items()
        {
            Ok(items) => items,
            Err(err) => {
                tracing::error!("Failed to load deleted library items: {err}");
                return;
            }
        };
        for item in items {
            if !undo_stack().lock().iter().any(|(id, _)| *id == item.id) {
                trash_deleted_item(&app, &item.id);
            }
        }
    });
}

#[tauri::command]
pub fn cancel_library_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.remove_library_job(&id) {
        fail_library_item(
            &app,
            &state.storage(),
            &id,
            cancelled_error().to_string(),
            true,
        );
        return Ok(());
    }
    // A job that already ended set its own final status, and nothing would
    // move the item on from Cancelling.
    if !state.library_job_pending(&id) {
        return Ok(());
    }
    let marked = state
        .storage()
        .mark_library_item_cancelling(&id)
        .map_err(|err| format!("Failed to cancel library item: {err}"))?;
    if marked {
        state.cancel_library_transcription(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn retry_library_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    require_library_license(&state)?;

    let storage = state.storage();
    let item = storage
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    let job = match build_retry_job(&item) {
        Ok(job) => job,
        Err(message) => {
            fail_library_item(&app, &storage, &id, message.clone(), false);
            return Err(message);
        }
    };

    set_library_status(&storage, &id, LibraryItemStatus::Pending);
    schedule_library_job(
        &app,
        &state,
        LibraryJob {
            id,
            kind: job,
            source: JobSource::of_item(&item),
        },
    );
    Ok(())
}

/// Re-runs speaker detection on a finished item without transcribing it again.
#[tauri::command]
pub async fn rediarize_library_item(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    require_library_license(&state)?;

    let storage = state.storage();
    let task_app = app.clone();
    let task_id = id.clone();
    let updated = tauri::async_runtime::spawn_blocking(move || {
        let model_path = crate::speech::installed_diarizer_path(&task_app)
            .ok_or_else(|| "The speaker detection model isn't downloaded".to_string())?;
        let item = storage
            .get_library_item(&task_id)
            .map_err(|err| format!("Failed to load library item: {err}"))?
            .filter(|item| matches!(item.status, LibraryItemStatus::Complete))
            .ok_or_else(|| "Library item isn't finished transcribing".to_string())?;
        let labeled = super::speakers::rediarize(&item, &model_path).map_err(|err| {
            tracing::warn!("[library] speaker detection failed: {err}");
            err.to_string()
        })?;
        let transcript =
            (!item.transcript_edited && !item.llm_cleanup_enabled && !labeled.segments.is_empty())
                .then(|| super::speakers::transcript_from_segments(&labeled.segments));
        // A transcription or a speaker edit made meanwhile must not be overwritten.
        storage
            .update_library_item_if(
                &task_id,
                LibraryItemPatch {
                    transcript,
                    segments: Some(labeled.segments),
                    words: labeled.words,
                    speakers: Some(labeled.speakers),
                    detect_speakers: Some(true),
                    ..Default::default()
                },
                |current| {
                    matches!(current.status, LibraryItemStatus::Complete)
                        && current.transcript == item.transcript
                        && current.segments == item.segments
                        && current.words == item.words
                        && current.speakers == item.speakers
                },
            )
            .map_err(|err| format!("Failed to update library item: {err}"))?
            .ok_or_else(|| "Library item changed while detecting speakers".to_string())
    })
    .await
    .map_err(|err| format!("Speaker detection task failed: {err}"))??;

    let _ = app.emit(EVENT_LIBRARY_COMPLETE, LibraryCompletePayload { id });
    Ok(updated)
}

#[tauri::command]
pub fn export_library_item_to_path(
    id: String,
    format: ExportFormat,
    output_path: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    require_library_license(&state)?;

    let item = state
        .storage()
        .get_library_item(&id)
        .map_err(|err| format!("Failed to load library item: {err}"))?
        .ok_or_else(|| "Library item not found".to_string())?;

    let output_path = PathBuf::from(&output_path);
    check_export_path(&output_path, &format)?;

    let content = build_export_content(&item, format)
        .map_err(|err| format!("Failed to build export: {err}"))?;

    fs::write(&output_path, content.as_bytes())
        .with_context(|| "Failed to write export file".to_string())
        .map_err(|err| err.to_string())?;

    crate::analytics::track_feature_used(&app, "library");
    Ok(())
}

fn check_export_path(path: &Path, format: &ExportFormat) -> Result<(), String> {
    let extension = match format {
        ExportFormat::Txt => "txt",
        ExportFormat::Md => "md",
        ExportFormat::Srt => "srt",
        ExportFormat::Vtt => "vtt",
    };
    let matches_format = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension));
    if !path.is_absolute() || !matches_format {
        return Err(format!(
            "This export can only be saved as a .{extension} file"
        ));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Export path contains invalid components".to_string());
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct LibraryImportFileProbe {
    pub path: String,
    pub duration_ms: Option<u64>,
    pub size_bytes: Option<u64>,
}

#[tauri::command]
pub async fn probe_library_import_files(paths: Vec<String>) -> Vec<LibraryImportFileProbe> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let file_path = Path::new(&path);
                LibraryImportFileProbe {
                    duration_ms: probe_media_duration_ms(file_path),
                    size_bytes: fs::metadata(file_path).ok().map(|meta| meta.len()),
                    path,
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn get_library_tags(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .storage()
        .get_library_tags()
        .map_err(|err| format!("Failed to load tags: {err}"))
}

pub(crate) fn recover_interrupted_library_items(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if !crate::license::license_gate_active(&state.settings_store) {
        return;
    }

    let storage = state.storage();
    let items = match storage.get_recoverable_library_items() {
        Ok(items) => items,
        Err(err) => {
            tracing::error!("Failed to load recoverable library items: {err}");
            return;
        }
    };

    for item in items {
        // A transcript that was being replaced when the app quit comes back,
        // and a recovered job keeps it again while it runs.
        let previous = storage
            .get_previous_library_transcript(&item.id)
            .inspect_err(|err| {
                tracing::warn!(
                    "Failed to read the previous transcript of library item {}: {err:#}",
                    item.id
                );
            })
            .ok()
            .flatten();
        match item.status {
            LibraryItemStatus::Cancelling => {
                if let Some(previous) = previous {
                    let _ = storage.update_library_item(
                        &item.id,
                        previous.into_patch(LibraryItemStatus::Complete),
                    );
                    let _ = app.emit(
                        EVENT_LIBRARY_COMPLETE,
                        LibraryCompletePayload {
                            id: item.id.clone(),
                        },
                    );
                    continue;
                }
                fail_library_item(app, &storage, &item.id, cancelled_error().to_string(), true);
            }
            LibraryItemStatus::Pending
            | LibraryItemStatus::Importing { .. }
            | LibraryItemStatus::Transcribing { .. } => match build_recovery_job(&item) {
                Ok(kind) => {
                    match previous {
                        Some(previous) => {
                            let _ = storage.update_library_item(
                                &item.id,
                                previous.into_patch(LibraryItemStatus::Pending),
                            );
                        }
                        None => set_library_status(&storage, &item.id, LibraryItemStatus::Pending),
                    }
                    schedule_library_job(
                        app,
                        &state,
                        LibraryJob {
                            id: item.id.clone(),
                            kind,
                            source: JobSource::of_item(&item),
                        },
                    );
                }
                Err(message) => match previous {
                    Some(previous) => {
                        let _ = storage.update_library_item(
                            &item.id,
                            previous.into_patch(LibraryItemStatus::Complete),
                        );
                        let _ = app.emit(
                            EVENT_LIBRARY_COMPLETE,
                            LibraryCompletePayload {
                                id: item.id.clone(),
                            },
                        );
                    }
                    None => fail_library_item(app, &storage, &item.id, message, false),
                },
            },
            _ => {}
        }
    }
}

#[cfg(target_os = "macos")]
pub fn handle_opened_paths(app: &AppHandle<AppRuntime>, urls: Vec<PathBuf>) -> Result<()> {
    let state = app.state::<AppState>();
    if require_library_license(&state).is_err() {
        if let Err(err) = crate::tray::toggle_settings_window(app) {
            tracing::error!("Failed to open settings window: {err}");
        }
        return Ok(());
    }

    let paths: Vec<String> = urls
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    pending_library_import().lock().paths = paths;
    if let Err(err) = crate::tray::toggle_settings_window(app) {
        tracing::error!("Failed to open settings window: {err}");
    }
    flush_pending_library_import(app);
    Ok(())
}

fn determine_delete_scope(app: &AppHandle<AppRuntime>, audio_path: &str) -> LibraryDeleteScope {
    let path = PathBuf::from(audio_path);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return LibraryDeleteScope::SkipFilesystemDeletion;
    }

    let root = match library_root(app).and_then(|root| {
        root.canonicalize()
            .map_err(anyhow::Error::from)
            .context("Failed to resolve library storage location.")
    }) {
        Ok(root) => root,
        Err(err) => {
            tracing::error!("Skipping library file deletion: {err}");
            return LibraryDeleteScope::SkipFilesystemDeletion;
        }
    };

    determine_delete_scope_from_paths(&root, &path)
}

fn determine_delete_scope_from_paths(root: &Path, path: &Path) -> LibraryDeleteScope {
    let safe_path = if path.exists() {
        match path.canonicalize() {
            Ok(path) => path,
            Err(err) => {
                tracing::error!(
                    "Skipping library file deletion, failed to canonicalize file: {err}"
                );
                return LibraryDeleteScope::SkipFilesystemDeletion;
            }
        }
    } else if let Some(parent) = path.parent() {
        if parent.exists() {
            match parent.canonicalize() {
                Ok(parent) => parent.join(path.file_name().unwrap_or_default()),
                Err(err) => {
                    tracing::error!(
                        "Skipping library file deletion, failed to canonicalize parent folder: {err}"
                    );
                    return LibraryDeleteScope::SkipFilesystemDeletion;
                }
            }
        } else {
            path.to_path_buf()
        }
    } else {
        path.to_path_buf()
    };

    if !safe_path.starts_with(root) {
        return LibraryDeleteScope::SkipFilesystemDeletion;
    }

    match safe_path.parent() {
        Some(parent) if parent == root => LibraryDeleteScope::DeleteFile(safe_path),
        Some(parent) if parent.exists() => {
            LibraryDeleteScope::DeleteDirectory(parent.to_path_buf())
        }
        _ if safe_path.exists() => LibraryDeleteScope::DeleteFile(safe_path),
        _ => LibraryDeleteScope::SkipFilesystemDeletion,
    }
}

fn build_retry_job(item: &LibraryItem) -> Result<LibraryJobKind, String> {
    if PathBuf::from(&item.audio_path).exists() {
        return Ok(LibraryJobKind::TranscribeExisting);
    }

    find_recoverable_source_path(item)
        .map(|source_path| LibraryJobKind::Import {
            source_path,
            store_original: item.store_original,
        })
        .ok_or_else(missing_original_file_message)
}

fn build_recovery_job(item: &LibraryItem) -> Result<LibraryJobKind, String> {
    match item.status {
        LibraryItemStatus::Importing { .. } => {
            if let Some(source_path) = find_recoverable_source_path(item) {
                return Ok(LibraryJobKind::Import {
                    source_path,
                    store_original: item.store_original,
                });
            }
            if PathBuf::from(&item.audio_path).exists() {
                return Ok(LibraryJobKind::TranscribeExisting);
            }
            Err(missing_original_file_message())
        }
        LibraryItemStatus::Pending | LibraryItemStatus::Transcribing { .. } => {
            build_retry_job(item)
        }
        LibraryItemStatus::Cancelling => Err("Transcription cancelled".to_string()),
        _ => Err("Library item is not recoverable".to_string()),
    }
}

fn find_recoverable_source_path(item: &LibraryItem) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = stored_original_path(item) {
        candidates.push(path);
    }

    let source = item.source_path.trim();
    if !source.is_empty() {
        candidates.push(PathBuf::from(source));
    }

    candidates.into_iter().find(|path| path.exists())
}

fn missing_original_file_message() -> String {
    "Original file not found. Re-import the file to try again.".to_string()
}

fn set_library_status(
    storage: &std::sync::Arc<crate::storage::StorageManager>,
    id: &str,
    status: LibraryItemStatus,
) {
    let _ = storage.update_library_item(
        id,
        LibraryItemPatch {
            status: Some(status),
            ..Default::default()
        },
    );
}
