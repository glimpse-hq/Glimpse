//! Transcribes a dictation in pieces at the speaker's pauses while they are
//! still talking, so only the audio after the last pause is left at release.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::Result;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::local_transcription::LocalTranscriber;
use crate::recorder::{self, LiveBufferState};
use crate::settings::UserSettings;
use crate::speech::catalog::{self, Languages};
use crate::transcription_api::TranscriptionSuccess;
use crate::{AppRuntime, AppState, model_manager::ReadyModel};

const POLL_INTERVAL: Duration = Duration::from_millis(100);
// In benchmarks, 8 s pieces at 0.8 s pauses kept whole-recording accuracy and
// punctuation; shorter pieces or pauses split sentences.
const MIN_PIECE_MS: usize = 8_000;
const PAUSE_MS: usize = 800;
// Audio scanned again on the next poll, so a pause spanning two polls is seen whole.
const RESCAN_MS: usize = 1_500;
const VAD_FRAME: usize = 320;

/// Parakeet TDT models only: Whisper pads every call to 30 s, and streaming
/// models already transcribe live.
pub fn supports(model_key: &str) -> bool {
    catalog::definition(model_key).is_some_and(|model| model.languages == Languages::ParakeetV3)
}

pub struct PieceSession {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<Option<Progress>>>,
    live: LiveBufferState,
    model_key: String,
}

#[derive(Default)]
struct Progress {
    text: String,
    language: Option<String>,
    /// Capture frames transcribed so far.
    done: usize,
}

/// The pieces of a stopped dictation and the processed audio after them.
pub struct Pieces {
    text: String,
    language: Option<String>,
    tail: Vec<i16>,
}

impl PieceSession {
    pub fn start(
        app: &AppHandle<AppRuntime>,
        model: ReadyModel,
        settings: &UserSettings,
    ) -> Option<Self> {
        let state = app.state::<AppState>();
        let live = state.pill().recorder().live_buffer()?;
        let transcriber = state.local_transcriber();
        let dictionary = crate::dictionary::dictionary_entries_for_model(&model, settings);
        let language = settings.language.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let model_key = model.key.clone();

        let thread_stop = Arc::clone(&stop);
        let thread_live = live.clone();
        let app = app.clone();
        let handle = std::thread::Builder::new()
            .name("dictation-pieces".into())
            .spawn(move || {
                let recording = || {
                    !thread_stop.load(Ordering::Relaxed)
                        && app
                            .state::<AppState>()
                            .pill()
                            .recorder()
                            .live_buffer()
                            .is_some_and(|now| Arc::ptr_eq(&now.buffer, &thread_live.buffer))
                };
                // A piece never waits behind a Library job or swaps models; its audio
                // goes with the next piece instead.
                let idle = || {
                    !transcriber.is_busy()
                        && transcriber.loaded_model_id().as_deref() == Some(model.key.as_str())
                };
                run(&thread_live, recording, idle, |samples| {
                    transcriber.try_transcribe_loaded(
                        &model,
                        samples,
                        16_000,
                        &dictionary,
                        Some(&language),
                    )
                })
            })
            .ok()?;

        Some(Self {
            stop,
            handle: Some(handle),
            live,
            model_key,
        })
    }

    pub fn model_key(&self) -> &str {
        &self.model_key
    }

    /// Call after the recorder stopped, so the buffer holds every sample.
    pub fn finish(mut self) -> Option<Pieces> {
        let handle = self.handle.take()?;
        self.stop.store(true, Ordering::Relaxed);
        handle.thread().unpark();
        let progress = handle.join().ok()??;
        if progress.done == 0 {
            return None;
        }
        let channels = self.live.channels.max(1) as usize;
        let tail = {
            let buffer = self.live.buffer.lock();
            let from = (progress.done * channels).min(buffer.len());
            recorder::prepare_samples(&buffer[from..], self.live.sample_rate, self.live.channels)
        };
        Some(Pieces {
            text: progress.text,
            language: progress.language,
            tail,
        })
    }
}

impl Drop for PieceSession {
    fn drop(&mut self) {
        // The worker ends after its current piece; nothing waits for it.
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = &self.handle {
            handle.thread().unpark();
        }
    }
}

impl Pieces {
    /// Transcribes the audio after the last pause and adds it to the pieces.
    pub fn complete(
        self,
        transcriber: &LocalTranscriber,
        model: &ReadyModel,
        dictionary: &[String],
        language: &str,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<TranscriptionSuccess> {
        let mut transcript = self.text;
        let mut detected = self.language;
        if !self.tail.is_empty() {
            let tail = crate::transcribe::transcribe_parakeet(
                transcriber,
                model,
                &self.tail,
                dictionary,
                language,
                cancel_token,
            )?;
            crate::transcribe::append_deduped_chunk(&mut transcript, &tail.transcript);
            detected = detected.or(tail.language);
        }
        Ok(TranscriptionSuccess {
            transcript,
            speech_model: Some(catalog::model_label(&model.key)),
            segments: None,
            words: None,
            language: detected,
        })
    }
}

fn run(
    live: &LiveBufferState,
    recording: impl Fn() -> bool,
    idle: impl Fn() -> bool,
    mut transcribe: impl FnMut(&[i16]) -> Option<Result<TranscriptionSuccess>>,
) -> Option<Progress> {
    let rate = live.sample_rate as usize;
    let channels = live.channels.max(1) as usize;
    let min_piece = rate * MIN_PIECE_MS / 1000;
    // Longer audio is left for release, which transcribes it in chunks.
    let max_piece = rate * crate::speech::PARAKEET_CHUNK_SECONDS as usize;
    let mut progress = Progress::default();
    let mut scanned = 0usize;
    loop {
        std::thread::park_timeout(POLL_INTERVAL);
        if !recording() {
            break;
        }
        if !idle() {
            continue;
        }
        let (start, window) = {
            let buffer = live.buffer.lock();
            let frames = buffer.len() / channels;
            if frames < progress.done + min_piece {
                continue;
            }
            let start = progress
                .done
                .max(scanned.saturating_sub(rate * RESCAN_MS / 1000));
            scanned = frames;
            (
                start,
                mono(&buffer[start * channels..frames * channels], channels),
            )
        };
        let from = (progress.done + min_piece).saturating_sub(start);
        let Some(cut) = find_pause(&window, live.sample_rate, from)
            .map(|at| start + at)
            .filter(|&cut| cut - progress.done <= max_piece)
        else {
            continue;
        };
        let raw = live.buffer.lock()[progress.done * channels..cut * channels].to_vec();
        let samples = recorder::prepare_samples(&raw, live.sample_rate, live.channels);
        if recorder::speech_percentage(&samples, 16_000)
            < crate::speech::VAD_MIN_SPEECH_PERCENT_FILE
        {
            progress.done = cut;
            continue;
        }
        match transcribe(&samples) {
            None => continue,
            Some(Ok(piece)) => {
                if progress.language.is_none() {
                    progress.language = piece.language;
                }
                crate::transcribe::append_deduped_chunk(&mut progress.text, &piece.transcript);
                progress.done = cut;
            }
            Some(Err(err)) => {
                tracing::warn!("[pieces] piece failed, transcribing the whole recording: {err:#}");
                return None;
            }
        }
    }
    Some(progress)
}

/// The middle of the first pause of at least `PAUSE_MS` whose middle is at or
/// after sample `from` of `samples` (mono, any rate).
fn find_pause(samples: &[i16], sample_rate: u32, from: usize) -> Option<usize> {
    let speech = glimpse_speech::vad::analyze(samples, sample_rate)?;
    let need = PAUSE_MS * 16 / VAD_FRAME;
    let mut run = 0;
    for (index, voiced) in speech.frames(VAD_FRAME).into_iter().enumerate() {
        run = if voiced { 0 } else { run + 1 };
        let cut = (index + 1 - run / 2) * VAD_FRAME * sample_rate as usize / 16_000;
        if run >= need && cut >= from {
            return Some(cut);
        }
    }
    None
}

fn mono(raw: &[i16], channels: usize) -> Vec<i16> {
    if channels == 1 {
        return raw.to_vec();
    }
    raw.chunks_exact(channels)
        .map(|frame| (frame.iter().map(|&s| i32::from(s)).sum::<i32>() / channels as i32) as i16)
        .collect()
}
