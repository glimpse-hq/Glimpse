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

const POLL_INTERVAL: Duration = Duration::from_millis(100);

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
    let mut resampler: Option<StreamResampler> = None;
    let mut pending: Vec<f32> = Vec::new();
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

        if sample_rate == 16_000 {
            pending.extend_from_slice(&new_samples);
        } else {
            if resampler.as_ref().is_none_or(|r| r.in_rate != sample_rate) {
                resampler = Some(StreamResampler::new(sample_rate, 16_000));
            }
            resampler
                .as_mut()
                .unwrap()
                .process(&new_samples, &mut pending);
        }

        let mut processed = 0;
        while processed + CHUNK_SAMPLES_16K <= pending.len() {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                let chunk = &pending[processed..processed + CHUNK_SAMPLES_16K];
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

        if processed > 0 {
            pending.drain(..processed);
        }
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    if !pending.is_empty() {
        pending.resize(CHUNK_SAMPLES_16K, 0.0);
        if let Ok(transcript) = transcriber.streaming_transcribe_chunk(&model, &pending) {
            if transcript != last_text {
                pill::emit_pill_mode(&app, true, &transcript);
            }
        }
    }
}

struct StreamResampler {
    in_rate: u32,
    step: f64,
    pos: f64,
    prev: f32,
    has_prev: bool,
}

impl StreamResampler {
    fn new(in_rate: u32, out_rate: u32) -> Self {
        Self {
            in_rate,
            step: in_rate as f64 / out_rate as f64,
            pos: 0.0,
            prev: 0.0,
            has_prev: false,
        }
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        let last = (input.len() - 1) as f64;
        while self.pos <= last {
            let base = self.pos.floor();
            let frac = (self.pos - base) as f32;
            let idx = base as isize;
            let current = if idx < 0 {
                if self.has_prev {
                    self.prev
                } else {
                    input[0]
                }
            } else {
                input[idx as usize]
            };
            let next = input[(idx + 1).clamp(0, input.len() as isize - 1) as usize];
            out.push(current + (next - current) * frac);
            self.pos += self.step;
        }
        self.pos -= input.len() as f64;
        self.prev = input[input.len() - 1];
        self.has_prev = true;
    }
}
