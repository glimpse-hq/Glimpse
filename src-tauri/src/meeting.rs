use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::OnceLock;
use std::thread;
#[cfg(target_os = "macos")]
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::library::{LibraryImportOptions, LibraryItem, LibraryItemStatus};
use crate::{AppRuntime, AppState, LibraryJob, LibraryJobKind, model_manager, remote_speech};

const EVENT_MEETING_STATE_CHANGED: &str = "meeting:state_changed";
const RECOVERY_MANIFEST_NAME: &str = ".meeting-session.json";
const RECOVERY_MANIFEST_VERSION: u32 = 1;
#[cfg(target_os = "macos")]
const DETECTION_POLL_INTERVAL: Duration = Duration::from_millis(2_500);
#[cfg(target_os = "macos")]
const DETECTION_CONFIRMATION_SAMPLES: u8 = 3;
#[cfg(target_os = "macos")]
const DETECTION_ABSENCE_RESET_SAMPLES: u16 = 120;
#[cfg(target_os = "macos")]
const MEETING_END_CONFIRMATION_SAMPLES: u8 = 3;

#[derive(Clone, Serialize, Deserialize)]
struct MeetingRecoveryManifest {
    version: u32,
    id: String,
    name: String,
    started_at: String,
    options: LibraryImportOptions,
}

#[derive(Clone)]
pub(crate) struct MeetingSession {
    id: String,
    name: String,
    item_dir: PathBuf,
    system_path: PathBuf,
    microphone_path: PathBuf,
    audio_path: PathBuf,
    started_at: String,
    microphone_name: Option<String>,
    source_app_name: Option<String>,
    #[cfg(target_os = "macos")]
    source_provider: Option<crate::platform::macos::meeting_detection::MeetingProvider>,
    application_isolated: bool,
    end_absent_samples: u8,
    end_prompted: bool,
    end_prompt_suppressed: bool,
    capture_stopped: bool,
    capture_error: Option<String>,
    options: LibraryImportOptions,
}

#[derive(Clone, Serialize)]
pub struct MeetingState {
    pub recording: bool,
    pub id: Option<String>,
    pub started_at: Option<String>,
    pub microphone_name: Option<String>,
    pub source_app_name: Option<String>,
    pub application_isolated: bool,
    pub capture_error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct MeetingLevels {
    pub microphone_level: f32,
    pub system_level: f32,
    pub capture_error: Option<String>,
}

impl MeetingState {
    fn idle() -> Self {
        Self {
            recording: false,
            id: None,
            started_at: None,
            microphone_name: None,
            source_app_name: None,
            application_isolated: false,
            capture_error: None,
        }
    }

    fn from_session(session: &MeetingSession) -> Self {
        Self {
            recording: true,
            id: Some(session.id.clone()),
            started_at: Some(session.started_at.clone()),
            microphone_name: session.microphone_name.clone(),
            source_app_name: session.source_app_name.clone(),
            application_isolated: session.application_isolated,
            capture_error: session.capture_error.clone(),
        }
    }
}

impl MeetingRecoveryManifest {
    fn from_session(session: &MeetingSession) -> Self {
        Self {
            version: RECOVERY_MANIFEST_VERSION,
            id: session.id.clone(),
            name: session.name.clone(),
            started_at: session.started_at.clone(),
            options: session.options.clone(),
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct MeetingDetectionState {
    provider: Option<crate::platform::macos::meeting_detection::MeetingProvider>,
    active_samples: u8,
    idle_samples: u8,
    absent_samples: u16,
    prompted: bool,
}

#[cfg(target_os = "macos")]
impl MeetingDetectionState {
    fn reset(&mut self) {
        *self = Self::default();
    }

    fn observe(
        &mut self,
        sample: crate::platform::macos::meeting_detection::DetectionSample,
    ) -> Option<crate::platform::macos::meeting_detection::MeetingProvider> {
        use crate::platform::macos::meeting_detection::DetectionSample;

        match sample {
            DetectionSample::Active(provider) => {
                if self.provider != Some(provider) {
                    *self = Self {
                        provider: Some(provider),
                        ..Self::default()
                    };
                }
                self.idle_samples = 0;
                self.absent_samples = 0;
                self.active_samples = self.active_samples.saturating_add(1);
                if self.active_samples >= DETECTION_CONFIRMATION_SAMPLES && !self.prompted {
                    self.prompted = true;
                    Some(provider)
                } else {
                    None
                }
            }
            DetectionSample::Idle(provider) => {
                if self.provider != Some(provider) {
                    *self = Self {
                        provider: Some(provider),
                        ..Self::default()
                    };
                }
                self.active_samples = 0;
                self.absent_samples = 0;
                self.idle_samples = self.idle_samples.saturating_add(1);
                if self.idle_samples >= DETECTION_CONFIRMATION_SAMPLES {
                    *self = Self::default();
                }
                None
            }
            DetectionSample::Other => {
                self.active_samples = 0;
                self.absent_samples = self.absent_samples.saturating_add(1);
                if self.absent_samples >= DETECTION_ABSENCE_RESET_SAMPLES {
                    *self = Self::default();
                }
                None
            }
        }
    }

    fn allow_retry(
        &mut self,
        provider: crate::platform::macos::meeting_detection::MeetingProvider,
    ) {
        if self.provider == Some(provider) {
            self.prompted = false;
        }
    }
}

#[cfg(target_os = "macos")]
fn meeting_detection_state() -> &'static parking_lot::Mutex<MeetingDetectionState> {
    static STATE: OnceLock<parking_lot::Mutex<MeetingDetectionState>> = OnceLock::new();
    STATE.get_or_init(|| parking_lot::Mutex::new(MeetingDetectionState::default()))
}

#[cfg(target_os = "macos")]
fn observe_recorded_meeting_source(
    session: &mut MeetingSession,
    sample: crate::platform::macos::meeting_detection::DetectionSample,
) -> bool {
    use crate::platform::macos::meeting_detection::DetectionSample;

    let Some(source) = session.source_provider else {
        return false;
    };
    if matches!(sample, DetectionSample::Active(provider) if provider == source) {
        session.end_absent_samples = 0;
        session.end_prompted = false;
        session.end_prompt_suppressed = false;
        return false;
    }

    // Browser calls can only be inspected reliably while that tab is active.
    // Losing browser focus is not evidence that the call itself ended.
    if source.browser_name().is_some()
        && !matches!(sample, DetectionSample::Idle(provider) if provider == source)
    {
        return false;
    }

    if session.end_prompted || session.end_prompt_suppressed {
        return false;
    }
    session.end_absent_samples = session.end_absent_samples.saturating_add(1);
    if session.end_absent_samples < MEETING_END_CONFIRMATION_SAMPLES {
        return false;
    }
    session.end_prompted = true;
    true
}

fn recovery_manifest_path(item_dir: &Path) -> PathBuf {
    item_dir.join(RECOVERY_MANIFEST_NAME)
}

fn write_recovery_manifest(session: &MeetingSession) -> Result<()> {
    let path = recovery_manifest_path(&session.item_dir);
    let temporary = session.item_dir.join(".meeting-session.json.tmp");
    let bytes = serde_json::to_vec_pretty(&MeetingRecoveryManifest::from_session(session))?;
    let mut file = fs::File::create(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn validate_options(
    app: &AppHandle<AppRuntime>,
    options: &LibraryImportOptions,
) -> Result<(), String> {
    if remote_speech::is_remote_model(&options.model_key) {
        return Ok(());
    }
    let status = model_manager::check_model_status(app.clone(), options.model_key.clone())?;
    if status.installed {
        Ok(())
    } else {
        Err("Selected model is not installed".to_string())
    }
}

fn meeting_person_detection_enabled(
    requested: bool,
    remote_model: bool,
    local_model_installed: bool,
) -> bool {
    requested && (remote_model || local_model_installed)
}

fn should_detect_people(app: &AppHandle<AppRuntime>, options: &LibraryImportOptions) -> bool {
    meeting_person_detection_enabled(
        options.detect_speakers,
        remote_speech::is_remote_model(&options.model_key),
        crate::diarization::is_installed(app)
            || crate::speech::installed_diarizer_path(app).is_some(),
    )
}

fn automatic_meeting_options(
    app: &AppHandle<AppRuntime>,
    state: &AppState,
) -> Result<LibraryImportOptions, String> {
    let settings = state.current_settings();
    let options = LibraryImportOptions {
        store_original: false,
        model_key: crate::speech::selected_model(&settings),
        llm_cleanup_enabled: false,
        show_timestamps: true,
        detect_speakers: true,
    };
    validate_options(app, &options)?;
    Ok(options)
}

#[cfg(target_os = "macos")]
pub(crate) fn start_automatic_detection(app: &AppHandle<AppRuntime>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        loop {
            thread::sleep(DETECTION_POLL_INTERVAL);

            let state = app.state::<AppState>();
            let settings = state.current_settings();
            let failed_capture = {
                let mut active = state.meeting_session.lock();
                active.as_mut().and_then(|session| {
                    if session.capture_stopped || session.capture_error.is_some() {
                        return None;
                    }
                    let failure = crate::platform::macos::meeting_capture::levels()
                        .ok()?
                        .capture_error?;
                    session.capture_error = Some(failure.clone());
                    let _ = app.emit(
                        EVENT_MEETING_STATE_CHANGED,
                        MeetingState::from_session(session),
                    );
                    Some(failure)
                })
            };
            if let Some(failure) = failed_capture {
                crate::toast::show(&app, "error", None, &failure);
            }
            if !settings.meeting_detection_enabled {
                meeting_detection_state().lock().reset();
                continue;
            }

            let browser_detection_enabled = settings
                .meeting_detection_apps
                .iter()
                .any(|app_id| app_id.starts_with("browser_"));
            let sample = crate::platform::macos::meeting_detection::inspect_meeting_activity(
                browser_detection_enabled,
            );
            let provider = meeting_detection_state().lock().observe(sample);

            let ended_source_name = {
                let mut active = state.meeting_session.lock();
                active.as_mut().and_then(|session| {
                    observe_recorded_meeting_source(session, sample)
                        .then(|| session.source_app_name.clone())
                        .flatten()
                })
            };
            if let Some(source_name) = ended_source_name {
                crate::toast::emit_toast(
                    &app,
                    crate::toast::Payload {
                        toast_type: "info".to_string(),
                        title: Some(crate::toast::native(&app, "native.meeting.ended_title")),
                        message: crate::toast::native_format(
                            &app,
                            "native.meeting.ended_message",
                            &[("app", source_name.as_str())],
                        ),
                        auto_dismiss: Some(false),
                        duration: None,
                        retry_id: None,
                        mode: None,
                        action: Some("stop_meeting_recording".to_string()),
                        action_label: Some(crate::toast::native(&app, "native.meeting.ended_stop")),
                        secondary_action: Some("continue_detected_meeting_recording".to_string()),
                        secondary_action_label: Some(crate::toast::native(
                            &app,
                            "native.meeting.ended_continue",
                        )),
                    },
                );
            }
            if state.meeting_session.lock().is_some() {
                continue;
            }

            let Some(provider) = provider else {
                continue;
            };
            if !settings
                .meeting_detection_apps
                .iter()
                .any(|app_id| app_id == provider.setting_id())
            {
                meeting_detection_state().lock().allow_retry(provider);
                continue;
            }

            if !crate::license::license_gate_active(&state.settings_store) {
                meeting_detection_state().lock().allow_retry(provider);
                continue;
            }
            if state.recording().is_active()
                || state.pill().status() != crate::pill::PillStatus::Idle
                || automatic_meeting_options(&app, &state).is_err()
            {
                meeting_detection_state().lock().allow_retry(provider);
                continue;
            }

            let provider_name = provider.display_name();
            let title = crate::toast::native(&app, "native.meeting.detected_title");
            let message = crate::toast::native_format(
                &app,
                "native.meeting.detected_message",
                &[("app", provider_name)],
            );
            crate::toast::emit_toast(
                &app,
                crate::toast::Payload {
                    toast_type: "info".to_string(),
                    title: Some(title),
                    message,
                    auto_dismiss: Some(false),
                    duration: None,
                    retry_id: None,
                    mode: None,
                    action: Some("start_detected_meeting_recording".to_string()),
                    action_label: Some(crate::toast::native(
                        &app,
                        "native.meeting.detected_record",
                    )),
                    secondary_action: Some("dismiss_detected_meeting_prompt".to_string()),
                    secondary_action_label: Some(crate::toast::native(
                        &app,
                        "native.meeting.detected_not_now",
                    )),
                },
            );
        }
    });
}

#[derive(Clone, Serialize)]
pub struct MeetingDetectionApp {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn list_installed_meeting_apps(
    app: AppHandle<AppRuntime>,
) -> Result<Vec<MeetingDetectionApp>, String> {
    #[cfg(target_os = "macos")]
    {
        let installed = crate::personalization::icons::list_installed_apps(app)?;
        return Ok(
            crate::platform::macos::meeting_detection::MeetingProvider::CONFIGURABLE
                .into_iter()
                .filter(|provider| {
                    installed.iter().any(|candidate| {
                        crate::platform::macos::meeting_detection::installed_app_matches(
                            *provider,
                            &candidate.name,
                            &candidate.path,
                        )
                    })
                })
                .map(|provider| MeetingDetectionApp {
                    id: provider.setting_id().to_string(),
                    name: provider
                        .browser_name()
                        .unwrap_or_else(|| provider.display_name())
                        .to_string(),
                })
                .collect(),
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn start_detected_meeting_recording(
    app: AppHandle<AppRuntime>,
) -> Result<MeetingState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let options = automatic_meeting_options(&app, &state)?;
        #[cfg(target_os = "macos")]
        {
            let provider = meeting_detection_state().lock().provider;
            start_meeting_recording_impl(options, app.clone(), &state, provider)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = options;
            Err("Meeting recording is not available on this platform yet.".to_string())
        }
    })
    .await
    .map_err(|err| format!("Meeting recording task failed: {err}"))?
}

#[tauri::command]
pub fn dismiss_detected_meeting_prompt() {}

#[tauri::command]
pub fn continue_detected_meeting_recording(state: tauri::State<'_, AppState>) {
    if let Some(mut active) = state.meeting_session.try_lock() {
        if let Some(session) = active.as_mut() {
            session.end_absent_samples = 0;
            session.end_prompted = false;
            session.end_prompt_suppressed = true;
        }
    }
}

#[tauri::command]
pub async fn get_meeting_state(app: AppHandle<AppRuntime>) -> Result<MeetingState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let current = state
            .meeting_session
            .lock()
            .as_ref()
            .map(MeetingState::from_session)
            .unwrap_or_else(MeetingState::idle);
        current
    })
    .await
    .map_err(|err| format!("Could not read meeting state: {err}"))
}

#[tauri::command]
pub fn get_meeting_levels(state: tauri::State<'_, AppState>) -> MeetingLevels {
    if state
        .meeting_session
        .try_lock()
        .is_none_or(|active| active.is_none())
    {
        return MeetingLevels {
            microphone_level: 0.0,
            system_level: 0.0,
            capture_error: None,
        };
    }

    #[cfg(target_os = "macos")]
    if let Ok(levels) = crate::platform::macos::meeting_capture::levels() {
        return MeetingLevels {
            microphone_level: levels.microphone,
            system_level: levels.system,
            capture_error: levels.capture_error,
        };
    }

    MeetingLevels {
        microphone_level: 0.0,
        system_level: 0.0,
        capture_error: None,
    }
}

#[tauri::command]
pub async fn start_meeting_recording(
    options: LibraryImportOptions,
    app: AppHandle<AppRuntime>,
) -> Result<MeetingState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        #[cfg(target_os = "macos")]
        {
            let provider =
                match crate::platform::macos::meeting_detection::inspect_meeting_activity(true) {
                    crate::platform::macos::meeting_detection::DetectionSample::Active(
                        provider,
                    ) => Some(provider),
                    _ => None,
                };
            start_meeting_recording_impl(options, app.clone(), &state, provider)
        }
        #[cfg(not(target_os = "macos"))]
        {
            crate::license::require_license_gate(&state.settings_store, "Meeting recording")?;
            validate_options(&app, &options)?;
            Err("Meeting recording is not available on this platform yet.".to_string())
        }
    })
    .await
    .map_err(|err| format!("Meeting recording task failed: {err}"))?
}

#[cfg(target_os = "macos")]
fn start_meeting_recording_impl(
    options: LibraryImportOptions,
    app: AppHandle<AppRuntime>,
    state: &AppState,
    source_provider: Option<crate::platform::macos::meeting_detection::MeetingProvider>,
) -> Result<MeetingState, String> {
    crate::license::require_license_gate(&state.settings_store, "Meeting recording")?;
    validate_options(&app, &options)?;

    let mut active = state.meeting_session.lock();
    if state.recording().is_active() || state.pill().status() != crate::pill::PillStatus::Idle {
        return Err("Stop the current recording before starting a meeting.".to_string());
    }
    if active.is_some() {
        return Err("A meeting recording is already in progress.".to_string());
    }

    {
        let id = Uuid::new_v4().to_string();
        let now = Local::now();
        let date = now.format("%Y-%m-%d %H:%M").to_string();
        let name =
            crate::toast::native_format(&app, "native.meeting.name", &[("date", date.as_str())]);
        let library_root =
            crate::library::processing::library_root(&app).map_err(|err| err.to_string())?;
        let item_dir = library_root.join(format!(
            "meeting-{}-{}",
            now.format("%Y%m%d-%H%M"),
            &id[..8]
        ));
        fs::create_dir_all(&item_dir).map_err(|err| err.to_string())?;
        let source_app_name = source_provider.map(|provider| provider.display_name().to_string());
        let settings = state.current_settings();
        let mut session = MeetingSession {
            id: id.clone(),
            name,
            system_path: item_dir.join("system.wav"),
            microphone_path: item_dir.join("microphone.wav"),
            audio_path: item_dir.join(format!("{id}.wav")),
            item_dir,
            started_at: Utc::now().to_rfc3339(),
            microphone_name: None,
            source_app_name,
            source_provider,
            application_isolated: false,
            end_absent_samples: 0,
            end_prompted: false,
            end_prompt_suppressed: false,
            capture_stopped: false,
            capture_error: None,
            options,
        };

        if let Err(err) = write_recovery_manifest(&session) {
            let _ = crate::platform::remove_dir_all_compat(&session.item_dir);
            return Err(format!("Could not prepare meeting recovery: {err}"));
        }

        let capture_info = match crate::platform::macos::meeting_capture::start(
            &session.system_path,
            &session.microphone_path,
            settings.microphone_device.as_deref(),
            source_provider.map(|provider| provider.capture_bundle_identifier()),
        ) {
            Ok(info) => info,
            Err(err) => {
                let _ = crate::platform::remove_dir_all_compat(&session.item_dir);
                return Err(format!("Could not start meeting recording: {err}"));
            }
        };
        session.microphone_name = capture_info.microphone_name;
        session.application_isolated = capture_info.application_isolated;

        let meeting_state = MeetingState::from_session(&session);
        *active = Some(session);
        let _ = app.emit(EVENT_MEETING_STATE_CHANGED, &meeting_state);
        Ok(meeting_state)
    }
}

#[tauri::command]
pub async fn stop_meeting_recording(app: AppHandle<AppRuntime>) -> Result<LibraryItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        stop_meeting_recording_impl(&app, &state)
    })
    .await
    .map_err(|err| format!("Meeting recording task failed: {err}"))?
}

fn stop_meeting_recording_impl(
    app: &AppHandle<AppRuntime>,
    state: &tauri::State<'_, AppState>,
) -> Result<LibraryItem, String> {
    let mut active = state.meeting_session.lock();
    let session = active
        .as_mut()
        .ok_or_else(|| "No meeting recording is in progress.".to_string())?;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session);
        return Err("Meeting recording is not available on this platform yet.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        if !session.capture_stopped {
            let result = crate::platform::macos::meeting_capture::stop();
            session.capture_stopped = true;
            if let Err(err) = result {
                session.capture_error = Some(
                    "Capture stopped with an error. Retry saving the captured audio.".to_string(),
                );
                let _ = app.emit(
                    EVENT_MEETING_STATE_CHANGED,
                    MeetingState::from_session(session),
                );
                return Err(format!(
                    "Capture stopped with an error. Retry to save the captured audio: {err}"
                ));
            }
        }

        let duration_seconds = crate::library::processing::finalize_meeting_tracks(
            &session.system_path,
            &session.microphone_path,
            &session.audio_path,
        )
        .map_err(|err| format!("Could not prepare meeting audio: {err}"))?;
        let metadata = fs::metadata(&session.audio_path)
            .context("Failed to read meeting audio")
            .map_err(|err| err.to_string())?;
        let detect_speakers = should_detect_people(&app, &session.options);
        let item = LibraryItem {
            id: session.id.clone(),
            name: session.name.clone(),
            audio_path: session.audio_path.display().to_string(),
            source_path: String::new(),
            store_original: false,
            status: LibraryItemStatus::Pending,
            transcript: None,
            transcript_edited: false,
            segments: None,
            words: None,
            duration_seconds,
            file_size_bytes: metadata.len(),
            original_format: "wav".to_string(),
            created_at: session.started_at.clone(),
            transcribed_at: None,
            tags: Vec::new(),
            llm_cleanup_enabled: false,
            speech_model: session.options.model_key.clone(),
            show_timestamps: session.options.show_timestamps,
            detect_speakers,
            kind: "meeting".to_string(),
            speakers: None,
            secondary_audio_path: None,
            sources: None,
            bookmarks: None,
        };
        state
            .storage()
            .insert_library_item(item.clone())
            .map_err(|err| format!("Failed to save meeting: {err}"))?;
        if let Err(err) = fs::remove_file(recovery_manifest_path(&session.item_dir)) {
            tracing::warn!("Failed to clear completed meeting recovery marker: {err}");
        }
        *active = None;
        drop(active);
        let _ = app.emit(EVENT_MEETING_STATE_CHANGED, MeetingState::idle());
        crate::library::queue::schedule_library_job(
            &app,
            &state,
            LibraryJob {
                id: item.id.clone(),
                kind: LibraryJobKind::TranscribeExisting,
                source: crate::library::JobSource::Recording,
            },
        );
        Ok(item)
    }
}

pub(crate) fn recover_interrupted_meetings(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if !crate::license::license_gate_active(&state.settings_store) {
        return;
    }

    let app = app.clone();
    thread::spawn(move || {
        let recovered = match recover_interrupted_meetings_inner(&app) {
            Ok(recovered) => recovered,
            Err(err) => {
                tracing::error!("Failed to scan interrupted meetings: {err}");
                return;
            }
        };
        if recovered > 0 {
            let message = if recovered == 1 {
                crate::toast::native(&app, "native.meeting.recovered_message_one")
            } else {
                let count = recovered.to_string();
                crate::toast::native_format(
                    &app,
                    "native.meeting.recovered_message_many",
                    &[("count", count.as_str())],
                )
            };
            let title = crate::toast::native(&app, "native.meeting.recovered_title");
            crate::toast::show(&app, "success", Some(&title), &message);
        }
    });
}

fn recover_interrupted_meetings_inner(app: &AppHandle<AppRuntime>) -> Result<usize> {
    let root = crate::library::processing::library_root(app)?;
    if !root.exists() {
        return Ok(0);
    }

    let mut recovered = 0usize;
    for entry in fs::read_dir(root)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                tracing::warn!("Could not inspect a meeting recovery entry: {err}");
                continue;
            }
        };
        let item_dir = entry.path();
        if !item_dir.is_dir() || !entry.file_name().to_string_lossy().starts_with("meeting-") {
            continue;
        }
        let manifest_path = recovery_manifest_path(&item_dir);
        if !manifest_path.is_file() {
            continue;
        }

        match recover_interrupted_meeting(app, &item_dir, &manifest_path) {
            Ok(true) => recovered += 1,
            Ok(false) => {}
            Err(err) => {
                // Keep both the marker and captured tracks so a later version
                // or a manual recovery can try again without losing audio.
                tracing::error!("Could not recover interrupted meeting: {err}");
            }
        }
    }
    Ok(recovered)
}

fn recover_interrupted_meeting(
    app: &AppHandle<AppRuntime>,
    item_dir: &Path,
    manifest_path: &Path,
) -> Result<bool> {
    if fs::metadata(manifest_path)?.len() > 64 * 1024 {
        return Err(anyhow::anyhow!(
            "Meeting recovery marker is unexpectedly large"
        ));
    }
    let manifest: MeetingRecoveryManifest = serde_json::from_slice(&fs::read(manifest_path)?)?;
    if manifest.version != RECOVERY_MANIFEST_VERSION {
        return Err(anyhow::anyhow!(
            "Unsupported meeting recovery marker version"
        ));
    }
    Uuid::parse_str(&manifest.id).context("Invalid meeting recovery identifier")?;
    let expected_suffix = format!("-{}", &manifest.id[..8]);
    if !item_dir
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.ends_with(&expected_suffix))
    {
        return Err(anyhow::anyhow!(
            "Meeting recovery folder does not match its marker"
        ));
    }

    let state = app.state::<AppState>();
    if state.storage().get_library_item(&manifest.id)?.is_some() {
        fs::remove_file(manifest_path)?;
        return Ok(false);
    }

    let system_path = item_dir.join("system.wav");
    let microphone_path = item_dir.join("microphone.wav");
    let audio_path = item_dir.join(format!("{}.wav", manifest.id));
    let duration_seconds = crate::library::processing::finalize_meeting_tracks(
        &system_path,
        &microphone_path,
        &audio_path,
    )?;
    let metadata = fs::metadata(&audio_path).context("Failed to read recovered meeting audio")?;
    let detect_speakers = should_detect_people(app, &manifest.options);
    let item = LibraryItem {
        id: manifest.id.clone(),
        name: crate::toast::native_format(
            app,
            "native.meeting.recovered_name",
            &[("name", manifest.name.as_str())],
        ),
        audio_path: audio_path.display().to_string(),
        source_path: String::new(),
        store_original: false,
        status: LibraryItemStatus::Pending,
        transcript: None,
        transcript_edited: false,
        segments: None,
        words: None,
        duration_seconds,
        file_size_bytes: metadata.len(),
        original_format: "wav".to_string(),
        created_at: manifest.started_at,
        transcribed_at: None,
        tags: vec!["Recovered".to_string()],
        llm_cleanup_enabled: false,
        speech_model: manifest.options.model_key,
        show_timestamps: manifest.options.show_timestamps,
        detect_speakers,
        kind: "recovered_meeting".to_string(),
        speakers: None,
        secondary_audio_path: None,
        sources: None,
        bookmarks: None,
    };
    state.storage().insert_library_item(item.clone())?;
    fs::remove_file(manifest_path)?;
    crate::library::queue::schedule_library_job(
        app,
        &state,
        LibraryJob {
            id: item.id,
            kind: LibraryJobKind::TranscribeExisting,
            source: crate::library::JobSource::Recording,
        },
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::meeting_person_detection_enabled;
    #[cfg(target_os = "macos")]
    use super::{MeetingDetectionState, MeetingSession, observe_recorded_meeting_source};
    #[cfg(target_os = "macos")]
    use crate::platform::macos::meeting_detection::{DetectionSample, MeetingProvider};

    #[cfg(target_os = "macos")]
    fn recorded_session(provider: MeetingProvider) -> MeetingSession {
        MeetingSession {
            id: "meeting-id".to_string(),
            name: "Meeting".to_string(),
            item_dir: std::path::PathBuf::new(),
            system_path: std::path::PathBuf::new(),
            microphone_path: std::path::PathBuf::new(),
            audio_path: std::path::PathBuf::new(),
            started_at: String::new(),
            microphone_name: None,
            source_app_name: Some(provider.display_name().to_string()),
            source_provider: Some(provider),
            application_isolated: true,
            end_absent_samples: 0,
            end_prompted: false,
            end_prompt_suppressed: false,
            capture_stopped: false,
            capture_error: None,
            options: crate::library::LibraryImportOptions {
                store_original: false,
                model_key: String::new(),
                llm_cleanup_enabled: false,
                show_timestamps: true,
                detect_speakers: true,
            },
        }
    }

    #[test]
    fn local_meetings_enable_person_detection_when_the_addon_is_installed() {
        assert!(meeting_person_detection_enabled(true, false, true));
    }

    #[test]
    fn person_detection_stays_disabled_when_it_was_not_requested() {
        assert!(!meeting_person_detection_enabled(false, true, true));
    }

    #[test]
    fn local_meetings_do_not_request_a_missing_addon() {
        assert!(!meeting_person_detection_enabled(true, false, false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn automatic_detection_confirms_a_call_and_prompts_only_once() {
        let mut state = MeetingDetectionState::default();
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Zoom)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Zoom)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Zoom)),
            Some(MeetingProvider::Zoom)
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Zoom)),
            None
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn automatic_detection_allows_a_new_prompt_after_the_app_returns_idle() {
        let mut state = MeetingDetectionState::default();
        for _ in 0..3 {
            state.observe(DetectionSample::Active(MeetingProvider::Teams));
        }
        for _ in 0..3 {
            state.observe(DetectionSample::Idle(MeetingProvider::Teams));
        }

        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Teams)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Teams)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::Teams)),
            Some(MeetingProvider::Teams)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn automatic_detection_eventually_forgets_a_closed_calling_app() {
        let mut state = MeetingDetectionState::default();
        for _ in 0..3 {
            state.observe(DetectionSample::Active(MeetingProvider::FaceTime));
        }
        for _ in 0..super::DETECTION_ABSENCE_RESET_SAMPLES {
            state.observe(DetectionSample::Other);
        }

        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::FaceTime)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::FaceTime)),
            None
        );
        assert_eq!(
            state.observe(DetectionSample::Active(MeetingProvider::FaceTime)),
            Some(MeetingProvider::FaceTime)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn recorded_native_call_prompts_only_after_confirmed_absence() {
        let mut session = recorded_session(MeetingProvider::Zoom);
        assert!(!observe_recorded_meeting_source(
            &mut session,
            DetectionSample::Other
        ));
        assert!(!observe_recorded_meeting_source(
            &mut session,
            DetectionSample::Other
        ));
        assert!(observe_recorded_meeting_source(
            &mut session,
            DetectionSample::Other
        ));
        assert!(!observe_recorded_meeting_source(
            &mut session,
            DetectionSample::Other
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn browser_call_does_not_look_ended_just_because_the_browser_lost_focus() {
        let mut session = recorded_session(MeetingProvider::GoogleMeetSafari);
        for _ in 0..10 {
            assert!(!observe_recorded_meeting_source(
                &mut session,
                DetectionSample::Other
            ));
        }
        for _ in 0..2 {
            assert!(!observe_recorded_meeting_source(
                &mut session,
                DetectionSample::Idle(MeetingProvider::GoogleMeetSafari)
            ));
        }
        assert!(observe_recorded_meeting_source(
            &mut session,
            DetectionSample::Idle(MeetingProvider::GoogleMeetSafari)
        ));
    }
}
