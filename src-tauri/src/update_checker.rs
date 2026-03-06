use parking_lot::Mutex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tracing::{debug, info, warn};

use crate::settings::UpdateChannel;
use crate::{toast, AppRuntime, AppState};

const CHECK_INTERVAL_HOURS: u64 = 6;
const INITIAL_DELAY_SECS: u64 = 30;
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

pub fn start_background_checker(app: AppHandle<AppRuntime>, state: SharedUpdateState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECS)).await;

        loop {
            if let Err(err) = check_for_update(&app, &state, None).await {
                warn!(error = ?err, "background update check failed");
            }
            tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_HOURS * 60 * 60)).await;
        }
    });
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

async fn update_endpoint_for_channel(channel: UpdateChannel) -> anyhow::Result<Option<Url>> {
    let stable = Url::parse(STABLE_UPDATE_ENDPOINT)?;

    if matches!(channel, UpdateChannel::Prerelease) {
        match latest_prerelease_manifest_url().await {
            Ok(Some(endpoint)) => Ok(Some(endpoint)),
            Ok(None) => {
                debug!("no prerelease release manifest found on GitHub");
                Ok(None)
            }
            Err(err) => {
                warn!(error = ?err, "failed to resolve prerelease manifest endpoint");
                Err(err)
            }
        }
    } else {
        Ok(Some(stable))
    }
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
    let Some(endpoint) = update_endpoint_for_channel(channel.clone()).await? else {
        debug!(channel = ?channel, "no update endpoint available");
        state.lock().clear();
        return Ok(());
    };

    let updater = app.updater_builder().endpoints(vec![endpoint])?.build()?;
    let update = updater.check().await?;

    if let Some(update) = update {
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
    } else {
        debug!(channel = ?channel, "no updates available");
        state.lock().clear();
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
    let resolved_channel = resolve_channel(&app, channel);
    let Some(endpoint) = update_endpoint_for_channel(resolved_channel.clone())
        .await
        .map_err(|err| err.to_string())?
    else {
        return Err("No update is currently available for this channel.".to_string());
    };
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;

    let Some(update) = updater.check().await.map_err(|err| err.to_string())? else {
        return Err("No update is currently available for this channel.".to_string());
    };

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
