use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::analytics::crash::stable_hash;
use crate::{AppRuntime, platform};

const WEBSITE_ICON_USER_AGENT: &str =
    concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const WEBSITE_ICON_MAX_BYTES: usize = 512 * 1024;
const WEBSITE_ICON_MISS_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_WEBSITE_ICONS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub name: String,
    pub path: String,
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebsiteIcon {
    pub site: String,
    pub icon_path: Option<String>,
}

fn normalize_website_domain(value: &str) -> Option<String> {
    let mut trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("feed://") {
        trimmed = rest.to_string();
    } else if let Some(rest) = trimmed.strip_prefix("feed:") {
        trimmed = rest.to_string();
    }

    if let Some(rest) = trimmed.strip_prefix("https://") {
        trimmed = rest.to_string();
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        trimmed = rest.to_string();
    }

    if let Some(rest) = trimmed.strip_prefix("www.") {
        trimmed = rest.to_string();
    }

    for separator in ['/', '?', '#', ':'] {
        if let Some((host, _)) = trimmed.split_once(separator) {
            trimmed = host.to_string();
        }
    }

    (!trimmed.is_empty()).then_some(trimmed)
}

pub(crate) fn app_icon_cache_dir(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let mut dir = app.path().app_data_dir().ok()?;
    dir.push("local");
    dir.push("cache");
    dir.push("appicons");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub(crate) fn website_icon_cache_dir(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let mut dir = app.path().app_data_dir().ok()?;
    dir.push("local");
    dir.push("cache");
    dir.push("siteicons");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub(crate) fn icon_cache_file_path(source_path: &Path, cache_dir: &Path) -> PathBuf {
    let key = stable_hash(&source_path.to_string_lossy());
    cache_dir.join(format!("{key}.png"))
}

fn website_icon_cache_file_path(site: &str, cache_dir: &Path) -> PathBuf {
    cache_dir.join(format!("{}.ico", stable_hash(site)))
}

// Marks a site the icon service has no icon for.
fn website_icon_miss_file_path(site: &str, cache_dir: &Path) -> PathBuf {
    website_icon_cache_file_path(site, cache_dir).with_extension("miss")
}

fn is_recent_miss(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < WEBSITE_ICON_MISS_TTL)
}

/// Deletes cached icons with one of `extensions` that aren't in `keep`.
fn prune_icon_cache(cache_dir: &Path, keep: &HashSet<PathBuf>, extensions: &[&str]) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let cached = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| extensions.contains(&ext));
        if cached && !keep.contains(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn is_private_or_local_host(site: &str) -> bool {
    let host = site.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host == "localhost" {
        return true;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    if !host.contains('.') {
        return true;
    }
    matches!(
        host.rsplit('.').next(),
        Some("local" | "internal" | "lan" | "home" | "intranet" | "corp" | "localdomain")
    )
}

async fn fetch_and_cache_website_icon(
    site: &str,
    cache_dir: &Path,
    client: &reqwest::Client,
) -> Option<PathBuf> {
    if is_private_or_local_host(site) {
        return None;
    }
    let url = format!("https://icons.duckduckgo.com/ip3/{site}.ico");
    let response = client.get(&url).send().await.ok()?;
    if !response.status().is_success() {
        let _ = std::fs::write(website_icon_miss_file_path(site, cache_dir), []);
        return None;
    }

    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > WEBSITE_ICON_MAX_BYTES {
        let _ = std::fs::write(website_icon_miss_file_path(site, cache_dir), []);
        return None;
    }

    let icon_path = website_icon_cache_file_path(site, cache_dir);
    std::fs::write(&icon_path, &bytes).ok()?;
    Some(icon_path)
}

fn warm_website_icon_cache_in_background(pending_sites: Vec<String>, cache_dir: PathBuf) {
    if pending_sites.is_empty() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .user_agent(WEBSITE_ICON_USER_AGENT)
            .timeout(Duration::from_secs(4))
            .connect_timeout(Duration::from_secs(3))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };

        for site in pending_sites {
            let _ = fetch_and_cache_website_icon(&site, &cache_dir, &client).await;
        }
    });
}

#[tauri::command]
pub fn list_website_icons(
    sites: Vec<String>,
    app: AppHandle<AppRuntime>,
) -> Result<Vec<WebsiteIcon>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for site in sites {
        let Some(site) = normalize_website_domain(&site) else {
            continue;
        };
        if seen.insert(site.clone()) {
            normalized.push(site);
        }
    }

    let Some(cache_dir) = website_icon_cache_dir(&app) else {
        return Ok(normalized
            .into_iter()
            .take(MAX_WEBSITE_ICONS)
            .map(|site| WebsiteIcon {
                site,
                icon_path: None,
            })
            .collect());
    };

    let keep: HashSet<PathBuf> = normalized
        .iter()
        .flat_map(|site| {
            [
                website_icon_cache_file_path(site, &cache_dir),
                website_icon_miss_file_path(site, &cache_dir),
            ]
        })
        .collect();
    prune_icon_cache(&cache_dir, &keep, &["ico", "miss"]);

    let mut pending_sites = Vec::new();
    let mut icons = Vec::with_capacity(normalized.len().min(MAX_WEBSITE_ICONS));
    for site in normalized.into_iter().take(MAX_WEBSITE_ICONS) {
        let cached = website_icon_cache_file_path(&site, &cache_dir);
        let icon_path = if cached.exists() {
            Some(cached.to_string_lossy().to_string())
        } else {
            if !is_recent_miss(&website_icon_miss_file_path(&site, &cache_dir)) {
                pending_sites.push(site.clone());
            }
            None
        };
        icons.push(WebsiteIcon { site, icon_path });
    }

    warm_website_icon_cache_in_background(pending_sites, cache_dir);
    Ok(icons)
}

#[tauri::command]
pub fn list_installed_apps(app: AppHandle<AppRuntime>) -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "macos")]
    let apps = platform::macos::icons::list_installed_apps(&app)?;
    #[cfg(target_os = "windows")]
    let apps = platform::windows::icons::list_installed_apps(&app)?;

    if let Some(cache_dir) = app_icon_cache_dir(&app) {
        let keep: HashSet<PathBuf> = apps
            .iter()
            .map(|installed| icon_cache_file_path(Path::new(&installed.path), &cache_dir))
            .collect();
        prune_icon_cache(&cache_dir, &keep, &["png"]);
    }
    Ok(apps)
}
