use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Result, anyhow};
use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager, async_runtime};
use tokio_util::sync::CancellationToken;
use webrtc_vad::VadMode;

use crate::transcribe::count_words;
use crate::{
    AppRuntime, AppState, LibraryJob, LibraryJobKind, dictionary, model_manager,
    recorder::speech_percentage_i16_with_mode, remote_speech, settings::UserSettings,
    storage::StorageManager, toast, transcribe, transcription_api,
};

use super::bleed::normalize;
use super::processing::{
    WavInfo, compute_total_chunks, convert_library_item, convert_segments_to_ms, diarize_segments,
    read_wav_info, stream_wav_chunks,
};
use super::types::{
    CHUNK_OVERLAP_SECONDS, DIRECT_TRANSCRIBE_MINUTES, EVENT_LIBRARY_COMPLETE, EVENT_LIBRARY_ERROR,
    EVENT_LIBRARY_PROGRESS, JobSource, LibraryCompletePayload, LibraryErrorPayload, LibraryItem,
    LibraryItemPatch, LibraryItemStatus, LibraryProgressPayload, LibraryProgressUpdate,
    LibraryTranscriptionResult, MAX_CHUNK_MINUTES, TranscriptSegment, cancelled_error,
    is_cancelled_error, is_ffmpeg_error_message,
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
        let source = job.source;
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
                        start_library_transcription_internal(
                            &app_handle,
                            &state_handle,
                            job_id,
                            source,
                        );
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
                start_library_transcription_internal(&app_handle, &state_handle, job_id, source);
            }
        }
    });
}

fn start_library_transcription_internal(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
    id: String,
    source: JobSource,
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
    let transcription_started_at = Instant::now();
    // Recordings have a second track when system audio was captured next to the microphone.
    let tracks =
        (source == JobSource::Recording).then(|| 1 + u8::from(item.secondary_audio_path.is_some()));
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
                    let speech_model = result
                        .speech_model
                        .as_deref()
                        .filter(|model| !model.trim().is_empty())
                        .unwrap_or(&item.speech_model);
                    crate::analytics::track_transcription_failed(
                        &app_handle,
                        "transcription",
                        library_transcription_mode(speech_model),
                        speech_model,
                        "no_speech",
                        Some(item.duration_seconds),
                        source.as_str(),
                    );
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
                    let speech_model = result
                        .speech_model
                        .as_deref()
                        .filter(|model| !model.trim().is_empty())
                        .unwrap_or(&item.speech_model);
                    let model_label = crate::model_manager::model_label(speech_model);
                    crate::analytics::track_transcription_completed(
                        &app_handle,
                        crate::analytics::TranscriptionEvent {
                            mode: library_transcription_mode(speech_model),
                            model: &model_label,
                            audio_duration_seconds: item.duration_seconds,
                            transcription_duration_seconds: transcription_started_at
                                .elapsed()
                                .as_secs_f32(),
                            word_count: count_words(&final_transcript),
                            audio_source: source.as_str(),
                            tracks,
                            ..Default::default()
                        },
                    );
                    let _ = storage.update_library_item(
                        &id,
                        LibraryItemPatch {
                            status: Some(LibraryItemStatus::Complete),
                            transcript: Some(final_transcript),
                            segments: result.segments.take(),
                            words: result.words.take(),
                            speech_model: result.speech_model.take(),
                            speakers: Some(result.speakers.take()),
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
                if !cancelled {
                    crate::analytics::track_transcription_failed(
                        &app_handle,
                        "transcription",
                        library_transcription_mode(&item.speech_model),
                        &item.speech_model,
                        crate::analytics::classify_error(&err),
                        Some(item.duration_seconds),
                        source.as_str(),
                    );
                }
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
                crate::analytics::track_transcription_failed(
                    &app_handle,
                    "transcription",
                    library_transcription_mode(&item.speech_model),
                    &item.speech_model,
                    "task_failed",
                    Some(item.duration_seconds),
                    source.as_str(),
                );
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

fn library_transcription_mode(model: &str) -> &'static str {
    if remote_speech::is_remote_model(model) {
        "remote"
    } else {
        "local"
    }
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

struct LocalRun<'a> {
    app: &'a AppHandle<AppRuntime>,
    state: &'a AppState,
    item: &'a LibraryItem,
    token: &'a CancellationToken,
    model: &'a model_manager::ReadyModel,
    dictionary: &'a [String],
    language: &'a str,
    sample_rate: u32,
    pass: TrackPass,
}

struct ChunkPlan {
    chunk_size: usize,
    overlap: usize,
    step: usize,
}

impl ChunkPlan {
    fn new(chunk_seconds: usize, overlap_seconds: usize, sample_rate: u32) -> Self {
        let chunk_size = (chunk_seconds * sample_rate as usize).max(1);
        let overlap = (overlap_seconds * sample_rate as usize).min(chunk_size.saturating_sub(1));
        let step = chunk_size.saturating_sub(overlap).max(1);
        Self {
            chunk_size,
            overlap,
            step,
        }
    }
}

fn offset_ms(start_idx: usize, sample_rate: u32) -> u64 {
    (start_idx as f64 / sample_rate as f64 * 1000.0) as u64
}

fn chunk_below_speech_gate(chunk: &[i16], sample_rate: u32) -> bool {
    speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive)
        < VAD_MIN_SPEECH_PERCENT_CHUNK
}

/// How one audio file's pass maps onto the item: which slice of the progress
/// bar it owns, which speaker its segments get, and whether partial text is
/// streamed to the UI (only sensible for a single-track item).
#[derive(Clone, Copy)]
struct TrackPass {
    progress_range: (f32, f32),
    speaker_id: Option<&'static str>,
    stream_partials: bool,
}

impl TrackPass {
    const SINGLE: Self = Self {
        progress_range: (0.0, 1.0),
        speaker_id: None,
        stream_partials: true,
    };

    fn map_progress(&self, progress: f32) -> f32 {
        let (start, end) = self.progress_range;
        start + progress.clamp(0.0, 1.0) * (end - start)
    }
}

fn transcribe_library_item(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
    item: &LibraryItem,
    token: &CancellationToken,
) -> Result<LibraryTranscriptionResult> {
    let Some(secondary) = item.secondary_audio_path.as_deref() else {
        return transcribe_audio_file(
            app,
            state,
            item,
            &PathBuf::from(&item.audio_path),
            token,
            TrackPass::SINGLE,
        );
    };

    // Recordings with both tracks: the microphone is "you", system audio is
    // everyone else. Each track is transcribed on its own, then interleaved.
    let mut microphone = transcribe_audio_file(
        app,
        state,
        item,
        &PathBuf::from(&item.audio_path),
        token,
        TrackPass {
            progress_range: (0.0, 0.5),
            speaker_id: Some("you"),
            stream_partials: false,
        },
    )?;
    let system = transcribe_audio_file(
        app,
        state,
        item,
        &PathBuf::from(secondary),
        token,
        TrackPass {
            progress_range: (0.5, 1.0),
            speaker_id: Some("others"),
            stream_partials: false,
        },
    )?;
    // Speaker audio the microphone picked up would otherwise appear twice.
    super::bleed::remove_bleed(&mut microphone, &system);
    let mut merged = merge_track_results(microphone, system);
    // The You/Others speakers were assigned when the item was created.
    merged.speakers = item.speakers.clone();
    Ok(merged)
}

fn merge_track_results(
    first: LibraryTranscriptionResult,
    second: LibraryTranscriptionResult,
) -> LibraryTranscriptionResult {
    let mut segments = first.segments.unwrap_or_default();
    segments.extend(second.segments.unwrap_or_default());
    segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));

    let mut words = first.words.unwrap_or_default();
    words.extend(second.words.unwrap_or_default());
    words.sort_by_key(|word| (word.start_ms, word.end_ms));

    let transcript = if segments.is_empty() {
        [first.transcript.trim(), second.transcript.trim()]
            .into_iter()
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        segments
            .iter()
            .map(|segment| segment.text.trim())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };

    LibraryTranscriptionResult {
        transcript,
        segments: (!segments.is_empty()).then_some(segments),
        words: (!words.is_empty()).then_some(words),
        speech_model: first.speech_model.or(second.speech_model),
        speakers: None,
    }
}

fn tag_speaker(
    segments: Option<Vec<TranscriptSegment>>,
    speaker_id: Option<&str>,
) -> Option<Vec<TranscriptSegment>> {
    let Some(speaker_id) = speaker_id else {
        return segments;
    };
    segments.map(|mut segments| {
        for segment in &mut segments {
            segment.speaker_id = Some(speaker_id.to_string());
        }
        segments
    })
}

fn transcribe_audio_file(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
    item: &LibraryItem,
    audio_path: &Path,
    token: &CancellationToken,
    pass: TrackPass,
) -> Result<LibraryTranscriptionResult> {
    if token.is_cancelled() {
        return Err(cancelled_error());
    }

    let audio_path = audio_path.to_path_buf();
    if !audio_path.exists() {
        return Err(anyhow!("Audio file not found"));
    }

    let wav_info = read_wav_info(&audio_path)?;
    if wav_info.total_samples == 0 {
        return Err(anyhow!("No audio data decoded from WAV file"));
    }

    let settings = state.current_settings();

    let wants_remote = remote_speech::is_remote_model(&item.speech_model)
        && remote_speech::is_configured(&settings);
    let mut remote_fallback = false;
    if wants_remote {
        match transcribe_remote(app, state, &settings, item, &audio_path, token, pass)? {
            Some(mut result) => {
                result.segments = tag_speaker(result.segments.take(), pass.speaker_id);
                result.words = tag_speaker(result.words.take(), pass.speaker_id);
                return Ok(result);
            }
            None => remote_fallback = true,
        }
    }

    let ready_model = if remote_fallback || remote_speech::is_remote_model(&item.speech_model) {
        model_manager::ensure_local_fallback_model(app, &settings.local_model)?
    } else {
        model_manager::ensure_model_ready(app, &item.speech_model)?
    };
    let dictionary = dictionary::dictionary_entries_for_model(&ready_model, &settings);
    let language = settings.language.clone();

    let run = LocalRun {
        app,
        state,
        item,
        token,
        model: &ready_model,
        dictionary: &dictionary,
        language: &language,
        sample_rate: wav_info.sample_rate,
        pass,
    };

    let mut result = if matches!(ready_model.engine, model_manager::LocalModelEngine::Whisper) {
        transcribe_chunked(&run, &audio_path, &wav_info, ChunkStrategy::Whisper)
    } else if wav_info.duration_seconds <= (DIRECT_TRANSCRIBE_MINUTES as f32 * 60.0) {
        transcribe_direct(&run, &audio_path)
    } else {
        transcribe_chunked(&run, &audio_path, &wav_info, ChunkStrategy::Parakeet)
    }?;
    result.segments = tag_speaker(result.segments.take(), pass.speaker_id);
    result.words = tag_speaker(result.words.take(), pass.speaker_id);
    Ok(result)
}

// Ok(Some) = done, Ok(None) = fall back to local, Err = cancel/unavailable.
fn transcribe_remote(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
    settings: &UserSettings,
    item: &LibraryItem,
    audio_path: &Path,
    token: &CancellationToken,
    pass: TrackPass,
) -> Result<Option<LibraryTranscriptionResult>> {
    let http = state.http();
    let attempt = async_runtime::block_on(remote_speech::attempt_remote(
        app,
        &http,
        settings,
        audio_path,
        &settings.local_model,
        remote_speech::TranscribeOptions {
            timestamps: true,
            diarization: item.detect_speakers,
        },
        || token.is_cancelled(),
    ));
    match attempt {
        remote_speech::RemoteAttempt::Success(success) => {
            let result = success.transcription;
            report_progress(
                app,
                state.storage(),
                &item.id,
                LibraryProgressUpdate::with_chunk_counts(pass.map_progress(1.0), 1, 1),
            );
            let (segments, speakers) = match success.diarized_segments.as_deref() {
                Some(segs) => {
                    let (converted, speakers) = diarize_segments(segs);
                    (Some(converted), speakers)
                }
                None => (result.segments.as_deref().map(convert_segments_to_ms), None),
            };
            let words = result.words.as_deref().map(convert_segments_to_ms);
            Ok(Some(LibraryTranscriptionResult {
                transcript: result.transcript,
                segments,
                words,
                speech_model: result.speech_model,
                speakers,
            }))
        }
        remote_speech::RemoteAttempt::Cancelled => Err(cancelled_error()),
        remote_speech::RemoteAttempt::Unavailable(message) => Err(anyhow!(message)),
        remote_speech::RemoteAttempt::Fallback => Ok(None),
    }
}

fn transcribe_direct(run: &LocalRun, audio_path: &Path) -> Result<LibraryTranscriptionResult> {
    let (samples, sample_rate) = transcribe::load_audio_for_transcription(audio_path)?;
    let speech_percent =
        speech_percentage_i16_with_mode(&samples, sample_rate, VadMode::VeryAggressive);
    if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
        return Ok(LibraryTranscriptionResult {
            transcript: String::new(),
            segments: None,
            words: None,
            speech_model: None,
            speakers: None,
        });
    }

    let result = run.state.local_transcriber().transcribe_with_segments(
        run.model,
        &samples,
        sample_rate,
        run.dictionary,
        Some(run.language),
    )?;
    if run.token.is_cancelled() {
        return Err(cancelled_error());
    }

    Ok(LibraryTranscriptionResult {
        transcript: result.transcript,
        segments: result.segments.as_deref().map(convert_segments_to_ms),
        words: result.words.as_deref().map(convert_segments_to_ms),
        speech_model: None,
        speakers: None,
    })
}

#[derive(Clone, Copy)]
enum ChunkStrategy {
    /// Short chunks with VAD gating; whisper hallucinates on silence.
    Whisper,
    /// Long chunks, no VAD; overlap words are trimmed by count and timestamp.
    Parakeet,
}

fn transcribe_chunked(
    run: &LocalRun,
    audio_path: &Path,
    wav_info: &WavInfo,
    strategy: ChunkStrategy,
) -> Result<LibraryTranscriptionResult> {
    let sample_rate = run.sample_rate;
    let transcriber = run.state.local_transcriber();
    let plan = match strategy {
        ChunkStrategy::Whisper => ChunkPlan::new(
            WHISPER_CHUNK_SECONDS as usize,
            WHISPER_CHUNK_OVERLAP_SECONDS as usize,
            sample_rate,
        ),
        ChunkStrategy::Parakeet => ChunkPlan::new(
            MAX_CHUNK_MINUTES as usize * 60,
            CHUNK_OVERLAP_SECONDS as usize,
            sample_rate,
        ),
    };

    let mut total_chunks =
        compute_total_chunks(wav_info.total_samples, plan.chunk_size, plan.step).max(1);
    let mut full_text = String::new();
    let mut merged_segments: Vec<TranscriptSegment> = Vec::new();
    let mut merged_words: Vec<TranscriptSegment> = Vec::new();
    let mut last_end_ms: u64 = 0;
    let mut last_word_end_ms: u64 = 0;
    let mut chunk_index: u32 = 0;

    stream_wav_chunks(
        audio_path,
        plan.chunk_size,
        plan.overlap,
        |start_idx, chunk| {
            if run.token.is_cancelled() {
                return Err(cancelled_error());
            }

            chunk_index = chunk_index.saturating_add(1);
            let remaining = wav_info
                .total_samples
                .saturating_sub(start_idx + chunk.len());
            total_chunks = total_chunks.max(chunk_index + u32::from(remaining > 0));
            let progress =
                ((start_idx + chunk.len()) as f32 / wav_info.total_samples as f32).min(1.0);
            if chunk_below_speech_gate(chunk, sample_rate) {
                report_progress(
                    run.app,
                    run.state.storage(),
                    &run.item.id,
                    LibraryProgressUpdate::with_chunk_counts(
                        run.pass.map_progress(progress),
                        chunk_index,
                        total_chunks,
                    ),
                );
                return Ok(());
            }
            let result = transcriber.transcribe_with_segments(
                run.model,
                chunk,
                sample_rate,
                run.dictionary,
                Some(run.language),
            )?;
            if run.token.is_cancelled() {
                return Err(cancelled_error());
            }

            let regions = match strategy {
                ChunkStrategy::Whisper => glimpse_speech::vad::speech_regions(chunk, sample_rate),
                ChunkStrategy::Parakeet => None,
            };
            let in_speech = |start_ms: u64, end_ms: u64| match regions.as_deref() {
                Some(regions) => transcription_api::overlaps_speech(
                    start_ms as f32 / 1000.0,
                    end_ms as f32 / 1000.0,
                    regions,
                ),
                None => true,
            };

            let offset = offset_ms(start_idx, sample_rate);
            let mut appended_text = None;
            let mut new_segments: Vec<TranscriptSegment> = Vec::new();
            // Chunks are joined on word timings; Whisper stretches segment ends.
            let spoken_words = result
                .words
                .as_deref()
                .map(convert_segments_to_ms)
                .map(|words| {
                    words
                        .into_iter()
                        .filter(|word| in_speech(word.start_ms, word.end_ms))
                        .collect::<Vec<_>>()
                })
                .filter(|words| !words.is_empty());
            if let Some(words) = spoken_words {
                let segments = result
                    .segments
                    .as_deref()
                    .map(convert_segments_to_ms)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|seg| in_speech(seg.start_ms, seg.end_ms))
                    .collect::<Vec<_>>();
                let previous_tail = &merged_words[merged_words.len().saturating_sub(8)..];
                let (segments, words) =
                    keep_new_words(&segments, &words, offset, last_word_end_ms, previous_tail);
                let text = segments
                    .iter()
                    .map(|seg| seg.text.trim())
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                if !text.is_empty() {
                    appended_text = Some(append_library_chunk(&mut full_text, &text));
                }
                if let Some(last) = segments.last() {
                    last_end_ms = last_end_ms.max(last.end_ms);
                }
                if let Some(last) = words.last() {
                    last_word_end_ms = last_word_end_ms.max(last.end_ms);
                }
                merged_segments.extend(segments.iter().cloned());
                new_segments = segments;
                merged_words.extend(words);
            } else {
                let chunk_text = transcription_api::keep_spoken_segments(
                    &result.transcript,
                    result.segments.as_deref(),
                    regions.as_deref(),
                );
                if !chunk_text.trim().is_empty() {
                    let deduped = transcribe::dedupe_overlap_text(&full_text, &chunk_text);
                    if !deduped.trim().is_empty() {
                        appended_text = Some(append_library_chunk(&mut full_text, &deduped));
                    }
                }

                if let Some(segments) = result.segments {
                    for seg in convert_segments_to_ms(&segments) {
                        let end_ms = seg.end_ms + offset;
                        if end_ms <= last_end_ms || !in_speech(seg.start_ms, seg.end_ms) {
                            continue;
                        }
                        let mut start_ms = seg.start_ms + offset;
                        let mut text = seg.text;
                        // Without word timings, a segment starting inside the chunk
                        // overlap is trimmed by text. Whisper's stretched ends make
                        // this unreliable there, so it only applies to Parakeet-style chunks.
                        if matches!(strategy, ChunkStrategy::Parakeet) && start_ms < last_end_ms {
                            let previous =
                                merged_segments.last().map_or("", |last| last.text.as_str());
                            let rest = transcribe::dedupe_overlap_text(previous, &text);
                            if rest.is_empty() {
                                continue;
                            }
                            start_ms = last_end_ms;
                            text = rest;
                        }
                        let new_segment = TranscriptSegment {
                            start_ms,
                            end_ms,
                            text,
                            speaker_id: None,
                        };
                        merged_segments.push(new_segment.clone());
                        new_segments.push(new_segment);
                        last_end_ms = end_ms;
                    }
                }
            }

            let update = if run.pass.stream_partials {
                let transcript_patch = appended_text.as_ref().map(|_| full_text.clone());
                let (segments_patch, chunk_segments) = if new_segments.is_empty() {
                    (None, None)
                } else {
                    (Some(merged_segments.clone()), Some(new_segments))
                };
                LibraryProgressUpdate {
                    progress,
                    current_chunk: chunk_index,
                    total_chunks,
                    transcript: transcript_patch,
                    segments: segments_patch,
                    chunk_text: appended_text,
                    chunk_segments,
                }
            } else {
                LibraryProgressUpdate::with_chunk_counts(
                    run.pass.map_progress(progress),
                    chunk_index,
                    total_chunks,
                )
            };
            report_progress(run.app, run.state.storage(), &run.item.id, update);
            Ok(())
        },
    )?;

    Ok(LibraryTranscriptionResult {
        transcript: full_text.trim().to_string(),
        segments: (!merged_segments.is_empty()).then_some(merged_segments),
        words: (!merged_words.is_empty()).then_some(merged_words),
        speech_model: None,
        speakers: None,
    })
}

// Leading words of a chunk that start this soon after the previous chunk's
// last word and repeat its final words are timing jitter, not new speech.
const CHUNK_REPEAT_WINDOW_MS: u64 = 1000;

/// Keeps the chunk words centred after `emitted_until_ms` (absolute), minus
/// leading words that repeat the end of `previous`. Segment text is rebuilt
/// from the kept words it owns, since Whisper can repeat a word across two
/// segments; a segment without word timings is judged by its own midpoint.
fn keep_new_words(
    segments: &[TranscriptSegment],
    words: &[TranscriptSegment],
    offset_ms: u64,
    emitted_until_ms: u64,
    previous: &[TranscriptSegment],
) -> (Vec<TranscriptSegment>, Vec<TranscriptSegment>) {
    let midpoint = |item: &TranscriptSegment| offset_ms + (item.start_ms + item.end_ms) / 2;
    let absolute = |item: &TranscriptSegment| TranscriptSegment {
        start_ms: item.start_ms + offset_ms,
        end_ms: item.end_ms + offset_ms,
        text: item.text.clone(),
        speaker_id: None,
    };

    let fresh: Vec<usize> = (0..words.len())
        .filter(|&index| midpoint(&words[index]) >= emitted_until_ms)
        .collect();
    let straddling = fresh
        .iter()
        .take_while(|&&index| {
            words[index].start_ms + offset_ms < emitted_until_ms + CHUNK_REPEAT_WINDOW_MS
        })
        .count()
        .min(previous.len());
    let repeated = (1..=straddling)
        .rev()
        .find(|&count| {
            fresh[..count]
                .iter()
                .map(|&index| normalize(&words[index].text))
                .eq(previous[previous.len() - count..]
                    .iter()
                    .map(|word| normalize(&word.text)))
        })
        .unwrap_or(0);
    let mut kept = vec![false; words.len()];
    for &index in &fresh[repeated..] {
        kept[index] = true;
    }

    // Whisper segment ranges can overlap, so each word goes to the last
    // segment that starts before its midpoint.
    let owners: Vec<usize> = words
        .iter()
        .map(|word| {
            let mid = (word.start_ms + word.end_ms) / 2;
            segments
                .iter()
                .rposition(|segment| segment.start_ms <= mid)
                .unwrap_or(0)
        })
        .collect();
    let kept_segments = segments
        .iter()
        .enumerate()
        .filter_map(|(position, segment)| {
            let own: Vec<usize> = (0..words.len())
                .filter(|&index| owners[index] == position)
                .collect();
            if own.is_empty() {
                return (midpoint(segment) >= emitted_until_ms).then(|| absolute(segment));
            }
            let own_kept: Vec<&TranscriptSegment> = own
                .iter()
                .filter(|&&index| kept[index])
                .map(|&index| &words[index])
                .collect();
            let (first, last) = (own_kept.first()?, own_kept.last()?);
            Some(TranscriptSegment {
                start_ms: first.start_ms + offset_ms,
                end_ms: last.end_ms + offset_ms,
                text: own_kept
                    .iter()
                    .map(|word| word.text.trim())
                    .collect::<Vec<_>>()
                    .join(" "),
                speaker_id: None,
            })
        })
        .collect();
    let kept_words = (0..words.len())
        .filter(|&index| kept[index])
        .map(|index| absolute(&words[index]))
        .collect();
    (kept_segments, kept_words)
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
    if let Some((idx, ch)) = text.char_indices().find(|(_, ch)| ch.is_alphabetic())
        && ch.is_uppercase()
    {
        let mut lowered = String::with_capacity(text.len());
        lowered.push_str(&text[..idx]);
        lowered.extend(ch.to_lowercase());
        lowered.push_str(&text[idx + ch.len_utf8()..]);
        *text = lowered;
    }
}
