use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use tauri::{async_runtime, AppHandle, Manager};
use tokio_util::sync::CancellationToken;
use webrtc_vad::VadMode;

use crate::{
    accessibility_context, analytics, assistive, dictionary, llm_cleanup, mode_context,
    model_manager,
    recorder::{speech_percentage_i16_with_mode, CompletedRecording, RecordingSaved},
    settings::{Personality, UserSettings},
    storage, toast, transcription_api, update_checker, AppRuntime, AppState,
    TranscriptionCompletePayload, TranscriptionErrorPayload, EVENT_TRANSCRIPTION_COMPLETE,
    EVENT_TRANSCRIPTION_ERROR,
};

const WHISPER_CHUNK_SECONDS: f32 = 28.0;
const WHISPER_CHUNK_OVERLAP_SECONDS: f32 = 2.0;
const VAD_MIN_SPEECH_PERCENT_FILE: f32 = 2.0;
const VAD_MIN_SPEECH_PERCENT_CHUNK: f32 = 5.0;

pub(crate) fn queue_transcription(
    app: &AppHandle<AppRuntime>,
    saved: RecordingSaved,
    recording: CompletedRecording,
) {
    let state = app.state::<AppState>();
    state.clear_cancellation();
    state.set_pending_path(Some(saved.path.clone()));

    let pending_selected_text = state.take_pending_selected_text();
    let cancel_token = state.create_transcription_token();

    let http = state.http();
    let app_handle = app.clone();
    let saved_for_task = saved.clone();
    let recording_for_task = recording.clone();

    async_runtime::spawn(async move {
        let is_cancelled = || app_handle.state::<AppState>().is_cancelled();

        let settings = app_handle.state::<AppState>().current_settings();
        let auto_paste = transcription_api::auto_paste_enabled();

        eprintln!(
            "[transcription] mode={:?} local_only=true",
            settings.transcription_mode,
        );
        accessibility_context::log_active_context();

        let active_mode = mode_context::resolve_active_personality(&settings);
        // Local transcription path
        let result = {
            let model_key = settings.local_model.clone();
            match model_manager::ensure_model_ready(&app_handle, &model_key) {
                Ok(ready_model) => {
                    let dictionary_terms =
                        dictionary::dictionary_entries_for_model(&ready_model, &settings);
                    let language = settings.language.clone();
                    let transcriber = app_handle.state::<AppState>().local_transcriber();
                    let local_recording = recording_for_task.clone();
                    let is_whisper =
                        matches!(ready_model.engine, model_manager::LocalModelEngine::Whisper);
                    let cancel_token_clone = cancel_token.clone();
                    match async_runtime::spawn_blocking(move || {
                        if is_whisper {
                            transcribe_local_chunked(
                                &transcriber,
                                &ready_model,
                                &local_recording.samples,
                                local_recording.sample_rate,
                                LocalChunkingConfig {
                                    dictionary: &dictionary_terms,
                                    language: Some(&language),
                                    chunk_seconds: WHISPER_CHUNK_SECONDS,
                                    overlap_seconds: WHISPER_CHUNK_OVERLAP_SECONDS,
                                    cancel_token: Some(&cancel_token_clone),
                                    strip_hallucinated_thank_you: true,
                                },
                            )
                        } else {
                            let speech_percent = speech_percentage_i16_with_mode(
                                &local_recording.samples,
                                local_recording.sample_rate,
                                VadMode::VeryAggressive,
                            );
                            if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
                                Ok(transcription_api::TranscriptionSuccess {
                                    transcript: String::new(),
                                    speech_model: None,
                                })
                            } else {
                                transcriber.transcribe(
                                    &ready_model,
                                    &local_recording.samples,
                                    local_recording.sample_rate,
                                    &dictionary_terms,
                                    Some(&language),
                                )
                            }
                        }
                    })
                    .await
                    {
                        Ok(inner) => inner,
                        Err(err) => Err(anyhow!("Local transcription task failed: {err}")),
                    }
                }
                Err(err) => Err(err),
            }
        };

        match result {
            Ok(result) => {
                if is_cancelled() {
                    app_handle
                        .state::<AppState>()
                        .pill()
                        .safe_reset(&app_handle);
                    app_handle.state::<AppState>().set_pending_path(None);
                    return;
                }

                let raw_transcript = result.transcript.clone();

                if count_words(&raw_transcript) == 0 {
                    handle_empty_transcription(&app_handle, &saved_for_task.path);
                    return;
                }

                if is_cancelled() {
                    app_handle
                        .state::<AppState>()
                        .pill()
                        .safe_reset(&app_handle);
                    app_handle.state::<AppState>().set_pending_path(None);
                    return;
                }

                if pending_selected_text.is_some() && !llm_cleanup::is_llm_available(&settings) {
                    emit_transcription_error(
                        &app_handle,
                        "Edit mode requires a selected language model. Choose one in Settings -> Models."
                            .to_string(),
                        "edit_mode",
                        saved_for_task.path.display().to_string(),
                    );
                    app_handle.state::<AppState>().set_pending_path(None);
                    return;
                }

                let is_edit_mode = pending_selected_text.is_some();
                let llm_available = llm_cleanup::is_llm_available(&settings);
                let should_refine_transcript =
                    llm_cleanup::should_refine_transcript(&settings, active_mode.as_ref());
                let llm_needed = is_edit_mode || should_refine_transcript;
                let preflight_unavailable =
                    llm_needed && matches!(llm_cleanup::cached_preflight_available(), Some(false));
                let should_use_llm = if is_edit_mode {
                    llm_available && !preflight_unavailable
                } else {
                    should_refine_transcript && !preflight_unavailable
                };

                let (final_transcript, llm_cleaned) = if should_use_llm {
                    if let Some(ref selected) = pending_selected_text {
                        match llm_cleanup::edit_transcription(
                            &http,
                            selected,
                            &raw_transcript,
                            &settings,
                        )
                        .await
                        {
                            Ok(edited) => (edited, true),
                            Err(err) => {
                                eprintln!("LLM edit failed, keeping original selected text: {err}");
                                llm_cleanup::note_preflight_failure();
                                maybe_warn_llm_unavailable(&app_handle, true);
                                (selected.clone(), false)
                            }
                        }
                    } else {
                        match llm_cleanup::cleanup_transcription(
                            &http,
                            &raw_transcript,
                            &settings,
                            active_mode.as_ref(),
                        )
                        .await
                        {
                            Ok(cleaned) => (cleaned, true),
                            Err(err) => {
                                eprintln!("Cleanup failed, using raw transcript: {err}");
                                llm_cleanup::note_preflight_failure();
                                maybe_warn_llm_unavailable(&app_handle, false);
                                (raw_transcript.clone(), false)
                            }
                        }
                    }
                } else {
                    if preflight_unavailable {
                        maybe_warn_llm_unavailable(&app_handle, is_edit_mode);
                    }
                    (raw_transcript.clone(), false)
                };

                let final_transcript =
                    dictionary::apply_replacements(&final_transcript, &settings.replacements);

                if count_words(&final_transcript) == 0 {
                    handle_empty_transcription(&app_handle, &saved_for_task.path);
                    return;
                }

                if is_cancelled() {
                    app_handle
                        .state::<AppState>()
                        .pill()
                        .safe_reset(&app_handle);
                    app_handle.state::<AppState>().set_pending_path(None);
                    return;
                }

                let mut pasted = false;
                if auto_paste && !final_transcript.trim().is_empty() {
                    let text = final_transcript.clone();
                    match async_runtime::spawn_blocking(move || assistive::paste_text(&text)).await
                    {
                        Ok(Ok(())) => pasted = true,
                        Ok(Err(err)) => {
                            emit_auto_paste_error(&app_handle, format!("Auto paste failed: {err}"));
                        }
                        Err(err) => {
                            emit_auto_paste_error(
                                &app_handle,
                                format!("Auto paste task error: {err}"),
                            );
                        }
                    }
                }

                let metadata = build_transcription_metadata(TranscriptionMetadataInput {
                    saved: &saved_for_task,
                    settings: &settings,
                    final_text: &final_transcript,
                    llm_cleaned,
                    synced: false,
                    mode: active_mode.as_ref(),
                });

                emit_transcription_complete_with_cleanup(
                    &app_handle,
                    raw_transcript,
                    final_transcript,
                    pasted,
                    saved_for_task.path.display().to_string(),
                    llm_cleaned,
                    metadata,
                    "local",
                );

                app_handle
                    .state::<AppState>()
                    .pill()
                    .safe_reset(&app_handle);
                app_handle.state::<AppState>().set_pending_path(None);
            }
            Err(err) => {
                if is_cancelled() {
                    app_handle.state::<AppState>().set_pending_path(None);
                    return;
                }
                emit_transcription_error(
                    &app_handle,
                    format!("Transcription failed: {err}"),
                    "local",
                    saved_for_task.path.display().to_string(),
                );
                app_handle.state::<AppState>().set_pending_path(None);
            }
        }
    });
}

pub(crate) fn retry_transcription_async(
    app: &AppHandle<AppRuntime>,
    saved: RecordingSaved,
    settings: UserSettings,
    original_id: String,
    saved_mode: (Option<String>, Option<String>),
    cancel_token: CancellationToken,
) {
    let http = app.state::<AppState>().http();
    let app_handle = app.clone();
    let saved_for_task = saved.clone();
    let retry_id = original_id.clone();
    let (saved_mode_id, saved_mode_name) = saved_mode;

    // Look up the saved personality (if it still exists and is enabled)
    let saved_personality = saved_mode_id.as_ref().and_then(|id| {
        settings
            .personalities
            .iter()
            .find(|p| &p.id == id && p.enabled)
            .cloned()
    });

    async_runtime::spawn(async move {
        struct RetryTokenGuard {
            app: AppHandle<AppRuntime>,
            id: String,
        }

        impl Drop for RetryTokenGuard {
            fn drop(&mut self) {
                self.app
                    .state::<AppState>()
                    .clear_retry_transcription(&self.id);
            }
        }

        let _guard = RetryTokenGuard {
            app: app_handle.clone(),
            id: retry_id.clone(),
        };

        if cancel_token.is_cancelled() {
            return;
        }

        eprintln!(
            "[retry_transcription] mode={:?} local_only=true",
            settings.transcription_mode,
        );
        // Local transcription path
        let result = {
            match load_audio_for_transcription(&saved_for_task.path) {
                Ok((samples, sample_rate)) => {
                    let model_key = settings.local_model.clone();
                    match model_manager::ensure_model_ready(&app_handle, &model_key) {
                        Ok(ready_model) => {
                            let dictionary_terms =
                                dictionary::dictionary_entries_for_model(&ready_model, &settings);
                            let language = settings.language.clone();
                            let transcriber = app_handle.state::<AppState>().local_transcriber();
                            let is_whisper = matches!(
                                ready_model.engine,
                                model_manager::LocalModelEngine::Whisper
                            );
                            let cancel_token_clone = cancel_token.clone();
                            match async_runtime::spawn_blocking(move || {
                                if is_whisper {
                                    transcribe_local_chunked(
                                        &transcriber,
                                        &ready_model,
                                        &samples,
                                        sample_rate,
                                        LocalChunkingConfig {
                                            dictionary: &dictionary_terms,
                                            language: Some(&language),
                                            chunk_seconds: WHISPER_CHUNK_SECONDS,
                                            overlap_seconds: WHISPER_CHUNK_OVERLAP_SECONDS,
                                            cancel_token: Some(&cancel_token_clone),
                                            strip_hallucinated_thank_you: true,
                                        },
                                    )
                                } else {
                                    let speech_percent = speech_percentage_i16_with_mode(
                                        &samples,
                                        sample_rate,
                                        VadMode::VeryAggressive,
                                    );
                                    if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
                                        Ok(transcription_api::TranscriptionSuccess {
                                            transcript: String::new(),
                                            speech_model: None,
                                        })
                                    } else {
                                        transcriber.transcribe(
                                            &ready_model,
                                            &samples,
                                            sample_rate,
                                            &dictionary_terms,
                                            Some(&language),
                                        )
                                    }
                                }
                            })
                            .await
                            {
                                Ok(inner) => inner,
                                Err(err) => Err(anyhow!("Local transcription task failed: {err}")),
                            }
                        }
                        Err(err) => Err(err),
                    }
                }
                Err(err) => Err(err),
            }
        };

        match result {
            Ok(result) => {
                if cancel_token.is_cancelled() {
                    return;
                }
                let raw_transcript = result.transcript.clone();

                if count_words(&raw_transcript) == 0 {
                    handle_empty_transcription(&app_handle, &saved_for_task.path);
                    return;
                }

                let should_refine_transcript =
                    llm_cleanup::should_refine_transcript(&settings, saved_personality.as_ref());
                let preflight_unavailable = should_refine_transcript
                    && matches!(llm_cleanup::cached_preflight_available(), Some(false));
                let should_use_llm = should_refine_transcript && !preflight_unavailable;

                let (final_transcript, llm_cleaned) = if should_use_llm {
                    match llm_cleanup::cleanup_transcription(
                        &http,
                        &raw_transcript,
                        &settings,
                        saved_personality.as_ref(),
                    )
                    .await
                    {
                        Ok(cleaned) => (cleaned, true),
                        Err(err) => {
                            eprintln!("Cleanup failed during retry, using raw transcript: {err}");
                            llm_cleanup::note_preflight_failure();
                            maybe_warn_llm_unavailable(&app_handle, false);
                            (raw_transcript.clone(), false)
                        }
                    }
                } else {
                    if preflight_unavailable {
                        maybe_warn_llm_unavailable(&app_handle, false);
                    }
                    (raw_transcript.clone(), false)
                };

                let final_transcript =
                    dictionary::apply_replacements(&final_transcript, &settings.replacements);

                if count_words(&final_transcript) == 0 {
                    handle_empty_transcription(&app_handle, &saved_for_task.path);
                    return;
                }

                if cancel_token.is_cancelled() {
                    return;
                }

                let metadata = storage::TranscriptionMetadata {
                    speech_model: resolve_speech_model_label(&settings),
                    llm_model: if llm_cleaned {
                        llm_cleanup::resolved_model_name(&settings)
                    } else {
                        None
                    },
                    word_count: count_words(&final_transcript),
                    audio_duration_seconds: compute_audio_duration_seconds(&saved_for_task),
                    synced: false,
                    mode_id: saved_mode_id.clone(),
                    mode_name: saved_mode_name.clone(),
                };

                let raw_text = if llm_cleaned {
                    Some(raw_transcript.clone())
                } else {
                    None
                };

                eprintln!(
                    "[retry_transcription] Updating local record {}: text_len={} llm_cleaned={}",
                    retry_id,
                    final_transcript.len(),
                    llm_cleaned
                );

                let _ = app_handle
                    .state::<AppState>()
                    .storage()
                    .update_transcription_result(
                        &retry_id,
                        final_transcript.clone(),
                        raw_text,
                        storage::TranscriptionStatus::Success,
                        None,
                        metadata.clone(),
                    );

                analytics::track_transcription_completed(
                    &app_handle,
                    "local",
                    Some(&metadata.speech_model),
                    llm_cleaned,
                );
                app_handle
                    .state::<AppState>()
                    .record_transcription_completed();

                crate::emit_event(
                    &app_handle,
                    EVENT_TRANSCRIPTION_COMPLETE,
                    TranscriptionCompletePayload {
                        transcript: final_transcript,
                        auto_paste: false,
                    },
                );
            }
            Err(err) => {
                if cancel_token.is_cancelled() {
                    return;
                }
                emit_transcription_error(
                    &app_handle,
                    format!("Transcription failed: {err}"),
                    "local",
                    saved_for_task.path.display().to_string(),
                );
            }
        }
    });
}

fn emit_transcription_complete_with_cleanup(
    app: &AppHandle<AppRuntime>,
    raw_transcript: String,
    final_transcript: String,
    auto_paste: bool,
    audio_path: String,
    llm_cleaned: bool,
    metadata: storage::TranscriptionMetadata,
    mode: &str,
) {
    analytics::track_transcription_completed(app, mode, Some(&metadata.speech_model), llm_cleaned);
    app.state::<AppState>().record_transcription_completed();

    crate::emit_event(
        app,
        EVENT_TRANSCRIPTION_COMPLETE,
        TranscriptionCompletePayload {
            transcript: final_transcript.clone(),
            auto_paste,
        },
    );

    app.state::<AppState>().pill().safe_reset(app);

    if llm_cleaned {
        let _ = app
            .state::<AppState>()
            .storage()
            .save_transcription_with_cleanup(
                raw_transcript,
                final_transcript,
                audio_path,
                metadata,
                None,
            );
    } else {
        let _ = app.state::<AppState>().storage().save_transcription(
            final_transcript,
            audio_path,
            storage::TranscriptionStatus::Success,
            None,
            metadata,
            None,
        );
    }

    let settings = app.state::<AppState>().current_settings();
    if let Err(err) = crate::tray::refresh_tray_menu(app, &settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::set_app_menu(app, &settings) {
        eprintln!("Failed to refresh app menu: {err}");
    }

    crate::schedule_recording_prune(app.clone(), settings);

    let update_state = app.state::<AppState>().update_state().clone();
    update_checker::maybe_show_update_toast(app, &update_state);
}

fn handle_empty_transcription(app: &AppHandle<AppRuntime>, audio_path: &Path) {
    crate::emit_event(
        app,
        EVENT_TRANSCRIPTION_COMPLETE,
        TranscriptionCompletePayload {
            transcript: String::new(),
            auto_paste: false,
        },
    );

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "warning".to_string(),
            title: None,
            message: "No words detected. Recording deleted.".to_string(),
            auto_dismiss: Some(true),
            duration: Some(3000),
            retry_id: None,
            mode: None,
            action: None,
            action_label: None,
        },
    );

    if audio_path.exists() {
        if let Err(err) = std::fs::remove_file(audio_path) {
            eprintln!(
                "Failed to remove empty transcription audio {}: {err}",
                audio_path.display()
            );
        }
    }

    crate::schedule_recording_prune(app.clone(), app.state::<AppState>().current_settings());

    app.state::<AppState>().pill().safe_reset(app);
    app.state::<AppState>().set_pending_path(None);
}

pub(crate) fn emit_transcription_error(
    app: &AppHandle<AppRuntime>,
    message: String,
    stage: &str,
    audio_path: String,
) {
    emit_transcription_error_inner(app, message, stage, audio_path, true);
}

fn emit_auto_paste_error(app: &AppHandle<AppRuntime>, message: String) {
    analytics::track_transcription_failed(app, "auto_paste", "paste_error");

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "error".to_string(),
            title: None,
            message,
            auto_dismiss: Some(true),
            duration: Some(3000),
            retry_id: None,
            mode: Some("local".into()),
            action: None,
            action_label: None,
        },
    );
}

fn emit_transcription_error_inner(
    app: &AppHandle<AppRuntime>,
    message: String,
    stage: &str,
    audio_path: String,
    reset_state: bool,
) {
    let reason = if message.contains("No speech") || message.contains("empty") {
        "no_speech"
    } else if message.contains("Model") || message.contains("model") {
        "model_error"
    } else {
        "api_error"
    };
    analytics::track_transcription_failed(app, stage, reason);

    crate::emit_event(
        app,
        EVENT_TRANSCRIPTION_ERROR,
        TranscriptionErrorPayload {
            message: message.clone(),
            stage: stage.to_string(),
        },
    );

    let state = app.state::<AppState>();
    let settings = state.current_settings();

    let toast_message = format_transcription_error(&message);
    let metadata = storage::TranscriptionMetadata {
        speech_model: resolve_speech_model_label(&settings),
        ..Default::default()
    };

    let record_result = state.storage().save_transcription(
        String::new(),
        audio_path.clone(),
        storage::TranscriptionStatus::Error,
        Some(toast_message.clone()),
        metadata,
        None,
    );

    if let Err(err) = record_result {
        eprintln!("Failed to persist failed transcription: {err}");
    }

    if state.pill().status() == crate::pill::PillStatus::Listening {
        return;
    }

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "error".to_string(),
            title: None,
            message: toast_message,
            auto_dismiss: None,
            duration: None,
            retry_id: None,
            mode: Some("local".into()),
            action: None,
            action_label: None,
        },
    );

    crate::schedule_recording_prune(app.clone(), settings);

    if reset_state {
        state.pill().reset(app);
    }
}

fn format_transcription_error(message: &str) -> String {
    let msg_lower = message.to_lowercase();

    if msg_lower.contains("not fully installed") || msg_lower.contains("missing:") {
        return "No transcription model installed".to_string();
    }
    if msg_lower.contains("model not found") || msg_lower.contains("no model") {
        return "No transcription model selected".to_string();
    }

    if msg_lower.contains("microphone") || msg_lower.contains("audio input") {
        return "Microphone error".to_string();
    }
    if msg_lower.contains("permission") {
        return "Permission denied".to_string();
    }
    if msg_lower.contains("auto paste") {
        return "Pasted to clipboard instead".to_string();
    }

    "Transcription failed".to_string()
}

struct TranscriptionMetadataInput<'a> {
    saved: &'a RecordingSaved,
    settings: &'a UserSettings,
    final_text: &'a str,
    llm_cleaned: bool,
    synced: bool,
    mode: Option<&'a Personality>,
}

fn build_transcription_metadata(
    input: TranscriptionMetadataInput<'_>,
) -> storage::TranscriptionMetadata {
    let TranscriptionMetadataInput {
        saved,
        settings,
        final_text,
        llm_cleaned,
        synced,
        mode,
    } = input;

    storage::TranscriptionMetadata {
        speech_model: resolve_speech_model_label(settings),
        llm_model: if llm_cleaned {
            llm_cleanup::resolved_model_name(settings)
        } else {
            None
        },
        word_count: count_words(final_text),
        audio_duration_seconds: compute_audio_duration_seconds(saved),
        synced,
        mode_id: mode.map(|m| m.id.clone()),
        mode_name: mode.map(|m| m.name.clone()),
    }
}

fn resolve_speech_model_label(settings: &UserSettings) -> String {
    model_manager::definition(&settings.local_model)
        .map(|def| def.label.to_string())
        .unwrap_or_else(|| settings.local_model.clone())
}

fn compute_audio_duration_seconds(saved: &RecordingSaved) -> f32 {
    if let Some(override_duration) = saved.duration_override_seconds {
        return override_duration;
    }
    let duration_ms = (saved.ended_at - saved.started_at).num_milliseconds();
    (duration_ms.max(0) as f32) / 1000.0
}

pub(crate) fn count_words(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

pub(crate) fn load_audio_for_transcription(path: &PathBuf) -> Result<(Vec<i16>, u32)> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext != "wav" {
        return Err(anyhow!("Unsupported audio format: {ext}"));
    }

    decode_wav(path)
}

fn decode_wav(path: &PathBuf) -> Result<(Vec<i16>, u32)> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open WAV file at {}", path.display()))?;
    let mut reader = hound::WavReader::new(file).map_err(|err| anyhow!("WAV read error: {err}"))?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int {
        return Err(anyhow!("Unsupported WAV sample format"));
    }
    if spec.bits_per_sample != 16 {
        return Err(anyhow!(
            "Unsupported WAV bits per sample: {}",
            spec.bits_per_sample
        ));
    }

    let mut samples = Vec::new();
    for sample in reader.samples::<i16>() {
        let sample = sample.map_err(|err| anyhow!("WAV read error: {err}"))?;
        samples.push(sample);
    }

    let samples = if spec.channels <= 1 {
        samples
    } else {
        downmix_interleaved(&samples, spec.channels as usize)
    };

    if samples.is_empty() {
        return Err(anyhow!("No audio data decoded from WAV file"));
    }

    Ok((samples, spec.sample_rate))
}

fn downmix_interleaved(samples: &[i16], channels: usize) -> Vec<i16> {
    crate::recorder::downmix_to_mono(samples, channels)
}

struct LocalChunkingConfig<'a> {
    dictionary: &'a [String],
    language: Option<&'a str>,
    chunk_seconds: f32,
    overlap_seconds: f32,
    cancel_token: Option<&'a CancellationToken>,
    strip_hallucinated_thank_you: bool,
}

fn transcribe_local_chunked(
    transcriber: &crate::local_transcription::LocalTranscriber,
    model: &model_manager::ReadyModel,
    samples: &[i16],
    sample_rate: u32,
    config: LocalChunkingConfig<'_>,
) -> Result<transcription_api::TranscriptionSuccess> {
    let LocalChunkingConfig {
        dictionary,
        language,
        chunk_seconds,
        overlap_seconds,
        cancel_token,
        strip_hallucinated_thank_you,
    } = config;

    if samples.is_empty() {
        return Err(anyhow!("No audio samples provided"));
    }

    let speech_percent =
        speech_percentage_i16_with_mode(samples, sample_rate, VadMode::VeryAggressive);
    if speech_percent < VAD_MIN_SPEECH_PERCENT_FILE {
        return Ok(transcription_api::TranscriptionSuccess {
            transcript: String::new(),
            speech_model: None,
        });
    }

    let chunk_samples = ((sample_rate.max(1) as f32) * chunk_seconds).round() as usize;
    let chunk_samples = chunk_samples.max(1);
    let overlap_samples = ((sample_rate.max(1) as f32) * overlap_seconds).round() as usize;
    let overlap_samples = overlap_samples.min(chunk_samples.saturating_sub(1));
    let step = chunk_samples.saturating_sub(overlap_samples).max(1);

    let mut full_text = String::new();
    let mut start = 0usize;
    let mut model_label = None;

    while start < samples.len() {
        if let Some(token) = cancel_token {
            if token.is_cancelled() {
                return Err(anyhow!("Transcription cancelled"));
            }
        }
        let end = (start + chunk_samples).min(samples.len());
        let chunk = &samples[start..end];
        let chunk_speech_percent =
            speech_percentage_i16_with_mode(chunk, sample_rate, VadMode::VeryAggressive);
        let min_chunk_threshold = if end == samples.len() {
            VAD_MIN_SPEECH_PERCENT_FILE
        } else {
            VAD_MIN_SPEECH_PERCENT_CHUNK
        };
        if chunk_speech_percent < min_chunk_threshold {
            start += step;
            continue;
        }
        let result = transcriber.transcribe(model, chunk, sample_rate, dictionary, language)?;
        if model_label.is_none() {
            model_label = result.speech_model.clone();
        }

        let chunk_text = result.transcript;
        if !chunk_text.trim().is_empty() {
            let deduped = dedupe_overlap_text(&full_text, &chunk_text);
            if !deduped.trim().is_empty() {
                append_deduped_chunk(&mut full_text, &deduped);
            }
        }

        if end == samples.len() {
            break;
        }
        start += step;
    }

    let transcript = if strip_hallucinated_thank_you {
        transcription_api::strip_hallucinated_thank_you(full_text.trim())
    } else {
        full_text.trim().to_string()
    };

    Ok(transcription_api::TranscriptionSuccess {
        transcript,
        speech_model: model_label,
    })
}

const MIN_OVERLAP_TOKENS: usize = 3;
const MAX_OVERLAP_TOKENS: usize = 30;

#[derive(Debug, Clone)]
struct TokenOffset {
    norm: String,
    start: usize,
}

pub(crate) fn dedupe_overlap_text(existing: &str, next: &str) -> String {
    let existing_trim = existing.trim_end();
    let next_trim = next.trim();
    if existing_trim.is_empty() {
        return next_trim.to_string();
    }

    if let Some(drop_index) = find_overlap_drop_index(existing_trim, next) {
        if drop_index >= next.len() {
            return String::new();
        }
        return next[drop_index..].trim_start().to_string();
    }

    let existing_tail = last_chars(existing_trim, 120);
    if !existing_tail.is_empty() && next_trim.starts_with(&existing_tail) {
        return next_trim[existing_tail.len()..].trim_start().to_string();
    }

    next_trim.to_string()
}

pub(crate) fn append_deduped_chunk(existing: &mut String, next: &str) {
    let trimmed = next.trim();
    if trimmed.is_empty() {
        return;
    }

    if existing.is_empty() {
        existing.push_str(trimmed);
        return;
    }

    existing.push(' ');
    existing.push_str(trimmed);
}

fn maybe_warn_llm_unavailable(app: &AppHandle<AppRuntime>, is_edit_mode: bool) {
    if !llm_cleanup::should_show_unavailable_notice() {
        return;
    }

    if is_edit_mode {
        toast::emit_toast(
            app,
            toast::Payload {
                toast_type: "error".to_string(),
                title: Some("Edit Mode".to_string()),
                message: "Language model unreachable. Edit mode won't run.".to_string(),
                auto_dismiss: Some(true),
                duration: Some(10_000),
                retry_id: None,
                mode: None,
                action: Some("open_llm_cleanup_settings".to_string()),
                action_label: Some("Open Settings".to_string()),
            },
        );
    } else {
        toast::show_with_action(
            app,
            "warning",
            Some("Language Model"),
            "Language model unreachable. Transcript refinement was skipped.",
            "open_llm_cleanup_settings",
            "Open Settings",
        );
    }
}

fn find_overlap_drop_index(existing: &str, next: &str) -> Option<usize> {
    let existing_tokens = tokenize_with_offsets(existing);
    let next_tokens = tokenize_with_offsets(next);
    if existing_tokens.is_empty() || next_tokens.is_empty() {
        return None;
    }

    let max_overlap = existing_tokens
        .len()
        .min(next_tokens.len())
        .min(MAX_OVERLAP_TOKENS);
    if max_overlap < MIN_OVERLAP_TOKENS {
        return None;
    }

    for overlap in (MIN_OVERLAP_TOKENS..=max_overlap).rev() {
        let start_existing = existing_tokens.len() - overlap;
        let mut matches = true;
        for idx in 0..overlap {
            if existing_tokens[start_existing + idx].norm != next_tokens[idx].norm {
                matches = false;
                break;
            }
        }
        if matches {
            if overlap >= next_tokens.len() {
                return Some(next.len());
            }
            return Some(next_tokens[overlap].start);
        }
    }

    None
}

fn tokenize_with_offsets(text: &str) -> Vec<TokenOffset> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut current_start = 0usize;
    let mut in_token = false;

    for (idx, ch) in text.char_indices() {
        if ch.is_alphanumeric() {
            if !in_token {
                in_token = true;
                current_start = idx;
                current.clear();
            }
            for lower in ch.to_lowercase() {
                current.push(lower);
            }
        } else if in_token {
            tokens.push(TokenOffset {
                norm: current.clone(),
                start: current_start,
            });
            in_token = false;
        }
    }

    if in_token {
        tokens.push(TokenOffset {
            norm: current,
            start: current_start,
        });
    }

    tokens
}

fn last_chars(value: &str, count: usize) -> String {
    let mut chars: Vec<char> = value.chars().collect();
    if chars.len() <= count {
        return value.to_string();
    }
    chars.drain(0..chars.len() - count);
    chars.into_iter().collect()
}

pub(crate) fn finalize_streaming_transcription(
    app: &AppHandle<AppRuntime>,
    raw_transcript: String,
    duration_seconds: f32,
) {
    let state = app.state::<AppState>();
    state.clear_cancellation();
    let pending_selected_text = state.take_pending_selected_text();
    let http = state.http();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let is_cancelled = || app_handle.state::<AppState>().is_cancelled();
        let settings = app_handle.state::<AppState>().current_settings();
        let auto_paste = transcription_api::auto_paste_enabled();
        let active_mode = mode_context::resolve_active_personality(&settings);
        let raw_transcript = transcription_api::normalize_transcript(&raw_transcript);

        if count_words(&raw_transcript) == 0 {
            crate::pill::collapse_expanded_pill(&app_handle);
            app_handle
                .state::<AppState>()
                .pill()
                .safe_reset(&app_handle);
            return;
        }

        if is_cancelled() {
            return;
        }

        let is_edit_mode = pending_selected_text.is_some();
        let llm_available = llm_cleanup::is_llm_available(&settings);
        let should_refine_transcript =
            llm_cleanup::should_refine_transcript(&settings, active_mode.as_ref());
        let llm_needed = is_edit_mode || should_refine_transcript;
        let preflight_unavailable =
            llm_needed && matches!(llm_cleanup::cached_preflight_available(), Some(false));
        let should_use_llm = if is_edit_mode {
            llm_available && !preflight_unavailable
        } else {
            should_refine_transcript && !preflight_unavailable
        };

        let (final_transcript, llm_cleaned) = if should_use_llm {
            if let Some(ref selected) = pending_selected_text {
                match llm_cleanup::edit_transcription(&http, selected, &raw_transcript, &settings)
                    .await
                {
                    Ok(edited) => (edited, true),
                    Err(err) => {
                        eprintln!("LLM edit failed (streaming): {err}");
                        llm_cleanup::note_preflight_failure();
                        maybe_warn_llm_unavailable(&app_handle, true);
                        (selected.clone(), false)
                    }
                }
            } else {
                match llm_cleanup::cleanup_transcription(
                    &http,
                    &raw_transcript,
                    &settings,
                    active_mode.as_ref(),
                )
                .await
                {
                    Ok(cleaned) => (cleaned, true),
                    Err(err) => {
                        eprintln!("Cleanup failed (streaming): {err}");
                        llm_cleanup::note_preflight_failure();
                        maybe_warn_llm_unavailable(&app_handle, false);
                        (raw_transcript.clone(), false)
                    }
                }
            }
        } else {
            if preflight_unavailable {
                maybe_warn_llm_unavailable(&app_handle, is_edit_mode);
            }
            (raw_transcript.clone(), false)
        };

        let final_transcript =
            dictionary::apply_replacements(&final_transcript, &settings.replacements);

        if count_words(&final_transcript) == 0 {
            crate::pill::collapse_expanded_pill(&app_handle);
            app_handle
                .state::<AppState>()
                .pill()
                .safe_reset(&app_handle);
            return;
        }

        if is_cancelled() {
            return;
        }

        let mut pasted = false;
        if auto_paste && !final_transcript.trim().is_empty() {
            let text = final_transcript.clone();
            match tauri::async_runtime::spawn_blocking(move || assistive::paste_text(&text)).await {
                Ok(Ok(())) => pasted = true,
                Ok(Err(err)) => eprintln!("Auto paste failed (streaming): {err}"),
                Err(err) => eprintln!("Auto paste task error (streaming): {err}"),
            }
        }

        if is_cancelled() {
            return;
        }

        let metadata = storage::TranscriptionMetadata {
            speech_model: resolve_speech_model_label(&settings),
            llm_model: if llm_cleaned {
                llm_cleanup::resolved_model_name(&settings)
            } else {
                None
            },
            word_count: count_words(&final_transcript),
            audio_duration_seconds: duration_seconds,
            synced: false,
            mode_id: active_mode.as_ref().map(|m| m.id.clone()),
            mode_name: active_mode.as_ref().map(|m| m.name.clone()),
        };

        crate::pill::collapse_expanded_pill(&app_handle);
        emit_transcription_complete_with_cleanup(
            &app_handle,
            raw_transcript,
            final_transcript,
            pasted,
            String::new(),
            llm_cleaned,
            metadata,
            "local_streaming",
        );
    });
}
