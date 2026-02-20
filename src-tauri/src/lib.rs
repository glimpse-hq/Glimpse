mod accessibility_context;
mod analytics;
mod assistive;
mod audio;
mod core;
mod crypto;
mod dictionary;
mod downloader;
mod library;
mod llm_cleanup;
mod local_transcription;
mod mode_context;
mod model_language_table;
mod model_manager;
mod permissions;
mod personalization;
mod pill;
mod platform;
mod recent_transcriptions;
mod recorder;
mod settings;
mod storage;
mod toast;
mod transcribe;
mod transcription_api;
mod tray;
mod update_checker;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use anyhow::{Context, Result};
use pill::PillController;
use recorder::{
    validate_recording, CompletedRecording, RecorderManager, RecordingRejectionReason,
    RecordingSaved,
};
use reqwest::Client;
use serde::Serialize;
use settings::{default_local_model, LlmProvider, SettingsStore, TranscriptionMode, UserSettings};
use tauri::async_runtime;
use tauri::tray::TrayIcon;
use tauri::Emitter;
use tauri::{AppHandle, Manager, Wry};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_opener::OpenerExt;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETTINGS_WINDOW_LABEL: &str = "settings";
pub(crate) const EVENT_RECORDING_START: &str = "recording:start";
pub(crate) const EVENT_AUDIO_SPECTRUM: &str = "audio:spectrum";
pub(crate) const EVENT_TRANSCRIPTION_COMPLETE: &str = "transcription:complete";
pub(crate) const EVENT_TRANSCRIPTION_ERROR: &str = "transcription:error";
pub(crate) const EVENT_SETTINGS_CHANGED: &str = "settings:changed";
pub(crate) const FEEDBACK_URL: &str = "https://github.com/LegendarySpy/Glimpse/issues/new/choose";
pub(crate) const FFMPEG_HELP_URL: &str = "https://github.com/LegendarySpy/Glimpse/wiki/ffmpeg-mac";

#[cfg(target_os = "macos")]
fn handle_app_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    use crate::recent_transcriptions::{
        copy_transcription_to_clipboard, MENU_ID_RECENT_TRANSCRIPTION_PREFIX,
    };
    use platform::macos::menu::{
        MENU_ID_CHECK_UPDATES, MENU_ID_MIC_DEFAULT, MENU_ID_MIC_PREFIX, MENU_ID_MODEL_PREFIX,
        MENU_ID_MODE_LOCAL, MENU_ID_REPORT_ISSUE, MENU_ID_WEBSITE,
    };
    use tauri_plugin_opener::OpenerExt;

    match id {
        MENU_ID_CHECK_UPDATES => {
            let _ = app.emit("navigate:about", ());
        }
        MENU_ID_WEBSITE => {
            let _ = app
                .opener()
                .open_url("https://github.com/LegendarySpy/Glimpse", None::<&str>);
        }
        MENU_ID_REPORT_ISSUE => {
            let _ = app.opener().open_url(FEEDBACK_URL, None::<&str>);
        }
        MENU_ID_MODE_LOCAL => {
            set_transcription_mode(app, settings::TranscriptionMode::Local);
        }
        MENU_ID_MIC_DEFAULT => {
            set_microphone(app, None);
        }
        _ => {
            if let Some(transcription_id) = id.strip_prefix(MENU_ID_RECENT_TRANSCRIPTION_PREFIX) {
                copy_transcription_to_clipboard(app, transcription_id);
            } else if let Some(model_key) = id.strip_prefix(MENU_ID_MODEL_PREFIX) {
                set_local_model(app, model_key);
            } else if let Some(device_id_raw) = id.strip_prefix(MENU_ID_MIC_PREFIX) {
                let device_id = device_id_raw.strip_prefix("dev:").unwrap_or(device_id_raw);
                set_microphone(app, Some(device_id));
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn handle_app_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    platform::windows::menu::handle_menu_event(app, id);
}

#[cfg(target_os = "macos")]
fn set_transcription_mode(app: &AppHandle<AppRuntime>, mode: settings::TranscriptionMode) {
    let state = app.state::<AppState>();
    let mut current = state.current_settings();
    if current.transcription_mode == mode {
        return;
    }
    current.transcription_mode = mode;
    match state.persist_settings(current.clone()) {
        Ok(saved) => {
            state.request_preflight_refresh();
            if let Err(err) = set_app_menu(app, &saved) {
                eprintln!("Failed to refresh app menu: {err}");
            }
            if let Err(err) = tray::refresh_tray_menu(app, &saved) {
                eprintln!("Failed to refresh tray menu: {err}");
            }
            if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &saved) {
                eprintln!("Failed to emit settings change: {err}");
            }
        }
        Err(err) => eprintln!("Failed to update transcription mode: {err}"),
    }
}

#[cfg(target_os = "macos")]
fn set_local_model(app: &AppHandle<AppRuntime>, model_key: &str) {
    if model_manager::definition(model_key).is_none() {
        eprintln!("Ignoring unknown model selection: {model_key}");
        return;
    }

    match model_manager::check_model_status(app.clone(), model_key.to_string()) {
        Ok(status) if status.installed => {}
        Ok(_) => {
            eprintln!("Model not installed: {model_key}");
            return;
        }
        Err(err) => {
            eprintln!("Failed to check model status for {model_key}: {err}");
            return;
        }
    }

    let state = app.state::<AppState>();
    let mut current = state.current_settings();
    if current.local_model == model_key {
        return;
    }
    current.local_model = model_key.to_string();
    match state.persist_settings(current.clone()) {
        Ok(saved) => {
            if let Err(err) = set_app_menu(app, &saved) {
                eprintln!("Failed to refresh app menu: {err}");
            }
            if let Err(err) = tray::refresh_tray_menu(app, &saved) {
                eprintln!("Failed to refresh tray menu: {err}");
            }
            if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &saved) {
                eprintln!("Failed to emit settings change: {err}");
            }
        }
        Err(err) => eprintln!("Failed to update model selection: {err}"),
    }
}

#[cfg(target_os = "macos")]
fn set_microphone(app: &AppHandle<AppRuntime>, device_id: Option<&str>) {
    let state = app.state::<AppState>();
    let mut current = state.current_settings();
    if current.microphone_device.as_deref() == device_id {
        return;
    }
    current.microphone_device = device_id.map(|id| id.to_string());
    match state.persist_settings(current.clone()) {
        Ok(saved) => {
            if let Err(err) = set_app_menu(app, &saved) {
                eprintln!("Failed to refresh app menu: {err}");
            }
            if let Err(err) = tray::refresh_tray_menu(app, &saved) {
                eprintln!("Failed to refresh tray menu: {err}");
            }
            if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &saved) {
                eprintln!("Failed to emit settings change: {err}");
            }
        }
        Err(err) => eprintln!("Failed to update microphone selection: {err}"),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn set_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &settings::UserSettings,
) -> tauri::Result<()> {
    let menu = platform::macos::menu::build_app_menu(app, settings)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn set_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &settings::UserSettings,
) -> tauri::Result<()> {
    platform::windows::menu::set_app_menu(app, settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = rt.enter();
    tauri::async_runtime::set(rt.handle().clone());

    let aptabase_key = option_env!("APTABASE_KEY").unwrap_or("A-DEV-0000000000");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_aptabase::Builder::new(aptabase_key).build())
        .plugin(tauri_plugin_user_input::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_permissions::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    #[cfg(target_os = "macos")]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        handle_app_menu_event(app, id);
    });

    #[cfg(target_os = "windows")]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        handle_app_menu_event(app, id);
    });

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            let handle = app.handle();
            let settings_store = Arc::new(SettingsStore::new(handle)?);
            let mut settings = settings_store.load().unwrap_or_default();
            if model_manager::definition(&settings.local_model).is_none() {
                settings.local_model = default_local_model();
                if let Err(err) = settings_store.save(&settings) {
                    eprintln!("Failed to persist default local model: {err}");
                }
            }

            app.manage(AppState::new(Arc::clone(&settings_store), settings, handle));

            #[cfg(target_os = "macos")]
            {
                let handle = app.handle();
                let settings = handle.state::<AppState>().current_settings();
                if let Err(err) = set_app_menu(handle, &settings) {
                    eprintln!("Failed to set app menu: {err}");
                }
            }

            #[cfg(target_os = "windows")]
            {
                let handle = app.handle();
                let settings = handle.state::<AppState>().current_settings();
                if let Err(err) = set_app_menu(handle, &settings) {
                    eprintln!("Failed to set app menu: {err}");
                }
                if let Err(err) = platform::windows::hotkeys::init(handle) {
                    eprintln!("Failed to initialize Windows hotkey platform stubs: {err}");
                }
            }

            if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.hide();
                platform::overlay::init(handle, &window);
            }

            if let Some(toast_window) = handle.get_webview_window(toast::WINDOW_LABEL) {
                let _ = toast_window.hide();
                platform::toast::init(handle, &toast_window);
            }

            if let Ok(tray) = tray::build_tray(handle) {
                handle.state::<AppState>().store_tray(tray);
            }

            if let Err(err) = pill::register_shortcuts(handle) {
                eprintln!("Failed to register shortcuts: {err}");
            }

            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let _ = tray::toggle_settings_window(&h);
            });

            let update_handle = handle.clone();
            let update_state = handle.state::<AppState>().update_state().clone();
            update_checker::start_background_checker(update_handle, update_state);

            handle
                .state::<AppState>()
                .start_preflight_loop(handle.clone());

            let _ = app.track_event("app_started", None);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            set_user_name,
            dictionary::set_dictionary,
            dictionary::get_replacements,
            dictionary::set_replacements,
            personalization::get_personalities,
            personalization::set_personalities,
            personalization::list_installed_apps,
            get_app_info,
            open_data_dir,
            get_transcriptions,
            delete_transcription,
            delete_all_transcriptions,
            retry_transcription,
            retry_llm_cleanup,
            undo_llm_cleanup,
            cancel_retry_transcription,
            library::commands::create_library_item,
            library::commands::get_library_items_page,
            library::commands::update_library_item,
            library::commands::delete_library_item,
            library::commands::cancel_library_transcription,
            library::commands::retry_library_transcription,
            library::commands::export_library_item_to_path,
            library::commands::get_library_tags,
            model_manager::list_models,
            model_manager::check_model_status,
            model_manager::download_model,
            model_manager::delete_model,
            model_manager::cancel_download,
            audio::list_input_devices,
            toast::toast_dismissed,
            open_accessibility_settings,
            open_microphone_settings,
            open_llm_cleanup_settings,
            open_ffmpeg_install,
            complete_onboarding,
            cancel_recording,
            reset_onboarding,
            toast::debug_show_toast,
            fetch_llm_models,
            open_whats_new,
            open_about_page,
            update_checker::get_update_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handler, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect();
                if let Err(err) = library::handle_opened_paths(handler, paths) {
                    eprintln!("Failed to handle opened files: {err}");
                }
            }
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    let _ = tray::toggle_settings_window(handler);
                }
            }
            tauri::RunEvent::Exit => {
                let state = handler.state::<AppState>();
                state.stop_preflight_loop();
                let now = Instant::now();
                let counters = state.session_counters.lock();
                analytics::track_app_exited(
                    handler,
                    (now - state.session_started_at).as_secs_f64(),
                    counters.recording_seconds,
                    counters.transcription_count,
                );
                handler.flush_events_blocking();
            }
            _ => {}
        });
}

pub(crate) type AppRuntime = Wry;

type GlimpseResult<T> = Result<T>;

#[derive(Clone)]
pub struct LibraryJob {
    pub id: String,
    pub kind: LibraryJobKind,
}

#[derive(Clone)]
pub enum LibraryJobKind {
    Import {
        source_path: PathBuf,
        store_original: bool,
    },
    TranscribeExisting,
}

pub struct AppState {
    pill: Arc<PillController>,
    http: Client,
    local_transcriber: Arc<local_transcription::LocalTranscriber>,
    storage: Arc<storage::StorageManager>,
    settings_store: Arc<SettingsStore>,
    settings: parking_lot::Mutex<UserSettings>,
    pub(crate) tray: parking_lot::Mutex<Option<TrayIcon<AppRuntime>>>,
    pub(crate) settings_close_handler_registered: AtomicBool,
    transcription_cancelled: AtomicBool,
    transcription_token: parking_lot::Mutex<Option<CancellationToken>>,
    ffmpeg_toast_shown: AtomicBool,
    pending_recording_path: parking_lot::Mutex<Option<PathBuf>>,
    pending_selected_text: parking_lot::Mutex<Option<String>>,
    download_tokens: parking_lot::Mutex<HashMap<String, CancellationToken>>,
    library_tokens: parking_lot::Mutex<HashMap<String, CancellationToken>>,
    library_queue: parking_lot::Mutex<VecDeque<LibraryJob>>,
    library_active: parking_lot::Mutex<Option<String>>,
    retry_tokens: parking_lot::Mutex<HashMap<String, CancellationToken>>,
    update_state: update_checker::SharedUpdateState,
    preflight_cancel: CancellationToken,
    preflight_started: AtomicBool,
    preflight_notify: Arc<Notify>,
    session_started_at: Instant,
    session_counters: parking_lot::Mutex<SessionCounters>,
}

#[derive(Clone, Copy)]
struct SessionCounters {
    recording_seconds: f64,
    transcription_count: u32,
}

impl AppState {
    pub fn new(
        settings_store: Arc<SettingsStore>,
        settings: UserSettings,
        app_handle: &AppHandle<AppRuntime>,
    ) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");

        let storage_path = app_handle
            .path()
            .app_data_dir()
            .expect("Failed to resolve app data directory")
            .join("transcriptions.db");

        let storage = storage::StorageManager::new(storage_path)
            .expect("Failed to initialize transcription storage");

        let recorder = Arc::new(RecorderManager::new());

        let local_transcriber = Arc::new(local_transcription::LocalTranscriber::new());
        local_transcriber.start_idle_monitor();

        Self {
            pill: Arc::new(PillController::new(Arc::clone(&recorder))),
            http,
            local_transcriber,
            storage: Arc::new(storage),
            settings_store,
            settings: parking_lot::Mutex::new(settings),
            tray: parking_lot::Mutex::new(None),
            settings_close_handler_registered: AtomicBool::new(false),
            transcription_cancelled: AtomicBool::new(false),
            transcription_token: parking_lot::Mutex::new(None),
            ffmpeg_toast_shown: AtomicBool::new(false),
            pending_recording_path: parking_lot::Mutex::new(None),
            pending_selected_text: parking_lot::Mutex::new(None),
            download_tokens: parking_lot::Mutex::new(HashMap::new()),
            library_tokens: parking_lot::Mutex::new(HashMap::new()),
            library_queue: parking_lot::Mutex::new(VecDeque::new()),
            library_active: parking_lot::Mutex::new(None),
            retry_tokens: parking_lot::Mutex::new(HashMap::new()),
            update_state: update_checker::create_state(),
            preflight_cancel: CancellationToken::new(),
            preflight_started: AtomicBool::new(false),
            preflight_notify: Arc::new(Notify::new()),
            session_started_at: Instant::now(),
            session_counters: parking_lot::Mutex::new(SessionCounters {
                recording_seconds: 0.0,
                transcription_count: 0,
            }),
        }
    }

    pub fn current_settings(&self) -> UserSettings {
        match self.settings_store.load() {
            Ok(latest) => {
                *self.settings.lock() = latest.clone();
                latest
            }
            Err(err) => {
                eprintln!("Failed to load settings from DB, using cache: {err}");
                self.settings.lock().clone()
            }
        }
    }

    pub fn persist_settings(&self, mut next: UserSettings) -> GlimpseResult<UserSettings> {
        if matches!(next.transcription_mode, TranscriptionMode::Cloud) {
            next.transcription_mode = TranscriptionMode::Local;
        }

        self.settings_store.save(&next)?;
        *self.settings.lock() = next.clone();
        Ok(next)
    }

    pub fn pill(&self) -> &PillController {
        &self.pill
    }

    pub fn record_recording_seconds(&self, duration_secs: f64) {
        if duration_secs.is_finite() && duration_secs > 0.0 {
            self.session_counters.lock().recording_seconds += duration_secs;
        }
    }

    pub fn record_transcription_completed(&self) {
        self.session_counters.lock().transcription_count += 1;
    }

    fn http(&self) -> Client {
        self.http.clone()
    }

    fn local_transcriber(&self) -> Arc<local_transcription::LocalTranscriber> {
        Arc::clone(&self.local_transcriber)
    }

    fn storage(&self) -> Arc<storage::StorageManager> {
        Arc::clone(&self.storage)
    }

    pub fn store_tray(&self, tray: TrayIcon<AppRuntime>) {
        *self.tray.lock() = Some(tray);
    }

    pub fn request_cancellation(&self) {
        self.transcription_cancelled.store(true, Ordering::SeqCst);
        if let Some(token) = self.transcription_token.lock().as_ref() {
            token.cancel();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.transcription_cancelled.load(Ordering::SeqCst)
    }

    pub fn clear_cancellation(&self) {
        self.transcription_cancelled.store(false, Ordering::SeqCst);
        *self.transcription_token.lock() = None;
    }

    pub fn create_transcription_token(&self) -> CancellationToken {
        let token = CancellationToken::new();
        *self.transcription_token.lock() = Some(token.clone());
        token
    }

    pub fn should_show_ffmpeg_toast(&self) -> bool {
        self.ffmpeg_toast_shown
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn set_pending_path(&self, path: Option<PathBuf>) {
        *self.pending_recording_path.lock() = path;
    }

    pub fn take_pending_path(&self) -> Option<PathBuf> {
        self.pending_recording_path.lock().take()
    }

    pub fn set_pending_selected_text(&self, text: Option<String>) {
        *self.pending_selected_text.lock() = text;
    }

    pub fn take_pending_selected_text(&self) -> Option<String> {
        self.pending_selected_text.lock().take()
    }

    pub fn create_download_token(&self, model: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.download_tokens
            .lock()
            .insert(model.to_string(), token.clone());
        token
    }

    pub fn cancel_download(&self, model: &str) -> bool {
        if let Some(token) = self.download_tokens.lock().remove(model) {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn clear_download_token(&self, model: &str) {
        self.download_tokens.lock().remove(model);
    }

    pub fn register_library_transcription(&self, id: String) -> CancellationToken {
        let mut tokens = self.library_tokens.lock();
        if let Some(token) = tokens.get(&id) {
            return token.clone();
        }
        let token = CancellationToken::new();
        tokens.insert(id, token.clone());
        token
    }

    pub fn enqueue_library_job(&self, job: LibraryJob) -> bool {
        if self.library_tokens.lock().contains_key(&job.id) {
            return false;
        }
        if self.library_active.lock().as_deref() == Some(&job.id) {
            return false;
        }
        let mut queue = self.library_queue.lock();
        if queue.iter().any(|queued| queued.id == job.id) {
            return false;
        }
        queue.push_back(job);
        true
    }

    pub fn claim_next_library_job(&self) -> Option<LibraryJob> {
        let mut active = self.library_active.lock();
        if active.is_some() {
            return None;
        }
        let mut queue = self.library_queue.lock();
        let next = queue.pop_front()?;
        *active = Some(next.id.clone());
        Some(next)
    }

    pub fn clear_active_library_job(&self, id: &str) {
        let mut active = self.library_active.lock();
        if active.as_deref() == Some(id) {
            *active = None;
        }
    }

    pub fn remove_library_job(&self, id: &str) -> bool {
        let mut queue = self.library_queue.lock();
        let before = queue.len();
        queue.retain(|queued| queued.id != id);
        before != queue.len()
    }

    pub fn cancel_library_transcription(&self, id: &str) {
        if let Some(token) = self.library_tokens.lock().get(id) {
            token.cancel();
        }
    }

    pub fn clear_library_transcription(&self, id: &str) {
        self.library_tokens.lock().remove(id);
    }

    pub fn register_retry_transcription(&self, id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.retry_tokens.lock().insert(id, token.clone());
        token
    }

    pub fn cancel_retry_transcription(&self, id: &str) -> bool {
        if let Some(token) = self.retry_tokens.lock().remove(id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn clear_retry_transcription(&self, id: &str) {
        self.retry_tokens.lock().remove(id);
    }

    pub fn start_preflight_loop(&self, app: AppHandle<AppRuntime>) {
        if self.preflight_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let token = self.preflight_cancel.clone();
        let notify = Arc::clone(&self.preflight_notify);

        async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(llm_cleanup::PREFLIGHT_TTL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let mut refresh_pending = false;

            loop {
                tokio::select! {
                    _ = token.cancelled() => break,
                    _ = notify.notified() => {
                        refresh_pending = true;
                    }
                    _ = ticker.tick() => {}
                }

                if token.is_cancelled() {
                    break;
                }

                if !refresh_pending {
                    // If woken by ticker, check if cache is still fresh (< TTL).
                    // Returns None when cache is expired, triggering refresh below.
                    if llm_cleanup::cached_preflight_available().is_some() {
                        continue;
                    }
                }

                let state = app.state::<AppState>();
                let settings = state.current_settings();
                llm_cleanup::run_preflight(state.http(), settings).await;
                refresh_pending = false;
            }
        });
    }

    pub fn stop_preflight_loop(&self) {
        self.preflight_cancel.cancel();
    }

    pub fn request_preflight_refresh(&self) {
        llm_cleanup::clear_preflight_cache();
        self.preflight_notify.notify_one();
    }

    pub fn update_state(&self) -> &update_checker::SharedUpdateState {
        &self.update_state
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Result<UserSettings, String> {
    Ok(state.current_settings())
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    permissions::open_accessibility_settings()
}

#[tauri::command]
fn open_microphone_settings() -> Result<(), String> {
    permissions::open_microphone_settings()
}

#[tauri::command]
fn open_llm_cleanup_settings(app: AppHandle<AppRuntime>) -> Result<(), String> {
    if let Err(err) = tray::toggle_settings_window(&app) {
        eprintln!("Failed to open settings window: {err}");
        return Err(err.to_string());
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Err(err) = app_clone.emit("navigate:models", ()) {
            eprintln!("Failed to emit navigate:models: {err}");
        }
    });

    Ok(())
}

#[tauri::command]
fn open_ffmpeg_install(app: AppHandle<AppRuntime>) -> Result<(), String> {
    app.opener()
        .open_url(FFMPEG_HELP_URL, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn complete_onboarding(
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    core::settings::complete_onboarding(&app, &state)
}

#[tauri::command]
fn reset_onboarding(
    _app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    core::settings::reset_onboarding(&state)
}

#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
fn update_settings(
    smartShortcut: String,
    smartEnabled: bool,
    holdShortcut: String,
    holdEnabled: bool,
    toggleShortcut: String,
    toggleEnabled: bool,
    transcriptionMode: TranscriptionMode,
    localModel: String,
    microphoneDevice: Option<String>,
    language: String,
    llmCleanupEnabled: bool,
    llmProvider: LlmProvider,
    llmEndpoint: String,
    llmApiKey: String,
    llmModel: String,
    editModeEnabled: bool,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<UserSettings, String> {
    core::settings::update_settings(
        core::settings::UpdateSettingsArgs {
            smart_shortcut: smartShortcut,
            smart_enabled: smartEnabled,
            hold_shortcut: holdShortcut,
            hold_enabled: holdEnabled,
            toggle_shortcut: toggleShortcut,
            toggle_enabled: toggleEnabled,
            transcription_mode: transcriptionMode,
            local_model: localModel,
            microphone_device: microphoneDevice,
            language,
            llm_cleanup_enabled: llmCleanupEnabled,
            llm_provider: llmProvider,
            llm_endpoint: llmEndpoint,
            llm_api_key: llmApiKey,
            llm_model: llmModel,
            edit_mode_enabled: editModeEnabled,
        },
        &app,
        &state,
    )
}

#[tauri::command]
fn set_user_name(
    name: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<UserSettings, String> {
    core::settings::set_user_name(name, &app, &state)
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    data_dir_size_bytes: u64,
    data_dir_path: String,
}

#[tauri::command]
fn get_app_info(app: AppHandle<AppRuntime>) -> Result<AppInfo, String> {
    let version = env!("CARGO_PKG_VERSION").to_string();

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let data_dir_path = data_dir.display().to_string();

    let data_dir_size_bytes = calculate_dir_size(&data_dir).unwrap_or(0);

    Ok(AppInfo {
        version,
        data_dir_size_bytes,
        data_dir_path,
    })
}

#[tauri::command]
async fn fetch_llm_models(
    endpoint: String,
    provider: String,
    api_key: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let llm_provider = match provider.as_str() {
        "lmstudio" => LlmProvider::LmStudio,
        "ollama" => LlmProvider::Ollama,
        "openai" => LlmProvider::OpenAI,
        "custom" => LlmProvider::Custom,
        "none" => LlmProvider::None,
        _ => LlmProvider::Custom,
    };

    llm_cleanup::fetch_available_models(&state.http(), &endpoint, &llm_provider, &api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_whats_new(app: AppHandle<AppRuntime>) {
    if let Err(err) = tray::toggle_settings_window(&app) {
        eprintln!("Failed to open settings window: {err}");
        return;
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Err(e) = app_clone.emit("navigate:about", ()) {
            eprintln!("Failed to emit navigate:about: {e}");
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
        if let Err(e) = app_clone.emit("open_whats_new", ()) {
            eprintln!("Failed to emit open_whats_new: {e}");
        }
    });
}

#[tauri::command]
fn open_about_page(app: AppHandle<AppRuntime>) {
    if let Err(err) = tray::toggle_settings_window(&app) {
        eprintln!("Failed to open settings window: {err}");
        return;
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Err(e) = app_clone.emit("navigate:about", ()) {
            eprintln!("Failed to emit navigate:about: {e}");
        }
    });
}

#[tauri::command]
fn open_data_dir(path: Option<String>, app: AppHandle<AppRuntime>) -> Result<(), String> {
    let path = path.ok_or_else(|| "Path is empty".to_string())?;
    let path = PathBuf::from(&path);

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let canonical_path = path
        .canonicalize()
        .map_err(|_| "Path does not exist".to_string())?;
    let canonical_data_dir = data_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize data dir: {e}"))?;

    if !canonical_path.starts_with(&canonical_data_dir) {
        return Err("Path is outside app data directory".to_string());
    }

    app.opener()
        .reveal_item_in_dir(&canonical_path)
        .map_err(|err| format!("Failed to open path: {err}"))
}

fn calculate_dir_size(path: &std::path::Path) -> Result<u64> {
    let mut total_size = 0u64;

    if !path.exists() {
        return Ok(0);
    }

    if path.is_file() {
        return Ok(path.metadata()?.len());
    }

    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let metadata = entry.metadata()?;

            if metadata.is_file() {
                total_size += metadata.len();
            } else if metadata.is_dir() {
                total_size += calculate_dir_size(&entry.path())?;
            }
        }
    }

    Ok(total_size)
}

#[tauri::command]
fn get_transcriptions(
    state: tauri::State<AppState>,
    search_query: Option<String>,
) -> Result<Vec<storage::TranscriptionRecord>, String> {
    state
        .storage()
        .get_all_filtered(search_query.as_deref())
        .map_err(|err| format!("Failed to get transcriptions: {err}"))
}

#[tauri::command]
fn delete_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<bool, String> {
    let result = match state.storage().delete(&id) {
        Ok(Some(audio_path)) => {
            let path = PathBuf::from(audio_path);
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(err) => Err(format!("Failed to delete transcription: {err}")),
    }?;

    let settings = state.current_settings();
    if let Err(err) = tray::refresh_tray_menu(&app, &settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }
    #[cfg(target_os = "macos")]
    if let Err(err) = set_app_menu(&app, &settings) {
        eprintln!("Failed to refresh app menu: {err}");
    }

    Ok(result)
}

#[tauri::command]
fn delete_all_transcriptions(
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<u32, String> {
    let audio_paths = state
        .storage()
        .delete_all()
        .map_err(|err| format!("Failed to delete all transcriptions: {err}"))?;

    let deleted_count = audio_paths.len() as u32;
    for audio_path in audio_paths {
        let _ = std::fs::remove_file(audio_path);
    }

    let settings = state.current_settings();
    if let Err(err) = tray::refresh_tray_menu(&app, &settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }
    #[cfg(target_os = "macos")]
    if let Err(err) = set_app_menu(&app, &settings) {
        eprintln!("Failed to refresh app menu: {err}");
    }

    Ok(deleted_count)
}

#[tauri::command]
async fn retry_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    core::transcriptions::retry_transcription(id, &app, &state)
}

#[tauri::command]
fn cancel_retry_transcription(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state.cancel_retry_transcription(&id))
}

#[tauri::command]
async fn retry_llm_cleanup(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    core::transcriptions::retry_llm_cleanup(id, &app, &state)
}

#[tauri::command]
async fn undo_llm_cleanup(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    core::transcriptions::undo_llm_cleanup(id, &app, &state)
}

pub(crate) fn hide_overlay(app: &AppHandle<AppRuntime>) {
    app.state::<AppState>().pill().reset(app);
}

pub(crate) fn stop_active_recording(app: &AppHandle<AppRuntime>) {
    app.state::<AppState>().pill().cancel(app);
}

#[tauri::command]
fn cancel_recording(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if state.pill().status() == pill::PillStatus::Processing {
        state.pill().cancel_processing(&app);
    } else {
        stop_active_recording(&app);
        hide_overlay(&app);
    }
}

pub(crate) fn persist_recording_async(app: AppHandle<AppRuntime>, recording: CompletedRecording) {
    let base_dir = match recordings_root(&app) {
        Ok(path) => path,
        Err(err) => {
            emit_error(
                &app,
                format!("Failed to resolve recordings directory: {err}"),
            );
            return;
        }
    };

    let recording_for_transcription = recording.clone();

    async_runtime::spawn(async move {
        let task =
            async_runtime::spawn_blocking(move || recorder::persist_recording(base_dir, recording));
        match task.await {
            Ok(Ok(saved)) => emit_complete(&app, saved, recording_for_transcription),
            Ok(Err(err)) => emit_error(&app, format!("Unable to save recording: {err}")),
            Err(err) => emit_error(&app, format!("Recording task failed: {err}")),
        }
    });
}

fn emit_complete(
    app: &AppHandle<AppRuntime>,
    saved: RecordingSaved,
    recording: CompletedRecording,
) {
    if let Err(rejection) = validate_recording(&recording) {
        let reason = match rejection {
            RecordingRejectionReason::TooShort {
                duration_ms,
                min_ms,
            } => {
                format!("Recording too short ({duration_ms}ms < {min_ms}ms minimum)")
            }
            RecordingRejectionReason::TooQuiet { rms, threshold } => {
                format!("Recording too quiet (energy {rms:.4} < {threshold} threshold)")
            }
            RecordingRejectionReason::NoSpeechDetected => {
                "No speech detected in recording".to_string()
            }
            RecordingRejectionReason::EmptyBuffer => "Recording buffer is empty".to_string(),
        };
        eprintln!("Recording rejected: {reason}");

        if let Err(err) = std::fs::remove_file(&saved.path) {
            eprintln!("Failed to remove rejected recording file: {err}");
        }

        app.state::<AppState>().pill().reset(app);
        return;
    }

    transcribe::queue_transcription(app, saved, recording);
}

pub(crate) fn emit_error(app: &AppHandle<AppRuntime>, message: String) {
    let state = app.state::<AppState>();
    let status = state.pill().status();
    if status == pill::PillStatus::Listening || status == pill::PillStatus::Processing {
        return;
    }
    state.pill().transition_to_error(app, &message);
}

pub(crate) fn emit_event<T: Serialize + Clone>(
    app: &AppHandle<AppRuntime>,
    event: &str,
    payload: T,
) {
    if let Err(err) = app.emit(event, payload) {
        eprintln!("Failed to emit {event}: {err}");
    }
}

fn recordings_root(app: &AppHandle<AppRuntime>) -> GlimpseResult<PathBuf> {
    let mut data_dir = app
        .path()
        .app_data_dir()
        .context("App data directory not found")?;
    data_dir.push("recordings");
    Ok(data_dir)
}

#[derive(Serialize, Clone)]
pub(crate) struct RecordingStartPayload {
    pub(crate) started_at: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct AudioSpectrumPayload {
    pub(crate) bins: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub(crate) struct TranscriptionCompletePayload {
    pub(crate) transcript: String,
    pub(crate) auto_paste: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct TranscriptionErrorPayload {
    pub(crate) message: String,
    pub(crate) stage: String,
}
