//! System audio via WASAPI loopback. Everything the default output device
//! plays, or chosen apps through process loopback where Windows supports it.

use std::{
    collections::VecDeque,
    ffi::c_void,
    mem::ManuallyDrop,
    path::{Path, PathBuf},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

use anyhow::{Result, anyhow};
use crossbeam_channel::{Sender, bounded};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    ActivateAudioInterfaceAsync, AudioSessionStateExpired, DEVICE_STATE_ACTIVE,
    IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
    IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, eConsole, eRender,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    BLOB, CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::core::{HRESULT, IUnknown, Interface, PCWSTR, PWSTR, Ref, implement};

use super::{AudioApp, SystemAudioScope};

const FORMAT_PCM: u16 = 1;
const FORMAT_IEEE_FLOAT: u16 = 3;
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const BUFFER_HNS: i64 = 10_000_000;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);
// Process loopback has no mix format of its own, so it is asked for this one.
const APP_SAMPLE_RATE: u32 = 48_000;
const APP_CHANNELS: u16 = 2;
// With several apps, one that goes quiet may stop delivering audio. The others
// are written without it once this much is waiting.
const MIX_STALL_FRAMES: usize = APP_SAMPLE_RATE as usize / 5;

pub(crate) fn supported() -> bool {
    true
}

/// Process loopback arrived in Windows 10 2004. Probed once rather than read
/// from the version number.
pub(crate) fn app_selection_supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        std::thread::spawn(|| {
            let _com = ComGuard::init().ok()?;
            let client = activate_process_loopback(std::process::id()).ok()?;
            initialize_app_client(&client).ok()
        })
        .join()
        .ok()
        .flatten()
        .is_some()
    })
}

pub(crate) fn permission_settings_url() -> &'static str {
    "ms-settings:privacy-microphone"
}

pub(crate) fn list_apps() -> Result<Vec<AudioApp>> {
    let _com = ComGuard::init()?;
    let own_pid = std::process::id();
    let mut apps: Vec<AudioApp> = Vec::new();
    for pid in audio_session_pids()? {
        if pid == own_pid {
            continue;
        }
        let Some(path) = process_path(pid) else {
            continue;
        };
        let Some(id) = exe_key(&path) else {
            continue;
        };
        if apps.iter().any(|app| app.id == id) {
            continue;
        }
        apps.push(AudioApp {
            id,
            name: file_description(&path).unwrap_or_else(|| exe_stem(&path)),
            icon: crate::platform::windows::icons::exe_icon_png(&path).map(|png| {
                use base64::Engine;
                let encoded = base64::engine::general_purpose::STANDARD.encode(png);
                format!("data:image/png;base64,{encoded}")
            }),
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

pub(crate) struct SystemAudioCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl SystemAudioCapture {
    pub(crate) fn start(
        scope: &SystemAudioScope,
        make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send> + Send + 'static,
    ) -> Result<Self> {
        let targets = match scope {
            SystemAudioScope::All => None,
            SystemAudioScope::Apps(selected) => {
                if !app_selection_supported() {
                    return Err(anyhow!(
                        "Recording single apps needs Windows 10 2004 or later"
                    ));
                }
                let roots = app_root_pids(selected)?;
                if roots.is_empty() {
                    return Err(anyhow!("None of the selected apps are running"));
                }
                Some(roots)
            }
        };
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop);
        let (ready_tx, ready_rx) = bounded::<Result<()>>(1);
        let handle = std::thread::Builder::new()
            .name("glimpse-recording-loopback".into())
            .spawn(move || {
                if let Err(err) = run_loopback(targets, stop_for_thread, make_sink, &ready_tx) {
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

impl ComGuard {
    fn init() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|err| anyhow!("COM init failed: {err}"))?;
        Ok(Self)
    }
}

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

struct Stream {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    format: MixFormat,
    pending: VecDeque<f32>,
}

/// Captures the whole default output device, or each app root's process tree
/// on its own client, mixed into one track.
fn run_loopback(
    targets: Option<Vec<u32>>,
    stop: Arc<AtomicBool>,
    make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send>,
    ready_tx: &Sender<Result<()>>,
) -> Result<()> {
    let _com = ComGuard::init()?;
    let mut streams = match targets {
        None => vec![open_device_loopback()?],
        Some(pids) => pids
            .into_iter()
            .map(open_app_loopback)
            .collect::<Result<Vec<_>>>()?,
    };
    for stream in &streams {
        unsafe { stream.client.Start() }.map_err(|err| anyhow!("Loopback start failed: {err}"))?;
    }

    let mut sink = make_sink(streams[0].format.sample_rate);
    let _ = ready_tx.send(Ok(()));

    let mut mono: Vec<f32> = Vec::new();
    let mut mixed: Vec<f32> = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL_INTERVAL);
        for stream in &mut streams {
            drain_packets(stream, &mut mono);
        }
        let waiting = |stream: &Stream| stream.pending.len();
        let shortest = streams.iter().map(waiting).min().unwrap_or(0);
        let longest = streams.iter().map(waiting).max().unwrap_or(0);
        let frames = if longest >= MIX_STALL_FRAMES {
            longest
        } else {
            shortest
        };
        if frames == 0 {
            continue;
        }
        mixed.clear();
        mixed.resize(frames, 0.0);
        for stream in &mut streams {
            let take = frames.min(stream.pending.len());
            for (out, sample) in mixed.iter_mut().zip(stream.pending.drain(..take)) {
                *out += sample;
            }
        }
        sink(&mixed);
    }

    for stream in &streams {
        unsafe {
            let _ = stream.client.Stop();
        }
    }
    Ok(())
}

fn drain_packets(stream: &mut Stream, mono: &mut Vec<f32>) {
    unsafe {
        loop {
            let Ok(packet) = stream.capture.GetNextPacketSize() else {
                break;
            };
            if packet == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            if stream
                .capture
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
                    decode_frames(data, frames as usize, &stream.format, mono);
                }
                stream.pending.extend(mono.iter());
            }
            let _ = stream.capture.ReleaseBuffer(frames);
        }
    }
}

fn open_device_loopback() -> Result<Stream> {
    unsafe {
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
        Ok(Stream {
            client,
            capture,
            format,
            pending: VecDeque::new(),
        })
    }
}

fn open_app_loopback(pid: u32) -> Result<Stream> {
    let client = activate_process_loopback(pid)?;
    let format = initialize_app_client(&client)?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }
        .map_err(|err| anyhow!("Capture client unavailable: {err}"))?;
    Ok(Stream {
        client,
        capture,
        format,
        pending: VecDeque::new(),
    })
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler(Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

/// An audio client that hears `pid` and every process it started.
fn activate_process_loopback(pid: u32) -> Result<IAudioClient> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // Dropping a PROPVARIANT clears it, which would free `params`.
    let mut variant = ManuallyDrop::new(PROPVARIANT::default());
    unsafe {
        let inner = &mut variant.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: &mut params as *mut _ as *mut u8,
        };
    }
    let (done_tx, done_rx) = bounded::<()>(1);
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler(done_tx).into();
    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant as *const _),
            &handler,
        )
    }
    .map_err(|err| anyhow!("App audio activation failed: {err}"))?;
    done_rx
        .recv_timeout(ACTIVATION_TIMEOUT)
        .map_err(|_| anyhow!("App audio activation timed out"))?;
    let mut result = HRESULT(0);
    let mut activated: Option<IUnknown> = None;
    unsafe { operation.GetActivateResult(&mut result, &mut activated) }
        .and_then(|()| result.ok())
        .map_err(|err| anyhow!("App audio activation failed: {err}"))?;
    activated
        .ok_or_else(|| anyhow!("App audio activation returned nothing"))?
        .cast()
        .map_err(|err| anyhow!("App audio client unavailable: {err}"))
}

fn initialize_app_client(client: &IAudioClient) -> Result<MixFormat> {
    let block_align = APP_CHANNELS * 4;
    let format = WAVEFORMATEX {
        wFormatTag: FORMAT_IEEE_FLOAT,
        nChannels: APP_CHANNELS,
        nSamplesPerSec: APP_SAMPLE_RATE,
        nAvgBytesPerSec: APP_SAMPLE_RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            BUFFER_HNS,
            0,
            &format,
            None,
        )
    }
    .map_err(|err| anyhow!("App loopback init failed: {err}"))?;
    Ok(MixFormat {
        sample_rate: APP_SAMPLE_RATE,
        channels: APP_CHANNELS as usize,
        float: true,
        bits: 32,
    })
}

/// Processes with an audio session on any active output device.
fn audio_session_pids() -> Result<Vec<u32>> {
    let mut pids = Vec::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|err| anyhow!("Audio enumerator failed: {err}"))?;
        let devices = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|err| anyhow!("Failed to list output devices: {err}"))?;
        for device_index in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(device_index) else {
                continue;
            };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                continue;
            };
            let Ok(sessions) = manager.GetSessionEnumerator() else {
                continue;
            };
            for session_index in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(session) = sessions
                    .GetSession(session_index)
                    .and_then(|session| session.cast::<IAudioSessionControl2>())
                else {
                    continue;
                };
                if session.IsSystemSoundsSession() == HRESULT(0)
                    || session.GetState().ok() == Some(AudioSessionStateExpired)
                {
                    continue;
                }
                if let Ok(pid) = session.GetProcessId()
                    && pid != 0
                    && !pids.contains(&pid)
                {
                    pids.push(pid);
                }
            }
        }
    }
    Ok(pids)
}

/// The topmost running process of each selected app. Capturing its tree
/// covers helper processes, such as the one a browser plays audio from.
fn app_root_pids(selected: &[String]) -> Result<Vec<u32>> {
    let processes = running_processes()?;
    let same_app = |pid: u32, exe: &str| {
        processes
            .iter()
            .any(|(other, _, other_exe)| *other == pid && other_exe == exe)
    };
    Ok(processes
        .iter()
        .filter(|(pid, parent, exe)| {
            *pid != std::process::id() && selected.contains(exe) && !same_app(*parent, exe)
        })
        .map(|(pid, _, _)| *pid)
        .collect())
}

/// Every running process as (pid, parent pid, lowercased exe name).
fn running_processes() -> Result<Vec<(u32, u32, String)>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|err| anyhow!("Failed to list processes: {err}"))?;
    let mut processes = Vec::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut next = unsafe { Process32FirstW(snapshot, &mut entry) };
    while next.is_ok() {
        let len = entry
            .szExeFile
            .iter()
            .position(|ch| *ch == 0)
            .unwrap_or(entry.szExeFile.len());
        let exe = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
        processes.push((entry.th32ProcessID, entry.th32ParentProcessID, exe));
        next = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    Ok(processes)
}

fn process_path(pid: u32) -> Option<PathBuf> {
    let process: HANDLE =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = [0u16; 1024];
    let mut len = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
    };
    unsafe {
        let _ = CloseHandle(process);
    }
    result.ok()?;
    Some(PathBuf::from(String::from_utf16_lossy(
        &buffer[..len as usize],
    )))
}

/// Apps are keyed by exe name, which stays the same across launches.
fn exe_key(path: &Path) -> Option<String> {
    Some(path.file_name()?.to_string_lossy().to_lowercase())
}

fn exe_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The name an exe gives itself, like "Google Chrome" for chrome.exe.
fn file_description(path: &Path) -> Option<String> {
    let wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let path = PCWSTR(wide.as_ptr());
    unsafe {
        let size = GetFileVersionInfoSizeW(path, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(path, None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        let mut translation: *mut c_void = std::ptr::null_mut();
        let mut translation_len = 0u32;
        let found = VerQueryValueW(
            data.as_ptr() as *const c_void,
            windows::core::w!("\\VarFileInfo\\Translation"),
            &mut translation,
            &mut translation_len,
        );
        if !found.as_bool() || translation.is_null() || translation_len < 4 {
            return None;
        }
        let language = *(translation as *const u16);
        let code_page = *(translation as *const u16).add(1);
        let key: Vec<u16> =
            format!("\\StringFileInfo\\{language:04x}{code_page:04x}\\FileDescription")
                .encode_utf16()
                .chain(Some(0))
                .collect();
        let mut value: *mut c_void = std::ptr::null_mut();
        let mut value_len = 0u32;
        let found = VerQueryValueW(
            data.as_ptr() as *const c_void,
            PCWSTR(key.as_ptr()),
            &mut value,
            &mut value_len,
        );
        if !found.as_bool() || value.is_null() || value_len == 0 {
            return None;
        }
        let text = std::slice::from_raw_parts(value as *const u16, value_len as usize);
        let end = text.iter().position(|ch| *ch == 0).unwrap_or(text.len());
        let name = String::from_utf16_lossy(&text[..end]).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
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
