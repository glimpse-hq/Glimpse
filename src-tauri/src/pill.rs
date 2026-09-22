use crate::analytics::{self, Activity};
use crate::permissions;
use crate::{
    AppRuntime, AppState, AudioSpectrumPayload, EVENT_AUDIO_SPECTRUM, MAIN_WINDOW_LABEL, assistive,
    core::hotkeys::{self, HotkeyState},
    emit_event, model_manager, music, platform,
    recorder::{
        MIN_RECORDING_DURATION_MS, NoInputDevice, RecorderManager, SPECTRUM_SIZE, calculate_rms_i16,
    },
    settings::{MediaAction, UserSettings},
    toast,
};
use parking_lot::Mutex;
use rustfft::{FftPlanner, num_complex::Complex};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const MODEL_NOTICE_INTERVAL: Duration = Duration::from_secs(20);
const SMART_MODE_TAP_THRESHOLD: Duration = Duration::from_millis(200);
const OVERLAY_HIDE_AFTER_IDLE_MS: u64 = 180;
const MAX_RECORDING_DURATION: Duration = Duration::from_secs(30 * 60);
const CAPTURE_ARM_DELAY: Duration = Duration::from_millis(280);
pub const EVENT_PILL_STATE: &str = "pill:state";
pub const EVENT_PILL_MODE: &str = "pill:mode";
pub const EVENT_PILL_HOVER: &str = "pill:hover";
pub(crate) const PILL_TONE_DEFAULT: &str = "default";
pub(crate) const PILL_TONE_CLEANUP: &str = "cleanup";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PillStatus {
    Idle,
    Listening,
    Processing,
    Error,
}

impl std::fmt::Display for PillStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PillStatus::Idle => write!(f, "idle"),
            PillStatus::Listening => write!(f, "listening"),
            PillStatus::Processing => write!(f, "processing"),
            PillStatus::Error => write!(f, "error"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingMode {
    Hold,
    Toggle,
}

#[derive(Serialize, Clone)]
pub struct PillStatePayload {
    pub status: PillStatus,
}

const SPECTRUM_BINS: usize = SPECTRUM_SIZE / 2;
const SPECTRUM_SMOOTHING: f32 = 0.8;
const SPECTRUM_MIN_DB: f32 = -100.0;
const SPECTRUM_MAX_DB: f32 = -30.0;
const SPECTRUM_FLOOR_RISE: f32 = 0.0005;

/// A polling thread that stops on request; the join happens off the caller's thread.
struct BackgroundEmitter {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl BackgroundEmitter {
    fn spawn(run: impl FnOnce(&AtomicBool) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_signal = Arc::clone(&stop);
        let handle = std::thread::spawn(move || run(&stop_signal));
        Self {
            stop,
            handle: Some(handle),
        }
    }

    fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            std::thread::spawn(move || {
                let _ = handle.join();
            });
        }
    }
}

// Meter level: RMS mapped between a noise floor and a speech ceiling.
fn microphone_test_level(samples: &[f32]) -> f32 {
    const NOISE_FLOOR: f32 = 0.012;
    const SPEECH_CEILING: f32 = 0.18;
    if samples.is_empty() {
        return 0.0;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    let normalized = (rms - NOISE_FLOOR).max(0.0) / (SPEECH_CEILING - NOISE_FLOOR);
    normalized.powf(0.72).min(1.0)
}

fn start_microphone_level_emitter(
    app: AppHandle<AppRuntime>,
    recorder: Arc<RecorderManager>,
) -> BackgroundEmitter {
    BackgroundEmitter::spawn(move |stop_signal| {
        let interval = Duration::from_millis(40);
        while !stop_signal.load(Ordering::Relaxed) {
            if let Some(samples) = recorder.spectrum_snapshot() {
                let _ = app.emit("microphone-test:level", microphone_test_level(&samples));
            }
            std::thread::sleep(interval);
        }
    })
}

fn start_spectrum_emitter(
    app: AppHandle<AppRuntime>,
    recorder: Arc<RecorderManager>,
) -> BackgroundEmitter {
    BackgroundEmitter::spawn(move |stop_signal| {
        let interval = Duration::from_millis(40);
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(SPECTRUM_SIZE);
        let denom = (SPECTRUM_SIZE - 1) as f32;
        let window: Vec<f32> = (0..SPECTRUM_SIZE)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / denom).cos())
            .collect();
        let mut buffer = vec![Complex { re: 0.0, im: 0.0 }; SPECTRUM_SIZE];
        let mut smoothed = vec![0.0f32; SPECTRUM_BINS];
        let mut floor = vec![1.0f32; SPECTRUM_BINS];
        let mut bins = vec![0u8; SPECTRUM_BINS];

        while !stop_signal.load(Ordering::Relaxed) {
            if let Some(samples) = recorder.spectrum_snapshot() {
                for (idx, sample) in samples.iter().enumerate() {
                    buffer[idx].re = sample * window[idx];
                    buffer[idx].im = 0.0;
                }
                fft.process(&mut buffer);

                for idx in 0..SPECTRUM_BINS {
                    let magnitude = buffer[idx].norm() / SPECTRUM_SIZE as f32;
                    let db = 20.0 * magnitude.max(1e-10).log10();
                    let normalized = ((db - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB))
                        .clamp(0.0, 1.0);
                    // Track the quiet level per bin so steady mic hiss reads as silence.
                    if normalized < floor[idx] {
                        floor[idx] = normalized;
                    } else {
                        floor[idx] += (normalized - floor[idx]) * SPECTRUM_FLOOR_RISE;
                    }
                    let above_floor =
                        ((normalized - floor[idx]) / (1.0 - floor[idx]).max(0.05)).clamp(0.0, 1.0);
                    smoothed[idx] = smoothed[idx] * SPECTRUM_SMOOTHING
                        + above_floor * (1.0 - SPECTRUM_SMOOTHING);
                    bins[idx] = (smoothed[idx] * 255.0).round().clamp(0.0, 255.0) as u8;
                }

                emit_event(
                    &app,
                    EVENT_AUDIO_SPECTRUM,
                    AudioSpectrumPayload { bins: bins.clone() },
                );
            }
            std::thread::sleep(interval);
        }
    })
}

#[derive(Serialize, Clone)]
pub struct PillHoverPayload {
    pub hovering: bool,
}

fn start_hover_emitter(app: AppHandle<AppRuntime>) -> BackgroundEmitter {
    BackgroundEmitter::spawn(move |stop_signal| {
        let interval = Duration::from_millis(50);
        let mut last_emitted: Option<bool> = None;
        while !stop_signal.load(Ordering::Relaxed) {
            if let Some(hovering) = cursor_over_pill_window(&app)
                && last_emitted != Some(hovering)
            {
                last_emitted = Some(hovering);
                emit_event(&app, EVENT_PILL_HOVER, PillHoverPayload { hovering });
            }
            std::thread::sleep(interval);
        }
        emit_event(&app, EVENT_PILL_HOVER, PillHoverPayload { hovering: false });
    })
}

fn cursor_over_pill_window(app: &AppHandle<AppRuntime>) -> Option<bool> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    let cursor = window.cursor_position().ok()?;
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;

    let left = pos.x as f64;
    let top = pos.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;

    Some(cursor.x >= left && cursor.x < right && cursor.y >= top && cursor.y < bottom)
}

pub struct PillController {
    status: Mutex<PillStatus>,
    recording_mode: Mutex<Option<RecordingMode>>,
    shortcut_origin: Mutex<Option<hotkeys::ShortcutAction>>,
    recording_options: Mutex<hotkeys::ShortcutOptions>,
    recording_settings: Mutex<Option<UserSettings>>,
    smart_press_time: Mutex<Option<Instant>>,
    hold_key_down: Mutex<bool>,
    paused_media_session: Mutex<Option<music::MediaSession>>,
    recorder: Arc<RecorderManager>,
    audio_spectrum_emitter: Mutex<Option<BackgroundEmitter>>,
    microphone_test: Mutex<Option<BackgroundEmitter>>,
    hover_emitter: Mutex<Option<BackgroundEmitter>>,
    recording_generation: AtomicU64,
    is_expanded: Mutex<bool>,
    recording_started_at: Mutex<Option<Instant>>,
    stopped_audio_seconds: Mutex<Option<f32>>,
    model_notice_shown_at: Mutex<Option<Instant>>,
}

impl PillController {
    pub fn new(recorder: Arc<RecorderManager>) -> Self {
        Self {
            status: Mutex::new(PillStatus::Idle),
            recording_mode: Mutex::new(None),
            shortcut_origin: Mutex::new(None),
            recording_options: Mutex::new(hotkeys::ShortcutOptions::default()),
            recording_settings: Mutex::new(None),
            smart_press_time: Mutex::new(None),
            hold_key_down: Mutex::new(false),
            paused_media_session: Mutex::new(None),
            recorder,
            audio_spectrum_emitter: Mutex::new(None),
            microphone_test: Mutex::new(None),
            hover_emitter: Mutex::new(None),
            recording_generation: AtomicU64::new(0),
            is_expanded: Mutex::new(false),
            recording_started_at: Mutex::new(None),
            stopped_audio_seconds: Mutex::new(None),
            model_notice_shown_at: Mutex::new(None),
        }
    }

    pub fn status(&self) -> PillStatus {
        *self.status.lock()
    }

    pub fn set_expanded(&self, expanded: bool) {
        *self.is_expanded.lock() = expanded;
    }

    pub fn is_expanded(&self) -> bool {
        *self.is_expanded.lock()
    }

    pub fn recorder(&self) -> &RecorderManager {
        &self.recorder
    }

    fn start_audio_spectrum_emitter(&self, app: &AppHandle<AppRuntime>) {
        let mut emitter = self.audio_spectrum_emitter.lock();
        if emitter.is_some() {
            return;
        }
        *emitter = Some(start_spectrum_emitter(
            app.clone(),
            Arc::clone(&self.recorder),
        ));
    }

    fn stop_audio_spectrum_emitter(&self) {
        if let Some(emitter) = self.audio_spectrum_emitter.lock().take() {
            emitter.stop();
        }
    }

    /// Settings mic test: opens the mic through the recorder and streams a level.
    /// Errors are short codes the frontend maps to copy.
    pub fn start_microphone_test(
        &self,
        app: &AppHandle<AppRuntime>,
        device_id: Option<String>,
    ) -> Result<String, String> {
        if !permissions::check_microphone_permission() {
            return Err("permission".into());
        }
        if self.is_recording() {
            return Err("busy".into());
        }
        self.stop_microphone_test(app);
        let device_name = self.recorder.start_monitor(device_id).map_err(|err| {
            if err.downcast_ref::<NoInputDevice>().is_some() {
                "no_device".to_string()
            } else {
                err.to_string()
            }
        })?;
        *self.microphone_test.lock() = Some(start_microphone_level_emitter(
            app.clone(),
            Arc::clone(&self.recorder),
        ));
        Ok(device_name)
    }

    pub fn stop_microphone_test(&self, app: &AppHandle<AppRuntime>) {
        let Some(emitter) = self.microphone_test.lock().take() else {
            return;
        };
        emitter.stop();
        if let Err(err) = self.recorder.stop() {
            tracing::warn!("Failed to stop microphone test: {err}");
        }
        let _ = app.emit("microphone-test:stopped", ());
    }

    fn start_hover_emitter(&self, app: &AppHandle<AppRuntime>) {
        let mut emitter = self.hover_emitter.lock();
        if emitter.is_some() {
            return;
        }
        *emitter = Some(start_hover_emitter(app.clone()));
    }

    fn stop_hover_emitter(&self) {
        if let Some(emitter) = self.hover_emitter.lock().take() {
            emitter.stop();
        }
    }

    fn model_is_ready(&self, app: &AppHandle<AppRuntime>) -> bool {
        let state = app.state::<AppState>();
        let model = crate::speech::selected_model(&state.current_settings());
        if crate::remote_speech::is_remote_model(&model)
            || state.ready_models.lock().contains(&model)
        {
            return true;
        }

        if self.model_notice_is_due() {
            match state.download_percent(&model) {
                Some(percent) => toast::show(
                    app,
                    "info",
                    None,
                    &toast::native_format(
                        app,
                        "native.toast.model_downloading",
                        &[("percent", &percent.to_string())],
                    ),
                ),
                None => {
                    let downloading = start_model_download(app, &model);
                    toast::show_with_action(
                        app,
                        "info",
                        None,
                        &toast::native(
                            app,
                            if downloading {
                                "native.toast.model_preparing"
                            } else {
                                "native.toast.model_none"
                            },
                        ),
                        "open_models_page",
                        &toast::native(app, "native.toast.model_action"),
                    );
                }
            }
        }
        false
    }

    fn model_notice_is_due(&self) -> bool {
        let mut last = self.model_notice_shown_at.lock();
        if last.is_some_and(|shown| shown.elapsed() < MODEL_NOTICE_INTERVAL) {
            return false;
        }
        *last = Some(Instant::now());
        true
    }

    fn start_streaming_session_if_supported(
        &self,
        app: &AppHandle<AppRuntime>,
        settings: &UserSettings,
    ) {
        let selected_model = crate::speech::selected_model(settings);
        if crate::remote_speech::is_remote_model(&selected_model)
            || !model_manager::is_streaming_model(&selected_model)
        {
            return;
        }

        if let Ok(ready) = model_manager::ensure_model_ready(app, &selected_model) {
            app.state::<AppState>().start_streaming_session(app, &ready);
        }
    }

    fn emit_state(&self, app: &AppHandle<AppRuntime>) {
        let status = *self.status.lock();

        if let Err(err) = app.emit(EVENT_PILL_STATE, PillStatePayload { status }) {
            tracing::error!("Failed to emit pill state: {err}");
        }
    }

    pub fn transition_to(&self, app: &AppHandle<AppRuntime>, new_status: PillStatus) {
        let previous = {
            let mut status = self.status.lock();
            if *status == new_status {
                return;
            }
            let previous = *status;
            *status = new_status;
            previous
        };

        self.update_overlay_visibility(app, previous, new_status);
        self.emit_state(app);
    }

    pub fn transition_to_error(&self, app: &AppHandle<AppRuntime>, message: &str) {
        let status = self.status();
        if matches!(status, PillStatus::Listening | PillStatus::Processing) {
            tracing::error!(
                "[Pill] Suppressing error during active recording ({status}): {message}"
            );
            return;
        }
        tracing::error!("[Pill] {message}");
        if let Err(err) = self.recorder.stop() {
            tracing::error!("[Pill] Failed to stop recorder during error transition: {err}");
        }
        self.resume_paused_media();
        self.reset_recording_state();
        self.set_hold_key_down(false);
        self.transition_to(app, PillStatus::Error);
        let simple_msg = simplify_recording_error(message);
        toast::show(app, "error", None, &simple_msg);
    }

    fn fail_recording_stop(&self, app: &AppHandle<AppRuntime>, context: &str, err: &anyhow::Error) {
        let message = format!("{context}: {err}");
        tracing::error!("[Pill] {message}");
        let settings = app.state::<AppState>().current_settings();
        analytics::track_recording_failed(
            app,
            "stop",
            analytics::error_detail(err),
            microphone_input_kind(&settings),
        );
        self.resume_paused_media();
        self.reset_recording_state();
        self.set_hold_key_down(false);
        self.transition_to(app, PillStatus::Error);
        let simple_msg = simplify_recording_error(&message);
        toast::show(app, "error", None, &simple_msg);
    }

    fn update_overlay_visibility(
        &self,
        app: &AppHandle<AppRuntime>,
        previous: PillStatus,
        next: PillStatus,
    ) {
        if next == PillStatus::Idle {
            let app_handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(OVERLAY_HIDE_AFTER_IDLE_MS));
                if app_handle.state::<AppState>().pill().status() == PillStatus::Idle {
                    app_handle.state::<AppState>().pill().stop_hover_emitter();
                    hide_overlay(&app_handle);
                }
            });
            return;
        }

        if previous == PillStatus::Idle {
            show_overlay(app);
            self.start_hover_emitter(app);
        }
    }

    pub fn reset(&self, app: &AppHandle<AppRuntime>) {
        self.reset_recording_state();
        self.set_hold_key_down(false);
        self.transition_to(app, PillStatus::Idle);
    }

    // Stop-processing cleanup should not invent a release event.
    // Reset/error paths clear this when the whole pill state is discarded.
    pub fn finish_processing(&self, app: &AppHandle<AppRuntime>) {
        let status = self.status();
        let recording = self.is_recording();
        let should_reset = match status {
            PillStatus::Processing => true,
            PillStatus::Listening => !recording,
            _ => false,
        };
        if should_reset {
            self.reset(app);
        }
    }

    fn pause_media_if_playing(&self, app: &AppHandle<AppRuntime>) {
        let settings = app.state::<AppState>().current_settings();
        let mode = match settings.media_action {
            MediaAction::Off => return,
            MediaAction::Pause => music::MediaMode::Pause,
            MediaAction::Duck10 => music::MediaMode::Duck(10),
            MediaAction::Duck25 => music::MediaMode::Duck(25),
            MediaAction::Duck50 => music::MediaMode::Duck(50),
            MediaAction::Duck75 => music::MediaMode::Duck(75),
        };
        let session = Some(music::engage(mode));
        *self.paused_media_session.lock() = session;
    }

    fn resume_paused_media(&self) {
        let session = self.paused_media_session.lock().take();
        music::disengage(session);
    }

    fn reset_recording_state(&self) {
        self.stop_audio_spectrum_emitter();
        end_dictation_activity();
        *self.recording_started_at.lock() = None;
        *self.recording_mode.lock() = None;
        *self.shortcut_origin.lock() = None;
        *self.recording_options.lock() = hotkeys::ShortcutOptions::default();
        *self.recording_settings.lock() = None;
        *self.smart_press_time.lock() = None;
    }

    fn capture_selected_text_if_enabled(
        &self,
        app: &AppHandle<AppRuntime>,
        settings: &UserSettings,
    ) {
        let state = app.state::<AppState>();

        if !settings.cleanup_enabled || !crate::llm_cleanup::is_llm_available(settings) {
            state.set_pending_selected_text(None);
            return;
        }

        let selected_text = match assistive::get_selected_text_ax() {
            Some(text) if text.len() <= 10_000 => Some(text),
            _ => None,
        };
        state.set_pending_selected_text(selected_text);
    }

    fn is_recording(&self) -> bool {
        self.recording_mode.lock().is_some()
    }

    fn active_mode(&self) -> Option<RecordingMode> {
        *self.recording_mode.lock()
    }

    fn try_start_recording(
        &self,
        mode: RecordingMode,
        origin: hotkeys::ShortcutAction,
        options: hotkeys::ShortcutOptions,
    ) -> bool {
        let mut current_mode = self.recording_mode.lock();
        if current_mode.is_some() {
            return false;
        }
        *current_mode = Some(mode);
        *self.shortcut_origin.lock() = Some(origin);
        *self.recording_options.lock() = options;
        if mode == RecordingMode::Hold {
            self.set_hold_key_down(true);
        }
        true
    }

    fn set_hold_key_down(&self, is_down: bool) {
        *self.hold_key_down.lock() = is_down;
    }

    fn clear_hold_state(&self) -> bool {
        let mut hold_down = self.hold_key_down.lock();
        if *hold_down {
            *hold_down = false;
            true
        } else {
            false
        }
    }

    fn prepare_shortcut_press(
        &self,
        app: &AppHandle<AppRuntime>,
        action: hotkeys::ShortcutAction,
    ) -> bool {
        if self.status() == PillStatus::Idle {
            let _ = self.recording_mode.lock().take();
            let _ = self.shortcut_origin.lock().take();
            *self.recording_options.lock() = hotkeys::ShortcutOptions::default();
            self.set_hold_key_down(false);
            let _ = self.smart_press_time.lock().take();
        }

        if self.status() == PillStatus::Processing {
            if *self.shortcut_origin.lock() == Some(action) {
                self.cancel_processing(app, "shortcut");
            }
            return false;
        }

        self.reset_stale_listening_state(app);

        if self.status() == PillStatus::Error {
            toast::hide(app);
            self.reset(app);
        }

        true
    }

    fn start_recording(
        &self,
        app: &AppHandle<AppRuntime>,
        mode: RecordingMode,
        origin: hotkeys::ShortcutAction,
        options: hotkeys::ShortcutOptions,
    ) -> bool {
        if !check_mic_permission(app) {
            crate::analytics::track_first_dictation_attempted(app, "mic_blocked");
            return false;
        }

        if !self.model_is_ready(app) {
            crate::analytics::track_first_dictation_attempted(app, "model_not_ready");
            return false;
        }

        // Dictation wins over an open Settings mic test.
        self.stop_microphone_test(app);

        if !self.try_start_recording(mode, origin, options) {
            return false;
        }
        analytics::set_activity(Activity::Recording);
        *self.recording_started_at.lock() = Some(Instant::now());

        let state = app.state::<AppState>();
        state.clear_cancellation();
        let mut settings = state.current_settings();
        settings.cleanup_enabled = options.cleanup_enabled;
        *self.recording_settings.lock() = Some(settings.clone());

        crate::speech::warm(app, &settings);
        crate::llm_cleanup::prewarm_apple_cleanup(&settings);

        let generation = self.recording_generation.fetch_add(1, Ordering::SeqCst) + 1;
        // Enter Listening before the device opens for fast visual feedback.
        self.transition_to(app, PillStatus::Listening);

        let pending_dir = crate::recordings_root(app)
            .ok()
            .map(|root| root.join(crate::recorder::PENDING_DIR_NAME));
        match self
            .recorder
            .start(settings.microphone_device.clone(), pending_dir)
        {
            Ok(started) => {
                crate::analytics::track_first_dictation_attempted(app, "started");
                // The gate above trusts a cached grant; re-check now that the
                // keypress is served, so a revoked grant is caught next press.
                #[cfg(target_os = "macos")]
                permissions::refresh_microphone_permission_detached();

                self.arm_capture_after_settle(app, generation);
                self.start_audio_spectrum_emitter(app);
                self.pause_media_if_playing(app);
                self.start_streaming_session_if_supported(app, &settings);
                self.spawn_recording_cap(app, generation);

                emit_event(
                    app,
                    crate::EVENT_RECORDING_START,
                    crate::RecordingStartPayload {
                        started_at: started.to_rfc3339(),
                    },
                );
                check_accessibility_warning(app);
                true
            }
            Err(err) => {
                crate::analytics::track_first_dictation_attempted(app, "start_failed");
                analytics::track_recording_failed(
                    app,
                    "start",
                    analytics::error_detail(&err),
                    microphone_input_kind(&settings),
                );
                self.reset_recording_state();
                self.set_hold_key_down(false);
                // Drop out of Listening so transition_to_error isn't suppressed.
                self.transition_to(app, PillStatus::Idle);

                if handle_revoked_mic_permission(app) {
                    return false;
                }

                self.transition_to_error(app, &format!("Unable to start recording: {err}"));
                false
            }
        }
    }

    fn after_delay_if_recording(
        app: &AppHandle<AppRuntime>,
        generation: u64,
        delay: Duration,
        action: impl FnOnce(&Self, &AppHandle<AppRuntime>) + Send + 'static,
    ) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let state = app.state::<AppState>();
            let pill = state.pill();
            if pill.recording_generation.load(Ordering::SeqCst) == generation && pill.is_recording()
            {
                action(pill, &app);
            }
        });
    }

    fn spawn_recording_cap(&self, app: &AppHandle<AppRuntime>, generation: u64) {
        Self::after_delay_if_recording(app, generation, MAX_RECORDING_DURATION, |pill, app| {
            if pill.status() == PillStatus::Listening {
                pill.stop_and_process(app);
            }
        });
    }

    fn arm_capture_after_settle(&self, app: &AppHandle<AppRuntime>, generation: u64) {
        Self::after_delay_if_recording(app, generation, CAPTURE_ARM_DELAY, |pill, _| {
            pill.recorder().arm();
        });
    }

    fn reset_stale_listening_state(&self, app: &AppHandle<AppRuntime>) {
        if self.status() == PillStatus::Listening && !self.is_recording() {
            self.reset(app);
        }
    }

    fn handle_hold_press(
        &self,
        app: &AppHandle<AppRuntime>,
        origin: hotkeys::ShortcutAction,
        options: hotkeys::ShortcutOptions,
    ) -> bool {
        if !self.prepare_shortcut_press(app, origin) {
            return false;
        }

        self.start_recording(app, RecordingMode::Hold, origin, options)
    }

    fn handle_hold_release(&self, app: &AppHandle<AppRuntime>) {
        if !self.clear_hold_state() {
            return;
        }

        if self.active_mode() != Some(RecordingMode::Hold) {
            return;
        }

        self.stop_and_process(app);
    }

    fn handle_toggle_press(&self, app: &AppHandle<AppRuntime>, options: hotkeys::ShortcutOptions) {
        let origin = hotkeys::ShortcutAction::Toggle;
        if !self.prepare_shortcut_press(app, origin) {
            return;
        }

        if self.active_mode() == Some(RecordingMode::Hold) {
            return;
        }

        if self.is_recording() {
            self.stop_and_process(app);
        } else {
            self.start_recording(app, RecordingMode::Toggle, origin, options);
        }
    }

    fn handle_smart_press(
        &self,
        app: &AppHandle<AppRuntime>,
        options: hotkeys::ShortcutOptions,
        press_time: Instant,
    ) {
        let origin = hotkeys::ShortcutAction::Smart;
        if !self.prepare_shortcut_press(app, origin) {
            return;
        }

        if self.is_recording() && self.active_mode() == Some(RecordingMode::Toggle) {
            self.handle_toggle_press(app, options);
            return;
        }

        if self.active_mode() == Some(RecordingMode::Hold) {
            return;
        }

        if self.handle_hold_press(app, origin, options) {
            *self.smart_press_time.lock() = Some(press_time);
        }
    }

    fn handle_smart_release(&self, app: &AppHandle<AppRuntime>, released_at: Instant) {
        let press_time = self.smart_press_time.lock().take();

        if let Some(start_time) = press_time {
            let held_duration = released_at.saturating_duration_since(start_time);
            let release_delay = released_at.elapsed();
            if release_delay >= Duration::from_millis(100) {
                tracing::warn!(
                    held_ms = held_duration.as_millis() as u64,
                    release_delay_ms = release_delay.as_millis() as u64,
                    tap = held_duration < SMART_MODE_TAP_THRESHOLD,
                    "Shortcut release handling delayed"
                );
            }

            if held_duration < SMART_MODE_TAP_THRESHOLD {
                if self.active_mode() == Some(RecordingMode::Hold) {
                    self.set_hold_key_down(false);
                    *self.recording_mode.lock() = Some(RecordingMode::Toggle);
                }
                return;
            }

            self.handle_hold_release(app);
        }
    }

    fn stop_and_process(&self, app: &AppHandle<AppRuntime>) {
        self.stop_and_process_inner(app, true);
    }

    /// Ends the recording when the microphone it opened is unplugged. The
    /// transcript is cut short, so it goes to History without pasting.
    #[cfg(target_os = "macos")]
    pub fn stop_if_input_device_removed(&self, app: &AppHandle<AppRuntime>) {
        if self.status() != PillStatus::Listening
            || !self.is_recording()
            || self.recorder.active_device_present() != Some(false)
        {
            return;
        }
        tracing::warn!("[Pill] Input device removed mid-recording");
        self.clear_hold_state();
        toast::show(
            app,
            "warning",
            None,
            &toast::native(app, "native.toast.mic_removed"),
        );
        self.stop_and_process_inner(app, false);
    }

    fn stop_and_process_inner(&self, app: &AppHandle<AppRuntime>, auto_paste: bool) {
        self.stop_audio_spectrum_emitter();
        let stopped_at = Instant::now();
        analytics::set_activity(Activity::Transcribing);
        let trigger = match self.recording_mode.lock().take() {
            Some(RecordingMode::Toggle) => "toggle",
            _ => "hold",
        };
        *self.stopped_audio_seconds.lock() = self
            .recording_started_at
            .lock()
            .take()
            .map(|started| stopped_at.duration_since(started).as_secs_f32());
        let settings = self
            .recording_settings
            .lock()
            .take()
            .unwrap_or_else(|| app.state::<AppState>().current_settings());
        let recording_options = *self.recording_options.lock();
        let origin = crate::transcribe::DictationOrigin {
            trigger,
            cleanup_shortcut: recording_options.cleanup_enabled,
            stopped_at,
        };
        let state = app.state::<AppState>();
        if auto_paste {
            self.capture_selected_text_if_enabled(app, &settings);
        } else {
            // No paste means no edit mode; keep the raw transcript.
            state.set_pending_selected_text(None);
        }

        let has_streaming = state.has_streaming_session();
        // Create the cancellation token up front, before the worker spawns, so a
        // rapid cancel can't slip in before the token exists and leak a paste.
        let cancel_token = state.create_transcription_token();

        if has_streaming {
            self.transition_to(app, PillStatus::Processing);
            let recorder = Arc::clone(&self.recorder);
            let app_handle = app.clone();
            let resume_app = app_handle.clone();
            let settings_for_transcription = settings.clone();
            std::thread::spawn(move || {
                let streaming_transcript = app_handle
                    .state::<AppState>()
                    .stop_streaming_session(&app_handle)
                    .unwrap_or_default();
                let asr_seconds = stopped_at.elapsed().as_secs_f32();
                match recorder.stop_after_capture(move || {
                    resume_app.state::<AppState>().pill().resume_paused_media();
                }) {
                    Ok(Some(recording)) => {
                        let duration_ms =
                            (recording.ended_at - recording.started_at).num_milliseconds();

                        if duration_ms < MIN_RECORDING_DURATION_MS {
                            analytics::track_dictation_discarded(
                                &app_handle,
                                "too_short",
                                Some(duration_ms as f32 / 1000.0),
                                Some(calculate_rms_i16(&recording.samples)),
                            );
                            discard_pending_recording(&recording);
                            collapse_expanded_pill(&app_handle);
                            app_handle
                                .state::<AppState>()
                                .pill()
                                .finish_processing(&app_handle);
                            return;
                        }

                        // Streaming can miss very short utterances (model
                        // lookahead + final-chunk latency); fall back to
                        // batch transcription of the captured audio.
                        if streaming_transcript.trim().is_empty() {
                            collapse_expanded_pill(&app_handle);
                            crate::persist_recording_async(
                                app_handle,
                                recording,
                                settings_for_transcription,
                                recording_options.temporary,
                                auto_paste,
                                cancel_token,
                                origin,
                            );
                            return;
                        }

                        let saved = match crate::recordings_root(&app_handle).and_then(|base_dir| {
                            crate::recorder::persist_recording(base_dir, &recording)
                        }) {
                            Ok(saved) => saved,
                            Err(err) => {
                                collapse_expanded_pill(&app_handle);
                                app_handle.state::<AppState>().pill().fail_recording_stop(
                                    &app_handle,
                                    "Unable to save recording",
                                    &err,
                                );
                                return;
                            }
                        };
                        app_handle
                            .state::<AppState>()
                            .set_pending_path(Some(saved.path.clone()));

                        crate::transcribe::finalize_streaming_transcription(
                            &app_handle,
                            crate::transcribe::StreamingTranscriptionInput {
                                raw_transcript: streaming_transcript,
                                duration_seconds: (duration_ms.max(0) as f32) / 1000.0,
                                audio_path: saved.path,
                                pending_path: saved.pending_path,
                                settings: settings_for_transcription,
                                temporary: recording_options.temporary,
                                auto_paste,
                                cancel_token,
                                origin,
                                asr_seconds,
                            },
                        );
                    }
                    Ok(None) => {
                        collapse_expanded_pill(&app_handle);
                        app_handle
                            .state::<AppState>()
                            .pill()
                            .finish_processing(&app_handle);
                    }
                    Err(err) => {
                        collapse_expanded_pill(&app_handle);
                        app_handle.state::<AppState>().pill().fail_recording_stop(
                            &app_handle,
                            "Unable to stop recording",
                            &err,
                        );
                    }
                }
            });
        } else {
            self.transition_to(app, PillStatus::Processing);
            let recorder = Arc::clone(&self.recorder);
            let app_handle = app.clone();
            let resume_app = app_handle.clone();
            let settings_for_transcription = settings.clone();
            std::thread::spawn(move || {
                match recorder.stop_after_capture(move || {
                    resume_app.state::<AppState>().pill().resume_paused_media();
                }) {
                    Ok(Some(recording)) => {
                        let duration_ms =
                            (recording.ended_at - recording.started_at).num_milliseconds();
                        if duration_ms < MIN_RECORDING_DURATION_MS {
                            analytics::track_dictation_discarded(
                                &app_handle,
                                "too_short",
                                Some(duration_ms as f32 / 1000.0),
                                Some(calculate_rms_i16(&recording.samples)),
                            );
                            discard_pending_recording(&recording);
                            app_handle
                                .state::<AppState>()
                                .pill()
                                .finish_processing(&app_handle);
                            return;
                        }

                        crate::persist_recording_async(
                            app_handle,
                            recording,
                            settings_for_transcription,
                            recording_options.temporary,
                            auto_paste,
                            cancel_token,
                            origin,
                        );
                    }
                    Ok(None) => {
                        app_handle
                            .state::<AppState>()
                            .pill()
                            .finish_processing(&app_handle);
                    }
                    Err(err) => {
                        app_handle.state::<AppState>().pill().fail_recording_stop(
                            &app_handle,
                            "Unable to stop recording",
                            &err,
                        );
                    }
                }
            });
        }
    }

    pub fn cancel(&self, app: &AppHandle<AppRuntime>, how: &str) {
        let recording_seconds = self
            .is_recording()
            .then(|| *self.recording_started_at.lock())
            .flatten()
            .map(|started| started.elapsed().as_secs_f32());
        self.stop_audio_spectrum_emitter();
        let _ = app.state::<AppState>().stop_streaming_session(app);
        collapse_expanded_pill(app);
        let app_handle = app.clone();
        if let Err(err) = self
            .recorder
            .stop_after_capture_and_discard_pending(move || {
                app_handle.state::<AppState>().pill().resume_paused_media();
            })
        {
            self.resume_paused_media();
            tracing::error!("Failed to stop recorder: {err}");
        }
        self.reset(app);
        if let Some(seconds) = recording_seconds {
            analytics::track_dictation_cancelled(app, "recording", how, Some(seconds));
        }
    }

    pub fn cancel_processing(&self, app: &AppHandle<AppRuntime>, how: &str) {
        if self.status() != PillStatus::Processing {
            return;
        }
        let stage = if analytics::activity() == Activity::Llm {
            "cleanup"
        } else {
            "transcribing"
        };

        self.stop_audio_spectrum_emitter();
        let state = app.state::<AppState>();
        let _ = state.stop_streaming_session(app);
        collapse_expanded_pill(app);
        state.request_cancellation();
        let app_handle = app.clone();
        if let Err(err) = self
            .recorder
            .stop_after_capture_and_discard_pending(move || {
                app_handle.state::<AppState>().pill().resume_paused_media();
            })
        {
            self.resume_paused_media();
            tracing::error!("Failed to stop recorder: {err}");
        }

        if let Some(path) = state.take_pending_path() {
            let _ = std::fs::remove_file(&path);
        }

        toast::show(
            app,
            "info",
            None,
            &toast::native(app, "native.toast.cancelled"),
        );
        self.reset(app);
        let audio_seconds = *self.stopped_audio_seconds.lock();
        analytics::track_dictation_cancelled(app, stage, how, audio_seconds);
    }
}

/// Idle again, unless a recording session or update owns the activity.
fn end_dictation_activity() {
    if matches!(
        analytics::activity(),
        Activity::Recording
            | Activity::Transcribing
            | Activity::Llm
            | Activity::Inserting
            | Activity::ModelLoading
    ) {
        analytics::set_activity(Activity::Idle);
    }
}

pub(crate) fn emit_pill_mode(app: &AppHandle<AppRuntime>, expanded: bool, text: &str) {
    emit_pill_mode_with_tone(app, expanded, text, PILL_TONE_DEFAULT);
}

pub(crate) fn emit_pill_mode_with_tone(
    app: &AppHandle<AppRuntime>,
    expanded: bool,
    text: &str,
    tone: &str,
) {
    app.state::<AppState>().pill().set_expanded(expanded);

    if let Err(err) = app.emit(
        EVENT_PILL_MODE,
        serde_json::json!({ "expanded": expanded, "text": text, "tone": tone }),
    ) {
        tracing::error!("Failed to emit pill mode: {err}");
    }
}

pub(crate) fn collapse_expanded_pill(app: &AppHandle<AppRuntime>) {
    emit_pill_mode(app, false, "");
}

fn discard_pending_recording(recording: &crate::recorder::CompletedRecording) {
    if let Some(path) = recording.pending_path.as_deref() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(target_os = "macos")]
fn show_microphone_permission_toast(app: &AppHandle<AppRuntime>) {
    toast::show_with_action(
        app,
        "error",
        Some("Microphone"),
        "Allow microphone access, then try again.",
        "open_microphone_settings",
        "Open Settings",
    );
}

#[cfg(target_os = "macos")]
fn handle_revoked_mic_permission(app: &AppHandle<AppRuntime>) -> bool {
    if permissions::refresh_microphone_permission() {
        return false;
    }

    show_microphone_permission_toast(app);
    true
}

#[cfg(not(target_os = "macos"))]
fn handle_revoked_mic_permission(_app: &AppHandle<AppRuntime>) -> bool {
    false
}

fn start_model_download(app: &AppHandle<AppRuntime>, model: &str) -> bool {
    let downloadable = crate::speech::catalog::local_manifests()
        .iter()
        .any(|manifest| manifest.id == model && crate::speech::catalog::is_downloadable(manifest));
    if !downloadable {
        return false;
    }
    let app = app.clone();
    let model = model.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::speech::install::download_model_now(app, model, None).await {
            tracing::warn!("Could not start the model download after a dictation: {err}");
        }
    });
    true
}

fn check_mic_permission(app: &AppHandle<AppRuntime>) -> bool {
    #[cfg(target_os = "macos")]
    {
        if permissions::check_microphone_permission_cached() {
            return true;
        }

        if let Err(err) = permissions::request_microphone_permission() {
            tracing::error!("Failed to request microphone permission: {err}");
        }

        if !permissions::refresh_microphone_permission() {
            show_microphone_permission_toast(app);
            return false;
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    true
}

// 0 = not checked yet, 1 = denied, 2 = granted.
static ACCESSIBILITY_AT_RECORDING_START: AtomicU8 = AtomicU8::new(0);

/// Accessibility access as last checked at recording start, without a fresh check.
pub(crate) fn cached_accessibility_granted() -> Option<bool> {
    match ACCESSIBILITY_AT_RECORDING_START.load(Ordering::Relaxed) {
        1 => Some(false),
        2 => Some(true),
        _ => None,
    }
}

fn check_accessibility_warning(app: &AppHandle<AppRuntime>) {
    #[cfg(target_os = "macos")]
    {
        let is_trusted = permissions::check_accessibility_permission();
        ACCESSIBILITY_AT_RECORDING_START.store(if is_trusted { 2 } else { 1 }, Ordering::Relaxed);
        if !is_trusted {
            toast::show_with_action(
                app,
                "warning",
                Some("Accessibility"),
                "Accessibility permissions missing.",
                "open_accessibility_settings",
                "Open Settings",
            );
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn shortcuts_paused(app: &AppHandle<AppRuntime>) -> bool {
    let state = app.state::<AppState>();
    state.is_shortcut_capture_active()
}

pub(crate) fn handle_registered_hotkey_event(
    app: &AppHandle<AppRuntime>,
    action: hotkeys::ShortcutAction,
    state: HotkeyState,
    options: hotkeys::ShortcutOptions,
    occurred_at: Instant,
) {
    if shortcuts_paused(app) {
        return;
    }

    let app_state = app.state::<AppState>();
    let pill = app_state.pill();

    match action {
        hotkeys::ShortcutAction::Smart => match state {
            HotkeyState::Pressed => pill.handle_smart_press(app, options, occurred_at),
            HotkeyState::Released => pill.handle_smart_release(app, occurred_at),
        },
        hotkeys::ShortcutAction::Hold => match state {
            HotkeyState::Pressed => {
                let _ = pill.handle_hold_press(app, action, options);
            }
            HotkeyState::Released => pill.handle_hold_release(app),
        },
        hotkeys::ShortcutAction::Toggle => {
            if state == HotkeyState::Pressed {
                pill.handle_toggle_press(app, options);
            }
        }
    }
}

pub fn register_shortcuts(app: &AppHandle<AppRuntime>) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    if state.is_shortcut_capture_active() {
        return Ok(());
    }

    let settings = state.current_settings();
    let mut parsed_shortcuts: Vec<(&'static str, hotkeys::Hotkey)> = Vec::new();
    let mut bindings = Vec::new();

    let mut add_binding = |label: &'static str,
                           enabled: bool,
                           raw_shortcut: &str,
                           action: hotkeys::ShortcutAction,
                           options: hotkeys::ShortcutOptions| {
        if !enabled {
            return;
        }

        let hotkey = match hotkeys::parse_shortcut(raw_shortcut) {
            Ok(hotkey) => hotkey,
            Err(err) => {
                tracing::error!("Skipping invalid {label} shortcut `{raw_shortcut}`: {err}");
                return;
            }
        };
        if let Err(err) = hotkeys::validate_recording_shortcut(&hotkey) {
            tracing::error!("Skipping unsupported {label} shortcut `{raw_shortcut}`: {err}");
            return;
        }

        if let Some((existing_label, existing_hotkey)) = parsed_shortcuts
            .iter()
            .find(|(_, existing_hotkey)| hotkeys::shortcuts_conflict(existing_hotkey, &hotkey))
        {
            let existing_shortcut = existing_hotkey.to_string();
            tracing::error!(
                "Skipping {label} shortcut `{raw_shortcut}` because it conflicts with {existing_label} shortcut `{existing_shortcut}`"
            );
            return;
        }

        parsed_shortcuts.push((label, hotkey));
        bindings.push(hotkeys::RegisteredHotkey {
            hotkey,
            action,
            options,
        });
    };

    for binding in &settings.shortcut_bindings.smart {
        add_binding(
            "Smart",
            settings.smart_enabled,
            &binding.shortcut,
            hotkeys::ShortcutAction::Smart,
            hotkeys::ShortcutOptions {
                temporary: binding.temporary,
                cleanup_enabled: binding.cleanup_enabled,
            },
        );
    }
    for binding in &settings.shortcut_bindings.hold {
        add_binding(
            "Hold",
            settings.hold_enabled,
            &binding.shortcut,
            hotkeys::ShortcutAction::Hold,
            hotkeys::ShortcutOptions {
                temporary: binding.temporary,
                cleanup_enabled: binding.cleanup_enabled,
            },
        );
    }
    for binding in &settings.shortcut_bindings.toggle {
        add_binding(
            "Toggle",
            settings.toggle_enabled,
            &binding.shortcut,
            hotkeys::ShortcutAction::Toggle,
            hotkeys::ShortcutOptions {
                temporary: binding.temporary,
                cleanup_enabled: binding.cleanup_enabled,
            },
        );
    }

    state.hotkeys.replace_registrations(app, bindings)
}

pub fn show_overlay(app: &AppHandle<AppRuntime>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        position_overlay_on_cursor_screen(&window);
        platform::overlay::show(app, &window);
        if !app.state::<AppState>().pill().is_expanded() {
            collapse_expanded_pill(app);
        }
    }
}

pub fn hide_overlay(app: &AppHandle<AppRuntime>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        platform::overlay::hide(app, &window);
    }
}

fn position_overlay(window: &WebviewWindow<AppRuntime>) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        place_on_monitor(window, &monitor);
    }
}

fn position_overlay_on_cursor_screen(window: &WebviewWindow<AppRuntime>) {
    match crate::toast::monitor_containing_cursor(window) {
        Some(monitor) => place_on_monitor(window, &monitor),
        None => position_overlay(window),
    }
}

/// Centers the window horizontally near the bottom edge of the monitor.
fn place_on_monitor(window: &WebviewWindow<AppRuntime>, monitor: &tauri::Monitor) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale_factor = monitor.scale_factor();
    let screen = monitor.size();
    let mon_pos = monitor.position();
    let x = mon_pos.x + (screen.width.saturating_sub(size.width) / 2) as i32;
    let bottom_padding_physical = (69.0 * scale_factor) as i32;
    let y = mon_pos.y + screen.height as i32 - size.height as i32 - bottom_padding_physical;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

pub fn start_hold_recording(app: &AppHandle<AppRuntime>) -> bool {
    app.state::<AppState>().pill().handle_hold_press(
        app,
        hotkeys::ShortcutAction::Hold,
        hotkeys::ShortcutOptions::default(),
    )
}

#[tauri::command]
pub fn stop_hold_recording(app: AppHandle<AppRuntime>) {
    app.state::<AppState>().pill().handle_hold_release(&app);
}

fn microphone_input_kind(settings: &UserSettings) -> &'static str {
    if settings.microphone_device.is_some() {
        "selected"
    } else {
        "default"
    }
}

/// Simplifies recording error messages
fn simplify_recording_error(message: &str) -> String {
    let msg_lower = message.to_lowercase();

    if msg_lower.contains("permission")
        || msg_lower.contains("not allowed")
        || msg_lower.contains("access denied")
        || msg_lower.contains("coreaudio")
    {
        return "Microphone permission needed. Check System Settings.".to_string();
    }

    if msg_lower.contains("microphone")
        || msg_lower.contains("audio")
        || msg_lower.contains("input device")
    {
        return "Microphone unavailable".to_string();
    }

    if message.len() <= 30 {
        return message.to_string();
    }

    "Recording failed".to_string()
}
