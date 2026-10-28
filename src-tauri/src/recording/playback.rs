//! Serves a recording's tracks as one mono 16-bit WAV, mixed from the track
//! files on request, so a single player keeps them in step.

use std::{
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{Result, anyhow, bail};
use tauri::{
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
    http::{Method, Request, Response, StatusCode, header},
};

use super::track::RateConverter;

pub(crate) const SCHEME: &str = "playback";

const HEADER_LEN: u64 = 44;
// About five seconds of 24 kHz audio per response.
const MAX_RESPONSE_BYTES: u64 = 256 * 1024;
const MIN_PIECE_FRAMES: u64 = 8192;
const MAX_PIECES: u64 = 4;

pub(crate) fn protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.asset_protocol_scope();
        responder.respond(respond(&request, |path| scope.is_allowed(path)));
    });
}

fn respond(request: &Request<Vec<u8>>, allowed: impl Fn(&Path) -> bool) -> Response<Vec<u8>> {
    let builder = Response::builder().header(header::ACCEPT_RANGES, "bytes");
    let empty = |builder: tauri::http::response::Builder, status: StatusCode| {
        builder.status(status).body(Vec::new()).unwrap_or_default()
    };

    let sources = sources(&request.uri().to_string());
    if sources.is_empty() || !sources.iter().all(|(path, _)| allowed(path)) {
        return empty(builder, StatusCode::FORBIDDEN);
    }
    let stream = match Stream::open(sources) {
        Ok(stream) => stream,
        Err(err) => {
            tracing::warn!("Playback stream unavailable: {err:#}");
            return empty(builder, StatusCode::NOT_FOUND);
        }
    };
    let total = stream.byte_len();
    let builder = builder.header(header::CONTENT_TYPE, "audio/wav");
    if request.method() == Method::HEAD {
        return builder
            .header(header::CONTENT_LENGTH, total)
            .body(Vec::new())
            .unwrap_or_default();
    }

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    // Media stacks always send a range; a plain GET gets the first chunk too
    // so a long recording is never read whole.
    let Some((start, end)) = parse_range(range.unwrap_or("bytes=0-"), total) else {
        return builder
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .body(Vec::new())
            .unwrap_or_default();
    };
    let end = end.min(start + MAX_RESPONSE_BYTES - 1);
    match stream.read(start, end + 1) {
        Ok(body) => builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total}"),
            )
            .header(header::CONTENT_LENGTH, body.len())
            .body(body)
            .unwrap_or_default(),
        Err(err) => {
            tracing::warn!("Playback read failed: {err:#}");
            empty(builder, StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// `track` paths in order, each with whether a `mute` index names it.
fn sources(uri: &str) -> Vec<(PathBuf, bool)> {
    let Ok(url) = tauri::Url::parse(uri) else {
        return Vec::new();
    };
    let muted = url
        .query_pairs()
        .filter(|(key, _)| key == "mute")
        .filter_map(|(_, value)| value.parse::<usize>().ok())
        .collect::<Vec<_>>();
    url.query_pairs()
        .filter(|(key, _)| key == "track")
        .enumerate()
        .map(|(index, (_, value))| (PathBuf::from(value.into_owned()), muted.contains(&index)))
        .collect()
}

/// First range of a `Range` header as inclusive byte offsets.
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (first, last) = spec.split_once('-')?;
    if first.is_empty() {
        let suffix: u64 = last.parse().ok()?;
        return (suffix > 0 && total > 0).then(|| (total.saturating_sub(suffix), total - 1));
    }
    let start: u64 = first.parse().ok()?;
    let end = match last {
        "" => total.checked_sub(1)?,
        last => last.parse::<u64>().ok()?.min(total.checked_sub(1)?),
    };
    (start <= end).then_some((start, end))
}

struct Track {
    path: PathBuf,
    rate: u32,
    // Frames at the track's own rate.
    frames: u64,
    muted: bool,
}

/// Muted tracks still count toward the rate and length, so muting never moves the timeline.
struct Stream {
    tracks: Vec<Track>,
    rate: u32,
    // Frames at the stream rate; shorter tracks end in silence.
    frames: u64,
}

impl Stream {
    fn open(sources: Vec<(PathBuf, bool)>) -> Result<Self> {
        let tracks = sources
            .into_iter()
            .map(|(path, muted)| {
                let reader = hound::WavReader::open(&path).map_err(|err| anyhow!("{err}"))?;
                let spec = reader.spec();
                if spec.channels != 1
                    || spec.sample_rate == 0
                    || spec.bits_per_sample != 16
                    || spec.sample_format != hound::SampleFormat::Int
                {
                    bail!("Unsupported track format");
                }
                Ok(Track {
                    rate: spec.sample_rate,
                    frames: reader.len() as u64,
                    path,
                    muted,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let rate = tracks.iter().map(|track| track.rate).max().unwrap_or(0);
        let frames = tracks
            .iter()
            .map(|track| track.frames * rate as u64 / track.rate as u64)
            .max()
            .unwrap_or(0);
        Ok(Self {
            tracks,
            rate,
            frames,
        })
    }

    fn byte_len(&self) -> u64 {
        HEADER_LEN + self.frames * 2
    }

    fn header(&self) -> Vec<u8> {
        let data_len = (self.frames * 2).min(u32::MAX as u64 - 36) as u32;
        let mut header = Vec::with_capacity(HEADER_LEN as usize);
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&(36 + data_len).to_le_bytes());
        header.extend_from_slice(b"WAVEfmt ");
        header.extend_from_slice(&16u32.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes());
        header.extend_from_slice(&self.rate.to_le_bytes());
        header.extend_from_slice(&(self.rate * 2).to_le_bytes());
        header.extend_from_slice(&2u16.to_le_bytes());
        header.extend_from_slice(&16u16.to_le_bytes());
        header.extend_from_slice(b"data");
        header.extend_from_slice(&data_len.to_le_bytes());
        header
    }

    /// Bytes `start..end` of the stream.
    fn read(&self, start: u64, end: u64) -> Result<Vec<u8>> {
        let mut out = Vec::with_capacity((end - start) as usize);
        if start < HEADER_LEN {
            out.extend_from_slice(&self.header()[start as usize..end.min(HEADER_LEN) as usize]);
        }
        if end <= HEADER_LEN {
            return Ok(out);
        }
        let data_start = start.max(HEADER_LEN) - HEADER_LEN;
        let data_end = end - HEADER_LEN;
        let first = data_start / 2;
        let last = data_end.div_ceil(2);
        // Any range reads the same, so pieces mix in parallel; this keeps
        // unoptimized dev builds, where resampling is slow, responsive.
        let pieces = ((last - first) / MIN_PIECE_FRAMES).clamp(1, MAX_PIECES);
        let bounds = (0..=pieces)
            .map(|piece| first + (last - first) * piece / pieces)
            .collect::<Vec<_>>();
        let mixed = std::thread::scope(|scope| {
            let handles = bounds
                .windows(2)
                .skip(1)
                .map(|piece| scope.spawn(|| self.mix(piece[0], piece[1])))
                .collect::<Vec<_>>();
            let mut mixed = self.mix(bounds[0], bounds[1])?;
            for handle in handles {
                let piece = handle
                    .join()
                    .map_err(|_| anyhow!("Playback mix panicked"))??;
                mixed.extend(piece);
            }
            anyhow::Ok(mixed)
        })?;
        let skip = (data_start - first * 2) as usize;
        let take = (data_end - data_start) as usize;
        out.extend_from_slice(&mixed[skip..skip + take]);
        Ok(out)
    }

    /// Frames `first..last` as little-endian bytes, summed like separate
    /// players at full volume.
    fn mix(&self, first: u64, last: u64) -> Result<Vec<u8>> {
        let mut sums = vec![0i32; (last - first) as usize];
        for track in self.tracks.iter().filter(|track| !track.muted) {
            for (sum, sample) in sums.iter_mut().zip(track.read(first, last, self.rate)?) {
                *sum += sample as i32;
            }
        }
        Ok(sums
            .into_iter()
            .flat_map(|sum| (sum.clamp(i16::MIN as i32, i16::MAX as i32) as i16).to_le_bytes())
            .collect())
    }
}

impl Track {
    /// Frames `from..to` at `rate`, cut short where the track ends.
    fn read(&self, from: u64, to: u64, rate: u32) -> Result<Vec<i16>> {
        if rate == self.rate {
            return read_samples(&self.path, from, to.min(self.frames));
        }
        let to = to.min(self.frames * rate as u64 / self.rate as u64);
        if to <= from {
            return Ok(Vec::new());
        }
        let mut converter = RateConverter::for_source(self.rate, rate, 0)?
            .ok_or_else(|| anyhow!("Track needs no resampling"))?;
        // Start one whole resampler block early so any range matches a straight read.
        let block = converter.block_frames();
        let block_in = block * self.rate as u64 / rate as u64;
        let first_block = (from / block).saturating_sub(1);
        let offset = first_block * block;
        let source_from = first_block * block_in;
        let source_to = ((to * self.rate as u64).div_ceil(rate as u64) + 3 * block_in)
            .min(self.frames)
            .max(source_from);
        let source = read_samples(&self.path, source_from, source_to)?
            .into_iter()
            .map(|sample| sample as f32 / i16::MAX as f32)
            .collect::<Vec<_>>();
        let mut resampled = Vec::with_capacity((to - offset) as usize);
        converter.push(&source, &mut resampled)?;
        converter.flush(to - offset, &mut resampled)?;
        Ok(resampled[(from - offset) as usize..(to - offset) as usize]
            .iter()
            .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)
            .collect())
    }
}

fn read_samples(path: &Path, from: u64, to: u64) -> Result<Vec<i16>> {
    if to <= from {
        return Ok(Vec::new());
    }
    let mut reader = hound::WavReader::open(path).map_err(|err| anyhow!("{err}"))?;
    let from_frame = u32::try_from(from).map_err(|_| anyhow!("Track position out of range"))?;
    reader.seek(from_frame).map_err(|err| anyhow!("{err}"))?;
    let mut bytes = vec![0u8; (to - from) as usize * 2];
    reader.into_inner().read_exact(&mut bytes)?;
    Ok(bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes(*pair))
        .collect())
}
