use std::{
    fs,
    io::BufWriter,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    thread::JoinHandle,
};

use anyhow::{Context, Result, anyhow};
use crossbeam_channel::{Sender, unbounded};
use parking_lot::Mutex;
use rubato::{
    Fft, FixedSync, Resampler, WindowFunction, audioadapter_buffers::direct::InterleavedSlice,
};

/// Tracks are stored at this rate. Sources at or below it keep their native rate.
const STORED_RATE: u32 = 24_000;
const RESAMPLER_CHUNK: usize = 1024;
pub(crate) const LIVE_RATE: u32 = 16_000;

enum TrackMessage {
    Audio { samples: Vec<f32>, position_ms: u64 },
    SourceChanged { rate: u32 },
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

/// A 16 kHz copy of what a track writes, on the track's timeline, for live
/// transcription. Collects nothing until enabled.
#[derive(Default)]
pub(crate) struct LiveTap {
    enabled: AtomicBool,
    feed: Mutex<Option<LiveFeed>>,
}

struct LiveFeed {
    converter: Option<RateConverter>,
    // 16 kHz index of `samples[0]` on the track's timeline.
    start: u64,
    samples: Vec<f32>,
}

impl LiveTap {
    pub(crate) fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            *self.feed.lock() = None;
        }
    }

    /// Samples since the last call and the 16 kHz index of the first. The
    /// index jumps when the tap was off in between.
    pub(crate) fn take(&self) -> Option<(u64, Vec<f32>)> {
        let mut feed = self.feed.lock();
        let feed = feed.as_mut()?;
        let samples = std::mem::take(&mut feed.samples);
        let start = feed.start;
        feed.start += samples.len() as u64;
        Some((start, samples))
    }

    /// `samples` is `None` for `count` frames of silence starting at stored-rate frame `position`.
    fn write(&self, samples: Option<&[f32]>, count: u64, position: u64, stored_rate: u32) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let mut feed = self.feed.lock();
        let feed = match feed.as_mut() {
            Some(feed) => feed,
            None => {
                let Ok(converter) = RateConverter::for_source(stored_rate, LIVE_RATE, 0) else {
                    return;
                };
                feed.insert(LiveFeed {
                    converter,
                    start: position * LIVE_RATE as u64 / stored_rate as u64,
                    samples: Vec::new(),
                })
            }
        };
        let result = match (feed.converter.as_mut(), samples) {
            (Some(conv), Some(samples)) => conv.push(samples, &mut feed.samples),
            (Some(conv), None) => conv.push_silence(count, &mut feed.samples),
            (None, Some(samples)) => feed.samples.write(samples),
            (None, None) => {
                feed.samples
                    .resize(feed.samples.len() + count as usize, 0.0);
                Ok(())
            }
        };
        if let Err(err) = result {
            tracing::warn!("Live tap stopped: {err}");
            self.enabled.store(false, Ordering::Relaxed);
        }
    }
}

pub(crate) const WRITE_FAILED: u8 = 1;
pub(crate) const DISK_FULL: u8 = 2;

/// Writes one source as mono 16-bit WAV at up to `STORED_RATE`, incrementally, on its own thread.
pub(crate) struct TrackWriter {
    tx: Sender<TrackMessage>,
    handle: JoinHandle<Result<u64>>,
    path: PathBuf,
    tap: Arc<LiveTap>,
}

impl TrackWriter {
    /// A failed write stops the track but keeps what reached the file, and
    /// sets `failure` to [`WRITE_FAILED`] or [`DISK_FULL`].
    pub(crate) fn spawn(
        path: PathBuf,
        source_rate: u32,
        thread_name: &str,
        failure: Arc<AtomicU8>,
    ) -> Result<Self> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)
                .with_context(|| format!("Failed to create {}", dir.display()))?;
        }
        let stored_rate = source_rate.min(STORED_RATE);
        let mut converter = RateConverter::for_source(source_rate, stored_rate, 0)?;
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
        let tap = Arc::new(LiveTap::default());
        let mut output = TrackOutput {
            writer,
            written: 0,
            since_refresh: 0,
            // The WAV header is rewritten about once a second so a crash leaves a readable file.
            refresh_every: stored_rate as u64,
            tap: Arc::clone(&tap),
            stored_rate,
        };

        let mut rate = source_rate as u64;
        // A source that stalls (nothing rendering, app closed) is padded with silence
        // once it falls this far behind the session clock, so tracks stay aligned.
        // Padding is counted in source frames and goes through the resampler with the
        // audio, so it lands in order behind the samples the resampler still holds.
        let mut align_tolerance_frames = rate / 4;

        let (tx, rx) = unbounded::<TrackMessage>();
        let handle = std::thread::Builder::new()
            .name(thread_name.to_string())
            .spawn(move || -> Result<u64> {
                // Source frames received, in the current source rate.
                let mut received: u64 = 0;
                // The clock runs before a device delivers audio, so the first chunk
                // from a new source is placed exactly instead of within tolerance.
                let mut place_exact = true;

                let mut step = |message: TrackMessage| -> Result<()> {
                    match message {
                        TrackMessage::Audio {
                            samples,
                            position_ms,
                        } => {
                            let expected_end = position_ms * rate / 1000;
                            let chunk_end = received + samples.len() as u64;
                            let tolerance = if place_exact {
                                0
                            } else {
                                align_tolerance_frames
                            };
                            place_exact = false;
                            if chunk_end + tolerance < expected_end {
                                let pad = expected_end - chunk_end;
                                match converter.as_mut() {
                                    Some(conv) => conv.push_silence(pad, &mut output)?,
                                    None => output.write_silence(pad)?,
                                }
                                received += pad;
                            }
                            match converter.as_mut() {
                                Some(conv) => conv.push(&samples, &mut output)?,
                                None => output.write(&samples)?,
                            }
                            received += samples.len() as u64;
                        }
                        TrackMessage::SourceChanged { rate: new_rate } => {
                            // Everything from the old source lands before the new one
                            // starts, so the file position is the only carry-over.
                            if let Some(conv) = converter.as_mut() {
                                conv.flush(received * stored_rate as u64 / rate, &mut output)?;
                            }
                            rate = new_rate as u64;
                            align_tolerance_frames = rate / 4;
                            received = output.written * rate / stored_rate as u64;
                            converter =
                                RateConverter::for_source(new_rate, stored_rate, output.written)?;
                            place_exact = true;
                        }
                        TrackMessage::Finish { final_ms } => {
                            if let Some(conv) = converter.as_mut() {
                                conv.flush(received * stored_rate as u64 / rate, &mut output)?;
                            }
                            let target = final_ms * stored_rate as u64 / 1000;
                            if output.written < target {
                                output.write_silence(target - output.written)?;
                            }
                        }
                    }
                    Ok(())
                };

                let mut failed = false;
                while let Ok(message) = rx.recv() {
                    let finish = matches!(message, TrackMessage::Finish { .. });
                    if !failed && let Err(err) = step(message) {
                        tracing::error!("Recording track stopped writing: {err:#}");
                        let reason = if crate::platform::is_disk_full(&err) {
                            DISK_FULL
                        } else {
                            WRITE_FAILED
                        };
                        failure.store(reason, Ordering::Relaxed);
                        failed = true;
                    }
                    if finish {
                        break;
                    }
                }

                // Best effort after a failed write: the header refreshed each
                // second already keeps the file readable.
                let finalized = output.writer.finalize();
                if !failed {
                    finalized.map_err(wav_error)?;
                }
                Ok(output.written)
            })
            .map_err(|err| anyhow!("Failed to spawn track writer: {err}"))?;

        Ok(Self {
            tx,
            handle,
            path,
            tap,
        })
    }

    pub(crate) fn tap(&self) -> Arc<LiveTap> {
        Arc::clone(&self.tap)
    }

    pub(crate) fn input(&self) -> TrackInput {
        TrackInput {
            tx: self.tx.clone(),
        }
    }

    /// The source was reopened, possibly at another rate; later chunks continue
    /// on the session clock.
    pub(crate) fn source_changed(&self, rate: u32) {
        let _ = self.tx.send(TrackMessage::SourceChanged { rate });
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

/// Keeps the io error as the source so a full disk can be recognised.
fn wav_error(err: hound::Error) -> anyhow::Error {
    match err {
        hound::Error::IoError(io) => anyhow::Error::new(io).context("WAV write failed"),
        other => anyhow!("WAV write failed: {other}"),
    }
}

struct TrackOutput {
    writer: Writer,
    written: u64,
    since_refresh: u64,
    refresh_every: u64,
    tap: Arc<LiveTap>,
    stored_rate: u32,
}

/// Where a `RateConverter` writes its output.
trait SampleSink {
    fn write(&mut self, samples: &[f32]) -> Result<()>;
}

impl SampleSink for Vec<f32> {
    fn write(&mut self, samples: &[f32]) -> Result<()> {
        self.extend_from_slice(samples);
        Ok(())
    }
}

impl SampleSink for TrackOutput {
    fn write(&mut self, samples: &[f32]) -> Result<()> {
        self.tap.write(
            Some(samples),
            samples.len() as u64,
            self.written,
            self.stored_rate,
        );
        for &sample in samples {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            self.writer.write_sample(value).map_err(wav_error)?;
        }
        self.advance(samples.len() as u64)
    }
}

impl TrackOutput {
    fn write_silence(&mut self, count: u64) -> Result<()> {
        self.tap.write(None, count, self.written, self.stored_rate);
        for _ in 0..count {
            self.writer.write_sample(0i16).map_err(wav_error)?;
        }
        self.advance(count)
    }

    fn advance(&mut self, count: u64) -> Result<()> {
        self.written += count;
        self.since_refresh += count;
        if self.since_refresh >= self.refresh_every {
            self.since_refresh = 0;
            self.writer.flush().map_err(wav_error)?;
        }
        Ok(())
    }
}

/// Streaming anti-aliased rate converter. The resampler's startup delay is
/// dropped, so output frame `n` is source time `n / out_rate`.
struct RateConverter {
    resampler: Fft<f32>,
    pending: Vec<f32>,
    scratch: Vec<f32>,
    delay_left: usize,
    emitted: u64,
}

impl RateConverter {
    /// `None` when the source already runs at the stored rate. A replacement
    /// microphone can run below it, so this also upsamples. `emitted` starts at
    /// the file position so `flush` targets stay absolute.
    fn for_source(in_rate: u32, out_rate: u32, emitted: u64) -> Result<Option<Self>> {
        if in_rate == out_rate {
            return Ok(None);
        }
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
        Ok(Some(Self {
            scratch: vec![0.0; resampler.output_frames_max()],
            pending: Vec::with_capacity(resampler.input_frames_max() * 2),
            delay_left: resampler.output_delay(),
            resampler,
            emitted,
        }))
    }

    fn push(&mut self, samples: &[f32], output: &mut impl SampleSink) -> Result<()> {
        self.pending.extend_from_slice(samples);
        self.drain(output, u64::MAX)
    }

    fn push_silence(&mut self, count: u64, output: &mut impl SampleSink) -> Result<()> {
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
    fn flush(&mut self, total: u64, output: &mut impl SampleSink) -> Result<()> {
        while self.emitted < total {
            let chunk = self.resampler.input_frames_next();
            if self.pending.len() < chunk {
                self.pending.resize(chunk, 0.0);
            }
            self.drain(output, total)?;
        }
        Ok(())
    }

    fn drain(&mut self, output: &mut impl SampleSink, limit: u64) -> Result<()> {
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
