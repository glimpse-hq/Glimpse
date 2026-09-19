use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use glimpse_speech::TimestampGranularity;
use glimpse_speech::service::{AudioInput, SpeechConfig, SpeechService, TranscribeRequest};
use parking_lot::{Condvar, Mutex};

use crate::{
    analytics::{self, Activity},
    model_manager::{self, ReadyModel},
    transcription_api::{TranscriptionSuccess, normalize_transcript},
};

const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct LocalTranscriber {
    service: SpeechService,
    last_used: Mutex<Option<Instant>>,
    idle_wait: Condvar,
    warm_in_flight: Mutex<Option<String>>,
    // Held for the duration of a live dictation session so batch transcriptions
    // (library, non-streaming dictation) can't interleave on the shared model
    // runtime and clobber the streaming transcript buffer.
    exclusive: Mutex<()>,
}

impl LocalTranscriber {
    pub fn new(model_cache_dir: std::path::PathBuf) -> Self {
        Self {
            service: SpeechService::new(SpeechConfig {
                resolver: crate::model_manager::local_resolver(model_cache_dir.clone()),
                model_cache_dir,
            }),
            last_used: Mutex::new(None),
            idle_wait: Condvar::new(),
            warm_in_flight: Mutex::new(None),
            exclusive: Mutex::new(()),
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
            tracing::info!(
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
        let _exclusive = self.exclusive.lock();
        self.warm_locked(model)
    }

    // Caller must hold `exclusive` (directly or via a streaming session).
    fn warm_locked(&self, model: &ReadyModel) -> Result<()> {
        let was_loaded = self.service.is_loaded();
        let started = Instant::now();
        let previous_activity = analytics::activity();
        if !was_loaded {
            analytics::set_activity(Activity::ModelLoading);
        }
        let result = self.service.preload_and_warm(&model.key);
        // A dictation step that started meanwhile keeps its own activity.
        if analytics::activity() == Activity::ModelLoading {
            analytics::set_activity(previous_activity);
        }
        result?;
        tracing::info!(
            "[LocalTranscriber] warm {} took {:.2}s (was_loaded={})",
            model.key,
            started.elapsed().as_secs_f32(),
            was_loaded
        );
        self.touch();
        Ok(())
    }

    pub fn preload_and_warm_if_needed(&self, model: &ReadyModel) -> Result<()> {
        if self.loaded_model_id().as_deref() == Some(model.key.as_str()) {
            tracing::debug!(
                "[LocalTranscriber] warm {} skipped (already loaded)",
                model.key
            );
            return Ok(());
        }

        {
            let mut warm_in_flight = self.warm_in_flight.lock();
            if warm_in_flight.is_some() {
                tracing::debug!(
                    "[LocalTranscriber] warm {} skipped (warm already in flight for {})",
                    model.key,
                    warm_in_flight.as_deref().unwrap_or("unknown")
                );
                return Ok(());
            }
            *warm_in_flight = Some(model.key.clone());
        }

        let result = self.preload_and_warm(model);
        let mut warm_in_flight = self.warm_in_flight.lock();
        if warm_in_flight.as_deref() == Some(model.key.as_str()) {
            *warm_in_flight = None;
        }
        result
    }

    pub fn loaded_model_id(&self) -> Option<String> {
        self.service.loaded_model_id()
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
            language: result.language,
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
            words: result.words,
            language: result.language,
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
        let _exclusive = self.exclusive.lock();
        let was_loaded = self.service.is_loaded();
        let started = Instant::now();
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
            timestamp_granularity: with_segments.then_some(TimestampGranularity::Word),
        })?;
        tracing::info!(
            "[LocalTranscriber] transcribe took {:.2}s (audio {:.2}s, was_loaded={})",
            started.elapsed().as_secs_f32(),
            response.duration_ms as f32 / 1000.0,
            was_loaded
        );
        self.touch();
        Ok(response)
    }

    // Take exclusive use of the transcriber for a live dictation session. Batch
    // transcriptions block until the returned guard drops, so the shared
    // streaming transcript buffer can't be overwritten mid-session.
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn begin_streaming_session(&self) -> StreamingGuard<'_> {
        StreamingGuard {
            _exclusive: self.exclusive.lock(),
            transcriber: self,
        }
    }

    pub fn unload(&self) {
        let _exclusive = self.exclusive.lock();
        self.service.unload();
        let mut last_used = self.last_used.lock();
        *last_used = None;
        self.idle_wait.notify_one();
    }

    /// Shutdown variant that never waits. A live dictation holds `exclusive`
    /// for the whole session, so blocking here freezes the event loop on quit.
    pub fn unload_if_idle(&self) {
        let Some(_exclusive) = self.exclusive.try_lock() else {
            return;
        };
        self.service.unload();
        let mut last_used = self.last_used.lock();
        *last_used = None;
        self.idle_wait.notify_one();
    }
}

/// Exclusive hold on the transcriber for one live dictation session. All
/// streaming calls go through this guard so they share the single held lock;
/// batch transcriptions wait until it drops.
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub struct StreamingGuard<'a> {
    transcriber: &'a LocalTranscriber,
    _exclusive: parking_lot::MutexGuard<'a, ()>,
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
impl StreamingGuard<'_> {
    pub fn warm(&self, model: &ReadyModel) -> Result<()> {
        self.transcriber.warm_locked(model)
    }

    pub fn reset(&self) {
        self.transcriber.service.streaming_reset();
    }

    /// Language and vocabulary for the next streaming session, for engines
    /// that take per-session configuration.
    pub fn configure(&self, model: &ReadyModel, language: Option<String>, dictionary: Vec<String>) {
        self.transcriber
            .service
            .streaming_configure(&model.key, language, dictionary);
    }

    pub fn transcribe_chunk(&self, model: &ReadyModel, chunk: &[f32]) -> Result<String> {
        let transcript = self
            .transcriber
            .service
            .streaming_transcribe_chunk(&model.key, chunk)?;
        self.transcriber.touch();
        Ok(transcript)
    }

    /// Finalize the stream, read the transcript, and clear for the next session.
    pub fn finish(&self) -> String {
        let transcript = self.transcriber.service.streaming_finalize();
        self.transcriber.service.streaming_reset();
        transcript
    }
}

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod parakeet_ane_tests {
    use super::*;

    #[test]
    #[ignore = "requires PARAKEET_ANE_TEST_CACHE, PARAKEET_ANE_TEST_ORIGIN and PARAKEET_ANE_TEST_RECORDINGS"]
    fn installs_and_transcribes_recordings_with_timestamps() -> anyhow::Result<()> {
        let cache = std::path::PathBuf::from(std::env::var("PARAKEET_ANE_TEST_CACHE")?);
        let origin = std::env::var("PARAKEET_ANE_TEST_ORIGIN")?;
        let recordings: serde_json::Value = serde_json::from_slice(&std::fs::read(
            std::env::var("PARAKEET_ANE_TEST_RECORDINGS")?,
        )?)?;
        let mut spec = crate::speech::catalog::install_spec("parakeet_tdt_v3_gguf", true).unwrap();
        for file in &mut spec.files {
            let filename = file.url.rsplit('/').next().unwrap();
            file.url = format!("{origin}/{filename}");
        }
        let manager = glimpse_speech::models::ModelInstallManager::new(cache.clone());
        let runtime = tokio::runtime::Runtime::new()?;
        let status = runtime.block_on(manager.install(&spec, Default::default()))?;
        assert!(status.installed);
        let resolved = manager.resolve(&spec)?;
        let model = ReadyModel {
            key: resolved.id,
            path: resolved.path,
            engine: resolved.engine,
        };
        let transcriber = LocalTranscriber::new(cache);
        transcriber.preload_and_warm(&model)?;
        for recording in recordings.as_array().unwrap() {
            let samples = glimpse_speech::audio::read_audio_samples(std::path::Path::new(
                recording["path"].as_str().unwrap(),
            ))
            .map_err(|e| anyhow::anyhow!("{e}"))?;
            let duration = samples.len() as f32 / 16_000.0;
            let pcm: Vec<i16> = samples
                .iter()
                .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                .collect();
            let result =
                transcriber.transcribe_with_segments(&model, &pcm, 16_000, &[], Some("en"))?;
            assert!(!result.transcript.trim().is_empty());
            assert_eq!(result.speech_model.as_deref(), Some("Parakeet TDT V3"));
            let words = result.words.as_ref().expect("word timestamps");
            assert!(!words.is_empty());
            let mut previous_start = 0.0;
            for word in words {
                assert!(word.start.is_finite() && word.end.is_finite());
                assert!(word.start >= previous_start && word.end >= word.start);
                assert!(
                    word.end <= duration + 0.001,
                    "timestamp {}..{} exceeds audio {}",
                    word.start,
                    word.end,
                    duration
                );
                previous_start = word.start;
            }
            println!(
                "Parakeet ANE: {:.2}s recording, {} timed words",
                duration,
                words.len()
            );
        }
        transcriber.unload();
        transcriber.preload_and_warm(&model)?;
        transcriber.unload();
        let encoder = manager
            .model_dir("parakeet_tdt_v3_gguf")
            .join(&spec.files[1].path);
        let moved = encoder.with_extension("held");
        std::fs::rename(&encoder, &moved)?;
        let missing = manager.resolve(&spec);
        std::fs::rename(&moved, &encoder)?;
        assert!(
            missing.is_err(),
            "missing encoder must not silently use ggml"
        );
        Ok(())
    }
}
