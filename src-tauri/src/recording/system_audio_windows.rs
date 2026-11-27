//! System audio via WASAPI loopback: everything each output device plays, or
//! chosen apps through process loopback where Windows supports it.

use std::{
    collections::{HashSet, VecDeque},
    ffi::c_void,
    mem::ManuallyDrop,
    path::{Path, PathBuf},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
use crossbeam_channel::{Sender, bounded};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, ActivateAudioInterfaceAsync, AudioSessionStateExpired,
    DEVICE_STATE_ACTIVE, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IAudioSessionControl2, IAudioSessionManager2, IMMDevice,
    IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    BLOB, CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongW, GetWindowThreadProcessId,
    IsWindowVisible, WS_EX_TOOLWINDOW,
};
use windows::core::{BOOL, HRESULT, IUnknown, Interface, PWSTR, Ref, implement};

use super::{AudioApp, SamplesCallback, SystemAudioScope};

const FORMAT_IEEE_FLOAT: u16 = 3;
const BUFFER_HNS: i64 = 10_000_000;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);
// Process loopback has no mix format of its own and output devices convert to
// this one, so every stream mixes without resampling.
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
// Streams are mixed by capture time and written this far behind it, so a
// packet that arrives late still lands in place. Packets were measured
// arriving up to 16 ms after capture.
const MIX_DELAY_FRAMES: u64 = SAMPLE_RATE as u64 / 25;
// A packet this close to where its stream's last one ended continues it, so
// timestamp jitter leaves no gaps. Further off, as after a pause or clock
// drift between devices, it goes where its timestamp says.
const RESYNC_FRAMES: u64 = SAMPLE_RATE as u64 / 50;
// How often output devices are rescanned and chosen apps are checked.
const CHECK_INTERVAL: Duration = Duration::from_secs(1);
const METER_INTERVAL: Duration = Duration::from_millis(100);
// An app session at least this loud is playing something.
const PLAYING_LEVEL: f32 = 0.01;

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
            initialize_client(&client).ok()
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
    let processes = running_processes()?;
    let windowed = windowed_pids()?;
    let mut apps: Vec<AudioApp> = Vec::new();
    for (pid, _) in audio_sessions()? {
        // Audio often plays from a helper process, so the app is the nearest
        // process up the tree that shows a window. Background services have none.
        let Some(app_pid) = ancestor(pid, &processes, |pid| windowed.contains(&pid)) else {
            continue;
        };
        if app_pid == own_pid {
            continue;
        }
        let Some(path) = process_path(app_pid) else {
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
            name: crate::platform::windows::file_description(&path)
                .unwrap_or_else(|| exe_stem(&path)),
            icon: crate::platform::windows::icons::exe_icon_png(&path).map(|png| {
                use base64::Engine;
                let encoded = base64::engine::general_purpose::STANDARD.encode(png);
                format!("data:image/png;base64,{encoded}")
            }),
        });
    }
    apps.sort_by_key(|app| app.name.to_lowercase());
    Ok(apps)
}

pub(crate) struct SystemAudioCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl SystemAudioCapture {
    /// `missed` is set once a chosen app plays audio that never reaches its
    /// capture.
    pub(crate) fn start(
        scope: &SystemAudioScope,
        missed: Arc<AtomicBool>,
        make_sink: impl FnOnce(u32) -> SamplesCallback + Send + 'static,
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
                if let Err(err) =
                    run_loopback(targets, missed, stop_for_thread, make_sink, &ready_tx)
                {
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

struct Stream {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    source: Source,
    // Timeline frame where the next packet continues this stream.
    next: Option<u64>,
    // Set once the stream stops delivering, as when its device is unplugged.
    lost: bool,
    // Loudest captured sample since the last check.
    peak: f32,
}

enum Source {
    /// An output device, by id.
    Output(String),
    App {
        root: u32,
        // Loudest the app's sessions metered since the last check.
        metered: f32,
        // Checks in a row where the app played and nothing was captured.
        missed_checks: u8,
    },
}

/// Captures every output device, or each app root's process tree on its own
/// client, mixed into one track.
fn run_loopback(
    targets: Option<Vec<u32>>,
    missed: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    make_sink: impl FnOnce(u32) -> SamplesCallback,
    ready_tx: &Sender<Result<()>>,
) -> Result<()> {
    let _com = ComGuard::init()?;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|err| anyhow!("Audio enumerator failed: {err}"))?;
    // Output devices whose last open failed, so the failure is logged once.
    let mut failed: HashSet<String> = HashSet::new();
    let mut streams = match targets.as_deref() {
        // Process loopback leaves out call audio, such as a Teams meeting, so
        // the whole system comes from the output devices instead.
        None => {
            let mut streams = Vec::new();
            sync_outputs(&enumerator, &mut streams, &mut failed);
            if streams.is_empty() {
                return Err(anyhow!("No output device could be recorded"));
            }
            streams
        }
        Some(roots) => roots
            .iter()
            .map(|&root| open_process_loopback(root))
            .collect::<Result<Vec<_>>>()?,
    };
    let mut meters = targets.as_deref().map(app_meters).unwrap_or_default();

    let mut sink = make_sink(SAMPLE_RATE);
    let _ = ready_tx.send(Ok(()));

    let mut mono: Vec<f32> = Vec::new();
    let mut mixed: Vec<f32> = Vec::new();
    let mut timeline = Timeline::new(now_hns());
    let (mut checked_at, mut metered_at) = (Instant::now(), Instant::now());
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL_INTERVAL);
        for stream in &mut streams {
            drain_packets(stream, &mut timeline, &mut mono);
        }
        let until = timeline
            .frame_at(now_hns())
            .saturating_sub(MIX_DELAY_FRAMES);
        timeline.take(until, &mut mixed);
        if !mixed.is_empty() {
            sink(&mixed);
        }

        if metered_at.elapsed() >= METER_INTERVAL {
            metered_at = Instant::now();
            read_meters(&meters, &mut streams);
        }
        if checked_at.elapsed() >= CHECK_INTERVAL {
            checked_at = Instant::now();
            match targets.as_deref() {
                None => sync_outputs(&enumerator, &mut streams, &mut failed),
                Some(roots) => {
                    for stream in &mut streams {
                        if missed_app_audio(stream) {
                            missed.store(true, Ordering::Relaxed);
                        }
                    }
                    meters = app_meters(roots);
                }
            }
        }
    }

    for stream in &streams {
        unsafe {
            let _ = stream.client.Stop();
        }
    }
    Ok(())
}

fn drain_packets(stream: &mut Stream, timeline: &mut Timeline, mono: &mut Vec<f32>) {
    unsafe {
        loop {
            let Ok(packet) = stream.capture.GetNextPacketSize() else {
                stream.lost = true;
                break;
            };
            if packet == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            let mut captured_hns: u64 = 0;
            if stream
                .capture
                .GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut flags,
                    None,
                    Some(&mut captured_hns),
                )
                .is_err()
            {
                stream.lost = true;
                break;
            }
            if frames > 0 {
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                    mono.clear();
                    mono.resize(frames as usize, 0.0);
                } else {
                    decode_frames(data, frames as usize, mono);
                    stream.peak = mono.iter().fold(stream.peak, |peak, s| peak.max(s.abs()));
                }
                let stamped = (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 == 0
                    && captured_hns != 0)
                    .then(|| timeline.frame_at(captured_hns));
                let start = match (stream.next, stamped) {
                    (Some(next), Some(at)) if next.abs_diff(at) <= RESYNC_FRAMES => next,
                    (next, at) => at.or(next).unwrap_or(timeline.written),
                };
                timeline.add(start, mono);
                stream.next = Some(start + frames as u64);
            }
            let _ = stream.capture.ReleaseBuffer(frames);
        }
    }
}

/// Every stream mixed by when each packet was captured, so idle devices,
/// streams that start and stop, and drift between device clocks keep their
/// place in time.
struct Timeline {
    origin_hns: u64,
    // Frame of `samples[0]`. Everything before it has been written.
    written: u64,
    samples: VecDeque<f32>,
}

impl Timeline {
    fn new(origin_hns: u64) -> Self {
        Self {
            origin_hns,
            written: 0,
            samples: VecDeque::new(),
        }
    }

    fn frame_at(&self, hns: u64) -> u64 {
        hns.saturating_sub(self.origin_hns) * SAMPLE_RATE as u64 / 10_000_000
    }

    fn add(&mut self, start: u64, mono: &[f32]) {
        let late = self.written.saturating_sub(start) as usize;
        let Some(mono) = mono.get(late..).filter(|rest| !rest.is_empty()) else {
            return;
        };
        let offset = (start + late as u64 - self.written) as usize;
        if self.samples.len() < offset + mono.len() {
            self.samples.resize(offset + mono.len(), 0.0);
        }
        for (slot, sample) in self.samples.range_mut(offset..).zip(mono) {
            *slot += sample;
        }
    }

    /// Everything up to `until`, with silence where nothing played.
    fn take(&mut self, until: u64, out: &mut Vec<f32>) {
        out.clear();
        let count = until.saturating_sub(self.written) as usize;
        let ready = count.min(self.samples.len());
        out.extend(self.samples.drain(..ready));
        out.resize(count, 0.0);
        self.written += count as u64;
    }
}

/// The performance counter in 100 ns units, the clock packet timestamps use.
fn now_hns() -> u64 {
    let (mut counter, mut frequency) = (0i64, 0i64);
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
        let _ = QueryPerformanceFrequency(&mut frequency);
    }
    (counter as u128 * 10_000_000 / frequency.max(1) as u128) as u64
}

/// Drops output devices that went away and opens any that became active, such
/// as headphones connected mid-recording.
fn sync_outputs(
    enumerator: &IMMDeviceEnumerator,
    streams: &mut Vec<Stream>,
    failed: &mut HashSet<String>,
) {
    streams.retain(|stream| !stream.lost);
    for (id, device) in active_outputs(enumerator) {
        let open = streams
            .iter()
            .any(|stream| matches!(&stream.source, Source::Output(open) if *open == id));
        if open {
            continue;
        }
        let opened = unsafe { device.Activate::<IAudioClient>(CLSCTX_ALL, None) }
            .map_err(|err| anyhow!("Audio client activation failed: {err}"))
            .and_then(|client| open_stream(client, Source::Output(id.clone())));
        // Retried on every check, since a device can be busy or not ready yet.
        match opened {
            Ok(stream) => {
                failed.remove(&id);
                streams.push(stream);
            }
            Err(err) => {
                if failed.insert(id) {
                    tracing::warn!("Output device loopback did not open: {err}");
                }
            }
        }
    }
}

fn open_process_loopback(root: u32) -> Result<Stream> {
    let source = Source::App {
        root,
        metered: 0.0,
        missed_checks: 0,
    };
    open_stream(activate_process_loopback(root)?, source)
}

fn open_stream(client: IAudioClient, source: Source) -> Result<Stream> {
    initialize_client(&client)?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }
        .map_err(|err| anyhow!("Capture client unavailable: {err}"))?;
    unsafe { client.Start() }.map_err(|err| anyhow!("Loopback start failed: {err}"))?;
    Ok(Stream {
        client,
        capture,
        source,
        next: None,
        lost: false,
        peak: 0.0,
    })
}

fn read_meters(meters: &[(u32, IAudioMeterInformation)], streams: &mut [Stream]) {
    for (root, meter) in meters {
        let Ok(level) = (unsafe { meter.GetPeakValue() }) else {
            continue;
        };
        for stream in streams.iter_mut() {
            if let Source::App {
                root: app, metered, ..
            } = &mut stream.source
                && app == root
            {
                *metered = metered.max(level);
            }
        }
    }
}

/// Whether the app played for two checks in a row while its capture stayed
/// digitally silent, as with call audio, which process loopback leaves out.
/// Two, since a sound that starts just before a check is captured after it.
fn missed_app_audio(stream: &mut Stream) -> bool {
    let peak = std::mem::take(&mut stream.peak);
    let lost = stream.lost;
    let Source::App {
        metered,
        missed_checks,
        ..
    } = &mut stream.source
    else {
        return false;
    };
    let played = std::mem::take(metered) >= PLAYING_LEVEL;
    *missed_checks = if played && peak == 0.0 && !lost {
        missed_checks.saturating_add(1)
    } else {
        0
    };
    *missed_checks >= 2
}

/// Volume meters of the audible audio sessions in each app root's process tree.
/// A muted session still meters, but no capture gets it.
fn app_meters(roots: &[u32]) -> Vec<(u32, IAudioMeterInformation)> {
    let (Ok(processes), Ok(sessions)) = (running_processes(), audio_sessions()) else {
        return Vec::new();
    };
    sessions
        .into_iter()
        .filter_map(|(pid, session)| {
            let root = ancestor(pid, &processes, |pid| roots.contains(&pid))?;
            let volume: ISimpleAudioVolume = session.cast().ok()?;
            let muted = unsafe { volume.GetMute() }.ok()?.as_bool();
            let level = unsafe { volume.GetMasterVolume() }.ok()?;
            if muted || level == 0.0 {
                return None;
            }
            Some((root, session.cast().ok()?))
        })
        .collect()
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

fn initialize_client(client: &IAudioClient) -> Result<()> {
    let block_align = CHANNELS * 4;
    let format = WAVEFORMATEX {
        wFormatTag: FORMAT_IEEE_FLOAT,
        nChannels: CHANNELS,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * block_align as u32,
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
    .map_err(|err| anyhow!("Loopback init failed: {err}"))
}

/// Live app sessions on every active output device, with their process ids.
fn audio_sessions() -> Result<Vec<(u32, IAudioSessionControl2)>> {
    let mut found = Vec::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|err| anyhow!("Audio enumerator failed: {err}"))?;
        for (_, device) in active_outputs(&enumerator) {
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
                {
                    found.push((pid, session));
                }
            }
        }
    }
    Ok(found)
}

/// Active output devices with their ids.
fn active_outputs(enumerator: &IMMDeviceEnumerator) -> Vec<(String, IMMDevice)> {
    unsafe {
        let Ok(devices) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
            return Vec::new();
        };
        (0..devices.GetCount().unwrap_or(0))
            .filter_map(|index| {
                let device = devices.Item(index).ok()?;
                let raw = device.GetId().ok()?;
                let id = raw.to_string().ok();
                CoTaskMemFree(Some(raw.0 as *const c_void));
                Some((id?, device))
            })
            .collect()
    }
}

/// Processes with a visible top-level window, what Task Manager counts as apps.
fn windowed_pids() -> Result<HashSet<u32>> {
    unsafe extern "system" fn collect(window: HWND, pids: LPARAM) -> BOOL {
        unsafe {
            let unowned = GetWindow(window, GW_OWNER).is_err();
            let tool = GetWindowLongW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0;
            if IsWindowVisible(window).as_bool() && unowned && !tool {
                let mut pid = 0u32;
                GetWindowThreadProcessId(window, Some(&mut pid));
                (*(pids.0 as *mut HashSet<u32>)).insert(pid);
            }
        }
        true.into()
    }
    let mut pids: HashSet<u32> = HashSet::new();
    unsafe {
        EnumWindows(
            Some(collect),
            LPARAM(&mut pids as *mut HashSet<u32> as isize),
        )
    }
    .map_err(|err| anyhow!("Failed to list windows: {err}"))?;
    Ok(pids)
}

/// The nearest of `pid` and its ancestors that `matches`.
fn ancestor(
    pid: u32,
    processes: &[(u32, u32, String)],
    matches: impl Fn(u32) -> bool,
) -> Option<u32> {
    let mut current = pid;
    // Bounded, since a reused parent pid can form a loop.
    for _ in 0..16 {
        if matches(current) {
            return Some(current);
        }
        current = processes
            .iter()
            .find(|(candidate, _, _)| *candidate == current)
            .map(|(_, parent, _)| *parent)
            .filter(|parent| *parent != 0 && *parent != current)?;
    }
    None
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
        .map_or_default(|stem| stem.to_string_lossy().into_owned())
}

fn decode_frames(data: *const u8, frames: usize, mono: &mut Vec<f32>) {
    let channels = CHANNELS as usize;
    let samples = unsafe { std::slice::from_raw_parts(data as *const f32, frames * channels) };
    mono.clear();
    mono.extend(
        samples
            .chunks_exact(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32),
    );
}
