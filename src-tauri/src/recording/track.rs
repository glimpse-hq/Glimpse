use std::{fs, io::BufWriter, path::PathBuf, thread::JoinHandle};

use anyhow::{Context, Result, anyhow};
use crossbeam_channel::{Sender, unbounded};

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

/// Writes one source as mono 16-bit WAV at its native rate, incrementally, on its own thread.
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
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: source_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let file = fs::File::create(&path)
            .with_context(|| format!("Failed to create {}", path.display()))?;
        let mut writer = hound::WavWriter::new(BufWriter::new(file), spec)
            .map_err(|err| anyhow!("WAV init failed: {err}"))?;

        let rate = source_rate as u64;
        // The WAV header is rewritten about once a second so a crash leaves a readable file.
        let header_refresh_samples = rate;
        // A source that stalls (nothing rendering, app closed) is padded with silence
        // once it falls this far behind the session clock, so tracks stay aligned.
        let align_tolerance_samples = rate / 4;

        let (tx, rx) = unbounded::<TrackMessage>();
        let handle = std::thread::Builder::new()
            .name(thread_name.to_string())
            .spawn(move || -> Result<u64> {
                let mut written: u64 = 0;
                let mut since_refresh: u64 = 0;

                while let Ok(message) = rx.recv() {
                    match message {
                        TrackMessage::Audio {
                            samples,
                            position_ms,
                        } => {
                            let expected_end = position_ms * rate / 1000;
                            let chunk_end = written + samples.len() as u64;
                            // The clock starts before the device delivers audio, so
                            // the first chunk is placed exactly.
                            let tolerance = if written == 0 {
                                0
                            } else {
                                align_tolerance_samples
                            };
                            if chunk_end + tolerance < expected_end {
                                let pad = expected_end - chunk_end;
                                write_silence(&mut writer, pad)?;
                                written += pad;
                            }
                            write_samples(&mut writer, &samples)?;
                            written += samples.len() as u64;
                            since_refresh += samples.len() as u64;
                            if since_refresh >= header_refresh_samples {
                                since_refresh = 0;
                                writer
                                    .flush()
                                    .map_err(|err| anyhow!("WAV flush failed: {err}"))?;
                            }
                        }
                        TrackMessage::Finish { final_ms } => {
                            let target = final_ms * rate / 1000;
                            if written < target {
                                write_silence(&mut writer, target - written)?;
                                written = target;
                            }
                            break;
                        }
                    }
                }

                writer
                    .finalize()
                    .map_err(|err| anyhow!("WAV finalize failed: {err}"))?;
                Ok(written)
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

fn write_samples(writer: &mut Writer, samples: &[f32]) -> Result<()> {
    for &sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        writer
            .write_sample(value)
            .map_err(|err| anyhow!("WAV write failed: {err}"))?;
    }
    Ok(())
}

fn write_silence(writer: &mut Writer, count: u64) -> Result<()> {
    for _ in 0..count {
        writer
            .write_sample(0i16)
            .map_err(|err| anyhow!("WAV write failed: {err}"))?;
    }
    Ok(())
}
