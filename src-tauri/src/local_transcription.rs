use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use glimpse_speech::engines::nemotron::NemotronEngine;
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use glimpse_speech::engines::parakeet::{
    ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
};
use glimpse_speech::{
    engines::whisper::{WhisperEngine, WhisperInferenceParams},
    TranscriptionEngine, TranscriptionResult, TranscriptionSegment,
};
use parking_lot::{Condvar, Mutex};

use crate::{
    model_manager::{self, LocalModelEngine, ReadyModel},
    transcription_api::{normalize_transcript, TranscriptionSuccess},
};

#[derive(Debug)]
pub struct TranscriptionSuccessWithSegments {
    pub transcript: String,
    pub segments: Option<Vec<TranscriptionSegment>>,
}

const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct LocalTranscriber {
    inner: Mutex<Option<LoadedEngine>>,
    last_used: Mutex<Option<Instant>>,
    idle_wait: Condvar,
}

struct LoadedEngine {
    key: String,
    path: PathBuf,
    engine: EngineInstance,
}

enum EngineInstance {
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    Nemotron {
        engine: Box<NemotronEngine>,
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    Parakeet {
        engine: Box<ParakeetEngine>,
    },
    Whisper {
        engine: Box<WhisperEngine>,
    },
}

struct PreparedAudio {
    pub data: Vec<f32>,
}

impl LocalTranscriber {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
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
        if self.inner.lock().is_none() {
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
        let already_loaded = {
            let guard = self.inner.lock();
            guard
                .as_ref()
                .map(|current| current.key == model.key && current.path == model.path)
                .unwrap_or(false)
        };

        if already_loaded {
            return Ok(());
        }

        self.ensure_engine(model)?;
        self.touch();

        let silence = vec![0.0f32; 16_000 * 2];
        let mut guard = self.inner.lock();
        let loaded = guard
            .as_mut()
            .ok_or_else(|| anyhow!("Local model not available"))?;

        let warmup_result = match &mut loaded.engine {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            EngineInstance::Nemotron { engine } => engine
                .transcribe_samples(silence, None)
                .map_err(|err| anyhow!("Nemotron warmup failed: {err}")),
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            EngineInstance::Parakeet { engine, .. } => engine
                .transcribe_samples(silence, None)
                .map_err(|err| anyhow!("Parakeet warmup failed: {err}")),
            EngineInstance::Whisper { engine } => engine
                .transcribe_samples(silence, None)
                .map_err(|err| anyhow!("Whisper warmup failed: {err}")),
        };
        let _ = warmup_result?;

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
        let (result, model_label) =
            self.transcribe_internal(model, samples, sample_rate, dictionary, language, false)?;

        Ok(TranscriptionSuccess {
            transcript: normalize_transcript(&result.text),
            speech_model: Some(model_label),
        })
    }

    pub fn transcribe_with_segments(
        &self,
        model: &ReadyModel,
        samples: &[i16],
        sample_rate: u32,
        dictionary: &[String],
        language: Option<&str>,
    ) -> Result<TranscriptionSuccessWithSegments> {
        let (result, _) =
            self.transcribe_internal(model, samples, sample_rate, dictionary, language, true)?;

        Ok(TranscriptionSuccessWithSegments {
            transcript: normalize_transcript(&result.text),
            segments: result.segments,
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
    ) -> Result<(TranscriptionResult, String)> {
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        let _ = with_segments;

        self.ensure_engine(model)?;
        self.touch();

        let prepared = prepare_audio(samples, sample_rate);
        let model_label = model_manager::definition(&model.key)
            .map(|def| def.label.to_string())
            .unwrap_or_else(|| model.key.clone());

        let mut guard = self.inner.lock();
        let loaded = guard
            .as_mut()
            .ok_or_else(|| anyhow!("Local model not available"))?;

        let result = match &mut loaded.engine {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            EngineInstance::Nemotron { engine } => engine
                .transcribe_samples(prepared.data.clone(), None)
                .map_err(|err| anyhow!("Nemotron transcription failed: {err}"))?,
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            EngineInstance::Parakeet { engine } => {
                let timestamp_granularity = if with_segments {
                    TimestampGranularity::Segment
                } else {
                    TimestampGranularity::Token
                };
                let params = Some(ParakeetInferenceParams {
                    language: None,
                    dictionary: dictionary.to_vec(),
                    timestamp_granularity,
                });
                engine
                    .transcribe_samples(prepared.data.clone(), params)
                    .map_err(|err| anyhow!("Parakeet transcription failed: {err}"))?
            }
            EngineInstance::Whisper { engine } => {
                let params = if !dictionary.is_empty() || language.is_some() {
                    Some(WhisperInferenceParams {
                        dictionary: dictionary.to_vec(),
                        language: language.map(|s| s.to_string()),
                        ..Default::default()
                    })
                } else {
                    None
                };

                engine
                    .transcribe_samples(prepared.data.clone(), params)
                    .map_err(|err| anyhow!("Whisper transcription failed: {err}"))?
            }
        };

        Ok((result, model_label))
    }

    fn ensure_engine(&self, model: &ReadyModel) -> Result<()> {
        {
            let guard = self.inner.lock();
            if let Some(current) = guard.as_ref() {
                if current.key == model.key && current.path == model.path {
                    return Ok(());
                }
            }
        }

        let engine = match &model.engine {
            LocalModelEngine::Nemotron => {
                #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
                {
                    let mut engine = NemotronEngine::new();
                    engine
                        .load_model(model.path.as_path())
                        .map_err(|err| anyhow!("Failed to load Nemotron model: {err}"))?;
                    EngineInstance::Nemotron {
                        engine: Box::new(engine),
                    }
                }

                #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
                {
                    return Err(anyhow!("Nemotron is not available in Intel macOS builds"));
                }
            }
            LocalModelEngine::Parakeet => {
                #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
                {
                    let mut engine = ParakeetEngine::new();
                    let params = ParakeetModelParams::tdt_int8();
                    engine
                        .load_model_with_params(model.path.as_path(), params)
                        .map_err(|err| anyhow!("Failed to load Parakeet model: {err}"))?;
                    EngineInstance::Parakeet {
                        engine: Box::new(engine),
                    }
                }

                #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
                {
                    return Err(anyhow!("Parakeet is not available in Intel macOS builds"));
                }
            }
            LocalModelEngine::Whisper => {
                let mut engine = WhisperEngine::new();
                engine
                    .load_model(model.path.as_path())
                    .map_err(|err| anyhow!("Failed to load Whisper model: {err}"))?;
                EngineInstance::Whisper {
                    engine: Box::new(engine),
                }
            }
        };

        let mut guard = self.inner.lock();
        *guard = Some(LoadedEngine {
            key: model.key.clone(),
            path: model.path.clone(),
            engine,
        });

        Ok(())
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_transcribe_chunk(&self, model: &ReadyModel, chunk: &[f32]) -> Result<String> {
        self.ensure_engine(model)?;
        self.touch();

        let mut guard = self.inner.lock();
        let loaded = guard
            .as_mut()
            .ok_or_else(|| anyhow!("Local model not available"))?;

        match &mut loaded.engine {
            EngineInstance::Nemotron { engine } => {
                engine
                    .transcribe_chunk(chunk)
                    .map_err(|err| anyhow!("Nemotron streaming chunk failed: {err}"))?;
                Ok(engine.get_transcript())
            }
            _ => Err(anyhow!("Streaming is only supported with Nemotron models")),
        }
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_reset(&self) {
        let mut guard = self.inner.lock();
        if let Some(loaded) = guard.as_mut() {
            if let EngineInstance::Nemotron { engine } = &mut loaded.engine {
                engine.reset();
            }
        }
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    pub fn streaming_get_transcript(&self) -> String {
        let guard = self.inner.lock();
        if let Some(loaded) = guard.as_ref() {
            if let EngineInstance::Nemotron { engine } = &loaded.engine {
                return engine.get_transcript();
            }
        }
        String::new()
    }

    pub fn unload(&self) {
        let mut inner = self.inner.lock();
        let mut last_used = self.last_used.lock();
        *inner = None;
        *last_used = None;
        self.idle_wait.notify_one();
    }
}

impl Default for LocalTranscriber {
    fn default() -> Self {
        Self::new()
    }
}

fn prepare_audio(samples: &[i16], sample_rate: u32) -> PreparedAudio {
    let normalized: Vec<f32> = samples
        .iter()
        .map(|sample| *sample as f32 / i16::MAX as f32)
        .collect();

    let mut data = if sample_rate == 16_000 {
        normalized
    } else {
        resample_linear(&normalized, sample_rate.max(1), 16_000)
    };

    const MIN_SAMPLES: usize = 16_000;
    const EXTRA_PADDING: usize = 4_000;

    let padding_needed = MIN_SAMPLES.saturating_sub(data.len()) + EXTRA_PADDING;
    data.extend(std::iter::repeat_n(0.0f32, padding_needed));

    PreparedAudio { data }
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    if from_rate == 0 || to_rate == 0 || from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = to_rate as f64 / from_rate as f64;
    let target_len = ((samples.len() as f64) * ratio).ceil().max(1.0) as usize;
    let last_index = samples.len() - 1;
    let mut output = Vec::with_capacity(target_len);

    for idx in 0..target_len {
        let src_pos = idx as f64 / ratio;
        let base = src_pos.floor() as usize;
        let frac = (src_pos - base as f64) as f32;
        let current = samples[base.min(last_index)];
        let next = samples[(base + 1).min(last_index)];
        output.push(current + (next - current) * frac);
    }

    output
}
