use anyhow::{Context, Result, anyhow};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use crate::audio::find_input_device;

/// Typed so the command layer can report "no microphone" distinctly.
#[derive(Debug)]
pub(crate) struct NoMicrophone;

impl std::fmt::Display for NoMicrophone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("No microphone available")
    }
}

impl std::error::Error for NoMicrophone {}

pub(crate) struct MicrophoneCapture {
    _stream: cpal::Stream,
    pub(crate) name: String,
}

/// Opens the microphone and delivers mono f32 audio at the device's native
/// rate. `make_sink` receives that rate and returns the audio callback.
pub(crate) fn start(
    device_id: Option<&str>,
    make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send>,
) -> Result<MicrophoneCapture> {
    let device = find_input_device(device_id).ok_or(NoMicrophone)?;
    let name = device
        .description()
        .map(|desc| desc.name().to_string())
        .unwrap_or_default();
    let config = device
        .default_input_config()
        .context("No supported input configuration")?;
    let format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    let sink = make_sink(stream_config.sample_rate);

    let stream = match format {
        SampleFormat::F32 => build_stream::<f32>(&device, stream_config, sink),
        SampleFormat::F64 => build_stream::<f64>(&device, stream_config, sink),
        SampleFormat::I8 => build_stream::<i8>(&device, stream_config, sink),
        SampleFormat::I16 => build_stream::<i16>(&device, stream_config, sink),
        SampleFormat::I24 => build_stream::<cpal::I24>(&device, stream_config, sink),
        SampleFormat::I32 => build_stream::<i32>(&device, stream_config, sink),
        SampleFormat::U8 => build_stream::<u8>(&device, stream_config, sink),
        SampleFormat::U16 => build_stream::<u16>(&device, stream_config, sink),
        SampleFormat::U32 => build_stream::<u32>(&device, stream_config, sink),
        other => return Err(anyhow!("Unsupported microphone sample format: {other}")),
    }
    .context("Failed to open microphone")?;
    stream.play().context("Failed to start microphone")?;

    Ok(MicrophoneCapture {
        _stream: stream,
        name,
    })
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut sink: Box<dyn FnMut(&[f32]) + Send>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + 'static,
    f32: FromSample<T>,
{
    let channels = (config.channels as usize).max(1);
    let mut mono: Vec<f32> = Vec::new();
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            mono.clear();
            for frame in data.chunks(channels) {
                let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
                mono.push(sum / channels as f32);
            }
            sink(&mono);
        },
        |err| tracing::error!("Recording microphone stream error: {err}"),
        None,
    )
}
