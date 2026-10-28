use std::collections::HashSet;
use std::path::{Path, PathBuf};

use objc2::AnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWorkspace};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
use tauri::AppHandle;

use crate::AppRuntime;
use crate::personalization::icons::{InstalledApp, app_icon_cache_dir, icon_cache_file_path};

const APP_ICON_POINTS: f64 = 32.0;

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
    lowered
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .rfind(|token| !token.is_empty())
        .is_some_and(|token| suffix_tokens.contains(&token))
}

fn collect_apps(
    dir: &Path,
    depth: usize,
    apps: &mut Vec<InstalledApp>,
    seen: &mut HashSet<String>,
    icon_cache_dir: Option<&Path>,
    pending_icon_warmup: &mut Vec<PathBuf>,
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

        let is_app_bundle = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false);
        if is_app_bundle {
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
                        pending_icon_warmup.push(path.clone());
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

/// PNG of an app icon's best representation for 32 points.
pub(crate) fn icon_png(icon: &NSImage) -> Option<Vec<u8>> {
    let mut rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(APP_ICON_POINTS, APP_ICON_POINTS),
    );
    let cg_image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

// NSWorkspace also finds icons that live only in the bundle's Assets.car.
fn cache_app_icon(app_bundle_path: &Path, cache_dir: &Path) -> Option<()> {
    let png = objc2::rc::autoreleasepool(|_| {
        let path = NSString::from_str(&app_bundle_path.to_string_lossy());
        let icon = NSWorkspace::sharedWorkspace().iconForFile(&path);
        icon_png(&icon)
    })?;
    std::fs::write(icon_cache_file_path(app_bundle_path, cache_dir), png).ok()
}

fn warm_icon_cache_in_background(pending: Vec<PathBuf>, cache_dir: PathBuf) {
    if pending.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        for app_bundle_path in pending {
            let _ = cache_app_icon(&app_bundle_path, &cache_dir);
        }
    });
}

pub fn list_installed_apps(app: &AppHandle<AppRuntime>) -> Result<Vec<InstalledApp>, String> {
    let mut apps = Vec::new();
    let mut seen = HashSet::new();
    let icon_cache_dir = app_icon_cache_dir(app);
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

    apps.sort_by_key(|app| app.name.to_lowercase());
    if let Some(cache_dir) = icon_cache_dir {
        warm_icon_cache_in_background(pending_icon_warmup, cache_dir);
    }
    Ok(apps)
}
