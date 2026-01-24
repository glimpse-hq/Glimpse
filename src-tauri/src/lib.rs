mod accessibility_context;
mod analytics;
mod assistive;
mod audio;
mod cloud;
mod crypto;
mod dictionary;
mod downloader;
mod llm_cleanup;
mod local_transcription;
mod mode_context;
mod model_manager;
mod permissions;
mod personalization;
mod pill;
mod platform;
mod recorder;
mod settings;
mod storage;
mod toast;
mod transcribe;
mod transcription_api;
mod tray;
mod update_checker;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
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

#[cfg(target_os = "macos")]
fn handle_app_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    use platform::macos::menu::{
        MENU_ID_CHECK_UPDATES, MENU_ID_MIC_DEFAULT, MENU_ID_MIC_PREFIX, MENU_ID_MODE_LOCAL,
        MENU_ID_MODEL_PREFIX, MENU_ID_REPORT_ISSUE, MENU_ID_WEBSITE,
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
            if let Some(model_key) = id.strip_prefix(MENU_ID_MODEL_PREFIX) {
                set_local_model(app, model_key);
            } else if let Some(device_id_raw) = id.strip_prefix(MENU_ID_MIC_PREFIX) {
                let device_id = device_id_raw.strip_prefix("dev:").unwrap_or(device_id_raw);
                set_microphone(app, Some(device_id));
            }
        }
    }
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
fn set_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &settings::UserSettings,
) -> tauri::Result<()> {
    let menu = platform::macos::menu::build_app_menu(app, settings)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = rt.enter();
    tauri::async_runtime::set(rt.handle().clone());

    let aptabase_key = option_env!("APTABASE_KEY").unwrap_or("A-DEV-0000000000");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_aptabase::Builder::new(aptabase_key).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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

            #[cfg(target_os = "macos")]
            {
                if let Err(err) = set_app_menu(handle, &settings) {
                    eprintln!("Failed to set app menu: {err}");
                }
            }

            app.manage(AppState::new(Arc::clone(&settings_store), settings, handle));

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
            cancel_retry_transcription,
            retry_llm_cleanup,
            undo_llm_cleanup,
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
            complete_onboarding,
            cancel_recording,
            reset_onboarding,
            import_transcription_from_cloud,
            mark_transcription_synced,
            toast::debug_show_toast,
            fetch_llm_models,
            cloud::set_cloud_credentials,
            cloud::clear_cloud_credentials,
            cloud::open_sign_in,
            cloud::open_checkout,
            open_whats_new,
            open_about_page,
            switch_to_local_mode,
            toast::show_celebration_toast,
            update_checker::get_update_status,
            update_checker::trigger_update_check,
            update_checker::simulate_update_available,
            update_checker::clear_update_state,
            update_checker::show_update_toast_now
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handler, event| match event {
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    let _ = tray::toggle_settings_window(handler);
                }
            }
            tauri::RunEvent::Exit => {
                let _ = handler.track_event("app_exited", None);
                handler.flush_events_blocking();
            }
            _ => {}
        });
}

pub(crate) type AppRuntime = Wry;

type GlimpseResult<T> = Result<T>;

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
    pending_recording_path: parking_lot::Mutex<Option<PathBuf>>,
    cloud_manager: cloud::CloudManager,
    pending_selected_text: parking_lot::Mutex<Option<String>>,
    download_tokens: parking_lot::Mutex<HashMap<String, CancellationToken>>,
    retry_tokens: parking_lot::Mutex<HashMap<String, CancellationToken>>,
    update_state: update_checker::SharedUpdateState,
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
            pending_recording_path: parking_lot::Mutex::new(None),
            cloud_manager: cloud::CloudManager::new(),
            pending_selected_text: parking_lot::Mutex::new(None),
            download_tokens: parking_lot::Mutex::new(HashMap::new()),
            retry_tokens: parking_lot::Mutex::new(HashMap::new()),
            update_state: update_checker::create_state(),
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

    pub fn persist_settings(&self, next: UserSettings) -> GlimpseResult<UserSettings> {
        self.settings_store.save(&next)?;
        *self.settings.lock() = next.clone();
        Ok(next)
    }

    pub fn pill(&self) -> &PillController {
        &self.pill
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
    }

    pub fn is_cancelled(&self) -> bool {
        self.transcription_cancelled.load(Ordering::SeqCst)
    }

    pub fn clear_cancellation(&self) {
        self.transcription_cancelled.store(false, Ordering::SeqCst);
    }

    pub fn set_pending_path(&self, path: Option<PathBuf>) {
        *self.pending_recording_path.lock() = path;
    }

    pub fn take_pending_path(&self) -> Option<PathBuf> {
        self.pending_recording_path.lock().take()
    }

    pub fn cloud_manager(&self) -> &cloud::CloudManager {
        &self.cloud_manager
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
fn complete_onboarding(
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut settings = state.current_settings();
    let model = settings.local_model.clone();
    settings.onboarding_completed = true;
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    analytics::track_onboarding_completed(&app, &model);
    Ok(())
}

#[tauri::command]
fn reset_onboarding(
    _app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut settings = state.current_settings();
    settings.onboarding_completed = false;
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    Ok(())
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
    if smartEnabled && smartShortcut.trim().is_empty() {
        return Err("Smart shortcut cannot be empty when enabled".into());
    }

    if holdEnabled && holdShortcut.trim().is_empty() {
        return Err("Hold shortcut cannot be empty when enabled".into());
    }

    if toggleEnabled && toggleShortcut.trim().is_empty() {
        return Err("Toggle shortcut cannot be empty when enabled".into());
    }

    if !smartEnabled && !holdEnabled && !toggleEnabled {
        return Err("At least one recording mode must be enabled".into());
    }

    let mut enabled_shortcuts: Vec<(&str, &str)> = vec![];
    if smartEnabled {
        enabled_shortcuts.push(("Smart", smartShortcut.trim()));
    }
    if holdEnabled {
        enabled_shortcuts.push(("Hold", holdShortcut.trim()));
    }
    if toggleEnabled {
        enabled_shortcuts.push(("Toggle", toggleShortcut.trim()));
    }

    for i in 0..enabled_shortcuts.len() {
        for j in (i + 1)..enabled_shortcuts.len() {
            let (name1, shortcut1) = enabled_shortcuts[i];
            let (name2, shortcut2) = enabled_shortcuts[j];
            if shortcut1.to_lowercase() == shortcut2.to_lowercase() {
                return Err(format!(
                    "{} and {} shortcuts cannot be the same",
                    name1, name2
                ));
            }
        }
    }

    if model_manager::definition(&localModel).is_none() {
        return Err("Unknown model selection".into());
    }

    if llmCleanupEnabled && !matches!(llmProvider, LlmProvider::None) {
        if matches!(llmProvider, LlmProvider::Custom) && llmEndpoint.trim().is_empty() {
            return Err("Custom LLM endpoint cannot be empty".into());
        }
        if matches!(llmProvider, LlmProvider::OpenAI) && llmApiKey.trim().is_empty() {
            return Err("OpenAI API key is required".into());
        }
    }

    let mut next = state.current_settings();
    let prev = next.clone();
    next.smart_shortcut = smartShortcut;
    next.smart_enabled = smartEnabled;
    next.hold_shortcut = holdShortcut;
    next.hold_enabled = holdEnabled;
    next.toggle_shortcut = toggleShortcut;
    next.toggle_enabled = toggleEnabled;
    next.transcription_mode = transcriptionMode;
    next.local_model = localModel;
    next.microphone_device = microphoneDevice;
    next.language = language;
    next.llm_cleanup_enabled = llmCleanupEnabled;
    next.llm_provider = llmProvider;
    next.llm_endpoint = llmEndpoint;
    next.llm_api_key = llmApiKey;
    next.llm_model = llmModel;
    next.edit_mode_enabled = editModeEnabled;

    let next = state
        .persist_settings(next)
        .map_err(|err| err.to_string())?;

    pill::register_shortcuts(&app).map_err(|err| err.to_string())?;

    if prev.transcription_mode != next.transcription_mode
        || prev.local_model != next.local_model
        || prev.microphone_device != next.microphone_device
    {
        if let Err(err) = tray::refresh_tray_menu(&app, &next) {
            eprintln!("Failed to refresh tray menu: {err}");
        }
        #[cfg(target_os = "macos")]
        if let Err(err) = set_app_menu(&app, &next) {
            eprintln!("Failed to refresh app menu: {err}");
        }
    }

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

    Ok(next)
}

#[tauri::command]
fn set_user_name(
    name: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<UserSettings, String> {
    let mut settings = state.current_settings();
    settings.user_name = name.trim().to_string();
    let next = state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &next) {
        eprintln!("Failed to emit settings change: {err}");
    }

    Ok(next)
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
fn switch_to_local_mode(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut settings = state.current_settings();

    if matches!(settings.transcription_mode, TranscriptionMode::Local) {
        return Ok(());
    }

    settings.transcription_mode = TranscriptionMode::Local;

    let settings = state
        .persist_settings(settings)
        .map_err(|e| e.to_string())?;

    if let Err(err) = tray::refresh_tray_menu(&app, &settings) {
        eprintln!("Failed to refresh tray menu: {err}");
    }

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &settings) {
        eprintln!("Failed to emit settings change: {err}");
    }

    toast::show(
        &app,
        "success",
        None,
        "Switched to local mode. Cloud sync still works.",
    );

    Ok(())
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
fn import_transcription_from_cloud(
    record: storage::TranscriptionRecord,
    state: tauri::State<AppState>,
) -> Result<bool, String> {
    state
        .storage()
        .import_transcription(record)
        .map_err(|err| format!("Failed to import transcription: {err}"))
}

#[tauri::command]
fn mark_transcription_synced(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    state
        .storage()
        .mark_as_synced(&id)
        .map_err(|err| format!("Failed to mark transcription as synced: {err}"))
}

#[tauri::command]
fn delete_transcription(id: String, state: tauri::State<AppState>) -> Result<bool, String> {
    match state.storage().delete(&id) {
        Ok(Some(audio_path)) => {
            let path = PathBuf::from(audio_path);
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(err) => Err(format!("Failed to delete transcription: {err}")),
    }
}

#[tauri::command]
fn delete_all_transcriptions(state: tauri::State<AppState>) -> Result<u32, String> {
    let audio_paths = state
        .storage()
        .delete_all()
        .map_err(|err| format!("Failed to delete all transcriptions: {err}"))?;

    let deleted_count = audio_paths.len() as u32;
    for audio_path in audio_paths {
        let _ = std::fs::remove_file(audio_path);
    }

    Ok(deleted_count)
}

#[tauri::command]
async fn retry_transcription(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    eprintln!("[retry_transcription] Starting retry for id={}", id);

    let record = state
        .storage()
        .get_by_id(&id)
        .ok_or_else(|| "Transcription not found".to_string())?;

    eprintln!(
        "[retry_transcription] Found record: audio_path={} speech_model={} synced={}",
        record.audio_path, record.speech_model, record.synced
    );

    if record.status == storage::TranscriptionStatus::Error {
        if let Some(message) = record.error_message.as_deref() {
            let lower = message.to_ascii_lowercase();
            let is_quota_error =
                lower.contains("quota reached") || lower.contains("beta tester limit");
            if is_quota_error {
                let is_tester = lower.contains("beta tester");
                cloud::show_quota_exceeded(&app, is_tester);
                return Err(String::new());
            }
        }
    }

    let audio_path = PathBuf::from(&record.audio_path);
    if !audio_path.exists() {
        if record.audio_path.contains("placeholder") || record.audio_path.contains("cloud_synced") {
            return Err(
                "Cannot retry cloud-synced transcriptions. Audio is only stored locally."
                    .to_string(),
            );
        }
        return Err("Audio file not found. It may have been deleted.".to_string());
    }

    let saved = RecordingSaved {
        path: audio_path,
        started_at: record.timestamp,
        ended_at: record.timestamp,
        duration_override_seconds: Some(record.audio_duration_seconds),
    };

    let settings = state.current_settings();
    let saved_mode = (record.mode_id, record.mode_name);
    let cancel_token = state.register_retry_transcription(id.clone());
    transcribe::retry_transcription_async(&app, saved, settings, id, saved_mode, cancel_token);

    Ok(())
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
    let record = state
        .storage()
        .get_by_id(&id)
        .ok_or_else(|| "Transcription not found".to_string())?;

    if record.status != storage::TranscriptionStatus::Success {
        return Err("Can only apply LLM cleanup to successful transcriptions".to_string());
    }

    let settings = state.current_settings();
    if !llm_cleanup::is_cleanup_available(&settings) {
        return Err("LLM cleanup is not configured".to_string());
    }
    let llm_model = llm_cleanup::resolved_model_name(&settings);

    let text_to_clean = record.raw_text.unwrap_or(record.text);

    // Look up the saved personality (if it still exists and is enabled)
    let saved_personality = record.mode_id.as_ref().and_then(|id| {
        settings
            .personalities
            .iter()
            .find(|p| &p.id == id && p.enabled)
            .cloned()
    });

    let http = state.http();
    let storage = state.storage();
    let record_id = id.clone();

    async_runtime::spawn(async move {
        match llm_cleanup::cleanup_transcription(
            &http,
            &text_to_clean,
            &settings,
            saved_personality.as_ref(),
        )
        .await
        {
            Ok(cleaned) => {
                if let Err(err) =
                    storage.update_with_llm_cleanup(&record_id, cleaned, llm_model.clone())
                {
                    eprintln!("Failed to save LLM cleanup: {err}");
                }
                let _ = app.emit(
                    EVENT_TRANSCRIPTION_COMPLETE,
                    TranscriptionCompletePayload {
                        transcript: String::new(),
                        auto_paste: false,
                    },
                );
            }
            Err(err) => {
                eprintln!("LLM cleanup failed: {err}");
                let _ = app.emit(
                    EVENT_TRANSCRIPTION_ERROR,
                    TranscriptionErrorPayload {
                        message: format!("LLM cleanup failed: {err}"),
                        stage: "llm_cleanup".to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn undo_llm_cleanup(
    id: String,
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage();

    match storage.revert_to_raw(&id) {
        Ok(Some(_)) => {
            let _ = app.emit(
                EVENT_TRANSCRIPTION_COMPLETE,
                TranscriptionCompletePayload {
                    transcript: String::new(),
                    auto_paste: false,
                },
            );
            Ok(())
        }
        Ok(None) => Err("No raw text available to revert to".to_string()),
        Err(err) => Err(format!("Failed to undo LLM cleanup: {err}")),
    }
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
