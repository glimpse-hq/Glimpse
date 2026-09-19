// App-level events and the device profile: shortcuts, updates, models, hardware.

use parking_lot::Mutex;
use serde_json::json;

use super::*;
use crate::AppRuntime;

static SHORTCUT_FAILURES_SENT: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

/// Records that global shortcuts stopped working or could not start: the
/// stage (worker_exit, keyboard_hook, mouse_hook, event_tap,
/// event_tap_disabled, register), a
/// bounded reason, and the numeric OS error code when there is one. At most
/// once per stage per session.
pub fn track_shortcut_failed(stage: &'static str, reason: impl Into<ErrorDetail>) {
    {
        let mut sent = SHORTCUT_FAILURES_SENT.lock();
        if sent.contains(&stage) {
            return;
        }
        sent.push(stage);
    }
    let reason = reason.into();
    // Callers include keyboard hook and event tap threads, which must not block.
    std::thread::spawn(move || {
        let mut props = json!({ "stage": stage });
        reason.insert_into(&mut props);
        capture_global("shortcut_failed", props);
    });
}

/// Records that an update finished installing: the version you updated
/// from and whether it was an automatic or a manual update.
pub fn track_update_installed(
    app: &tauri::AppHandle<AppRuntime>,
    from_version: &str,
    source: &str,
) {
    let is_version = from_version.split('.').count() == 3
        && from_version.split('.').all(|part| {
            !part.is_empty() && part.len() <= 4 && part.bytes().all(|b| b.is_ascii_digit())
        });
    capture_event(
        app,
        "update_installed",
        json!({
            "from_version": if is_version { from_version } else { "unknown" },
            "source": source,
        }),
    );
}

/// Records the name of a speech model you deleted.
pub fn track_model_deleted(app: &tauri::AppHandle<AppRuntime>, model: &str) {
    let model = if crate::speech::catalog::definition(model).is_some() {
        model
    } else {
        "other"
    };
    capture_event(app, "model_deleted", json!({ "model": model }));
}

/// Records which speech model you switched from and to.
pub fn track_model_changed(app: &tauri::AppHandle<AppRuntime>, from: &str, to: &str) {
    capture_event(app, "model_changed", json!({ "from": from, "to": to }));
}

/// Coarse hardware profile: memory as a bucket, the chip family, and on
/// Windows the graphics vendor. Anything that can't be read is left out.
pub(super) fn hardware_profile() -> serde_json::Map<String, serde_json::Value> {
    let mut profile = serde_json::Map::new();
    if let Some(bytes) = total_memory_bytes() {
        profile.insert("ram_bucket".into(), ram_bucket(bytes).into());
    }
    if let Some(chip) = chip() {
        profile.insert("chip".into(), chip.into());
    }
    #[cfg(target_os = "windows")]
    if let Some(vendor) = gpu_vendor() {
        profile.insert("gpu_vendor".into(), vendor.into());
    }
    profile
}

// Machines report a little less than their installed memory.
fn ram_bucket(bytes: u64) -> &'static str {
    match bytes as f64 / (1u64 << 30) as f64 {
        gib if gib < 7.0 => "under_8",
        gib if gib < 12.0 => "8",
        gib if gib < 20.0 => "16",
        gib if gib < 40.0 => "24_36",
        _ => "48_plus",
    }
}

#[cfg(target_os = "macos")]
fn sysctl(name: &str) -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn total_memory_bytes() -> Option<u64> {
    sysctl("hw.memsize")?.parse().ok()
}

/// `m1` through `m9`, with `_pro`, `_max` or `_ultra` when present.
#[cfg(target_os = "macos")]
fn chip() -> Option<String> {
    let brand = sysctl("machdep.cpu.brand_string")?;
    if brand.contains("Intel") {
        return Some("intel".into());
    }
    let Some(rest) = brand.strip_prefix("Apple M") else {
        return Some("other".into());
    };
    let mut words = rest.split_whitespace();
    let generation = words
        .next()
        .filter(|word| word.len() == 1 && word.bytes().all(|b| b.is_ascii_digit()));
    let Some(generation) = generation else {
        return Some("other".into());
    };
    let tier = match words.next() {
        Some("Pro") => "_pro",
        Some("Max") => "_max",
        Some("Ultra") => "_ultra",
        _ => "",
    };
    Some(format!("m{generation}{tier}"))
}

#[cfg(target_os = "windows")]
fn total_memory_bytes() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some(status.ullTotalPhys)
}

#[cfg(target_os = "windows")]
fn chip() -> Option<String> {
    if cfg!(target_arch = "aarch64") {
        return Some("arm".into());
    }
    let identifier = std::env::var("PROCESSOR_IDENTIFIER").ok()?;
    let chip = if identifier.contains("GenuineIntel") {
        "intel"
    } else if identifier.contains("AuthenticAMD") {
        "amd"
    } else if identifier.starts_with("ARM") {
        "arm"
    } else {
        "other"
    };
    Some(chip.into())
}

/// The vendor of the first hardware graphics adapter.
#[cfg(target_os = "windows")]
fn gpu_vendor() -> Option<&'static str> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1,
    };

    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
    (0..)
        .map_while(|index| unsafe { factory.EnumAdapters1(index) }.ok())
        .filter_map(|adapter| unsafe { adapter.GetDesc1() }.ok())
        .find(|desc| desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0)
        .map(|desc| match desc.VendorId {
            0x10DE => "nvidia",
            0x1002 => "amd",
            0x8086 => "intel",
            _ => "other",
        })
}
