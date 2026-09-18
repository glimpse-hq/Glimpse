//! Long-form recording: microphone and/or system audio captured as separate
//! tracks, written to disk continuously, then saved as a Library item.

mod microphone;
mod track;

#[cfg(target_os = "macos")]
#[path = "system_audio_macos.rs"]
mod system_audio;
#[cfg(target_os = "windows")]
#[path = "system_audio_windows.rs"]
mod system_audio;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Local};
use crossbeam_channel::{Sender, bounded, unbounded};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::library::{AudioSources, Bookmark, LibraryItem, RecordingOutput};
use crate::{AppRuntime, AppState, LibraryJob, LibraryJobKind};
use track::{TrackInput, TrackWriter};

pub const EVENT_STATE: &str = "recording-session:state";
const SESSIONS_DIR: &str = "recording-sessions";
const MANIFEST_FILE: &str = "session.json";
// The last sources used, so the tray can start a recording without the window.
const LAST_SOURCES_FILE: &str = "last-sources.json";
const MICROPHONE_FILE: &str = "microphone.wav";
const SYSTEM_FILE: &str = "system.wav";
const STATE_TICK: Duration = Duration::from_millis(100);
// RMS window mapped onto the 0..1 level meter.
const LEVEL_FLOOR: f32 = 0.006;
const LEVEL_CEILING: f32 = 0.22;

#[derive(Debug, Clone, Serialize)]
pub struct AudioApp {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordingCapabilities {
    pub system_audio: bool,
    pub app_selection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicrophoneSource {
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedApp {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemAudioSource {
    /// `None` captures everything the system plays.
    pub apps: Option<Vec<SelectedApp>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingSources {
    pub microphone: Option<MicrophoneSource>,
    pub system_audio: Option<SystemAudioSource>,
}

pub(crate) enum SystemAudioScope {
    All,
    Apps(Vec<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Idle,
    Recording,
    Paused,
    Saving,
}

impl Status {
    fn label(self) -> &'static str {
        match self {
            Status::Idle => "idle",
            Status::Recording => "recording",
            Status::Paused => "paused",
            Status::Saving => "saving",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionLevels {
    pub microphone: f32,
    pub system_audio: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordingSessionState {
    pub status: &'static str,
    pub elapsed_ms: u64,
    pub sources: AudioSources,
    pub levels: SessionLevels,
    pub bookmarks: Vec<Bookmark>,
    pub finish_requested: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionManifest {
    id: String,
    started_at: DateTime<Local>,
    sources: AudioSources,
    bookmarks: Vec<Bookmark>,
}

/// Wall clock for one session, minus time spent paused. Lock-free so capture
/// callbacks can stamp chunks without blocking.
struct SessionClock {
    started: Instant,
    paused_since_ms: AtomicU64,
    paused_total_ms: AtomicU64,
}

const RUNNING: u64 = u64::MAX;

impl SessionClock {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            paused_since_ms: AtomicU64::new(RUNNING),
            paused_total_ms: AtomicU64::new(0),
        }
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn elapsed_ms(&self) -> u64 {
        let now = self.now_ms();
        let paused_total = self.paused_total_ms.load(Ordering::Relaxed);
        let paused_since = self.paused_since_ms.load(Ordering::Relaxed);
        let current_pause = if paused_since == RUNNING {
            0
        } else {
            now.saturating_sub(paused_since)
        };
        now.saturating_sub(paused_total)
            .saturating_sub(current_pause)
    }

    fn pause(&self) {
        let _ = self.paused_since_ms.compare_exchange(
            RUNNING,
            self.now_ms(),
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
    }

    fn resume(&self) {
        let since = self.paused_since_ms.swap(RUNNING, Ordering::Relaxed);
        if since != RUNNING {
            self.paused_total_ms
                .fetch_add(self.now_ms().saturating_sub(since), Ordering::Relaxed);
        }
    }
}

struct Shared {
    status: Mutex<Status>,
    clock: Mutex<Option<Arc<SessionClock>>>,
    paused: Arc<AtomicBool>,
    microphone_level: Arc<AtomicU32>,
    system_level: Arc<AtomicU32>,
    sources: Mutex<AudioSources>,
    bookmarks: Mutex<Vec<Bookmark>>,
    session_dir: Mutex<Option<PathBuf>>,
    finish_requested: AtomicBool,
    emitter_running: AtomicBool,
}

impl Shared {
    fn state(&self) -> RecordingSessionState {
        let elapsed_ms = self
            .clock
            .lock()
            .as_ref()
            .map(|clock| clock.elapsed_ms())
            .unwrap_or(0);
        RecordingSessionState {
            status: self.status.lock().label(),
            elapsed_ms,
            sources: self.sources.lock().clone(),
            levels: SessionLevels {
                microphone: f32::from_bits(self.microphone_level.load(Ordering::Relaxed)),
                system_audio: f32::from_bits(self.system_level.load(Ordering::Relaxed)),
            },
            bookmarks: self.bookmarks.lock().clone(),
            finish_requested: self.finish_requested.load(Ordering::Relaxed),
        }
    }

    fn is_active(&self) -> bool {
        !matches!(*self.status.lock(), Status::Idle)
    }

    fn reset(&self) {
        *self.status.lock() = Status::Idle;
        *self.clock.lock() = None;
        self.paused.store(false, Ordering::Relaxed);
        self.microphone_level
            .store(0f32.to_bits(), Ordering::Relaxed);
        self.system_level.store(0f32.to_bits(), Ordering::Relaxed);
        *self.sources.lock() = AudioSources::default();
        self.bookmarks.lock().clear();
        *self.session_dir.lock() = None;
        self.finish_requested.store(false, Ordering::Relaxed);
    }
}

struct SessionOutput {
    dir: PathBuf,
    started_at: DateTime<Local>,
    duration_seconds: f32,
    microphone_path: Option<PathBuf>,
    system_path: Option<PathBuf>,
}

enum WorkerCommand {
    Start {
        sources: RecordingSources,
        dir: PathBuf,
        reply: Sender<Result<()>>,
    },
    Finish {
        reply: Sender<Result<SessionOutput>>,
    },
    Discard {
        reply: Sender<()>,
    },
}

pub struct RecordingManager {
    tx: Sender<WorkerCommand>,
    shared: Arc<Shared>,
}

impl Default for RecordingManager {
    fn default() -> Self {
        let shared = Arc::new(Shared {
            status: Mutex::new(Status::Idle),
            clock: Mutex::new(None),
            paused: Arc::new(AtomicBool::new(false)),
            microphone_level: Arc::new(AtomicU32::new(0f32.to_bits())),
            system_level: Arc::new(AtomicU32::new(0f32.to_bits())),
            sources: Mutex::new(AudioSources::default()),
            bookmarks: Mutex::new(Vec::new()),
            session_dir: Mutex::new(None),
            finish_requested: AtomicBool::new(false),
            emitter_running: AtomicBool::new(false),
        });
        let (tx, rx) = unbounded();
        let worker_shared = Arc::clone(&shared);
        // Capture streams are not Send on every platform, so one thread owns them.
        std::thread::Builder::new()
            .name("glimpse-recording".into())
            .spawn(move || {
                let mut worker = Worker {
                    shared: worker_shared,
                    active: None,
                };
                while let Ok(command) = rx.recv() {
                    match command {
                        WorkerCommand::Start {
                            sources,
                            dir,
                            reply,
                        } => {
                            let _ = reply.send(worker.start(sources, dir));
                        }
                        WorkerCommand::Finish { reply } => {
                            let _ = reply.send(worker.finish());
                        }
                        WorkerCommand::Discard { reply } => {
                            worker.discard();
                            let _ = reply.send(());
                        }
                    }
                }
            })
            .expect("failed to spawn recording thread");
        Self { tx, shared }
    }
}

impl RecordingManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> RecordingSessionState {
        self.shared.state()
    }

    pub fn is_active(&self) -> bool {
        self.shared.is_active()
    }

    fn send_start(&self, sources: RecordingSources, dir: PathBuf) -> Result<()> {
        let (reply, rx) = bounded(1);
        self.tx
            .send(WorkerCommand::Start {
                sources,
                dir,
                reply,
            })
            .map_err(|_| anyhow!("Recording worker is gone"))?;
        rx.recv()
            .map_err(|_| anyhow!("Recording worker did not respond"))?
    }

    fn send_finish(&self) -> Result<SessionOutput> {
        let (reply, rx) = bounded(1);
        self.tx
            .send(WorkerCommand::Finish { reply })
            .map_err(|_| anyhow!("Recording worker is gone"))?;
        rx.recv()
            .map_err(|_| anyhow!("Recording worker did not respond"))?
    }

    fn send_discard(&self) {
        let (reply, rx) = bounded(1);
        if self.tx.send(WorkerCommand::Discard { reply }).is_ok() {
            let _ = rx.recv();
        }
    }

    fn pause(&self) -> bool {
        let mut status = self.shared.status.lock();
        if *status != Status::Recording {
            return false;
        }
        if let Some(clock) = self.shared.clock.lock().as_ref() {
            clock.pause();
        }
        self.shared.paused.store(true, Ordering::Relaxed);
        *status = Status::Paused;
        true
    }

    fn resume(&self) -> bool {
        let mut status = self.shared.status.lock();
        if *status != Status::Paused {
            return false;
        }
        if let Some(clock) = self.shared.clock.lock().as_ref() {
            clock.resume();
        }
        self.shared.paused.store(false, Ordering::Relaxed);
        *status = Status::Recording;
        true
    }

    fn add_bookmark(&self) -> Option<Bookmark> {
        if !matches!(
            *self.shared.status.lock(),
            Status::Recording | Status::Paused
        ) {
            return None;
        }
        let at_ms = self.shared.clock.lock().as_ref()?.elapsed_ms();
        let bookmark = Bookmark {
            id: uuid::Uuid::new_v4().to_string(),
            at_ms,
            label: None,
        };
        self.shared.bookmarks.lock().push(bookmark.clone());
        self.write_manifest();
        Some(bookmark)
    }

    fn update_bookmark(&self, id: &str, label: Option<String>) -> bool {
        let mut bookmarks = self.shared.bookmarks.lock();
        let Some(bookmark) = bookmarks.iter_mut().find(|bookmark| bookmark.id == id) else {
            return false;
        };
        bookmark.label = label
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty());
        drop(bookmarks);
        self.write_manifest();
        true
    }

    fn remove_bookmark(&self, id: &str) {
        self.shared
            .bookmarks
            .lock()
            .retain(|bookmark| bookmark.id != id);
        self.write_manifest();
    }

    fn write_manifest(&self) {
        let Some(dir) = self.shared.session_dir.lock().clone() else {
            return;
        };
        let Some(id) = dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
        else {
            return;
        };
        let manifest = SessionManifest {
            id,
            started_at: Local::now(),
            sources: self.shared.sources.lock().clone(),
            bookmarks: self.shared.bookmarks.lock().clone(),
        };
        if let Err(err) = write_manifest_file(&dir, &manifest) {
            tracing::warn!("Failed to write recording manifest: {err}");
        }
    }
}

fn write_manifest_file(dir: &Path, manifest: &SessionManifest) -> Result<()> {
    let contents = serde_json::to_vec_pretty(manifest)?;
    fs::write(dir.join(MANIFEST_FILE), contents)?;
    Ok(())
}

struct ActiveSession {
    dir: PathBuf,
    started_at: DateTime<Local>,
    clock: Arc<SessionClock>,
    microphone: Option<(microphone::MicrophoneCapture, TrackWriter)>,
    system: Option<(system_audio::SystemAudioCapture, TrackWriter)>,
}

struct Worker {
    shared: Arc<Shared>,
    active: Option<ActiveSession>,
}

impl Worker {
    fn start(&mut self, sources: RecordingSources, dir: PathBuf) -> Result<()> {
        if self.active.is_some() {
            return Err(anyhow!("already_recording"));
        }
        if sources.microphone.is_none() && sources.system_audio.is_none() {
            return Err(anyhow!("no_sources"));
        }
        fs::create_dir_all(&dir).with_context(|| format!("Failed to create {}", dir.display()))?;

        let clock = Arc::new(SessionClock::new());
        let started_at = Local::now();
        self.shared.paused.store(false, Ordering::Relaxed);
        self.shared
            .microphone_level
            .store(0f32.to_bits(), Ordering::Relaxed);
        self.shared
            .system_level
            .store(0f32.to_bits(), Ordering::Relaxed);

        let mut summary = AudioSources::default();
        let mut session = ActiveSession {
            dir: dir.clone(),
            started_at,
            clock: Arc::clone(&clock),
            microphone: None,
            system: None,
        };

        let result =
            (|| -> Result<()> {
                // System audio first: it is the source that can be refused, and
                // failing before the microphone opens keeps cleanup simple.
                if let Some(system) = sources.system_audio.as_ref() {
                    let scope = match system.apps.as_ref() {
                        Some(apps) => {
                            SystemAudioScope::Apps(apps.iter().map(|app| app.id.clone()).collect())
                        }
                        None => SystemAudioScope::All,
                    };
                    let path = dir.join(SYSTEM_FILE);
                    let sink = SinkParts {
                        clock: Arc::clone(&clock),
                        paused: Arc::clone(&self.shared.paused),
                        level: Arc::clone(&self.shared.system_level),
                    };
                    let (writer_tx, writer_rx) = bounded::<Result<TrackWriter>>(1);
                    let capture = system_audio::SystemAudioCapture::start(&scope, move |rate| {
                        match TrackWriter::spawn(path, rate, "glimpse-recording-system") {
                            Ok(writer) => {
                                let callback = sink.into_callback(writer.input());
                                let _ = writer_tx.send(Ok(writer));
                                callback
                            }
                            Err(err) => {
                                let _ = writer_tx.send(Err(err));
                                Box::new(|_: &[f32]| {})
                            }
                        }
                    })
                    .map_err(|err| {
                        if err.to_string() == "permission" {
                            anyhow!("system_audio_permission")
                        } else {
                            err
                        }
                    })?;
                    let writer = match writer_rx.recv() {
                        Ok(Ok(writer)) => writer,
                        Ok(Err(err)) => {
                            capture.stop();
                            return Err(err);
                        }
                        Err(_) => {
                            capture.stop();
                            return Err(anyhow!("System audio writer did not start"));
                        }
                    };
                    summary.system_audio = Some(
                        system
                            .apps
                            .as_ref()
                            .map(|apps| apps.iter().map(|app| app.name.clone()).collect())
                            .unwrap_or_default(),
                    );
                    session.system = Some((capture, writer));
                }

                if let Some(mic) = sources.microphone.as_ref() {
                    let path = dir.join(MICROPHONE_FILE);
                    let sink = SinkParts {
                        clock: Arc::clone(&clock),
                        paused: Arc::clone(&self.shared.paused),
                        level: Arc::clone(&self.shared.microphone_level),
                    };
                    let (writer_tx, writer_rx) = bounded::<Result<TrackWriter>>(1);
                    let capture = microphone::start(mic.device_id.as_deref(), move |rate| {
                        match TrackWriter::spawn(path, rate, "glimpse-recording-microphone") {
                            Ok(writer) => {
                                let callback = sink.into_callback(writer.input());
                                let _ = writer_tx.send(Ok(writer));
                                callback
                            }
                            Err(err) => {
                                let _ = writer_tx.send(Err(err));
                                Box::new(|_: &[f32]| {})
                            }
                        }
                    })
                    .map_err(|err| {
                        if err.downcast_ref::<microphone::NoMicrophone>().is_some() {
                            anyhow!("no_microphone")
                        } else {
                            err
                        }
                    })?;
                    let writer = match writer_rx.recv() {
                        Ok(Ok(writer)) => writer,
                        Ok(Err(err)) => return Err(err),
                        Err(_) => return Err(anyhow!("Microphone writer did not start")),
                    };
                    summary.microphone = Some(capture.name.clone());
                    session.microphone = Some((capture, writer));
                }
                Ok(())
            })();

        if let Err(err) = result {
            discard_session(session);
            return Err(err);
        }

        let manifest = SessionManifest {
            id: dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            started_at,
            sources: summary.clone(),
            bookmarks: Vec::new(),
        };
        if let Err(err) = write_manifest_file(&dir, &manifest) {
            tracing::warn!("Failed to write recording manifest: {err}");
        }

        *self.shared.sources.lock() = summary;
        self.shared.bookmarks.lock().clear();
        *self.shared.session_dir.lock() = Some(dir);
        *self.shared.clock.lock() = Some(clock);
        self.shared.finish_requested.store(false, Ordering::Relaxed);
        *self.shared.status.lock() = Status::Recording;
        self.active = Some(session);
        Ok(())
    }

    fn finish(&mut self) -> Result<SessionOutput> {
        let session = self.active.take().ok_or_else(|| anyhow!("not_recording"))?;
        *self.shared.status.lock() = Status::Saving;
        let final_ms = session.clock.elapsed_ms();

        let mut microphone_path = None;
        let mut system_path = None;
        let result = (|| -> Result<()> {
            if let Some((capture, writer)) = session.microphone {
                drop(capture);
                let (path, _) = writer.finish(final_ms)?;
                microphone_path = Some(path);
            }
            if let Some((capture, writer)) = session.system {
                capture.stop();
                let (path, _) = writer.finish(final_ms)?;
                system_path = Some(path);
            }
            Ok(())
        })();
        result?;

        Ok(SessionOutput {
            dir: session.dir,
            started_at: session.started_at,
            duration_seconds: final_ms as f32 / 1000.0,
            microphone_path,
            system_path,
        })
    }
}

impl Worker {
    fn discard(&mut self) {
        if let Some(session) = self.active.take() {
            discard_session(session);
        }
    }
}

fn discard_session(session: ActiveSession) {
    if let Some((capture, writer)) = session.microphone {
        drop(capture);
        writer.discard();
    }
    if let Some((capture, writer)) = session.system {
        capture.stop();
        writer.discard();
    }
    let _ = fs::remove_dir_all(&session.dir);
}

struct SinkParts {
    clock: Arc<SessionClock>,
    paused: Arc<AtomicBool>,
    level: Arc<AtomicU32>,
}

impl SinkParts {
    fn into_callback(self, input: TrackInput) -> Box<dyn FnMut(&[f32]) + Send> {
        Box::new(move |samples: &[f32]| {
            if self.paused.load(Ordering::Relaxed) {
                self.level.store(0f32.to_bits(), Ordering::Relaxed);
                return;
            }
            self.level
                .store(meter_level(samples).to_bits(), Ordering::Relaxed);
            input.push(samples, self.clock.elapsed_ms());
        })
    }
}

fn meter_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let energy: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (energy / samples.len() as f32).sqrt();
    ((rms - LEVEL_FLOOR) / (LEVEL_CEILING - LEVEL_FLOOR))
        .clamp(0.0, 1.0)
        .powf(0.7)
}

fn sessions_root(app: &AppHandle<AppRuntime>) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("App data directory not found")?
        .join(SESSIONS_DIR))
}

fn emit_state(app: &AppHandle<AppRuntime>, shared: &Shared) {
    let _ = app.emit(EVENT_STATE, shared.state());
}

fn sync_tray(app: &AppHandle<AppRuntime>, state: &RecordingSessionState) {
    let elapsed = matches!(state.status, "recording" | "paused").then_some(state.elapsed_ms);
    crate::tray::set_recording_indicator(app, elapsed);
}

/// Refreshes the tray menu (pause/resume/finish items) after a transition.
fn refresh_menus(app: &AppHandle<AppRuntime>) {
    let settings = app.state::<AppState>().current_settings();
    if let Err(err) = crate::tray::refresh_tray_menu(app, &settings) {
        tracing::warn!("Failed to refresh tray menu: {err}");
    }
}

fn start_state_emitter(app: AppHandle<AppRuntime>, shared: Arc<Shared>) {
    if shared.emitter_running.swap(true, Ordering::Relaxed) {
        return;
    }
    std::thread::Builder::new()
        .name("glimpse-recording-state".into())
        .spawn(move || {
            let mut last_tray_key = None;
            loop {
                let state = shared.state();
                let active = state.status != "idle";
                let tray_key = (state.status, state.elapsed_ms / 1000);
                if last_tray_key != Some(tray_key) {
                    last_tray_key = Some(tray_key);
                    sync_tray(&app, &state);
                }
                let _ = app.emit(EVENT_STATE, state);
                if !active {
                    shared.emitter_running.store(false, Ordering::Relaxed);
                    break;
                }
                std::thread::sleep(STATE_TICK);
            }
        })
        .ok();
}

fn check_microphone_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use crate::permissions;
        if permissions::check_microphone_permission_cached() {
            return true;
        }
        let _ = permissions::request_microphone_permission();
        permissions::refresh_microphone_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn selected_model_ready(app: &AppHandle<AppRuntime>, state: &AppState) -> Result<String> {
    let settings = state.current_settings();
    let model = crate::speech::selected_model(&settings);
    if !crate::remote_speech::is_remote_model(&model) {
        let status = crate::model_manager::check_model_status(app.clone(), model.clone())
            .map_err(|err| anyhow!(err))?;
        if !status.installed {
            return Err(anyhow!("no_model"));
        }
    }
    Ok(model)
}

fn save_session(
    app: &AppHandle<AppRuntime>,
    name: String,
    model_key: &str,
    output: SessionOutput,
    sources: AudioSources,
    bookmarks: Vec<Bookmark>,
) -> Result<LibraryItem> {
    let state = app.state::<AppState>();
    let item = crate::library::create_recording_item(
        app,
        state.storage(),
        model_key,
        RecordingOutput {
            name,
            started_at: output.started_at,
            duration_seconds: output.duration_seconds,
            microphone_path: output.microphone_path,
            system_path: output.system_path,
            sources,
            bookmarks,
        },
    )?;
    let _ = fs::remove_dir_all(&output.dir);
    crate::library::schedule_library_job(
        app,
        &state,
        LibraryJob {
            id: item.id.clone(),
            kind: LibraryJobKind::TranscribeExisting,
        },
    );
    Ok(item)
}

/// Sessions left behind by a crash are saved to the Library on launch. The
/// tracks are readable because their headers are refreshed while recording.
pub(crate) fn recover_interrupted_sessions(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if !crate::license::license_gate_active(&state.settings_store) {
        return;
    }
    let Ok(root) = sessions_root(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let model = match selected_model_ready(app, &state) {
        Ok(model) => model,
        Err(err) => {
            tracing::warn!("Skipping recording recovery: {err}");
            return;
        }
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let manifest = fs::read(dir.join(MANIFEST_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SessionManifest>(&bytes).ok());
        let Some(manifest) = manifest else {
            let _ = fs::remove_dir_all(&dir);
            continue;
        };
        let readable = |name: &str| -> Option<(PathBuf, f32)> {
            let path = dir.join(name);
            let info = crate::library::read_wav_info(&path).ok()?;
            (info.total_samples > 0).then_some((path, info.duration_seconds))
        };
        let microphone = manifest
            .sources
            .microphone
            .as_ref()
            .and_then(|_| readable(MICROPHONE_FILE));
        let system = manifest
            .sources
            .system_audio
            .as_ref()
            .and_then(|_| readable(SYSTEM_FILE));
        if microphone.is_none() && system.is_none() {
            let _ = fs::remove_dir_all(&dir);
            continue;
        }
        let duration_seconds = microphone
            .as_ref()
            .map(|(_, d)| *d)
            .unwrap_or(0.0)
            .max(system.as_ref().map(|(_, d)| *d).unwrap_or(0.0));
        let output = SessionOutput {
            dir: dir.clone(),
            started_at: manifest.started_at,
            duration_seconds,
            microphone_path: microphone.map(|(path, _)| path),
            system_path: system.map(|(path, _)| path),
        };
        let name = default_session_name(&manifest.started_at);
        match save_session(
            app,
            name,
            &model,
            output,
            manifest.sources,
            manifest.bookmarks,
        ) {
            Ok(item) => tracing::info!("Recovered interrupted recording {}", item.id),
            Err(err) => tracing::error!("Failed to recover recording: {err}"),
        }
    }
}

fn default_session_name(started_at: &DateTime<Local>) -> String {
    format!("Recording - {}", started_at.format("%b %-d, %-I:%M %p"))
}

#[tauri::command]
pub fn get_recording_capabilities() -> RecordingCapabilities {
    RecordingCapabilities {
        system_audio: system_audio::supported(),
        app_selection: system_audio::app_selection_supported(),
    }
}

#[tauri::command]
pub async fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    tauri::async_runtime::spawn_blocking(system_audio::list_apps)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_recording_session_state(app: AppHandle<AppRuntime>) -> RecordingSessionState {
    app.state::<AppState>().recording().state()
}

/// Blocking start used by the command (off the async runtime) and the tray.
fn start_session(app: &AppHandle<AppRuntime>, sources: RecordingSources) -> Result<()> {
    let state = app.state::<AppState>();
    crate::license::require_license_gate(&state.settings_store, "Recording")
        .map_err(|err| anyhow!(err))?;
    let manager = state.recording();
    if manager.is_active() {
        return Err(anyhow!("already_recording"));
    }
    selected_model_ready(app, &state)?;
    if sources.microphone.is_some() && !check_microphone_permission() {
        return Err(anyhow!("microphone_permission"));
    }
    let root = sessions_root(app)?;
    let dir = root.join(uuid::Uuid::new_v4().to_string());
    manager.send_start(sources.clone(), dir)?;

    if let Ok(json) = serde_json::to_vec(&sources) {
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(root.join(LAST_SOURCES_FILE), json);
    }
    crate::analytics::track_feature_used(app, "recording");
    refresh_menus(app);
    start_state_emitter(app.clone(), Arc::clone(&manager.shared));
    Ok(())
}

#[tauri::command]
pub async fn start_recording_session(
    app: AppHandle<AppRuntime>,
    sources: RecordingSources,
) -> Result<RecordingSessionState, String> {
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_session(&app_for_task, sources))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;
    Ok(app.state::<AppState>().recording().state())
}

fn load_last_sources(app: &AppHandle<AppRuntime>) -> Option<RecordingSources> {
    let bytes = fs::read(sessions_root(app).ok()?.join(LAST_SOURCES_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Sources the last recording started with. The Record screen and the tray
/// both reopen with them.
#[tauri::command]
pub fn get_last_recording_sources(app: AppHandle<AppRuntime>) -> Option<RecordingSources> {
    load_last_sources(&app)
}

/// Tray "Start Recording": reuses the last sources; without any, or on
/// failure, the Record screen opens so the user can sort it out there.
pub(crate) fn start_from_tray(app: &AppHandle<AppRuntime>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let started = match load_last_sources(&app) {
            Some(sources) => start_session(&app, sources),
            None => Err(anyhow!("no_sources")),
        };
        if let Err(err) = started {
            tracing::warn!("Tray start fell back to the Record screen: {err}");
            if let Err(err) =
                crate::tray::open_settings_page(&app, crate::tray::SettingsPage::Record)
            {
                tracing::error!("Failed to open the Record screen: {err}");
            }
        }
    });
}

#[tauri::command]
pub fn pause_recording_session(app: AppHandle<AppRuntime>) -> RecordingSessionState {
    let state = app.state::<AppState>();
    let manager = state.recording();
    manager
        .shared
        .finish_requested
        .store(false, Ordering::Relaxed);
    if manager.pause() {
        refresh_menus(&app);
    }
    emit_state(&app, &manager.shared);
    manager.state()
}

#[tauri::command]
pub fn resume_recording_session(app: AppHandle<AppRuntime>) -> RecordingSessionState {
    let state = app.state::<AppState>();
    let manager = state.recording();
    manager
        .shared
        .finish_requested
        .store(false, Ordering::Relaxed);
    if manager.resume() {
        refresh_menus(&app);
    }
    emit_state(&app, &manager.shared);
    manager.state()
}

#[tauri::command]
pub fn add_recording_bookmark(app: AppHandle<AppRuntime>) -> Result<Bookmark, String> {
    let state = app.state::<AppState>();
    let manager = state.recording();
    let bookmark = manager
        .add_bookmark()
        .ok_or_else(|| "not_recording".to_string())?;
    emit_state(&app, &manager.shared);
    Ok(bookmark)
}

#[tauri::command]
pub fn update_recording_bookmark(
    app: AppHandle<AppRuntime>,
    id: String,
    label: Option<String>,
) -> Result<RecordingSessionState, String> {
    let state = app.state::<AppState>();
    let manager = state.recording();
    if !manager.update_bookmark(&id, label) {
        return Err("bookmark_not_found".into());
    }
    emit_state(&app, &manager.shared);
    Ok(manager.state())
}

#[tauri::command]
pub fn remove_recording_bookmark(app: AppHandle<AppRuntime>, id: String) -> RecordingSessionState {
    let state = app.state::<AppState>();
    let manager = state.recording();
    manager.remove_bookmark(&id);
    emit_state(&app, &manager.shared);
    manager.state()
}

/// Throws the session away: files deleted, nothing added to the Library.
#[tauri::command]
pub async fn discard_recording_session(app: AppHandle<AppRuntime>) -> RecordingSessionState {
    let app_for_task = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        app_for_task.state::<AppState>().recording().send_discard();
    })
    .await;
    let state = app.state::<AppState>();
    let manager = state.recording();
    manager.shared.reset();
    refresh_menus(&app);
    sync_tray(&app, &manager.shared.state());
    emit_state(&app, &manager.shared);
    manager.state()
}

#[tauri::command]
pub async fn finish_recording_session(
    app: AppHandle<AppRuntime>,
    name: String,
) -> Result<LibraryItem, String> {
    let state = app.state::<AppState>();
    let manager = state.recording();
    if !manager.is_active() {
        return Err("not_recording".into());
    }
    let model = selected_model_ready(&app, &state).map_err(|err| err.to_string())?;
    let sources = manager.shared.sources.lock().clone();
    let bookmarks = manager.shared.bookmarks.lock().clone();
    emit_state(&app, &manager.shared);

    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<AppState>();
        let output = state.recording().send_finish()?;
        let name = name.trim().to_string();
        let name = if name.is_empty() {
            default_session_name(&output.started_at)
        } else {
            name
        };
        save_session(&app_for_task, name, &model, output, sources, bookmarks)
    })
    .await
    .map_err(|err| err.to_string())?;

    manager.shared.reset();
    refresh_menus(&app);
    sync_tray(&app, &manager.shared.state());
    emit_state(&app, &manager.shared);
    result.map_err(|err| err.to_string())
}

#[tauri::command]
pub fn open_system_audio_settings(app: AppHandle<AppRuntime>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(system_audio::permission_settings_url(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Tray "Finish Recording": pauses, brings the window to the Record screen and
/// lets the UI open the naming dialog.
pub(crate) fn request_finish_from_tray(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let manager = state.recording();
    if !manager.is_active() {
        return;
    }
    manager.pause();
    manager
        .shared
        .finish_requested
        .store(true, Ordering::Relaxed);
    refresh_menus(app);
    emit_state(app, &manager.shared);
    if let Err(err) = crate::tray::open_settings_page(app, crate::tray::SettingsPage::Record) {
        tracing::error!("Failed to open the Record screen: {err}");
    }
}

pub(crate) fn toggle_pause_from_tray(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let manager = state.recording();
    let changed = if *manager.shared.status.lock() == Status::Paused {
        manager.resume()
    } else {
        manager.pause()
    };
    if changed {
        refresh_menus(app);
        emit_state(app, &manager.shared);
    }
}

pub(crate) fn add_bookmark_from_tray(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let manager = state.recording();
    if manager.add_bookmark().is_some() {
        emit_state(app, &manager.shared);
    }
}
