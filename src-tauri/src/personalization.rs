#[cfg(target_os = "macos")]
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::settings::Personality;
use crate::{AppRuntime, AppState, EVENT_SETTINGS_CHANGED};

const INSTRUCTION_CHAR_LIMIT: usize = 3000;

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

fn sanitize_list(entries: &[String], limit: usize, max_len: usize, lower: bool) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for raw in entries {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let capped: String = trimmed.chars().take(max_len).collect();
        let capped = capped.trim();
        let value = if lower {
            capped.to_lowercase()
        } else {
            capped.to_string()
        };
        let key = capped.to_lowercase();
        if seen.insert(key) {
            cleaned.push(value);
        }
        if cleaned.len() >= limit {
            break;
        }
    }

    cleaned
}

fn sanitize_instructions(entries: &[String]) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut remaining_chars = INSTRUCTION_CHAR_LIMIT;

    for raw in entries {
        if remaining_chars == 0 {
            break;
        }

        let newline_cost = usize::from(!cleaned.is_empty());
        if remaining_chars <= newline_cost {
            break;
        }

        let allowed_chars = remaining_chars - newline_cost;
        let capped: String = raw.chars().take(allowed_chars).collect();

        remaining_chars -= newline_cost;
        remaining_chars = remaining_chars.saturating_sub(capped.chars().count());
        cleaned.push(capped);
    }

    cleaned
}

fn normalize_website_domain(value: &str) -> Option<String> {
    let mut trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("https://") {
        trimmed = rest.to_string();
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        trimmed = rest.to_string();
    }

    if let Some(rest) = trimmed.strip_prefix("www.") {
        trimmed = rest.to_string();
    }

    if let Some((host, _)) = trimmed.split_once('/') {
        trimmed = host.to_string();
    }

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn sanitize_personalities(entries: &[Personality]) -> Vec<Personality> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for entry in entries {
        let name = entry.name.trim();
        if name.is_empty() {
            continue;
        }
        let mut id = entry.id.trim().to_string();
        if id.is_empty() {
            id = Uuid::new_v4().to_string();
        }
        while !seen.insert(id.to_lowercase()) {
            id = Uuid::new_v4().to_string();
        }

        let capped_name: String = name.chars().take(60).collect();
        let apps = sanitize_list(&entry.apps, 64, 60, false);
        let websites = sanitize_list(&entry.websites, 64, 120, true);
        let instructions = sanitize_instructions(&entry.instructions);

        cleaned.push(Personality {
            id,
            name: capped_name.trim().to_string(),
            enabled: entry.enabled,
            apps,
            websites,
            instructions,
        });

        if cleaned.len() >= 32 {
            break;
        }
    }

    cleaned
}

#[tauri::command]
pub fn get_personalities(state: tauri::State<AppState>) -> Result<Vec<Personality>, String> {
    let mut settings = state.current_settings();
    let cleaned = sanitize_personalities(&settings.personalities);
    if cleaned != settings.personalities {
        settings.personalities = cleaned.clone();
        state
            .persist_settings(settings)
            .map_err(|err| err.to_string())?;
    }
    Ok(cleaned)
}

#[tauri::command]
pub fn set_personalities(
    personalities: Vec<Personality>,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<Vec<Personality>, String> {
    let cleaned = sanitize_personalities(&personalities);
    let mut settings = state.current_settings();
    settings.personalities = cleaned.clone();
    let saved = state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;

    if let Err(err) = app.emit(EVENT_SETTINGS_CHANGED, &saved) {
        eprintln!("Failed to emit settings change: {err}");
    }

    Ok(cleaned)
}

#[cfg(target_os = "macos")]
fn is_blacklisted_app(name: &str) -> bool {
    let lowered = name.to_lowercase();
    let exact = [
        "activity monitor",
        "audio midi setup",
        "boot camp assistant",
        "console",
        "disk utility",
        "font book",
        "image capture",
        "keychain access",
        "migration assistant",
        "script editor",
        "system information",
        "system settings",
        "terminal",
        "time machine",
    ];
    if exact.contains(&lowered.as_str()) {
        return true;
    }

    let suffix_tokens = ["installer", "uninstaller", "updater", "agent"];
    let mut last_token = None;
    for token in lowered.split(|ch: char| !ch.is_ascii_alphanumeric()) {
        if !token.is_empty() {
            last_token = Some(token);
        }
    }

    last_token.is_some_and(|token| suffix_tokens.contains(&token))
}

#[cfg(target_os = "macos")]
fn collect_apps(
    dir: &Path,
    depth: usize,
    apps: &mut Vec<InstalledApp>,
    seen: &mut HashSet<String>,
    icon_cache_dir: Option<&Path>,
    pending_icon_warmup: &mut Vec<(PathBuf, String)>,
) {
    if depth == 0 {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name();
        if file_name.to_string_lossy().starts_with('.') {
            continue;
        }

        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
        {
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_string();
            if name.is_empty() || is_blacklisted_app(&name) {
                continue;
            }
            let key = path.to_string_lossy().to_string();
            if seen.insert(key.clone()) {
                let icon_path = icon_cache_dir.and_then(|cache_dir| {
                    let cached_path = icon_cache_file_path(&path, cache_dir);
                    if cached_path.exists() {
                        Some(cached_path.to_string_lossy().to_string())
                    } else {
                        pending_icon_warmup.push((path.clone(), name.clone()));
                        None
                    }
                });
                apps.push(InstalledApp {
                    name,
                    path: key,
                    icon_path,
                });
            }
            continue;
        }

        if path.is_dir() {
            collect_apps(
                &path,
                depth.saturating_sub(1),
                apps,
                seen,
                icon_cache_dir,
                pending_icon_warmup,
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn app_icon_cache_dir(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let mut dir = app.path().app_data_dir().ok()?;
    dir.push("local");
    dir.push("cache");
    dir.push("appicons");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn website_icon_cache_dir(app: &AppHandle<AppRuntime>) -> Option<PathBuf> {
    let mut dir = app.path().app_data_dir().ok()?;
    dir.push("local");
    dir.push("cache");
    dir.push("siteicons");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[cfg(target_os = "macos")]
fn icon_cache_file_path(app_bundle_path: &Path, cache_dir: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    app_bundle_path.to_string_lossy().hash(&mut hasher);
    let key = hasher.finish();
    cache_dir.join(format!("{key:016x}.png"))
}

fn website_icon_cache_file_path(site: &str, cache_dir: &Path) -> PathBuf {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    site.hash(&mut hasher);
    let key = hasher.finish();
    cache_dir.join(format!("{key:016x}.ico"))
}

#[cfg(target_os = "macos")]
fn pick_bundle_icon(app_bundle_path: &Path, app_name: &str) -> Option<PathBuf> {
    let resources_dir = app_bundle_path.join("Contents").join("Resources");
    let entries = std::fs::read_dir(resources_dir).ok()?;
    let app_name = app_name.to_lowercase();
    let mut best: Option<(i32, u64, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        let is_icns = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("icns"))
            .unwrap_or(false);
        if !is_icns {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let mut score = 0;
        if !app_name.is_empty() && stem == app_name {
            score += 140;
        }
        if !app_name.is_empty() && stem.contains(&app_name) {
            score += 80;
        }
        if stem.contains("appicon") {
            score += 120;
        } else if stem.contains("icon") {
            score += 40;
        }

        let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        match &best {
            Some((best_score, _, _)) if score < *best_score => {}
            Some((best_score, best_size, _)) if score == *best_score && size <= *best_size => {}
            _ => best = Some((score, size, path)),
        }
    }

    best.map(|(_, _, path)| path)
}

#[cfg(target_os = "macos")]
fn should_refresh_icon(source: &Path, cached: &Path) -> bool {
    if !cached.exists() {
        return true;
    }

    let source_modified = std::fs::metadata(source)
        .and_then(|meta| meta.modified())
        .ok();
    let cached_modified = std::fs::metadata(cached)
        .and_then(|meta| meta.modified())
        .ok();

    match (source_modified, cached_modified) {
        (Some(source_modified), Some(cached_modified)) => source_modified > cached_modified,
        (Some(_), None) => true,
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn ensure_cached_icon(app_bundle_path: &Path, app_name: &str, cache_dir: &Path) -> Option<PathBuf> {
    let source_icon = pick_bundle_icon(app_bundle_path, app_name)?;
    let cached_icon = icon_cache_file_path(app_bundle_path, cache_dir);

    if should_refresh_icon(&source_icon, &cached_icon) {
        let status = Command::new("/usr/bin/sips")
            .arg("-s")
            .arg("format")
            .arg("png")
            .arg("-z")
            .arg("64")
            .arg("64")
            .arg(&source_icon)
            .arg("--out")
            .arg(&cached_icon)
            .status()
            .ok()?;

        if !status.success() || !cached_icon.exists() {
            return None;
        }
    }

    Some(cached_icon)
}

#[cfg(target_os = "macos")]
fn warm_icon_cache_in_background(pending: Vec<(PathBuf, String)>, cache_dir: PathBuf) {
    if pending.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        for (app_bundle_path, app_name) in pending {
            let _ = ensure_cached_icon(&app_bundle_path, &app_name, &cache_dir);
        }
    });
}

fn fetch_and_cache_website_icon(
    site: &str,
    cache_dir: &Path,
    client: &reqwest::blocking::Client,
) -> Option<PathBuf> {
    let url = format!("https://{site}/favicon.ico");
    let response = client.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }

    let bytes = response.bytes().ok()?;
    if bytes.is_empty() || bytes.len() > 512 * 1024 {
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

    std::thread::spawn(move || {
        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(4))
            .connect_timeout(Duration::from_secs(3))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };

        for site in pending_sites {
            let _ = fetch_and_cache_website_icon(&site, &cache_dir, &client);
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
        if normalized.len() >= 256 {
            break;
        }
    }

    let Some(cache_dir) = website_icon_cache_dir(&app) else {
        return Ok(normalized
            .into_iter()
            .map(|site| WebsiteIcon {
                site,
                icon_path: None,
            })
            .collect());
    };

    let mut pending_sites = Vec::new();
    let mut icons = Vec::with_capacity(normalized.len());

    for site in normalized {
        let cached = website_icon_cache_file_path(&site, &cache_dir);
        let icon_path = if cached.exists() {
            Some(cached.to_string_lossy().to_string())
        } else {
            pending_sites.push(site.clone());
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
    {
        let mut apps = Vec::new();
        let mut seen = HashSet::new();
        let icon_cache_dir = app_icon_cache_dir(&app);
        let mut pending_icon_warmup = Vec::new();
        let mut roots = vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
        ];
        if let Ok(home) = std::env::var("HOME") {
            roots.push(PathBuf::from(home).join("Applications"));
        }

        for root in roots {
            collect_apps(
                &root,
                3,
                &mut apps,
                &mut seen,
                icon_cache_dir.as_deref(),
                &mut pending_icon_warmup,
            );
        }

        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        if let Some(cache_dir) = icon_cache_dir {
            warm_icon_cache_in_background(pending_icon_warmup, cache_dir);
        }
        Ok(apps)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_instructions, sanitize_personalities, INSTRUCTION_CHAR_LIMIT};
    use crate::settings::Personality;

    fn personality_with_instructions(instructions: Vec<String>) -> Personality {
        Personality {
            id: "test-id".to_string(),
            name: "Test".to_string(),
            enabled: true,
            apps: Vec::new(),
            websites: Vec::new(),
            instructions,
        }
    }

    #[test]
    fn sanitize_personalities_allows_up_to_3000_instruction_chars() {
        let instruction = "a".repeat(INSTRUCTION_CHAR_LIMIT + 250);
        let cleaned = sanitize_personalities(&[personality_with_instructions(vec![instruction])]);

        assert_eq!(cleaned.len(), 1);
        assert_eq!(cleaned[0].instructions.len(), 1);
        assert_eq!(
            cleaned[0].instructions[0].chars().count(),
            INSTRUCTION_CHAR_LIMIT
        );
    }

    #[test]
    fn sanitize_instructions_counts_newline_between_entries() {
        let instructions = vec!["a".repeat(2000), "b".repeat(2000)];
        let cleaned = sanitize_instructions(&instructions);

        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[1].chars().count(), 999);
        assert_eq!(cleaned.join("\n").chars().count(), INSTRUCTION_CHAR_LIMIT);
    }

    #[test]
    fn sanitize_instructions_is_not_limited_by_line_count() {
        let instructions: Vec<String> = (0..240).map(|index| format!("line-{index}")).collect();
        let cleaned = sanitize_instructions(&instructions);

        assert_eq!(cleaned.len(), instructions.len());
    }

    #[test]
    fn sanitize_instructions_preserves_duplicate_lines() {
        let instructions = vec![
            "repeat".to_string(),
            "repeat".to_string(),
            "repeat".to_string(),
        ];
        let cleaned = sanitize_instructions(&instructions);

        assert_eq!(cleaned, instructions);
    }
}
