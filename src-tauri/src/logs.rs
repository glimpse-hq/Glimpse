use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};

use crate::{AppRuntime, AppState};

static LOG_GUARD: Mutex<Option<tracing_appender::non_blocking::WorkerGuard>> = Mutex::new(None);

const REPORT_FILE: &str = "Glimpse Report.txt";
const REPORT_LOG_BYTES: usize = 2 * 1024 * 1024;
// Lines before the first launch line were written by older versions, which
// logged provider replies and file paths.
const LAUNCH_MARK: &str = "glimpse_lib::logs: start ";

/// Writes app logs to daily-rotated files in the OS log dir (kept 7 days)
pub(crate) fn init(app: &AppHandle<AppRuntime>) {
    use tracing_subscriber::fmt::writer::MakeWriterExt;
    use tracing_subscriber::layer::SubscriberExt;

    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::remove_file(dir.join("crash.log"));

    let appender = match tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("glimpse")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&dir)
    {
        Ok(appender) => appender,
        Err(err) => {
            eprintln!("Failed to create log file appender: {err}");
            return;
        }
    };
    let (writer, guard) = tracing_appender::non_blocking(appender);

    let filter = tracing_subscriber::filter::Targets::new()
        .with_default(tracing::level_filters::LevelFilter::WARN)
        .with_target("glimpse_lib", tracing::level_filters::LevelFilter::INFO)
        .with_target("glimpse_speech", tracing::level_filters::LevelFilter::INFO);
    let subscriber = tracing_subscriber::fmt()
        .with_writer(writer.and(std::io::stderr))
        .with_ansi(false)
        .finish()
        .with(filter);
    if tracing::subscriber::set_global_default(subscriber).is_ok() {
        *LOG_GUARD.lock() = Some(guard);
        tracing::info!("start v{}", env!("CARGO_PKG_VERSION"));
    }
}

/// Writes out queued lines before the process exits. Later lines are dropped.
pub(crate) fn flush() {
    LOG_GUARD.lock().take();
}

/// Logs the setup and how the previous run ended, off the startup path.
pub(crate) fn log_launch(
    app: &AppHandle<AppRuntime>,
    previous: Option<crate::analytics::PreviousSession>,
    previous_marker: Option<String>,
) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let previous_run =
            crate::analytics::previous_run_summary(previous.as_ref(), previous_marker.as_deref());
        tracing::info!("setup {} prev={previous_run}", summary(&app));
    });
}

fn summary(app: &AppHandle<AppRuntime>) -> String {
    let settings = app.state::<AppState>().current_settings();
    let model = crate::speech::selected_model(&settings);
    let model = if crate::remote_speech::is_remote_model(&model) {
        format!(
            "remote:{}",
            crate::analytics::remote_provider_label(&settings.remote_speech_provider)
        )
    } else {
        model
    };
    let hardware: Vec<String> = crate::analytics::hardware_profile()
        .into_iter()
        .map(|(key, value)| format!("{key}={}", value.as_str().unwrap_or_default()))
        .collect();
    format!(
        "v{} {} {} {} {} {} mic={} accessibility={} model={model} cleanup={} utc{}",
        env!("CARGO_PKG_VERSION"),
        crate::platform::install_type(),
        std::env::consts::OS,
        os_version(),
        std::env::consts::ARCH,
        hardware.join(" "),
        microphone_access(),
        accessibility_access(),
        if settings.llm_enabled { "on" } else { "off" },
        chrono::Local::now().format("%:z"),
    )
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    format!(
        "{}.{}.{}",
        version.majorVersion, version.minorVersion, version.patchVersion
    )
}

#[cfg(target_os = "windows")]
fn os_version() -> String {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::UI::Shell::SHRegGetUSValueW;
    use windows::core::HSTRING;

    let mut buffer = [0u16; 16];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    let err = unsafe {
        SHRegGetUSValueW(
            &HSTRING::from(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"),
            &HSTRING::from("CurrentBuildNumber"),
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size as *mut u32),
            true,
            None,
            0,
        )
    };
    if err != ERROR_SUCCESS {
        return "build=unknown".into();
    }
    let len = (size as usize / 2).min(buffer.len());
    format!(
        "build={}",
        String::from_utf16_lossy(&buffer[..len]).trim_end_matches('\0')
    )
}

// The cached grant: a fresh TCC check can block for minutes.
#[cfg(target_os = "macos")]
fn microphone_access() -> &'static str {
    match crate::permissions::microphone_permission_known() {
        Some(true) => "allowed",
        Some(false) => "denied",
        None => "unknown",
    }
}

#[cfg(target_os = "windows")]
fn microphone_access() -> &'static str {
    if crate::permissions::check_microphone_permission() {
        "allowed"
    } else {
        "denied"
    }
}

#[cfg(target_os = "macos")]
fn accessibility_access() -> &'static str {
    if crate::permissions::check_accessibility_permission() {
        "allowed"
    } else {
        "missing"
    }
}

#[cfg(target_os = "windows")]
fn accessibility_access() -> &'static str {
    "n/a"
}

#[cfg(target_os = "macos")]
fn secure_input() -> &'static str {
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }
    // While on, macOS hides every keypress from other apps, shortcuts included.
    if unsafe { IsSecureEventInputEnabled() != 0 } {
        " secure_input=on"
    } else {
        " secure_input=off"
    }
}

#[cfg(target_os = "windows")]
fn secure_input() -> &'static str {
    ""
}

/// Writes a shareable report (current state and recent logs) and shows it in
/// Finder or Explorer.
#[tauri::command]
pub(crate) async fn reveal_logs(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
        let path = dir.join(REPORT_FILE);
        let state = app.state::<AppState>();
        let mut report = format!(
            "Glimpse report {}\n{}\n{}{}\n\n",
            chrono::Local::now().to_rfc3339(),
            summary(&app),
            state.hotkeys.summary(),
            secure_input(),
        );
        report.push_str(&recent_logs(&dir));
        if let Ok(home) = app.path().home_dir() {
            let home = home.to_string_lossy();
            report = report
                .replace(home.as_ref(), "~")
                .replace(&home.replace('\\', r"\\"), "~");
        }
        std::fs::write(&path, report).map_err(|err| err.to_string())?;
        Ok::<_, String>(path)
    })
    .await
    .map_err(|err| err.to_string())??;
    tauri_plugin_opener::reveal_item_in_dir(visible_path(path)).map_err(|err| err.to_string())
}

fn recent_logs(dir: &Path) -> String {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("glimpse.") && name.ends_with(".log"))
        })
        .collect();
    files.sort();
    let mut logs = String::new();
    for file in files {
        if let Ok(bytes) = std::fs::read(&file) {
            logs.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    let Some(first_launch) = logs.find(LAUNCH_MARK) else {
        return String::new();
    };
    let start = logs[..first_launch]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let mut tail_start = start.max(logs.len().saturating_sub(REPORT_LOG_BYTES));
    while !logs.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    logs.split_off(tail_start)
}

// Store builds write AppData into the package's own folder, which Explorer
// can't see at the path the app uses.
#[cfg(target_os = "windows")]
fn visible_path(path: PathBuf) -> PathBuf {
    let (Some(cache), Some(local)) = (
        crate::data_export::msix_local_cache_dir(),
        std::env::var_os("LOCALAPPDATA"),
    ) else {
        return path;
    };
    match path.strip_prefix(local) {
        Ok(rest) if cache.join("Local").join(rest).is_file() => cache.join("Local").join(rest),
        _ => path,
    }
}

#[cfg(target_os = "macos")]
fn visible_path(path: PathBuf) -> PathBuf {
    path
}
