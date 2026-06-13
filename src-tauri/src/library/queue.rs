use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use chrono::Utc;
use tauri::{async_runtime, AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;
use webrtc_vad::VadMode;

use crate::transcribe::count_words;
use crate::{
    dictionary, model_manager, recorder::speech_percentage_i16_with_mode, remote_speech,
    storage::StorageManager, toast, transcribe, transcription_api, AppRuntime, AppState,
    LibraryJob, LibraryJobKind,
};

use super::processing::{
    compute_total_chunks, convert_library_item, convert_segments_to_ms, read_wav_info,
    stream_wav_chunks,
};
use super::types::{
    cancelled_error, is_cancelled_error, is_ffmpeg_error_message, LibraryCompletePayload,
    LibraryErrorPayload, LibraryItem, LibraryItemPatch, LibraryItemStatus, LibraryProgressPayload,
    LibraryProgressUpdate, LibraryTranscriptionResult, TranscriptSegment, CHUNK_OVERLAP_SECONDS,
    DIRECT_TRANSCRIBE_MINUTES, EVENT_LIBRARY_COMPLETE, EVENT_LIBRARY_ERROR, EVENT_LIBRARY_PROGRESS,
    MAX_CHUNK_MINUTES,
};
use crate::speech::{
    VAD_MIN_SPEECH_PERCENT_CHUNK, VAD_MIN_SPEECH_PERCENT_FILE, WHISPER_CHUNK_OVERLAP_SECONDS,
    WHISPER_CHUNK_SECONDS,
};

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
                                cancelled_error(),
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
                        cancelled_error(),
                    );
                    return;
                }
                start_library_transcription_internal(&app_handle, &state_handle, job_id);
            }
        }
    });
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
            tracing::error!("Library item not found for transcription: {id}");
            let _ = app.emit(
                EVENT_LIBRARY_ERROR,
                LibraryErrorPayload {
                    id: id.clone(),
                    message: "Library item not found".to_string(),
                    cancelled: false,
                },
            );
            release_library_slot(app, state, &id);
            return;
        }
        Err(err) => {
            tracing::error!("Failed to load library item {id}: {err}");
            let _ = app.emit(
                EVENT_LIBRARY_ERROR,
                LibraryErrorPayload {
                    id: id.clone(),
                    message: format!("Failed to load library item: {err}"),
                    cancelled: false,
                },
            );
            release_library_slot(app, state, &id);
            return;
        }
    };

    if matches!(
        item.status,
        LibraryItemStatus::Cancelling | LibraryItemStatus::Cancelled
    ) {
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
                if !settings.replacements.is_empty() {
                    for entries in [result.segments.as_mut(), result.words.as_mut()]
                        .into_iter()
                        .flatten()
                    {
                        for entry in entries.iter_mut() {
                            entry.text =
                                dictionary::apply_replacements(&entry.text, &settings.replacements);
                        }
                    }
                }

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
                            cancelled: false,
                        },
                    );
                } else {
                    let _ = storage.update_library_item(
                        &id,
                        LibraryItemPatch {
                            status: Some(LibraryItemStatus::Complete),
                            transcript: Some(final_transcript),
                            segments: result.segments.take(),
                            words: result.words.take(),
                            speech_model: result.speech_model.take(),
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
                let cancelled = is_cancelled_error(&err);
                let message = err.to_string();
                let status = if cancelled {
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
                        cancelled,
                        message,
                    },
                );
            }
            Err(err) => {
                let message = format!("Library transcription task failed: {err}");
                let _ = storage.update_library_item(
                    &id,
                    LibraryItemPatch {
                        status: Some(LibraryItemStatus::Error {
                            message: message.clone(),
                        }),
                        ..Default::default()
                    },
                );
                let _ = app_handle.emit(
                    EVENT_LIBRARY_ERROR,
                    LibraryErrorPayload {
                        id: id.clone(),
                        cancelled: false,
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
    let cancelled = is_cancelled_error(&err);
    let message = err.to_string();
    let status = if cancelled {
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
            cancelled,
            message,
        },
    );
    release_library_slot(app, state, id);
}

pub(crate) fn schedule_library_job(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    job: LibraryJob,
) {
    if !state.enqueue_library_job(job) {
        return;
    }
    start_next_library_job(app, state);
}

fn start_next_library_job(app: &AppHandle<AppRuntime>, state: &tauri::State<'_, AppState>) {
    let Some(job) = state.claim_next_library_job() else {
        return;
    };
    start_library_job_internal(app, job);
}

pub(crate) fn release_library_slot(
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
        return Err(cancelled_error());
    }

    let audio_path = PathBuf::from(&item.audio_path);
    if !audio_path.exists() {
        return Err(anyhow!("Audio file not found"));
    }

    let wav_info = read_wav_info(&audio_path)?;
    let sample_rate = wav_info.sample_rate;
    let duration_seconds = wav_info.duration_seconds;
    if wav_info.total_samples == 0 {
        return Err(anyhow!("No audio data decoded from WAV file"));
    }

    let settings = state.current_settings();
    let mut remote_fallback = false;

    let wants_remote = remote_speech::is_remote_model(&item.speech_model)
        && remote_speech::is_configured(&settings);

    if wants_remote {
        let http = state.http();
        let attempt = async_runtime::block_on(remote_speech::attempt_remote(
            app,
            &http,
            &settings,
            &audio_path,
            &settings.local_model,
            true,
            || token.is_cancelled(),
        ));
        match attempt {
            remote_speech::RemoteAttempt::Success(success) => {
                report_progress(
                    app,
                    state.storage(),
                    &item.id,
                    LibraryProgressUpdate::with_chunk_counts(1.0, 1, 1),
                );
                let segments = success.segments.as_deref().map(convert_segments_to_ms);
                let words = success.words.as_deref().map(convert_segments_to_ms);
                return Ok(LibraryTranscriptionResult {
                    transcript: success.transcript,
                    segments,
                    words,
                    speech_model: success.speech_model,
                });
            }
            remote_speech::RemoteAttempt::Cancelled => {
                return Err(cancelled_error());
            }
            remote_speech::RemoteAttempt::Unavailable(message) => {
                return Err(anyhow!(message));
            }
            remote_speech::RemoteAttempt::Fallback => {
                remote_fallback = true;
            }
        }
    }

    let ready_model = if remote_fallback || remote_speech::is_remote_model(&item.speech_model) {
        model_manager::ensure_local_fallback_model(app, &settings.local_model)?
    } else {
        model_manager::ensure_model_ready(app, &item.speech_model)?
    };
    let dictionary_terms = dictionary::dictionary_entries_for_model(&ready_model, &settings);
    let language = settings.language.clone();
    let transcriber = state.local_transcriber();
    let use_whisper_chunking =
        matches!(ready_model.engine, model_manager::LocalModelEngine::Whisper);

    if use_whisper_chunking {
        let chunk_size = (WHISPER_CHUNK_SECONDS as usize * sample_rate as usize).max(1);
        let overlap = (WHISPER_CHUNK_OVERLAP_SECONDS as usize * sample_rate as usize)
            .min(chunk_size.saturating_sub(1));
        let step = chunk_size.saturating_sub(overlap).max(1);

        let mut total_chunks =
            compute_total_chunks(wav_info.total_samples, chunk_size, step).max(1) as u32;
        let mut full_text = String::new();
        let mut merged_segments: Vec<TranscriptSegment> = Vec::new();
        let mut merged_words: Vec<TranscriptSegment> = Vec::new();
        let mut last_end_ms: u64 = 0;
        let mut last_word_end_ms: u64 = 0;
        let mut chunk_index: u32 = 0;

        stream_wav_chunks(&audio_path, chunk_size, overlap, |start_idx, chunk| {
            if token.is_cancelled() {
                return Err(cancelled_error());
            }

            chunk_index = chunk_index.saturating_add(1);
            let remaining = wav_info
                .total_samples
                .saturating_sub(start_idx + chunk.len());
            total_chunks = total_chunks.max(chunk_index + u32::from(remaining > 0));
            let chunk_speech_percent =
                speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
            if chunk_speech_percent < VAD_MIN_SPEECH_PERCENT_CHUNK {
                let progress =
                    ((start_idx + chunk.len()) as f32 / wav_info.total_samples as f32).min(1.0);
                report_progress(
                    app,
                    state.storage(),
                    &item.id,
                    LibraryProgressUpdate::with_chunk_counts(progress, chunk_index, total_chunks),
                );
                return Ok(());
            }
            let result = transcriber.transcribe_with_segments(
                &ready_model,
                chunk,
                sample_rate,
                dictionary_terms.as_slice(),
                Some(&language),
            )?;
            if token.is_cancelled() {
                return Err(cancelled_error());
            }

            let regions = glimpse_speech::vad::speech_regions(chunk, sample_rate);
            let in_speech = |start_ms: u64, end_ms: u64| match regions.as_deref() {
                Some(regions) => transcription_api::overlaps_speech(
                    start_ms as f32 / 1000.0,
                    end_ms as f32 / 1000.0,
                    regions,
                ),
                None => true,
            };

            let chunk_text = transcription_api::keep_spoken_segments(
                &result.transcript,
                result.segments.as_deref(),
                regions.as_deref(),
            );
            let mut appended_text = None;
            if !chunk_text.trim().is_empty() {
                let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
                if !deduped.trim().is_empty() {
                    let appended = append_library_chunk(&mut full_text, &deduped);
                    appended_text = Some(appended);
                }
            }

            let mut new_segments: Vec<TranscriptSegment> = Vec::new();
            if let Some(segments) = result.segments {
                let offset_ms = (start_idx as f64 / sample_rate as f64 * 1000.0) as u64;
                for seg in convert_segments_to_ms(&segments) {
                    let start_ms = seg.start_ms + offset_ms;
                    let end_ms = seg.end_ms + offset_ms;
                    if end_ms <= last_end_ms || !in_speech(seg.start_ms, seg.end_ms) {
                        continue;
                    }
                    let new_segment = TranscriptSegment {
                        start_ms,
                        end_ms,
                        text: seg.text,
                        speaker_id: None,
                    };
                    merged_segments.push(new_segment.clone());
                    new_segments.push(new_segment);
                    last_end_ms = end_ms;
                }
            }

            if let Some(words) = result.words {
                let offset_ms = (start_idx as f64 / sample_rate as f64 * 1000.0) as u64;
                let converted = convert_segments_to_ms(&words);
                let chunk_word_floor = last_word_end_ms;
                for word in converted {
                    if !in_speech(word.start_ms, word.end_ms) {
                        continue;
                    }
                    let start_ms = word.start_ms + offset_ms;
                    let end_ms = word.end_ms + offset_ms;
                    if end_ms <= chunk_word_floor {
                        continue;
                    }
                    last_word_end_ms = last_word_end_ms.max(end_ms);
                    merged_words.push(TranscriptSegment {
                        start_ms,
                        end_ms,
                        text: word.text,
                        speaker_id: None,
                    });
                }
            }

            let progress =
                ((start_idx + chunk.len()) as f32 / wav_info.total_samples as f32).min(1.0);
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
                LibraryProgressUpdate {
                    progress,
                    current_chunk: chunk_index,
                    total_chunks,
                    transcript: transcript_patch,
                    segments: segments_patch,
                    chunk_text: appended_text,
                    chunk_segments,
                },
            );
            Ok(())
        })?;

        return Ok(LibraryTranscriptionResult {
            transcript: transcription_api::strip_non_speech_tags(&full_text),
            segments: if merged_segments.is_empty() {
                None
            } else {
                Some(merged_segments)
            },
            words: (!merged_words.is_empty()).then_some(merged_words),
            speech_model: None,
        });
    }

    if duration_seconds <= (DIRECT_TRANSCRIBE_MINUTES as f32 * 60.0) {
        let (samples, sample_rate) = transcribe::load_audio_for_transcription(&audio_path)?;
        let speech_percent =
            speech_percentage_i16_with_mode(&samples, sample_rate, VadMode::VeryAggressive);
        if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
            return Ok(LibraryTranscriptionResult {
                transcript: String::new(),
                segments: None,
                words: None,
                speech_model: None,
            });
        }

        let result = transcriber.transcribe_with_segments(
            &ready_model,
            &samples,
            sample_rate,
            dictionary_terms.as_slice(),
            Some(&language),
        )?;
        if token.is_cancelled() {
            return Err(cancelled_error());
        }

        return Ok(LibraryTranscriptionResult {
            transcript: result.transcript,
            segments: result.segments.as_deref().map(convert_segments_to_ms),
            words: result.words.as_deref().map(convert_segments_to_ms),
            speech_model: None,
        });
    }

    let chunk_size = (MAX_CHUNK_MINUTES as usize * 60 * sample_rate as usize).max(1);
    let overlap = (CHUNK_OVERLAP_SECONDS as usize * sample_rate as usize).min(chunk_size);
    let step = chunk_size.saturating_sub(overlap).max(1);
    let mut total_chunks =
        compute_total_chunks(wav_info.total_samples, chunk_size, step).max(1) as u32;
    let mut full_text = String::new();
    let mut merged_segments: Vec<TranscriptSegment> = Vec::new();
    let mut merged_words: Vec<TranscriptSegment> = Vec::new();
    let mut last_end_ms: u64 = 0;
    let mut last_word_end_ms: u64 = 0;
    let mut chunk_index: u32 = 0;

    stream_wav_chunks(&audio_path, chunk_size, overlap, |start_idx, chunk| {
        if token.is_cancelled() {
            return Err(cancelled_error());
        }

        chunk_index = chunk_index.saturating_add(1);
        let remaining = wav_info
            .total_samples
            .saturating_sub(start_idx + chunk.len());
        total_chunks = total_chunks.max(chunk_index + u32::from(remaining > 0));
        let chunk_speech_percent =
            speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
        if chunk_speech_percent < VAD_MIN_SPEECH_PERCENT_CHUNK {
            let progress =
                ((start_idx + chunk.len()) as f32 / wav_info.total_samples as f32).min(1.0);
            report_progress(
                app,
                state.storage(),
                &item.id,
                LibraryProgressUpdate::with_chunk_counts(progress, chunk_index, total_chunks),
            );
            return Ok(());
        }
        let result = transcriber.transcribe_with_segments(
            &ready_model,
            chunk,
            sample_rate,
            dictionary_terms.as_slice(),
            Some(&language),
        )?;
        if token.is_cancelled() {
            return Err(cancelled_error());
        }

        let chunk_text = result.transcript;
        let mut kept_words = 0usize;
        if !chunk_text.trim().is_empty() {
            let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
            if !deduped.trim().is_empty() {
                kept_words = deduped.split_whitespace().count();
                append_library_chunk(&mut full_text, &deduped);
            }
        }

        if let Some(segments) = result.segments {
            let offset_ms = (start_idx as f64 / sample_rate as f64 * 1000.0) as u64;
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
                    speaker_id: None,
                });
                last_end_ms = end_ms;
            }
        }

        if let Some(words) = result.words {
            let offset_ms = (start_idx as f64 / sample_rate as f64 * 1000.0) as u64;
            let converted = convert_segments_to_ms(&words);
            let exact_skip = (chunk_text.split_whitespace().count() == converted.len())
                .then(|| converted.len().saturating_sub(kept_words));
            let chunk_word_floor = last_word_end_ms;
            for (index, word) in converted.into_iter().enumerate() {
                let start_ms = word.start_ms + offset_ms;
                let end_ms = word.end_ms + offset_ms;
                match exact_skip {
                    Some(skip) if index < skip => continue,
                    None if end_ms <= chunk_word_floor => continue,
                    _ => {}
                }
                last_word_end_ms = last_word_end_ms.max(end_ms);
                merged_words.push(TranscriptSegment {
                    start_ms,
                    end_ms,
                    text: word.text,
                    speaker_id: None,
                });
            }
        }

        let progress = ((start_idx + chunk.len()) as f32 / wav_info.total_samples as f32).min(1.0);
        report_progress(
            app,
            state.storage(),
            &item.id,
            LibraryProgressUpdate::with_chunk_counts(progress, chunk_index, total_chunks),
        );
        Ok(())
    })?;

    Ok(LibraryTranscriptionResult {
        transcript: full_text.trim().to_string(),
        segments: if merged_segments.is_empty() {
            None
        } else {
            Some(merged_segments)
        },
        words: (!merged_words.is_empty()).then_some(merged_words),
        speech_model: None,
    })
}

fn report_progress(
    app: &AppHandle<AppRuntime>,
    storage: Arc<StorageManager>,
    id: &str,
    update: LibraryProgressUpdate,
) {
    let LibraryProgressUpdate {
        progress,
        current_chunk,
        total_chunks,
        transcript,
        segments,
        chunk_text,
        chunk_segments,
    } = update;

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

fn append_library_chunk(existing: &mut String, next: &str) -> String {
    let trimmed = next.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.to_string();
    let ends_sentence = existing
        .chars()
        .rev()
        .find(|ch| !ch.is_whitespace())
        .map(|ch| matches!(ch, '.' | '!' | '?' | ':' | ';'))
        .unwrap_or(true);

    if !ends_sentence {
        lowercase_first_alpha(&mut normalized);
    }

    transcribe::append_deduped_chunk(existing, &normalized);
    normalized
}

fn lowercase_first_alpha(text: &mut String) {
    if let Some((idx, ch)) = text.char_indices().find(|(_, ch)| ch.is_alphabetic()) {
        if ch.is_uppercase() {
            let mut lowered = String::with_capacity(text.len());
            lowered.push_str(&text[..idx]);
            lowered.extend(ch.to_lowercase());
            lowered.push_str(&text[idx + ch.len_utf8()..]);
            *text = lowered;
        }
    }
}
