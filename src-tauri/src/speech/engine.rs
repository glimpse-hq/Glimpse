use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use glimpse_speech::service::{AudioInput, SpeechConfig, SpeechService, TranscribeRequest};
use glimpse_speech::TimestampGranularity;
use parking_lot::{Condvar, Mutex};

use crate::{
    model_manager::{self, ReadyModel},
    transcription_api::{normalize_transcript, TranscriptionSuccess},
};

const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct LocalTranscriber {
    service: SpeechService,
    last_used: Mutex<Option<Instant>>,
    idle_wait: Condvar,
}

impl LocalTranscriber {
    pub fn new(model_cache_dir: std::path::PathBuf) -> Self {
        Self {
            service: SpeechService::new(SpeechConfig { model_cache_dir }),
            last_used: Mutex::new(None),
            idle_wait: Condvar::new(),
        }
    }

    pub fn start_idle_monitor(self: &Arc<Self>) {
        let transcriber = Arc::clone(self);
        std::thread::spawn(move || {
            let mut last_used = transcriber.last_used.lock();

            loop {
                while last_used.is_none() {
                    transcriber.idle_wait.wait(&mut last_used);
                }

                let Some(last_seen) = *last_used else {
                    continue;
                };
                let wait_for = IDLE_TIMEOUT.saturating_sub(last_seen.elapsed());

                if wait_for.is_zero() {
                    drop(last_used);
                    transcriber.check_idle_unload();
                    last_used = transcriber.last_used.lock();
                    continue;
                }

                transcriber.idle_wait.wait_for(&mut last_used, wait_for);
            }
        });
    }

    fn check_idle_unload(&self) {
        if !self.service.is_loaded() {
            return;
        }

        let should_unload = self
            .last_used
            .lock()
            .map(|last| last.elapsed() >= IDLE_TIMEOUT)
            .unwrap_or(false);

        if should_unload {
            eprintln!(
                "[LocalTranscriber] Unloading model after {} seconds of inactivity",
                IDLE_TIMEOUT.as_secs()
            );
            self.unload();
        }
    }

    fn touch(&self) {
        let mut last_used = self.last_used.lock();
        *last_used = Some(Instant::now());
        self.idle_wait.notify_one();
    }

    pub fn preload_and_warm(&self, model: &ReadyModel) -> Result<()> {
        self.service.preload_and_warm(&model.key)?;
        self.touch();
        Ok(())
    }

    pub fn transcribe(
        &self,
        model: &ReadyModel,
        samples: &[i16],
        sample_rate: u32,
        dictionary: &[String],
        language: Option<&str>,
    ) -> Result<TranscriptionSuccess> {
        let result =
            self.transcribe_internal(model, samples, sample_rate, dictionary, language, false)?;

        Ok(TranscriptionSuccess {
            transcript: normalize_transcript(&result.text),
            speech_model: Some(model_manager::model_label(&model.key)),
            segments: None,
            words: None,
        })
    }

    pub fn transcribe_with_segments(
        &self,
        model: &ReadyModel,
        samples: &[i16],
        sample_rate: u32,
        dictionary: &[String],
        language: Option<&str>,
    ) -> Result<TranscriptionSuccess> {
        let result =
            self.transcribe_internal(model, samples, sample_rate, dictionary, language, true)?;

        Ok(TranscriptionSuccess {
            transcript: normalize_transcript(&result.text),
            speech_model: Some(model_manager::model_label(&model.key)),
            segments: result.segments,
            words: None,
        })
    }

    fn transcribe_internal(
        &self,
        model: &ReadyModel,
        samples: &[i16],
        sample_rate: u32,
        dictionary: &[String],
        language: Option<&str>,
        with_segments: bool,
    ) -> Result<glimpse_speech::Transcription> {
        let response = self.service.transcribe(TranscribeRequest {
            audio: AudioInput::PcmI16 {
                samples: samples.to_vec(),
                sample_rate,
            },
            model_id: model.key.clone(),
            language: language.map(str::to_string),
            prompt: None,
            dictionary: dictionary.to_vec(),
            timestamps: with_segments,
            timestamp_granularity: with_segments.then_some(TimestampGranularity::Segment),
        })?;
        self.touch();
        Ok(response)
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_transcribe_chunk(&self, model: &ReadyModel, chunk: &[f32]) -> Result<String> {
        let transcript = self.service.streaming_transcribe_chunk(&model.key, chunk)?;
        self.touch();
        Ok(transcript)
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_reset(&self) {
        self.service.streaming_reset();
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_get_transcript(&self) -> String {
        self.service.streaming_get_transcript()
    }

    pub fn unload(&self) {
        self.service.unload();
        let mut last_used = self.last_used.lock();
        *last_used = None;
        self.idle_wait.notify_one();
    }

    pub fn loaded_model_id(&self) -> Option<String> {
        self.service.loaded_model_id()
    }
}
