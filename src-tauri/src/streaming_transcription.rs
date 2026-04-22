use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::{AppHandle, Manager};

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use crate::pill;
use crate::{model_manager::ReadyModel, AppRuntime, AppState};

const POLL_INTERVAL: Duration = Duration::from_millis(400);

const CHUNK_SAMPLES_16K: usize = 8960;

pub struct StreamingSession {
    stop_flag: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl StreamingSession {
    pub fn start(app: &AppHandle<AppRuntime>, ready_model: &ReadyModel) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = Arc::clone(&stop_flag);
        let app_handle = app.clone();
        let model = ready_model.clone();

        let handle = std::thread::Builder::new()
            .name("streaming-transcription".into())
            .spawn(move || {
                streaming_thread(app_handle, model, thread_stop_flag);
            })
            .expect("failed to spawn streaming transcription thread");

        Self {
            stop_flag,
            handle: Some(handle),
        }
    }

    pub fn stop(mut self, app: &AppHandle<AppRuntime>) -> String {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }

        #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
        {
            let state = app.state::<AppState>();
            let transcriber = state.local_transcriber();
            let transcript = transcriber.streaming_get_transcript();
            transcriber.streaming_reset();
            transcript
        }

        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        {
            let _ = app;
            String::new()
        }
    }
}

impl Drop for StreamingSession {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn streaming_thread(app: AppHandle<AppRuntime>, model: ReadyModel, stop_flag: Arc<AtomicBool>) {
    let state = app.state::<AppState>();
    let transcriber = state.local_transcriber();

    if let Err(err) = transcriber.preload_and_warm(&model) {
        eprintln!("[streaming] Failed to preload model: {err}");
        return;
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    transcriber.streaming_reset();

    let recorder = state.pill().recorder();
    let mut buffer_offset: usize = 0;
    let mut resample_remainder: Vec<f32> = Vec::new();
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    let mut last_text = String::new();

    while !stop_flag.load(Ordering::SeqCst) {
        std::thread::sleep(POLL_INTERVAL);

        let Some((new_samples, sample_rate, new_offset)) =
            recorder.read_live_samples(buffer_offset)
        else {
            continue;
        };

        if new_samples.is_empty() {
            continue;
        }

        buffer_offset = new_offset;

        let samples_16k = if sample_rate == 16_000 {
            new_samples
        } else {
            resample_linear(&new_samples, sample_rate, 16_000)
        };

        let mut all_samples = std::mem::take(&mut resample_remainder);
        all_samples.extend_from_slice(&samples_16k);

        let mut processed = 0;
        while processed + CHUNK_SAMPLES_16K <= all_samples.len() {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                let chunk = &all_samples[processed..processed + CHUNK_SAMPLES_16K];
                match transcriber.streaming_transcribe_chunk(&model, chunk) {
                    Ok(transcript) => {
                        if transcript != last_text {
                            last_text.clone_from(&transcript);
                            pill::emit_pill_mode(&app, true, &transcript);
                        }
                    }
                    Err(err) => {
                        eprintln!("[streaming] Chunk transcription failed: {err}");
                    }
                }
            }

            processed += CHUNK_SAMPLES_16K;
        }

        if processed < all_samples.len() {
            resample_remainder = all_samples[processed..].to_vec();
        }
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    if !resample_remainder.is_empty() {
        resample_remainder.resize(CHUNK_SAMPLES_16K, 0.0);
        if let Ok(transcript) = transcriber.streaming_transcribe_chunk(&model, &resample_remainder)
        {
            if transcript != last_text {
                pill::emit_pill_mode(&app, true, &transcript);
            }
        }
    }
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || to_rate == 0 || from_rate == to_rate {
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
