use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{DateTime, Local};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, async_runtime};

use crate::settings::{self, RecordingPrunePolicy, UserSettings};
use crate::{
    AppRuntime, AppState, EVENT_TRANSCRIPTION_COMPLETE, TranscriptionCompletePayload, recorder,
};

/// Deletes the recordings or transcripts the auto-delete setting has expired.
pub(crate) fn schedule_prune(app: AppHandle<AppRuntime>, settings: UserSettings) {
    let recording_policy = settings::auto_delete_recording_policy(&settings);
    let transcription_policy = settings::auto_delete_transcription_policy(&settings);
    if recording_policy == RecordingPrunePolicy::Never
        && transcription_policy == RecordingPrunePolicy::Never
    {
        return;
    }

    async_runtime::spawn(async move {
        let app_handle = app.clone();
        let result = async_runtime::spawn_blocking(move || -> Result<(u32, u32)> {
            let now = Local::now();
            let recordings = count_or_prune_recordings(&app_handle, recording_policy, now, true)?;
            let transcriptions =
                count_or_prune_transcriptions(&app_handle, transcription_policy, now, true)?;
            Ok((recordings, transcriptions))
        })
        .await;
        match result {
            Ok(Ok((recordings, transcriptions))) => {
                if transcriptions > 0 {
                    crate::tray::refresh_menus(&app, &app.state::<AppState>().current_settings());
                }
                if recordings + transcriptions > 0 {
                    let _ = app.emit(
                        EVENT_TRANSCRIPTION_COMPLETE,
                        TranscriptionCompletePayload {
                            transcript: String::new(),
                            auto_paste: false,
                            record: None,
                        },
                    );
                }
            }
            Ok(Err(err)) => tracing::error!("Failed to auto-delete: {err}"),
            Err(err) => tracing::error!("Auto-delete task failed: {err}"),
        }
    });
}

#[derive(Serialize)]
pub(crate) struct PrunePreview {
    candidate_count: u32,
}

#[tauri::command]
pub(crate) async fn preview_recording_prune(
    policy: RecordingPrunePolicy,
    app: AppHandle<AppRuntime>,
) -> Result<PrunePreview, String> {
    let candidate_count = async_runtime::spawn_blocking(move || {
        count_or_prune_recordings(&app, policy, Local::now(), false)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    Ok(PrunePreview { candidate_count })
}

#[tauri::command]
pub(crate) async fn preview_transcription_prune(
    policy: RecordingPrunePolicy,
    app: AppHandle<AppRuntime>,
) -> Result<PrunePreview, String> {
    let candidate_count = async_runtime::spawn_blocking(move || {
        count_or_prune_transcriptions(&app, policy, Local::now(), false)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    Ok(PrunePreview { candidate_count })
}

fn count_or_prune_transcriptions(
    app: &AppHandle<AppRuntime>,
    policy: RecordingPrunePolicy,
    now: DateTime<Local>,
    delete: bool,
) -> Result<u32> {
    let Some(cutoff) = settings::recording_prune_cutoff(policy, now) else {
        return Ok(0);
    };
    let cutoff_millis = cutoff.timestamp_millis();

    let storage = app.state::<AppState>().storage();
    if delete {
        storage
            .prune_before_and_remove_files(cutoff_millis)
            .context("Failed to prune transcriptions")
    } else {
        storage
            .count_prunable_before(cutoff_millis)
            .context("Failed to count prunable transcriptions")
    }
}

fn count_or_prune_recordings(
    app: &AppHandle<AppRuntime>,
    policy: RecordingPrunePolicy,
    now: DateTime<Local>,
    delete: bool,
) -> Result<u32> {
    if policy == RecordingPrunePolicy::Never {
        return Ok(0);
    }
    let root = crate::recordings_root(app)?;
    if !root.exists() {
        return Ok(0);
    }

    let cutoff = settings::recording_prune_cutoff(policy, now);
    let (count, _) = walk_recording_tree(&root, policy, cutoff, delete)?;
    Ok(count)
}

fn walk_recording_tree(
    path: &Path,
    policy: RecordingPrunePolicy,
    cutoff: Option<DateTime<Local>>,
    delete: bool,
) -> Result<(u32, bool)> {
    let mut count = 0;
    let mut is_empty = true;

    for entry in fs::read_dir(path)
        .with_context(|| format!("Failed to read recordings directory {}", path.display()))?
    {
        let entry = entry?;
        let child_path = entry.path();
        let metadata = entry.metadata()?;

        if metadata.is_dir() {
            if is_pending_recordings_dir(&child_path) {
                is_empty = false;
                continue;
            }
            let (child_count, child_empty) =
                walk_recording_tree(&child_path, policy, cutoff, delete)?;
            count += child_count;
            if !child_empty {
                is_empty = false;
            } else if delete {
                fs::remove_dir(&child_path).with_context(|| {
                    format!(
                        "Failed to remove empty recordings directory {}",
                        child_path.display()
                    )
                })?;
            }
            continue;
        }

        if should_prune_recording_file(&child_path, &metadata, policy, cutoff) {
            if delete {
                fs::remove_file(&child_path).with_context(|| {
                    format!("Failed to remove recording {}", child_path.display())
                })?;
            }
            count += 1;
        } else {
            is_empty = false;
        }
    }

    Ok((count, is_empty))
}

fn is_pending_recordings_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == recorder::PENDING_DIR_NAME)
}

fn should_prune_recording_file(
    path: &Path,
    metadata: &fs::Metadata,
    policy: RecordingPrunePolicy,
    cutoff: Option<DateTime<Local>>,
) -> bool {
    if !metadata.is_file() {
        return false;
    }

    let is_wav = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"));
    if !is_wav {
        return false;
    }

    if matches!(policy, RecordingPrunePolicy::Immediately) {
        return true;
    }

    let Some(cutoff) = cutoff else {
        return false;
    };

    metadata
        .modified()
        .ok()
        .map(|modified| DateTime::<Local>::from(modified) <= cutoff)
        .unwrap_or(false)
}
