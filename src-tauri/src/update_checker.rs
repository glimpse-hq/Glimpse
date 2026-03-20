use parking_lot::Mutex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tracing::{debug, error, info, warn};

use crate::pill::PillStatus;
use crate::settings::UpdateChannel;
use crate::{toast, AppRuntime, AppState};

const CHECK_INTERVAL_HOURS: u64 = 6;
const INITIAL_DELAY_SECS: u64 = 30;
const AUTO_UPDATE_IDLE_MINS: u64 = 10;
const AUTO_UPDATE_POLL_SECS: u64 = 30;
const AUTO_UPDATE_MARKER_FILE: &str = ".auto_updated";
const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/LegendarySpy/Glimpse/releases/latest/download/latest.json";
const GITHUB_RELEASES_API_ENDPOINT: &str =
    "https://api.github.com/repos/LegendarySpy/Glimpse/releases?per_page=20";
const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const RELEASE_MANIFEST_FILE_NAME: &str = "latest.json";
const EVENT_UPDATE_DOWNLOAD_PROGRESS: &str = "update:download-progress";

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    prerelease: bool,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Default)]
pub struct UpdateState {
    available_version: Option<String>,
    toast_shown_this_session: bool,
}

impl UpdateState {
    pub fn set_available(&mut self, version: String) {
        self.available_version = Some(version);
    }

    pub fn is_available(&self) -> bool {
        self.available_version.is_some()
    }

    pub fn available_version(&self) -> Option<&String> {
        self.available_version.as_ref()
    }

    pub fn mark_toast_shown(&mut self) {
        self.toast_shown_this_session = true;
    }

    pub fn should_show_toast(&self) -> bool {
        self.is_available() && !self.toast_shown_this_session
    }

    pub fn clear(&mut self) {
        self.available_version = None;
        self.toast_shown_this_session = false;
    }
}

pub type SharedUpdateState = Arc<Mutex<UpdateState>>;

pub fn create_state() -> SharedUpdateState {
    Arc::new(Mutex::new(UpdateState::default()))
}

// --- Auto-update marker file (persists "just auto-updated" state across restarts) ---

fn marker_path(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(AUTO_UPDATE_MARKER_FILE))
}

fn write_marker(app: &AppHandle<AppRuntime>) -> bool {
    let Some(path) = marker_path(app) else {
        warn!("auto-update: failed to resolve restart marker path");
        return false;
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            warn!(
                path = %parent.display(),
                error = %err,
                "auto-update: failed to create marker directory"
            );
        }
    }

    if let Err(err) = std::fs::write(&path, "auto_update_completed\n") {
        error!(
            path = %path.display(),
            error = %err,
            "auto-update: failed to write restart marker"
        );
        return false;
    }

    true
}

/// Called on startup: if a marker file exists, the app was just auto-updated.
/// Sets a flag on AppState so a toast can be shown when the user opens the settings window.
pub fn check_post_auto_update(app: &AppHandle<AppRuntime>) {
    if let Some(path) = marker_path(app) {
        if path.is_file() {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    app.state::<AppState>().set_auto_update_completed();
                    info!(
                        "auto-update: detected post-restart marker, will show toast on next settings open"
                    );
                }
                Err(err) => {
                    warn!(
                        path = %path.display(),
                        error = %err,
                        "auto-update: failed to clear post-restart marker"
                    );
                }
            }
        }
    }
}

pub fn start_background_checker(app: AppHandle<AppRuntime>, state: SharedUpdateState) {
    let auto_update_app = app.clone();
    let auto_update_state = state.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECS)).await;

        loop {
            if let Err(err) = check_for_update(&app, &state, None).await {
                warn!(error = ?err, "background update check failed");
            }
            tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_HOURS * 60 * 60)).await;
        }
    });

    tauri::async_runtime::spawn(async move {
        // Stagger after the background checker's initial delay so it has time to
        // populate `state` with any available update before the auto-update loop starts.
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECS + 10)).await;
        run_auto_update_loop(auto_update_app, auto_update_state).await;
    });
}

/// Runs the auto-update loop. When enabled, the settings window is hidden, and
/// the app has been idle for 10 minutes, downloads and installs the update then
/// restarts the app silently. A marker file is written before restart so a toast
/// can be shown when the user next opens the settings window.
async fn run_auto_update_loop(app: AppHandle<AppRuntime>, state: SharedUpdateState) {
    let idle_duration = Duration::from_secs(AUTO_UPDATE_IDLE_MINS * 60);

    loop {
        tokio::time::sleep(Duration::from_secs(AUTO_UPDATE_POLL_SECS)).await;

        // Check if auto-update is enabled (in-memory cache, no DB hit)
        if !app.state::<AppState>().is_auto_update_enabled() {
            continue;
        }

        // Check if an update is available
        if !state.lock().is_available() {
            continue;
        }

        // Only auto-update when the settings window is not visible
        if is_settings_window_visible(&app) {
            continue;
        }

        // Wait for idle: pill must be idle for the full duration
        if !wait_for_idle(&app, idle_duration).await {
            continue;
        }

        // Re-check all conditions after the idle wait
        if !should_restart_for_auto_update(&app, &state) {
            continue;
        }

        info!("auto-update: app is idle and window hidden, downloading update");

        match resolve_available_update(&app, None).await {
            Ok(Some((update, channel))) => match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    if !should_restart_for_auto_update(&app, &state) {
                        info!(
                            channel = ?channel,
                            "auto-update: installed, but restart deferred because app is no longer idle"
                        );
                        continue;
                    }

                    if !write_marker(&app) {
                        warn!(
                            channel = ?channel,
                            "auto-update: installed, but restart deferred because marker write failed"
                        );
                        continue;
                    }

                    state.lock().clear();
                    info!(channel = ?channel, "auto-update: installed, restarting");
                    app.request_restart();
                    return;
                }
                Err(err) => {
                    warn!(error = %err, "auto-update: download/install failed");
                }
            },
            Ok(None) => {}
            Err(err) => {
                warn!(error = %err, "auto-update: failed to resolve update");
            }
        }
        // Back off before retrying
        tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_HOURS * 60 * 60)).await;
    }
}

/// Returns true only if the pill stays idle for the entire `required` duration
/// while auto-update remains enabled, the backend stays idle, and the settings
/// window stays hidden throughout the wait.
async fn wait_for_idle(app: &AppHandle<AppRuntime>, required: Duration) -> bool {
    let poll = Duration::from_secs(10);
    let mut elapsed = Duration::ZERO;

    while elapsed < required {
        tokio::time::sleep(poll).await;

        let state = app.state::<AppState>();

        if state.pill().status() != PillStatus::Idle {
            return false;
        }

        if !state.is_auto_update_enabled() {
            return false;
        }

        if !state.is_backend_idle() {
            return false;
        }

        if is_settings_window_visible(app) {
            return false;
        }

        elapsed += poll;
    }

    true
}

fn should_restart_for_auto_update(app: &AppHandle<AppRuntime>, state: &SharedUpdateState) -> bool {
    app.state::<AppState>().is_auto_update_enabled()
        && state.lock().is_available()
        && !is_settings_window_visible(app)
        && app.state::<AppState>().is_backend_idle()
}

fn is_settings_window_visible(app: &AppHandle<AppRuntime>) -> bool {
    app.get_webview_window(crate::SETTINGS_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Resolves the update channel, checks all endpoints, and returns the first
/// available update object (if any). Shared by both interactive and silent update paths.
async fn resolve_available_update(
    app: &AppHandle<AppRuntime>,
    channel_override: Option<UpdateChannel>,
) -> Result<Option<(tauri_plugin_updater::Update, UpdateChannel)>, String> {
    let channel = resolve_channel(app, channel_override);
    let endpoints = update_endpoints_for_channel(channel.clone())
        .await
        .map_err(|err| err.to_string())?;
    let mut last_error = None;
    let mut checked_endpoint = false;

    for endpoint in endpoints {
        let endpoint_for_log = endpoint.clone();
        let updater_builder = match app.updater_builder().endpoints(vec![endpoint]) {
            Ok(builder) => builder,
            Err(err) => {
                warn!(
                    endpoint = %endpoint_for_log,
                    channel = ?channel,
                    error = %err,
                    "update: failed to configure updater endpoint"
                );
                last_error = Some(err.to_string());
                continue;
            }
        };

        let updater = match updater_builder.build() {
            Ok(updater) => updater,
            Err(err) => {
                warn!(
                    endpoint = %endpoint_for_log,
                    channel = ?channel,
                    error = %err,
                    "update: failed to build updater"
                );
                last_error = Some(err.to_string());
                continue;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => return Ok(Some((update, channel))),
            Ok(None) => {
                checked_endpoint = true;
            }
            Err(err) => {
                warn!(
                    endpoint = %endpoint_for_log,
                    channel = ?channel,
                    error = %err,
                    "update: failed to check endpoint"
                );
                last_error = Some(err.to_string());
            }
        }
    }

    if !checked_endpoint {
        if let Some(err) = last_error {
            return Err(err);
        }
    }

    Ok(None)
}

async fn latest_prerelease_manifest_url() -> anyhow::Result<Option<Url>> {
    let releases = reqwest::Client::new()
        .get(GITHUB_RELEASES_API_ENDPOINT)
        .header(reqwest::header::ACCEPT, GITHUB_API_ACCEPT)
        .header(reqwest::header::USER_AGENT, GITHUB_API_USER_AGENT)
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<GitHubRelease>>()
        .await?;

    for release in releases {
        if !release.prerelease {
            continue;
        }

        if let Some(asset) = release
            .assets
            .iter()
            .find(|asset| asset.name == RELEASE_MANIFEST_FILE_NAME)
        {
            let url = Url::parse(&asset.browser_download_url)?;
            return Ok(Some(url));
        }
    }

    Ok(None)
}

async fn update_endpoints_for_channel(channel: UpdateChannel) -> anyhow::Result<Vec<Url>> {
    let stable = Url::parse(STABLE_UPDATE_ENDPOINT)?;

    if !matches!(channel, UpdateChannel::Prerelease) {
        return Ok(vec![stable]);
    }

    let mut endpoints = Vec::new();
    match latest_prerelease_manifest_url().await {
        Ok(Some(endpoint)) => endpoints.push(endpoint),
        Ok(None) => {
            debug!("no prerelease release manifest found on GitHub");
        }
        Err(err) => {
            warn!(error = ?err, "failed to resolve prerelease manifest endpoint");
        }
    }
    endpoints.push(stable);
    Ok(endpoints)
}

fn resolve_channel(
    app: &AppHandle<AppRuntime>,
    override_channel: Option<UpdateChannel>,
) -> UpdateChannel {
    if let Some(channel) = override_channel {
        channel
    } else {
        app.state::<AppState>().current_settings().update_channel
    }
}

async fn check_for_update(
    app: &AppHandle<AppRuntime>,
    state: &SharedUpdateState,
    channel_override: Option<UpdateChannel>,
) -> anyhow::Result<()> {
    debug!("checking for updates");

    let channel = resolve_channel(app, channel_override);
    match resolve_available_update(app, Some(channel.clone()))
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    {
        Some((update, _)) => {
            let version = update.version.clone();
            info!(version = %version, channel = ?channel, "update available");

            {
                let mut guard = state.lock();
                if guard.available_version.as_ref() != Some(&version) {
                    guard.set_available(version.clone());
                    guard.toast_shown_this_session = false;
                }
            }

            let _ = app.emit("update:available", version);
        }
        None => {
            debug!(channel = ?channel, "no updates available");
            state.lock().clear();
        }
    }

    Ok(())
}

pub fn maybe_show_update_toast(app: &AppHandle<AppRuntime>, state: &SharedUpdateState) {
    let (should_show, new_version) = {
        let guard = state.lock();
        (
            guard.should_show_toast(),
            guard.available_version().cloned(),
        )
    };

    if !should_show {
        return;
    }

    state.lock().mark_toast_shown();

    let current_version = env!("CARGO_PKG_VERSION");
    let message = match new_version {
        Some(ref v) => format!("v{current_version} → v{v}"),
        None => "Update available.".to_string(),
    };

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "update".to_string(),
            title: None,
            message,
            auto_dismiss: Some(false),
            duration: None,
            retry_id: None,
            mode: None,
            action: Some("open_about_page".to_string()),
            action_label: Some("Update".to_string()),
        },
    );
}

#[derive(Serialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub progress: Option<u8>,
}

#[tauri::command]
pub fn get_update_status(app: AppHandle<AppRuntime>) -> UpdateStatus {
    let state = app.state::<AppState>();
    let guard = state.update_state().lock();
    UpdateStatus {
        available: guard.is_available(),
        version: guard.available_version().cloned(),
    }
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle<AppRuntime>,
    channel: Option<UpdateChannel>,
) -> Result<UpdateStatus, String> {
    let update_state = app.state::<AppState>().update_state().clone();
    check_for_update(&app, &update_state, channel)
        .await
        .map_err(|err| err.to_string())?;

    let guard = update_state.lock();
    Ok(UpdateStatus {
        available: guard.is_available(),
        version: guard.available_version().cloned(),
    })
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle<AppRuntime>,
    channel: Option<UpdateChannel>,
) -> Result<(), String> {
    let (update, resolved_channel) = resolve_available_update(&app, channel)
        .await?
        .ok_or_else(|| "No update is currently available for this channel.".to_string())?;

    let mut downloaded = 0_u64;
    let mut total: Option<u64> = None;
    let progress_app = app.clone();

    update
        .download_and_install(
            |chunk_length, content_length| {
                if total.is_none() {
                    total = content_length;
                }

                downloaded = downloaded.saturating_add(chunk_length as u64);
                let progress = total.and_then(|value| {
                    if value == 0 {
                        None
                    } else {
                        Some(((downloaded.saturating_mul(100)) / value).min(100) as u8)
                    }
                });

                let _ = progress_app.emit(
                    EVENT_UPDATE_DOWNLOAD_PROGRESS,
                    UpdateDownloadProgress {
                        downloaded,
                        total,
                        progress,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;

    let _ = app.emit(
        EVENT_UPDATE_DOWNLOAD_PROGRESS,
        UpdateDownloadProgress {
            downloaded,
            total,
            progress: Some(100),
        },
    );

    app.state::<AppState>().update_state().lock().clear();
    let _ = app.emit("update:cleared", ());

    info!(channel = ?resolved_channel, "update downloaded and installed");
    Ok(())
}

#[tauri::command]
pub fn trigger_update_check(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let update_state = state.update_state().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = check_for_update(&app, &update_state, None).await {
            warn!(error = ?err, "manual update check failed");
        }
    });
}

#[allow(dead_code)]
#[tauri::command]
pub fn simulate_update_available(app: AppHandle<AppRuntime>, version: String) {
    let state = app.state::<AppState>();
    {
        let mut guard = state.update_state().lock();
        guard.set_available(version.clone());
        guard.toast_shown_this_session = false;
    }
    let _ = app.emit("update:available", version);
}

#[tauri::command]
pub fn clear_update_state(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    state.update_state().lock().clear();
    let _ = app.emit("update:cleared", ());
}

#[allow(dead_code)]
#[tauri::command]
pub fn show_update_toast_now(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let update_state = state.update_state().clone();

    {
        let mut guard = update_state.lock();
        if !guard.is_available() {
            guard.set_available("99.0.0".to_string());
        }
        guard.toast_shown_this_session = false;
    }

    maybe_show_update_toast(&app, &update_state);
}
