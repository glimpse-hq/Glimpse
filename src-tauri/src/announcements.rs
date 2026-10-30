use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::{AppState, license, platform, settings::SettingsStore};

const FEED_URL: &str = "https://tryglimpse.cc/announcements.json";
const RELEASE_URL: &str = "https://api.github.com/repos/glimpse-hq/Glimpse/releases/tags/v";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const FEED_VERSION: u32 = 1;
const KEY_SEEN: &str = "announcements_seen";
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
struct Feed {
    version: u32,
    items: Vec<serde_json::Value>,
}

/// Unknown keys reject the item, so targeting added later never reaches an
/// older app as "everyone".
#[derive(Deserialize)]
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
    if release_notes_due(store)
        && let Some(markdown) = release_notes(&client).await
    {
        return Ok(Some(Announcement::ReleaseNotes {
            version: VERSION.to_string(),
            markdown,
        }));
    }

    let seen = seen_ids(store);
    Ok(targeted_messages(store, &client)
        .await?
        .into_iter()
        .find(|message| !matches!(message, Announcement::Message { id, .. } if seen.contains(id))))
}

/// Running messages for this user, closed ones included, so they can be reopened.
#[tauri::command]
pub async fn list_announcements(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Announcement>, String> {
    targeted_messages(&state.settings_store, &state.http()).await
}

async fn targeted_messages(
    store: &SettingsStore,
    client: &Client,
) -> Result<Vec<Announcement>, String> {
    let Some(items) = fetch_feed(client).await else {
        return Ok(Vec::new());
    };
    let audience = audience(store)?;
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
    Ok(items
        .into_iter()
        .filter(|item| {
            item.starts.is_none_or(|starts| starts <= now)
                && item.ends.is_none_or(|ends| now < ends)
                && (item.platforms.is_empty() || item.platforms.iter().any(|p| p == platform))
                && (item.audience.is_empty()
                    || item.audience.iter().any(|a| audience.contains(&a.as_str())))
                && (item.install.is_empty() || item.install.iter().any(|i| i == install))
                && (item.versions.is_empty() || item.versions.iter().any(|v| v == VERSION))
        })
        .map(|item| Announcement::Message {
            id: item.id,
            markdown: item.markdown,
            button: item.button,
            url: item.url.filter(|url| url.starts_with("https://")),
            checkout: item.checkout,
            code: item.code,
        })
        .collect())
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
    let feed = response
        .json::<Feed>()
        .await
        .inspect_err(|err| tracing::warn!("[announcements] feed unreadable: {err}"))
        .ok()?;
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
