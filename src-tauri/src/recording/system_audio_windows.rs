//! System audio via WASAPI loopback on the default output device. Per-app
//! capture is not offered here; the picker is hidden on Windows.

use std::{
    ffi::c_void,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

use anyhow::{Result, anyhow};
use crossbeam_channel::bounded;
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE, eConsole, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize,
};

use super::{AudioApp, SystemAudioScope};

const FORMAT_PCM: u16 = 1;
const FORMAT_IEEE_FLOAT: u16 = 3;
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const BUFFER_HNS: i64 = 10_000_000;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub(crate) fn supported() -> bool {
    true
}

pub(crate) fn app_selection_supported() -> bool {
    false
}

pub(crate) fn permission_settings_url() -> &'static str {
    "ms-settings:privacy-microphone"
}

pub(crate) fn list_apps() -> Result<Vec<AudioApp>> {
    Ok(Vec::new())
}

pub(crate) struct SystemAudioCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl SystemAudioCapture {
    pub(crate) fn start(
        _scope: &SystemAudioScope,
        make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send> + Send + 'static,
    ) -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop);
        let (ready_tx, ready_rx) = bounded::<Result<()>>(1);
        let handle = std::thread::Builder::new()
            .name("glimpse-recording-loopback".into())
            .spawn(move || {
                if let Err(err) = run_loopback(stop_for_thread, make_sink, &ready_tx) {
                    let _ = ready_tx.send(Err(err));
                }
            })
            .map_err(|err| anyhow!("Failed to spawn loopback thread: {err}"))?;
        ready_rx
            .recv()
            .map_err(|_| anyhow!("Loopback thread exited early"))??;
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    pub(crate) fn stop(mut self) {
        self.teardown();
    }

    fn teardown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.teardown();
    }
}

struct ComGuard;

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

struct MixFormat {
    sample_rate: u32,
    channels: usize,
    float: bool,
    bits: u16,
}

fn run_loopback(
    stop: Arc<AtomicBool>,
    make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send>,
    ready_tx: &crossbeam_channel::Sender<Result<()>>,
) -> Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|err| anyhow!("COM init failed: {err}"))?;
    let _com = ComGuard;

    let (client, capture, format) = unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|err| anyhow!("Audio enumerator failed: {err}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|err| anyhow!("No default output device: {err}"))?;
        let client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|err| anyhow!("Audio client activation failed: {err}"))?;
        let format_ptr = client
            .GetMixFormat()
            .map_err(|err| anyhow!("Failed to read mix format: {err}"))?;
        let format = parse_format(format_ptr);
        let init = client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            BUFFER_HNS,
            0,
            format_ptr,
            None,
        );
        CoTaskMemFree(Some(format_ptr as *const c_void));
        init.map_err(|err| anyhow!("Loopback init failed: {err}"))?;
        let format = format?;
        let capture: IAudioCaptureClient = client
            .GetService()
            .map_err(|err| anyhow!("Capture client unavailable: {err}"))?;
        client
            .Start()
            .map_err(|err| anyhow!("Loopback start failed: {err}"))?;
        (client, capture, format)
    };

    let mut sink = make_sink(format.sample_rate);
    let _ = ready_tx.send(Ok(()));

    let mut mono: Vec<f32> = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL_INTERVAL);
        unsafe {
            loop {
                let Ok(packet) = capture.GetNextPacketSize() else {
                    break;
                };
                if packet == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames: u32 = 0;
                let mut flags: u32 = 0;
                if capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }
                if frames > 0 {
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                        mono.clear();
                        mono.resize(frames as usize, 0.0);
                    } else {
                        decode_frames(data, frames as usize, &format, &mut mono);
                    }
                    sink(&mono);
                }
                let _ = capture.ReleaseBuffer(frames);
            }
        }
    }

    unsafe {
        let _ = client.Stop();
    }
    Ok(())
}

fn parse_format(ptr: *const WAVEFORMATEX) -> Result<MixFormat> {
    if ptr.is_null() {
        return Err(anyhow!("Null mix format"));
    }
    // WAVEFORMATEX is packed, so fields are copied out rather than borrowed.
    let format = unsafe { std::ptr::read_unaligned(ptr) };
    let mut tag = format.wFormatTag;
    if tag == FORMAT_EXTENSIBLE {
        let extensible = unsafe { std::ptr::read_unaligned(ptr as *const WAVEFORMATEXTENSIBLE) };
        // The first GUID field of SubFormat carries the wave format tag.
        tag = extensible.SubFormat.data1 as u16;
    }
    let bits = format.wBitsPerSample;
    let float = tag == FORMAT_IEEE_FLOAT;
    if !float && tag != FORMAT_PCM {
        return Err(anyhow!("Unsupported loopback format tag {tag}"));
    }
    if (float && bits != 32) || (!float && bits != 16) {
        return Err(anyhow!("Unsupported loopback bit depth {bits}"));
    }
    Ok(MixFormat {
        sample_rate: format.nSamplesPerSec,
        channels: format.nChannels.max(1) as usize,
        float,
        bits,
    })
}

fn decode_frames(data: *const u8, frames: usize, format: &MixFormat, mono: &mut Vec<f32>) {
    mono.clear();
    let channels = format.channels;
    if format.float && format.bits == 32 {
        let samples = unsafe { std::slice::from_raw_parts(data as *const f32, frames * channels) };
        for frame in samples.chunks_exact(channels) {
            mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
    } else {
        let samples = unsafe { std::slice::from_raw_parts(data as *const i16, frames * channels) };
        for frame in samples.chunks_exact(channels) {
            let sum: f32 = frame.iter().map(|s| *s as f32).sum();
            mono.push(sum / channels as f32 / i16::MAX as f32);
        }
    }
}
