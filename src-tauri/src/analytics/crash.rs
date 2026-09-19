// Crash and error reporting: panic markers, native crash markers, and
// frontend errors, all reduced to bounded fields before they leave.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde_json::json;
use tauri::Manager;

use super::*;
use crate::{AppRuntime, AppState};

const CRASH_PHASES: [&str; 13] = [
    "startup",
    "setup_start",
    "logging",
    "crash_handler",
    "settings_load",
    "app_state",
    "services",
    "tray_shortcuts",
    "background_tasks",
    "analytics_init",
    "recording_recovery",
    "running",
    "shutdown",
];
static CRASH_PHASE: AtomicU8 = AtomicU8::new(0);
static PANIC_RECORDED: AtomicBool = AtomicBool::new(false);

pub const CRASH_MARKER_FILE: &str = "last_crash.txt";
const SESSION_LOCK_FILE: &str = "session.lock";
// Must match AUTO_UPDATE_MARKER_FILE in update_checker.rs.
const AUTO_UPDATE_MARKER_FILE: &str = ".auto_updated";

pub fn set_crash_phase(phase: &'static str) {
    let Some(next) = CRASH_PHASES
        .iter()
        .position(|candidate| *candidate == phase)
    else {
        return;
    };
    let next = next as u8;
    let mut current = CRASH_PHASE.load(Ordering::Relaxed);
    while next > current {
        match CRASH_PHASE.compare_exchange_weak(current, next, Ordering::Relaxed, Ordering::Relaxed)
        {
            Ok(_) => return,
            Err(updated) => current = updated,
        }
    }
}

pub(crate) fn crash_phase() -> &'static str {
    CRASH_PHASES
        .get(usize::from(CRASH_PHASE.load(Ordering::Relaxed)))
        .copied()
        .unwrap_or("unknown")
}

// `extra` must carry `$exception_fingerprint`.
pub(super) fn capture_exception(
    app: &tauri::AppHandle<AppRuntime>,
    exception_type: &str,
    value: &str,
    mechanism: &str,
    handled: bool,
    frames: Vec<serde_json::Value>,
    extra: serde_json::Value,
) {
    let Some(mut event) = build_event(app, "$exception", extra, true) else {
        return;
    };
    let mut item = json!({
        "type": exception_type,
        "value": value,
        "mechanism": { "type": mechanism, "handled": handled, "synthetic": false },
    });
    if !frames.is_empty() {
        item["stacktrace"] = json!({ "type": "raw", "frames": frames });
    }
    let _ = event.insert_prop("$exception_list", json!([item]));
    let _ = event.insert_prop(
        "$exception_level",
        if handled { "warning" } else { "error" },
    );
    send(event);
}

pub(super) fn crash_context(
    app: &tauri::AppHandle<AppRuntime>,
    marker_payload: &serde_json::Value,
) -> serde_json::Value {
    let settings = app.state::<AppState>().current_settings();
    let selected_model = crate::speech::selected_model(&settings);
    let selected_model_kind = if crate::remote_speech::is_remote_model(&selected_model) {
        "remote"
    } else {
        "local"
    };
    let local_manifest = crate::model_manager::definition(&settings.local_model);
    let marker_phase = marker_payload
        .get("crash_phase")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| crash_phase().to_string());
    let marker_activity = marker_payload
        .get("activity")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| activity().as_str());

    json!({
        "crash_report_schema": 2,
        "crash_phase": marker_phase,
        "activity": marker_activity,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpu_features": cpu_features(),
        "speech_model_kind": selected_model_kind,
        "speech_model": selected_model,
        "local_model": settings.local_model,
        "local_model_engine": local_manifest.map(|manifest| format!("{:?}", manifest.engine)),
        "local_model_family": local_manifest.map(|manifest| manifest.family),
        "remote_speech_provider": if settings.remote_speech_enabled {
            Some(remote_provider_label(&settings.remote_speech_provider))
        } else {
            None
        },
        "remote_speech_enabled": settings.remote_speech_enabled,
        "llm_enabled": settings.llm_enabled,
    })
}

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn cpu_features() -> Vec<&'static str> {
    let mut features = Vec::new();
    if std::arch::is_x86_feature_detected!("sse4.2") {
        features.push("sse4.2");
    }
    if std::arch::is_x86_feature_detected!("avx") {
        features.push("avx");
    }
    if std::arch::is_x86_feature_detected!("avx2") {
        features.push("avx2");
    }
    if std::arch::is_x86_feature_detected!("fma") {
        features.push("fma");
    }
    if std::arch::is_x86_feature_detected!("avx512f") {
        features.push("avx512f");
    }
    features
}

#[cfg(target_arch = "aarch64")]
fn cpu_features() -> Vec<&'static str> {
    vec!["neon"]
}

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64")))]
fn cpu_features() -> Vec<&'static str> {
    Vec::new()
}

/// Records a frontend failure using only bounded fields and a local hash. The
/// exception message and stack never cross the command boundary.
#[tauri::command]
pub fn report_frontend_crash(
    app: tauri::AppHandle<AppRuntime>,
    window_label: String,
    source: String,
    error_kind: String,
    fingerprint: String,
    reason_code: String,
) {
    let window_label = match window_label.as_str() {
        "main" | "toast" | "settings" => window_label.as_str(),
        _ => "unknown",
    };
    let source = match source.as_str() {
        "render" | "window_error" | "unhandled_rejection" => source.as_str(),
        _ => "unknown",
    };
    let error_kind = match error_kind.as_str() {
        "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" => {
            error_kind.as_str()
        }
        _ => "unknown",
    };
    let fingerprint = if fingerprint.len() <= 16
        && fingerprint
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        fingerprint.as_str()
    } else {
        "unknown"
    };
    // Must stay in sync with REASON_RULES in main.tsx.
    let reason_code = match reason_code.as_str() {
        "undefined_access" | "cancelled" | "permission" | "network" | "timeout" | "not_found" => {
            reason_code.as_str()
        }
        _ => "unknown",
    };
    let diagnostics_marker = json!({ "crash_phase": "frontend" });
    capture_exception(
        &app,
        error_kind,
        &format!("{source}:{reason_code}"),
        &format!("frontend_{source}"),
        false,
        Vec::new(),
        json!({
            "$exception_fingerprint": fingerprint,
            "window": window_label,
            "source": source,
            "error_kind": error_kind,
            "reason_code": reason_code,
            "fingerprint": fingerprint,
            "diagnostics": crash_context(&app, &diagnostics_marker),
        }),
    );
}

pub fn install_crash_handler(marker_path: PathBuf, crash_log_path: Option<PathBuf>) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str));
        // Later panics would overwrite the first, which is usually the cause.
        if !PANIC_RECORDED.swap(true, Ordering::Relaxed) {
            let when = chrono::Local::now().to_rfc3339();
            write_panic_artifacts(
                &marker_path,
                crash_log_path.as_deref(),
                &location,
                message,
                &thread_label(std::thread::current().name()),
                &when,
            );
        }
        previous(info);
    }));
}

fn write_panic_artifacts(
    marker_path: &Path,
    crash_log_path: Option<&Path>,
    location: &str,
    message: Option<&str>,
    thread: &str,
    when: &str,
) {
    let crash_type = classify_panic(message);
    write_marker_atomically(
        marker_path,
        &format!(
            "{APP_VERSION}\n{location}\n{crash_type}\ncrash_phase={}\nactivity={}\nthread={thread}\n",
            crash_phase(),
            activity().as_str(),
        ),
    );
    if let Some(path) = crash_log_path {
        let detail: String = message
            .unwrap_or("<non-string panic payload>")
            .chars()
            .take(2000)
            .collect();
        let _ = std::fs::write(
            path,
            format!(
                "Glimpse {APP_VERSION} crashed\n\
                 # Stays on your device. May contain text you typed or file paths; review before sharing.\n\
                 time: {when}\nlocation: {location}\ntype: {crash_type}\nmessage: {detail}\n"
            ),
        );
    }
}

/// Temp-then-rename so a crash mid-write can't leave a truncated marker.
pub(crate) fn write_marker_atomically(marker_path: &Path, body: &str) {
    let temp_path = marker_path.with_extension("tmp");
    if std::fs::write(&temp_path, body).is_ok() {
        let _ = std::fs::rename(&temp_path, marker_path);
    }
}

// Thread names can carry counters; digits become `#` so they group.
fn thread_label(name: Option<&str>) -> String {
    let Some(name) = name.filter(|name| !name.is_empty()) else {
        return "unnamed".to_string();
    };
    name.chars()
        .take(48)
        .map(|character| match character {
            '0'..='9' => '#',
            'a'..='z' | 'A'..='Z' | '-' | '_' | '.' => character,
            _ => '_',
        })
        .collect()
}

/// What the previous run left behind when it did not quit cleanly.
pub struct PreviousSession {
    version: String,
    started_at: Option<u64>,
    alive_at: Option<u64>,
    dictation_interrupted: bool,
    recording_session_interrupted: bool,
    update_pending: bool,
    had_crash_marker: bool,
}

struct SessionLock {
    path: PathBuf,
    started_at: u64,
}

// `None` once the app has quit, so a late heartbeat cannot recreate the file.
static SESSION_LOCK: Mutex<Option<SessionLock>> = Mutex::new(None);
const FIRST_HEARTBEAT: Duration = Duration::from_secs(60);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10 * 60);

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn write_session_lock(lock: &SessionLock, alive_at: u64) {
    write_marker_atomically(
        &lock.path,
        &format!(
            "version={APP_VERSION}\nstarted_at={}\nalive_at={alive_at}\npid={}\n",
            lock.started_at,
            std::process::id(),
        ),
    );
}

/// Reads the lock a previous run left behind (it only survives an unclean
/// exit), then writes a fresh one for this run. Evidence comes from files that
/// already exist, so nothing extra is written while dictating.
pub fn begin_session(app: &tauri::AppHandle<AppRuntime>) -> Option<PreviousSession> {
    let data_dir = app.path().app_data_dir().ok()?;
    let lock_path = data_dir.join(SESSION_LOCK_FILE);
    let previous = std::fs::read_to_string(&lock_path).ok().map(|contents| {
        let field = |key: &str| {
            contents
                .lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
                .map(str::trim)
        };
        let dictation_interrupted = crate::recordings_root(app)
            .ok()
            .and_then(|root| std::fs::read_dir(root.join(crate::recorder::PENDING_DIR_NAME)).ok())
            .is_some_and(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .file_name()
                        .to_str()
                        .is_some_and(|name| name.ends_with(".partial.wav"))
                })
            });
        PreviousSession {
            version: field("version").unwrap_or("unknown").to_string(),
            started_at: field("started_at").and_then(|value| value.parse().ok()),
            alive_at: field("alive_at").and_then(|value| value.parse().ok()),
            dictation_interrupted,
            recording_session_interrupted: crate::recording::has_unfinished_session(app),
            update_pending: data_dir.join(AUTO_UPDATE_MARKER_FILE).is_file(),
            had_crash_marker: data_dir.join(CRASH_MARKER_FILE).is_file(),
        }
    });

    let _ = std::fs::create_dir_all(&data_dir);
    let lock = SessionLock {
        path: lock_path,
        started_at: unix_now(),
    };
    write_session_lock(&lock, lock.started_at);
    *SESSION_LOCK.lock() = Some(lock);
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(FIRST_HEARTBEAT).await;
        loop {
            match SESSION_LOCK.lock().as_ref() {
                Some(lock) => write_session_lock(lock, unix_now()),
                None => return,
            }
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
        }
    });
    previous
}

/// Removes this run's lock so the next launch sees a clean exit.
pub fn end_session() {
    if let Some(lock) = SESSION_LOCK.lock().take() {
        let _ = std::fs::remove_file(lock.path);
    }
}

/// Records that the previous run ended without quitting: the version that
/// was running, whether the computer restarted since (`reboot`), an update
/// was being installed (`update`), or neither (`unknown`), a bucketed uptime, and flags for an interrupted dictation,
/// an unfinished recording session, a pending update, and a crash marker.
/// When the cause is unknown and no crash marker exists, the OS crash report
/// for that run is read too (see `os_reports`).
pub fn report_unclean_exit(app: &tauri::AppHandle<AppRuntime>, previous: &PreviousSession) {
    if !app.state::<AppState>().analytics_state().0 {
        return;
    }
    let rebooted = previous
        .started_at
        .zip(boot_time())
        .is_some_and(|(started_at, booted_at)| booted_at > started_at);
    // The Windows updater quits into the installer without a normal exit.
    let cause = if rebooted {
        "reboot"
    } else if previous.update_pending {
        "update"
    } else {
        "unknown"
    };
    let uptime_bucket = match previous.started_at.zip(previous.alive_at) {
        Some((started_at, alive_at)) => uptime_bucket(alive_at.saturating_sub(started_at)),
        None => "unknown",
    };
    capture_event(
        app,
        "unclean_exit",
        json!({
            "crashed_version": previous.version,
            "cause": cause,
            "uptime_bucket": uptime_bucket,
            "dictation_interrupted": previous.dictation_interrupted,
            "recording_session_interrupted": previous.recording_session_interrupted,
            "update_pending": previous.update_pending,
            "had_crash_marker": previous.had_crash_marker,
            "session_started_at": previous.started_at,
        }),
    );
    if cause == "unknown"
        && !previous.had_crash_marker
        && let Some(started_at) = previous.started_at
    {
        super::os_reports::report_os_crash(app, started_at);
    }
}

// Lower bound: the heartbeat runs at 1 minute, then every 10 minutes.
fn uptime_bucket(seconds: u64) -> &'static str {
    match seconds {
        0..60 => "under_1m",
        60..600 => "1_10m",
        600..3_600 => "10_60m",
        3_600..28_800 => "1_8h",
        _ => "over_8h",
    }
}

#[cfg(target_os = "macos")]
fn boot_time() -> Option<u64> {
    // Prints `{ sec = 1726600000, usec = 0 } Thu Sep 17 ...`.
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "kern.boottime"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let (_, rest) = text.split_once("sec = ")?;
    rest.split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

// Fast Startup resumes the kernel instead of booting, so a shutdown with it
// enabled can read as no reboot.
#[cfg(target_os = "windows")]
fn boot_time() -> Option<u64> {
    let uptime = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() } / 1000;
    unix_now().checked_sub(uptime)
}

fn classify_panic(message: Option<&str>) -> &'static str {
    let Some(message) = message else {
        return "non_string_panic";
    };
    const RULES: &[(&str, &[&str])] = &[
        ("out_of_memory", &["memory allocation", "out of memory"]),
        ("assertion", &["assertion"]),
        ("unwrap_or_expect", &["unwrap()", "expect("]),
        ("bounds_check", &["index out of bounds"]),
    ];
    let message = message.to_ascii_lowercase();
    RULES
        .iter()
        .find(|(_, needles)| needles.iter().any(|needle| message.contains(needle)))
        .map_or("string_panic", |(reason, _)| *reason)
}

/// Reports the crash marker the previous run left, if any: the crash type,
/// sanitized source location, crash phase, activity, and panicking thread
/// name. A panic from a run that still quit cleanly is sent as handled.
pub fn report_pending_crash(
    app: &tauri::AppHandle<AppRuntime>,
    marker_path: &Path,
    previous_exit_clean: bool,
) {
    // A leftover temp file means a crash died mid-marker-write; drop it.
    let _ = std::fs::remove_file(marker_path.with_extension("tmp"));
    let Ok(contents) = std::fs::read_to_string(marker_path) else {
        return;
    };
    let _ = std::fs::remove_file(marker_path);
    let payload = parse_crash_marker(&contents);
    // Every writer fills the type line, so "unknown" means the marker was
    // cut short (e.g. the process died mid-write). Group those separately.
    let crash_type = match payload["crash_type"].as_str() {
        None | Some("unknown") => "truncated_marker".to_string(),
        Some(value) => value.to_string(),
    };
    let location = payload["location"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let location_key = sanitized_crash_location(&location, &crash_type);
    let (mechanism, fingerprint) = if crash_type == "native" {
        // Offsets differ per build, so group on module + exception code.
        (
            "native_crash",
            format!(
                "native:{}:{}",
                payload["faulting_module"].as_str().unwrap_or("unknown"),
                payload["exception_code"].as_str().unwrap_or("unknown"),
            ),
        )
    } else {
        ("rust_panic", format!("{crash_type}:{location_key}"))
    };
    // Only markers with a thread line come from builds that keep session.lock,
    // so older markers stay fatal.
    let handled =
        mechanism == "rust_panic" && previous_exit_clean && payload.get("thread").is_some();
    let diagnostics = crash_context(app, &payload);
    let extra = merge_json_objects(
        payload,
        json!({
            "location": location_key,
            "location_hash": stable_hash(&location_key),
            "raw_location_kind": if location == location_key { "unchanged" } else { "sanitized" },
            "diagnostics": diagnostics,
            "$exception_fingerprint": fingerprint,
        }),
    );
    capture_exception(
        app,
        &crash_type,
        &location_key,
        mechanism,
        handled,
        vec![crash_frame(&location_key, &crash_type)],
        extra,
    );
}

pub(super) fn merge_json_objects(
    mut base: serde_json::Value,
    extra: serde_json::Value,
) -> serde_json::Value {
    let Some(base_object) = base.as_object_mut() else {
        return extra;
    };
    if let Some(extra_object) = extra.as_object() {
        for (key, value) in extra_object {
            base_object.insert(key.clone(), value.clone());
        }
    }
    base
}

fn sanitized_crash_location(location: &str, crash_type: &str) -> String {
    if crash_type == "native" {
        return location.to_string();
    }
    let location = location.replace('\\', "/");
    let (path, line) = match location.rsplit_once(':') {
        Some((path, line)) if line.parse::<u32>().is_ok() => (path, Some(line)),
        _ => (location.as_str(), None),
    };
    let path = crate_relative_path(path).unwrap_or_else(|| path_tail(path));
    match line {
        Some(line) => format!("{path}:{line}"),
        None => path,
    }
}

// Keeps the part of a dependency path that names the crate, dropping the
// user's home directory. Expects `/` separators.
fn crate_relative_path(path: &str) -> Option<String> {
    if let Some((_, rest)) = path.split_once("/registry/src/") {
        return rest
            .split_once('/')
            .map(|(_, crate_path)| crate_path.to_string());
    }
    if let Some((_, rest)) = path.split_once("/git/checkouts/") {
        let (checkout, rest) = rest.split_once('/')?;
        let (_, file) = rest.split_once('/')?;
        let repo = checkout.rsplit_once('-').map_or(checkout, |(repo, _)| repo);
        return Some(format!("{repo}/{file}"));
    }
    if let Some((_, rest)) = path.split_once("/rustc/") {
        return rest
            .split_once('/')
            .map(|(_, library)| library)
            .filter(|library| library.starts_with("library/"))
            .map(str::to_string);
    }
    let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':');
    (!absolute).then(|| path.to_string())
}

fn path_tail(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn stable_hash(value: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

fn crash_frame(location: &str, crash_type: &str) -> serde_json::Value {
    if crash_type == "native" {
        return json!({
            "filename": location,
            "function": "<native>",
            "lang": "native",
            "platform": "native",
            "in_app": true,
            "synthetic": true,
            "resolved": false,
        });
    }
    let (filename, line_no) = location
        .rsplit_once(':')
        .and_then(|(file, line)| line.parse::<u32>().ok().map(|n| (file, Some(n))))
        .unwrap_or((location, None));
    let mut frame = json!({
        "filename": filename,
        "function": crash_type,
        "lang": "rust",
        "platform": "rust",
        "in_app": true,
        "synthetic": true,
        "resolved": true,
    });
    if let Some(line_no) = line_no {
        frame["lineno"] = json!(line_no);
    }
    frame
}

// First three lines are version/location/type; native handlers append
// key=value lines that fold into the payload.
fn parse_crash_marker(contents: &str) -> serde_json::Value {
    let mut lines = contents.lines();
    let crashed_version = lines.next().unwrap_or("unknown");
    let location = lines.next().unwrap_or("unknown");
    let crash_type = lines.next().unwrap_or("unknown");
    let mut payload = serde_json::Map::new();
    payload.insert("crashed_version".into(), json!(crashed_version));
    payload.insert("location".into(), json!(location));
    payload.insert("crash_type".into(), json!(crash_type));
    for line in lines {
        if let Some((key, value)) = line.split_once('=') {
            payload.insert(key.trim().to_string(), json!(value.trim()));
        }
    }
    serde_json::Value::Object(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_panic_marker_into_base_fields() {
        let parsed =
            parse_crash_marker("1.2.3\nsrc/lib.rs:42\nunwrap_or_expect\ncrash_phase=setup\n");
        assert_eq!(parsed["crashed_version"], "1.2.3");
        assert_eq!(parsed["location"], "src/lib.rs:42");
        assert_eq!(parsed["crash_type"], "unwrap_or_expect");
        assert_eq!(parsed["crash_phase"], "setup");
        assert!(parsed.get("faulting_module").is_none());
    }

    #[test]
    fn parses_native_marker_with_extra_fields() {
        // Exactly what platform::windows::crash emits.
        let marker = "1.0.0\nnvcuda.dll+0x7ffd1234\nnative\nexception_code=0xc0000005\nfaulting_module=nvcuda.dll\nminidump=crash.dmp\n";
        let parsed = parse_crash_marker(marker);
        assert_eq!(parsed["crash_type"], "native");
        assert_eq!(parsed["location"], "nvcuda.dll+0x7ffd1234");
        assert_eq!(parsed["exception_code"], "0xc0000005");
        assert_eq!(parsed["faulting_module"], "nvcuda.dll");
        assert_eq!(parsed["minidump"], "crash.dmp");
    }

    #[test]
    fn parses_truncated_marker_without_panicking() {
        let parsed = parse_crash_marker("1.0.0");
        assert_eq!(parsed["crashed_version"], "1.0.0");
        assert_eq!(parsed["location"], "unknown");
        assert_eq!(parsed["crash_type"], "unknown");
    }

    #[test]
    fn writes_marker_and_crash_log_then_parses_back() {
        let dir = std::env::temp_dir().join(format!("glimpse-crash-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let marker = dir.join("last_crash.txt");
        let log = dir.join("crash.log");

        write_panic_artifacts(
            &marker,
            Some(&log),
            "src/foo.rs:10",
            Some("boom: index out of bounds"),
            "tokio-runtime-worker",
            "2026-06-24T00:00:00+00:00",
        );

        let marker_text = std::fs::read_to_string(&marker).expect("read marker");
        let mut lines = marker_text.lines();
        assert_eq!(lines.next().unwrap(), APP_VERSION);
        assert_eq!(lines.next().unwrap(), "src/foo.rs:10");
        assert_eq!(lines.next().unwrap(), "bounds_check");

        // Marker stays anonymized; the local log keeps the message.
        assert!(!marker_text.contains("boom"));
        let log_text = std::fs::read_to_string(&log).expect("read crash log");
        assert!(log_text.contains("location: src/foo.rs:10"));
        assert!(log_text.contains("type: bounds_check"));
        assert!(log_text.contains("message: boom: index out of bounds"));
        assert!(log_text.contains("review before sharing"));

        let parsed = parse_crash_marker(&marker_text);
        assert_eq!(parsed["crash_type"], "bounds_check");
        assert_eq!(parsed["location"], "src/foo.rs:10");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitizes_crash_locations_without_losing_grouping_line() {
        assert_eq!(
            sanitized_crash_location("/Users/alice/private/src/foo.rs:42", "bounds_check"),
            "foo.rs:42"
        );
        assert_eq!(
            sanitized_crash_location("C:\\Users\\Alice\\AppData\\main.rs:7", "string_panic"),
            "main.rs:7"
        );
        assert_eq!(
            sanitized_crash_location("nvcuda.dll+0x1234", "native"),
            "nvcuda.dll+0x1234"
        );
        assert_eq!(
            sanitized_crash_location(
                "C:\\Users\\Alice\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f\\tao-0.35.3\\src\\platform_impl\\windows\\event_loop\\runner.rs:371",
                "string_panic"
            ),
            "tao-0.35.3/src/platform_impl/windows/event_loop/runner.rs:371"
        );
        assert_eq!(
            sanitized_crash_location(
                "/Users/alice/.cargo/git/checkouts/glimpse-speech-0a1b2c3d4e5f6a7b/9f8e7d6/src/whisper.rs:12",
                "unwrap_or_expect"
            ),
            "glimpse-speech/src/whisper.rs:12"
        );
        assert_eq!(
            sanitized_crash_location(
                "/rustc/0123abcd/library/core/src/panicking.rs:221",
                "string_panic"
            ),
            "library/core/src/panicking.rs:221"
        );
        assert_eq!(
            sanitized_crash_location("src\\recorder.rs:88", "bounds_check"),
            "src/recorder.rs:88"
        );
    }
}
