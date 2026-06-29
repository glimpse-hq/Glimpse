// Anonymous, opt-out usage analytics. You are a random UUID, never your
// identity, and your transcripts/audio are never sent. Every function below
// notes in plain English exactly what it records.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::Manager;

use crate::{settings::UserSettings, AppRuntime, AppState};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const POSTHOG_API_KEY: Option<&str> = option_env!("POSTHOG_API_KEY");
const POSTHOG_HOST: Option<&str> = option_env!("POSTHOG_HOST");

/// Starts analytics and records your app version, OS, and (once) install date.
pub async fn init(app: &tauri::AppHandle<AppRuntime>) {
    let (api_key, host) = match (POSTHOG_API_KEY, POSTHOG_HOST) {
        (Some(k), Some(h)) if !k.is_empty() && !h.is_empty() => (k, h),
        _ => return,
    };

    let (enabled, distinct_id) = app.state::<AppState>().analytics_state();
    if !enabled || distinct_id.is_empty() {
        return;
    }

    let options = match posthog_rs::ClientOptionsBuilder::default()
        .api_key(api_key.to_string())
        .host(host)
        .build()
    {
        Ok(opts) => opts,
        Err(err) => {
            tracing::error!("Failed to build PostHog client options: {err}");
            return;
        }
    };

    if let Err(err) = posthog_rs::init_global(options).await {
        tracing::error!("Failed to init PostHog: {err}");
        return;
    }

    let mut identify = posthog_rs::Event::new("$identify", &distinct_id);
    let _ = identify.insert_prop(
        "$set",
        json!({
            "app_version": APP_VERSION,
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        }),
    );
    let _ = identify.insert_prop(
        "$set_once",
        json!({ "install_date": chrono::Utc::now().to_rfc3339() }),
    );
    posthog_rs::capture(identify);
}

fn build_event(
    app: &tauri::AppHandle<AppRuntime>,
    event_name: &str,
    props: serde_json::Value,
    require_enabled: bool,
) -> Option<posthog_rs::Event> {
    if POSTHOG_API_KEY.is_none_or(|k| k.is_empty()) || POSTHOG_HOST.is_none_or(|h| h.is_empty()) {
        return None;
    }

    let (enabled, distinct_id) = app.state::<AppState>().analytics_state();
    if (require_enabled && !enabled) || distinct_id.is_empty() {
        return None;
    }

    let mut event = posthog_rs::Event::new(event_name, &distinct_id);
    let _ = event.insert_prop("app_version", APP_VERSION);
    let _ = event.insert_prop("platform", std::env::consts::OS);
    if let Some(obj) = props.as_object() {
        for (key, value) in obj {
            let _ = event.insert_prop(key.as_str(), value.clone());
        }
    }
    Some(event)
}

fn capture_event(app: &tauri::AppHandle<AppRuntime>, event_name: &str, props: serde_json::Value) {
    if let Some(event) = build_event(app, event_name, props, true) {
        posthog_rs::capture(event);
    }
}

fn capture_exception(
    app: &tauri::AppHandle<AppRuntime>,
    exception_type: &str,
    value: &str,
    mechanism: &str,
    fingerprint: &str,
    frame: Option<serde_json::Value>,
    extra: serde_json::Value,
) {
    let Some(mut event) = build_event(app, "$exception", extra, true) else {
        return;
    };
    let mut item = json!({
        "type": exception_type,
        "value": value,
        "mechanism": { "type": mechanism, "handled": false, "synthetic": false },
    });
    if let Some(frame) = frame {
        item["stacktrace"] = json!({ "type": "raw", "frames": [frame] });
    }
    let _ = event.insert_prop("$exception_list", json!([item]));
    let _ = event.insert_prop("$exception_level", "error");
    let _ = event.insert_prop("$exception_fingerprint", fingerprint);
    posthog_rs::capture(event);
}

/// Records, only on the opt-out click, that this install opted out.
/// Final event sent; bypasses the enabled check since the setting is already off.
pub fn track_analytics_opt_out(app: &tauri::AppHandle<AppRuntime>) {
    if let Some(event) = build_event(app, "analytics_opt_out", json!({}), false) {
        posthog_rs::capture(event);
    }
}

/// Records that you opened the app (fires on every launch).
pub fn track_app_started(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "app_started", json!({}));
}

/// Records the very first time you ever run the app, once per install.
pub fn track_app_installed(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "app_installed", json!({}));
}

/// Records that a transcription succeeded: local vs remote, the model, whether
/// LLM cleanup ran, audio source, audio and processing duration, and word count.
/// The transcribed text itself is never included.
#[allow(clippy::too_many_arguments)]
pub fn track_transcription_completed(
    app: &tauri::AppHandle<AppRuntime>,
    mode: &str,
    model: Option<&str>,
    llm_cleaned: bool,
    audio_duration_seconds: f32,
    transcription_duration_seconds: f32,
    word_count: u32,
    audio_source: &str,
) {
    capture_event(
        app,
        "transcription_completed",
        json!({
            "mode": mode,
            "model": model.unwrap_or("unknown"),
            "llm_cleaned": llm_cleaned,
            "audio_duration_seconds": audio_duration_seconds,
            "transcription_duration_seconds": transcription_duration_seconds,
            "word_count": word_count,
            "audio_source": audio_source,
        }),
    );
}

/// Records that a transcription failed: stage, mode, speech model, bounded
/// reason, audio source, and audio duration.
pub fn track_transcription_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    mode: &str,
    model: &str,
    reason: &str,
    audio_duration_seconds: Option<f32>,
    audio_source: &str,
) {
    capture_event(
        app,
        "transcription_failed",
        json!({
            "stage": stage,
            "mode": mode,
            "model": model,
            "reason": reason,
            "audio_duration_seconds": audio_duration_seconds,
            "audio_source": audio_source,
        }),
    );
}

/// Records a bounded onboarding screen identifier without form contents.
#[tauri::command]
pub fn track_onboarding_step_viewed(app: tauri::AppHandle<AppRuntime>, step: String) {
    let step = match step.as_str() {
        "welcome" | "import" | "model" | "model_downloading" | "permissions" | "done" => {
            step.as_str()
        }
        _ => "unknown",
    };
    capture_event(&app, "onboarding_step_viewed", json!({ "step": step }));
}

/// Records selected product-setting toggles after settings persist.
pub fn track_setting_changed(
    app: &tauri::AppHandle<AppRuntime>,
    setting: &str,
    from_value: bool,
    to_value: bool,
) {
    capture_event(
        app,
        "settings_changed",
        json!({
            "setting": setting,
            "from_value": from_value,
            "to_value": to_value,
        }),
    );
}

/// Compares persisted settings and records changes to product-feature toggles.
pub fn track_settings_changes(
    app: &tauri::AppHandle<AppRuntime>,
    previous: &UserSettings,
    next: &UserSettings,
) {
    for (setting, from_value, to_value) in [
        ("llm_enabled", previous.llm_enabled, next.llm_enabled),
        (
            "cleanup_enabled",
            previous.cleanup_enabled,
            next.cleanup_enabled,
        ),
        (
            "edit_mode_enabled",
            previous.edit_mode_enabled,
            next.edit_mode_enabled,
        ),
        (
            "remote_speech_enabled",
            previous.remote_speech_enabled,
            next.remote_speech_enabled,
        ),
        (
            "auto_dictionary_enabled",
            previous.auto_dictionary_enabled,
            next.auto_dictionary_enabled,
        ),
    ] {
        if from_value != to_value {
            track_setting_changed(app, setting, from_value, to_value);
        }
    }
}

/// Records the recording phase, a bounded failure reason, and whether the
/// default or a selected microphone was requested. Never records its name.
pub fn track_recording_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    reason: &str,
    input: &str,
) {
    capture_event(
        app,
        "recording_failed",
        json!({ "stage": stage, "reason": reason, "input": input }),
    );
}

/// Records when remote speech falls back to a local model, including the
/// bounded provider failure reason and whether fallback was available.
pub fn track_transcription_fallback(
    app: &tauri::AppHandle<AppRuntime>,
    remote_model: &str,
    local_model: &str,
    reason: &str,
    outcome: &str,
) {
    capture_event(
        app,
        "transcription_fallback",
        json!({
            "remote_model": remote_model,
            "local_model": local_model,
            "reason": reason,
            "outcome": outcome,
        }),
    );
}

/// Records the name of a speech model you downloaded.
pub fn track_model_downloaded(app: &tauri::AppHandle<AppRuntime>, model: &str) {
    capture_event(app, "model_downloaded", json!({ "model": model }));
}

/// Records a model download/install phase and bounded failure reason.
pub fn track_model_download_failed(
    app: &tauri::AppHandle<AppRuntime>,
    model: &str,
    stage: &str,
    reason: &str,
) {
    capture_event(
        app,
        "model_download_failed",
        json!({ "model": model, "stage": stage, "reason": reason }),
    );
}

/// Records a manual or automatic update phase and bounded failure reason.
pub fn track_update_failed(
    app: &tauri::AppHandle<AppRuntime>,
    source: &str,
    stage: &str,
    version: Option<&str>,
    reason: &str,
) {
    capture_event(
        app,
        "update_failed",
        json!({
            "source": source,
            "stage": stage,
            "version": version.unwrap_or("unknown"),
            "reason": reason,
        }),
    );
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
    capture_exception(
        &app,
        error_kind,
        source,
        &format!("frontend_{source}"),
        fingerprint,
        None,
        json!({
            "window": window_label,
            "source": source,
            "error_kind": error_kind,
            "fingerprint": fingerprint,
        }),
    );
}

/// Maps a raw error message to a bounded, non-identifying reason code. Rules are
/// checked in order, so earlier (more specific) categories win.
pub fn classify_failure_reason(message: &str) -> &'static str {
    const RULES: &[(&str, &[&str])] = &[
        ("cancelled", &["cancel"]),
        (
            "permission",
            &["permission", "not allowed", "access denied"],
        ),
        (
            "unauthorized",
            &["unauthorized", "authentication", "api key"],
        ),
        ("rate_limited", &["rate limit", "too many requests"]),
        ("quota_exceeded", &["quota", "billing"]),
        ("timeout", &["timeout", "timed out"]),
        ("network", &["network", "connect", "dns"]),
        ("not_found", &["not found", "no such file"]),
        ("no_speech", &["no speech", "empty"]),
        ("model_error", &["model"]),
        ("decode", &["decode", "ffmpeg"]),
        ("verification", &["checksum", "verify"]),
        ("storage", &["disk", "write", "save", "storage"]),
        ("task_failed", &["task", "join"]),
    ];
    let message = message.to_ascii_lowercase();
    RULES
        .iter()
        .find(|(_, needles)| needles.iter().any(|needle| message.contains(needle)))
        .map_or("unknown", |(reason, _)| *reason)
}

/// Records that you finished the first-run setup.
pub fn track_onboarding_completed(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "onboarding_completed", json!({}));
}

/// Flushes PostHog's global worker on app exit; `capture` only enqueues.
pub fn track_app_exited(
    app: &tauri::AppHandle<AppRuntime>,
    uptime_seconds: f64,
    transcription_count: u32,
) {
    if let Some(event) = build_event(
        app,
        "app_exited",
        json!({
            "uptime_seconds": uptime_seconds,
            "transcription_count": transcription_count,
        }),
        true,
    ) {
        posthog_rs::capture(event);
    }
    let _ = tauri::async_runtime::block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(2), posthog_rs::shutdown()).await
    });
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
        let when = chrono::Local::now().to_rfc3339();
        write_panic_artifacts(
            &marker_path,
            crash_log_path.as_deref(),
            &location,
            message,
            &when,
        );
        previous(info);
    }));
}

fn write_panic_artifacts(
    marker_path: &Path,
    crash_log_path: Option<&Path>,
    location: &str,
    message: Option<&str>,
    when: &str,
) {
    let crash_type = classify_panic(message);
    let _ = std::fs::write(
        marker_path,
        format!("{APP_VERSION}\n{location}\n{crash_type}"),
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

pub fn report_pending_crash(app: &tauri::AppHandle<AppRuntime>, marker_path: &Path) {
    let Ok(contents) = std::fs::read_to_string(marker_path) else {
        return;
    };
    let _ = std::fs::remove_file(marker_path);
    let payload = parse_crash_marker(&contents);
    let crash_type = payload["crash_type"].as_str().unwrap_or("unknown").to_string();
    let location = payload["location"].as_str().unwrap_or("unknown").to_string();
    let (mechanism, fingerprint) = if crash_type == "native" {
        // Offsets are ASLR-randomized, so group on module + exception code.
        (
            "native_crash",
            format!(
                "native:{}:{}",
                payload["faulting_module"].as_str().unwrap_or("unknown"),
                payload["exception_code"].as_str().unwrap_or("unknown"),
            ),
        )
    } else {
        ("rust_panic", format!("{crash_type}:{location}"))
    };
    capture_exception(
        app,
        &crash_type,
        &location,
        mechanism,
        &fingerprint,
        Some(crash_frame(&location, &crash_type)),
        payload,
    );
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
        let parsed = parse_crash_marker("1.2.3\nsrc/lib.rs:42\nunwrap_or_expect");
        assert_eq!(parsed["crashed_version"], "1.2.3");
        assert_eq!(parsed["location"], "src/lib.rs:42");
        assert_eq!(parsed["crash_type"], "unwrap_or_expect");
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
}
