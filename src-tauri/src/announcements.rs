use base64::Engine;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use reqwest::Client;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::{AppRuntime, AppState, license, platform, settings::SettingsStore, toast};

const FEED_URL: &str = "https://tryglimpse.cc/announcements.signed.json";
/// Glimpse-Site signs the feed with the matching private key.
const FEED_PUBLIC_KEY: &str = "s/qsUv+2vEf3fc1UntU9fGA3Xjv556eUec7zX7V/K+E=";
const RELEASE_URL: &str = "https://api.github.com/repos/glimpse-hq/Glimpse/releases/tags/v";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const FEED_VERSION: u32 = 2;
const KEY_SEEN: &str = "announcements_seen";
const KEY_TOASTED: &str = "announcements_toasted";
const TOAST_CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
const KEY_RELEASE_NOTES_VERSION: &str = "release_notes_seen_version";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// One dialog for the main window: this version's release notes after an
/// update, otherwise a message from the site targeted at this user.
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Announcement {
    ReleaseNotes {
        version: String,
        markdown: String,
    },
    Message {
        id: String,
        markdown: String,
        button: Option<String>,
        url: Option<String>,
        checkout: Option<String>,
        code: Option<String>,
    },
}

#[derive(Deserialize)]
struct SignedFeed {
    payload: String,
    signature: String,
}

#[derive(Deserialize)]
struct Feed {
    version: u32,
    items: Vec<serde_json::Value>,
}

/// Unknown keys reject the item, so targeting added later never reaches an
/// older app as "everyone".
#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct FeedItem {
    id: String,
    markdown: String,
    #[serde(default)]
    platforms: Vec<String>,
    #[serde(default)]
    audience: Vec<String>,
    #[serde(default)]
    install: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    starts: Option<DateTime<Utc>>,
    ends: Option<DateTime<Utc>>,
    button: Option<String>,
    url: Option<String>,
    checkout: Option<String>,
    code: Option<String>,
    toast: Option<String>,
    #[serde(default)]
    toast_buttons: Vec<ToastButton>,
}

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct ToastButton {
    label: String,
    action: ToastAction,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum ToastAction {
    /// Does what the announcement's button does.
    Button,
    /// Opens the announcement in the main window.
    Open,
    Close,
}

impl ToastAction {
    fn command(self) -> &'static str {
        match self {
            Self::Button => "run_toasted_announcement",
            Self::Open => "open_toasted_announcement",
            Self::Close => "close_toast",
        }
    }
}

impl FeedItem {
    fn into_message(self) -> Announcement {
        Announcement::Message {
            id: self.id,
            markdown: self.markdown,
            button: self.button,
            url: self.url,
            checkout: self.checkout,
            code: self.code,
        }
    }
}

#[derive(Deserialize)]
struct Release {
    body: Option<String>,
}

/// Fresh installs start on the current version, so only updates show notes.
pub fn note_launch(store: &SettingsStore, onboarding_completed: bool) {
    if onboarding_completed || !release_notes_seen_version(store).is_empty() {
        return;
    }
    if let Err(err) = store.write_app_value(KEY_RELEASE_NOTES_VERSION, &VERSION.to_string()) {
        tracing::warn!("[announcements] couldn't record the installed version: {err}");
    }
}

/// Release notes `glimpse dev show release-notes` puts in front of Home.
#[cfg(debug_assertions)]
pub(crate) static DEV_RELEASE_NOTES: parking_lot::Mutex<Option<String>> =
    parking_lot::Mutex::new(None);

#[tauri::command]
pub async fn get_announcement(
    state: tauri::State<'_, AppState>,
) -> Result<Option<Announcement>, String> {
    // The sandbox shows only what `glimpse dev` asks for, never the live feed.
    if crate::integrations::dev_sandbox() {
        #[cfg(debug_assertions)]
        if let Some(markdown) = DEV_RELEASE_NOTES.lock().clone() {
            return Ok(Some(Announcement::ReleaseNotes {
                version: VERSION.to_string(),
                markdown,
            }));
        }
        return Ok(None);
    }
    let store = &state.settings_store;
    let client = state.http();
    let requested = OPEN_REQUESTED.lock().clone();
    if let Some(item) = requested
        && is_targeted(&item, &audience(store)?)
    {
        return Ok(Some(item.into_message()));
    }
    if release_notes_due(store)
        && let Some(markdown) = release_notes(&client).await
    {
        return Ok(Some(Announcement::ReleaseNotes {
            version: VERSION.to_string(),
            markdown,
        }));
    }

    let seen = seen_ids(store);
    Ok(targeted_items(store, &client)
        .await?
        .into_iter()
        .find(|item| !seen.contains(&item.id))
        .map(FeedItem::into_message))
}

/// Running messages for this user, closed ones included, so they can be reopened.
#[tauri::command]
pub async fn list_announcements(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Announcement>, String> {
    Ok(targeted_items(&state.settings_store, &state.http())
        .await?
        .into_iter()
        .map(FeedItem::into_message)
        .collect())
}

static LAST_TOAST_CHECK: Mutex<Option<Instant>> = Mutex::new(None);
/// Fetched after one dictation and shown after a later one, so it never lands late.
static TOAST_DUE: Mutex<Option<FeedItem>> = Mutex::new(None);
static TOASTED: Mutex<Option<FeedItem>> = Mutex::new(None);
/// Shown in place of the usual pick until it's dismissed.
static OPEN_REQUESTED: Mutex<Option<FeedItem>> = Mutex::new(None);

/// Shows the first unseen announcement marked `toast` once, after a dictation.
pub fn toast_after_use(app: &AppHandle<AppRuntime>, show: bool) {
    if crate::integrations::dev_sandbox() {
        return;
    }
    let store = &app.state::<AppState>().settings_store;
    if show
        && let Some(item) = TOAST_DUE.lock().take().filter(|item| {
            !seen_ids(store).contains(&item.id)
                && audience(store).is_ok_and(|audience| is_targeted(item, &audience))
        })
    {
        let mut toasted = toasted_ids(store);
        toasted.push(item.id.clone());
        if let Err(err) = store.write_app_value(KEY_TOASTED, &toasted) {
            tracing::warn!("[announcements] couldn't record the toast: {err}");
            return;
        }
        let button = |index: usize| item.toast_buttons.get(index);
        toast::emit_toast(
            app,
            toast::Payload {
                toast_type: "info".to_string(),
                message: item.toast.clone().unwrap_or_default(),
                auto_dismiss: Some(true),
                duration: Some(9000),
                action: button(0).map(|b| b.action.command().to_string()),
                action_label: button(0).map(|b| b.label.clone()),
                secondary_action: button(1).map(|b| b.action.command().to_string()),
                secondary_action_label: button(1).map(|b| b.label.clone()),
                ..Default::default()
            },
        );
        *TOASTED.lock() = Some(item);
        return;
    }
    {
        let mut last = LAST_TOAST_CHECK.lock();
        if last.is_some_and(|last| last.elapsed() < TOAST_CHECK_INTERVAL) {
            return;
        }
        *last = Some(Instant::now());
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let store = &state.settings_store;
        let Ok(items) = targeted_items(store, &state.http()).await else {
            return;
        };
        let seen = seen_ids(store);
        let toasted = toasted_ids(store);
        *TOAST_DUE.lock() = items.into_iter().find(|item| {
            item.toast.is_some() && !seen.contains(&item.id) && !toasted.contains(&item.id)
        });
    });
}

#[tauri::command]
pub fn open_toasted_announcement(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let Some(item) = TOASTED.lock().clone() else {
        return Ok(());
    };
    *OPEN_REQUESTED.lock() = Some(item);
    crate::tray::open_settings_page(&app, crate::tray::SettingsPage::Announcement)
        .map_err(|err| err.to_string())
}

/// Does what the dialog's button would, so the dialog doesn't follow.
#[tauri::command]
pub fn run_toasted_announcement(
    app: AppHandle<AppRuntime>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let Some(item) = TOASTED.lock().clone() else {
        return Ok(());
    };
    if let Some(tier) = item.checkout {
        license::open_checkout(app, tier, "announcement".to_string(), None, item.code)?;
    } else if let Some(url) = item.url {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|err| err.to_string())?;
    }
    TOASTED.lock().take();
    dismiss_announcement(state, item.id)
}

async fn targeted_items(store: &SettingsStore, client: &Client) -> Result<Vec<FeedItem>, String> {
    let Some(items) = fetch_feed(client).await else {
        return Ok(Vec::new());
    };
    let audience = audience(store)?;
    Ok(items
        .into_iter()
        .filter(|item| is_targeted(item, &audience))
        .map(|item| FeedItem {
            url: item.url.filter(|url| url.starts_with("https://")),
            ..item
        })
        .collect())
}

/// Running now and meant for this install.
fn is_targeted(item: &FeedItem, audience: &[&str]) -> bool {
    let now = Utc::now();
    let platform = if cfg!(target_os = "macos") {
        "mac"
    } else {
        "windows"
    };
    let install = if platform::is_store_build() {
        "store"
    } else {
        "direct"
    };
    item.starts.is_none_or(|starts| starts <= now)
        && item.ends.is_none_or(|ends| now < ends)
        && (item.platforms.is_empty() || item.platforms.iter().any(|p| p == platform))
        && (item.audience.is_empty()
            || item.audience.iter().any(|a| audience.contains(&a.as_str())))
        && (item.install.is_empty() || item.install.iter().any(|i| i == install))
        && (item.versions.is_empty() || item.versions.iter().any(|v| v == VERSION))
}

#[tauri::command]
pub fn dismiss_release_notes(state: tauri::State<'_, AppState>) -> Result<(), String> {
    #[cfg(debug_assertions)]
    DEV_RELEASE_NOTES.lock().take();
    state
        .settings_store
        .write_app_value(KEY_RELEASE_NOTES_VERSION, &VERSION.to_string())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn dismiss_announcement(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    OPEN_REQUESTED
        .lock()
        .take_if(|requested| requested.id == id);
    let store = &state.settings_store;
    let mut seen = seen_ids(store);
    if !seen.contains(&id) {
        seen.push(id);
    }
    store
        .write_app_value(KEY_SEEN, &seen)
        .map_err(|err| err.to_string())
}

/// `unlicensed` includes trial.
fn audience(store: &SettingsStore) -> Result<Vec<&'static str>, String> {
    if license::has_active_license(store) {
        return Ok(vec!["licensed"]);
    }
    let state = license::get_license_state(store)?;
    Ok(if state.trial_active {
        vec!["unlicensed", "trial"]
    } else {
        vec!["unlicensed"]
    })
}

/// Only feature releases (x.y.0 and x.y.5) show their notes after an update.
fn release_notes_due(store: &SettingsStore) -> bool {
    let feature_release = VERSION
        .rsplit('.')
        .next()
        .is_some_and(|patch| patch == "0" || patch == "5");
    feature_release && release_notes_seen_version(store) != VERSION
}

fn release_notes_seen_version(store: &SettingsStore) -> String {
    store
        .read_app_value(KEY_RELEASE_NOTES_VERSION, String::new())
        .unwrap_or_default()
}

fn toasted_ids(store: &SettingsStore) -> Vec<String> {
    store
        .read_app_value(KEY_TOASTED, Vec::new())
        .unwrap_or_default()
}

fn seen_ids(store: &SettingsStore) -> Vec<String> {
    store
        .read_app_value(KEY_SEEN, Vec::new())
        .unwrap_or_default()
}

async fn release_notes(client: &Client) -> Option<String> {
    let response = client
        .get(format!("{RELEASE_URL}{VERSION}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Glimpse-App")
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .inspect_err(|err| tracing::warn!("[announcements] release notes request failed: {err}"))
        .ok()?;
    if !response.status().is_success() {
        tracing::warn!("[announcements] release notes got {}", response.status());
        return None;
    }
    let body = response.json::<Release>().await.ok()?.body?;
    let body = body.trim();
    (!body.is_empty()).then(|| body.to_string())
}

async fn fetch_feed(client: &Client) -> Option<Vec<FeedItem>> {
    let response = client
        .get(FEED_URL)
        .header("User-Agent", "Glimpse-App")
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .inspect_err(|err| tracing::warn!("[announcements] feed request failed: {err}"))
        .ok()?;
    if !response.status().is_success() {
        tracing::warn!("[announcements] feed got {}", response.status());
        return None;
    }
    let signed = response
        .json::<SignedFeed>()
        .await
        .inspect_err(|err| tracing::warn!("[announcements] feed unreadable: {err}"))
        .ok()?;
    let feed = verified_feed(&signed)?;
    if feed.version != FEED_VERSION {
        tracing::warn!("[announcements] skipping feed version {}", feed.version);
        return None;
    }
    Some(
        feed.items
            .into_iter()
            .filter_map(|item| serde_json::from_value(item).ok())
            .collect(),
    )
}

fn verified_feed(signed: &SignedFeed) -> Option<Feed> {
    let engine = base64::engine::general_purpose::STANDARD;
    let key = engine.decode(FEED_PUBLIC_KEY).ok()?;
    let verified = engine.decode(&signed.signature).is_ok_and(|signature| {
        UnparsedPublicKey::new(&ED25519, key)
            .verify(signed.payload.as_bytes(), &signature)
            .is_ok()
    });
    if !verified {
        tracing::warn!("[announcements] feed signature doesn't match, ignoring it");
        return None;
    }
    serde_json::from_str(&signed.payload)
        .inspect_err(|err| tracing::warn!("[announcements] feed unreadable: {err}"))
        .ok()
}
