use std::{fs, io::BufWriter, path::PathBuf, thread::JoinHandle};

use anyhow::{Context, Result, anyhow};
use crossbeam_channel::{Sender, unbounded};
use rubato::{
    Fft, FixedSync, Resampler, WindowFunction, audioadapter_buffers::direct::InterleavedSlice,
};

/// Tracks are stored at this rate. Sources at or below it keep their native rate.
const STORED_RATE: u32 = 24_000;
const RESAMPLER_CHUNK: usize = 1024;

enum TrackMessage {
    Audio { samples: Vec<f32>, position_ms: u64 },
    Finish { final_ms: u64 },
}

/// Cloneable handle given to a capture callback.
#[derive(Clone)]
pub(crate) struct TrackInput {
    tx: Sender<TrackMessage>,
}

impl TrackInput {
    /// `position_ms` is the session clock when this chunk ended.
    pub(crate) fn push(&self, samples: &[f32], position_ms: u64) {
        if samples.is_empty() {
            return;
        }
        let _ = self.tx.send(TrackMessage::Audio {
            samples: samples.to_vec(),
            position_ms,
        });
    }
}

/// Writes one source as mono 16-bit WAV at up to `STORED_RATE`, incrementally, on its own thread.
pub(crate) struct TrackWriter {
    tx: Sender<TrackMessage>,
    handle: JoinHandle<Result<u64>>,
    path: PathBuf,
}

impl TrackWriter {
    pub(crate) fn spawn(path: PathBuf, source_rate: u32, thread_name: &str) -> Result<Self> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)
                .with_context(|| format!("Failed to create {}", dir.display()))?;
        }
        let stored_rate = source_rate.min(STORED_RATE);
        let mut downsampler = if stored_rate < source_rate {
            Some(Downsampler::new(source_rate, stored_rate)?)
        } else {
            None
        };
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: stored_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let file = fs::File::create(&path)
            .with_context(|| format!("Failed to create {}", path.display()))?;
        let writer = hound::WavWriter::new(BufWriter::new(file), spec)
            .map_err(|err| anyhow!("WAV init failed: {err}"))?;
        let mut output = TrackOutput {
            writer,
            written: 0,
            since_refresh: 0,
            // The WAV header is rewritten about once a second so a crash leaves a readable file.
            refresh_every: stored_rate as u64,
        };

        let rate = source_rate as u64;
        // A source that stalls (nothing rendering, app closed) is padded with silence
        // once it falls this far behind the session clock, so tracks stay aligned.
        // Padding is counted in source frames and goes through the resampler with the
        // audio, so it lands in order behind the samples the resampler still holds.
        let align_tolerance_frames = rate / 4;

        let (tx, rx) = unbounded::<TrackMessage>();
        let handle = std::thread::Builder::new()
            .name(thread_name.to_string())
            .spawn(move || -> Result<u64> {
                let mut received: u64 = 0;

                while let Ok(message) = rx.recv() {
                    match message {
                        TrackMessage::Audio {
                            samples,
                            position_ms,
                        } => {
                            let expected_end = position_ms * rate / 1000;
                            let chunk_end = received + samples.len() as u64;
                            // The clock starts before the device delivers audio, so
                            // the first chunk is placed exactly.
                            let tolerance = if received == 0 {
                                0
                            } else {
                                align_tolerance_frames
                            };
                            if chunk_end + tolerance < expected_end {
                                let pad = expected_end - chunk_end;
                                match downsampler.as_mut() {
                                    Some(down) => down.push_silence(pad, &mut output)?,
                                    None => output.write_silence(pad)?,
                                }
                                received += pad;
                            }
                            match downsampler.as_mut() {
                                Some(down) => down.push(&samples, &mut output)?,
                                None => output.write(&samples)?,
                            }
                            received += samples.len() as u64;
                        }
                        TrackMessage::Finish { final_ms } => {
                            if let Some(down) = downsampler.as_mut() {
                                down.flush(received * stored_rate as u64 / rate, &mut output)?;
                            }
                            let target = final_ms * stored_rate as u64 / 1000;
                            if output.written < target {
                                output.write_silence(target - output.written)?;
                            }
                            break;
                        }
                    }
                }

                output
                    .writer
                    .finalize()
                    .map_err(|err| anyhow!("WAV finalize failed: {err}"))?;
                Ok(output.written)
            })
            .map_err(|err| anyhow!("Failed to spawn track writer: {err}"))?;

        Ok(Self { tx, handle, path })
    }

    pub(crate) fn input(&self) -> TrackInput {
        TrackInput {
            tx: self.tx.clone(),
        }
    }

    /// Pads to `final_ms`, closes the file and returns the sample count.
    pub(crate) fn finish(self, final_ms: u64) -> Result<(PathBuf, u64)> {
        let _ = self.tx.send(TrackMessage::Finish { final_ms });
        let written = self
            .handle
            .join()
            .map_err(|_| anyhow!("Track writer thread panicked"))??;
        Ok((self.path, written))
    }

    pub(crate) fn discard(self) {
        let _ = self.tx.send(TrackMessage::Finish { final_ms: 0 });
        let _ = self.handle.join();
        let _ = fs::remove_file(&self.path);
    }
}

type Writer = hound::WavWriter<BufWriter<fs::File>>;

struct TrackOutput {
    writer: Writer,
    written: u64,
    since_refresh: u64,
    refresh_every: u64,
}

impl TrackOutput {
    fn write(&mut self, samples: &[f32]) -> Result<()> {
        for &sample in samples {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            self.writer
                .write_sample(value)
                .map_err(|err| anyhow!("WAV write failed: {err}"))?;
        }
        self.advance(samples.len() as u64)
    }

    fn write_silence(&mut self, count: u64) -> Result<()> {
        for _ in 0..count {
            self.writer
                .write_sample(0i16)
                .map_err(|err| anyhow!("WAV write failed: {err}"))?;
        }
        self.advance(count)
    }

    fn advance(&mut self, count: u64) -> Result<()> {
        self.written += count;
        self.since_refresh += count;
        if self.since_refresh >= self.refresh_every {
            self.since_refresh = 0;
            self.writer
                .flush()
                .map_err(|err| anyhow!("WAV flush failed: {err}"))?;
        }
        Ok(())
    }
}

/// Streaming anti-aliased downsampler. The resampler's startup delay is dropped,
/// so output frame `n` is source time `n / out_rate`.
struct Downsampler {
    resampler: Fft<f32>,
    pending: Vec<f32>,
    scratch: Vec<f32>,
    delay_left: usize,
    emitted: u64,
}

impl Downsampler {
    fn new(in_rate: u32, out_rate: u32) -> Result<Self> {
        // One FFT block per chunk keeps the anti-aliasing cutoff close to the output Nyquist.
        let resampler = Fft::<f32>::new_custom(
            in_rate as usize,
            out_rate as usize,
            RESAMPLER_CHUNK,
            1,
            1,
            WindowFunction::BlackmanHarris2,
            FixedSync::Input,
        )
        .map_err(|err| anyhow!("Resampler init failed: {err}"))?;
        Ok(Self {
            scratch: vec![0.0; resampler.output_frames_max()],
            pending: Vec::with_capacity(resampler.input_frames_max() * 2),
            delay_left: resampler.output_delay(),
            resampler,
            emitted: 0,
        })
    }

    fn push(&mut self, samples: &[f32], output: &mut TrackOutput) -> Result<()> {
        self.pending.extend_from_slice(samples);
        self.drain(output, u64::MAX)
    }

    fn push_silence(&mut self, count: u64, output: &mut TrackOutput) -> Result<()> {
        // Bounded pieces keep a long stall from allocating the whole gap at once.
        let mut left = count;
        while left > 0 {
            let piece = left.min(RESAMPLER_CHUNK as u64 * 16);
            self.pending
                .resize(self.pending.len() + piece as usize, 0.0);
            left -= piece;
            self.drain(output, u64::MAX)?;
        }
        Ok(())
    }

    /// Pushes zeros through until `total` frames have come out, then stops.
    fn flush(&mut self, total: u64, output: &mut TrackOutput) -> Result<()> {
        while self.emitted < total {
            let chunk = self.resampler.input_frames_next();
            if self.pending.len() < chunk {
                self.pending.resize(chunk, 0.0);
            }
            self.drain(output, total)?;
        }
        Ok(())
    }

    fn drain(&mut self, output: &mut TrackOutput, limit: u64) -> Result<()> {
        let mut start = 0;
        loop {
            let chunk = self.resampler.input_frames_next();
            if self.pending.len() - start < chunk {
                break;
            }
            let input = InterleavedSlice::new(&self.pending[start..start + chunk], 1, chunk)
                .map_err(|err| anyhow!("Resampler input failed: {err}"))?;
            let scratch_len = self.scratch.len();
            let mut out = InterleavedSlice::new_mut(&mut self.scratch, 1, scratch_len)
                .map_err(|err| anyhow!("Resampler output failed: {err}"))?;
            let (_, produced) = self
                .resampler
                .process_into_buffer(&input, &mut out, None)
                .map_err(|err| anyhow!("Resampling failed: {err}"))?;
            start += chunk;

            let skip = self.delay_left.min(produced);
            self.delay_left -= skip;
            let room = limit.saturating_sub(self.emitted);
            let keep = ((produced - skip) as u64).min(room) as usize;
            output.write(&self.scratch[skip..skip + keep])?;
            self.emitted += keep as u64;
        }
        self.pending.drain(..start);
        Ok(())
    }
}
