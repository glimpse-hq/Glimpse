// Anonymous, opt-out usage analytics. You are a random UUID, never your
// identity, and your transcripts/audio are never sent. Every function below
// notes in plain English exactly what it records.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::Manager;

use crate::{AppRuntime, AppState};

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
            eprintln!("Failed to build PostHog client options: {err}");
            return;
        }
    };

    if let Err(err) = posthog_rs::init_global(options).await {
        eprintln!("Failed to init PostHog: {err}");
        return;
    }

    let mut identify = posthog_rs::Event::new("$identify", &distinct_id);
    let _ = identify.insert_prop(
        "$set",
        json!({
            "app_version": APP_VERSION,
            "platform": std::env::consts::OS,
        }),
    );
    let _ = identify.insert_prop(
        "$set_once",
        json!({ "install_date": chrono::Utc::now().to_rfc3339() }),
    );
    let _ = posthog_rs::capture(identify).await;
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
        tauri::async_runtime::spawn(async move {
            let _ = posthog_rs::capture(event).await;
        });
    }
}

/// Best-effort blocking capture for use during app exit.
/// SAFETY: Must be called from a synchronous context (e.g. Tauri window event handler).
/// Calling from within an async Tokio task will panic.
fn capture_event_blocking(
    app: &tauri::AppHandle<AppRuntime>,
    event_name: &str,
    props: serde_json::Value,
) {
    if let Some(event) = build_event(app, event_name, props, true) {
        let _ = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                std::time::Duration::from_secs(2),
                posthog_rs::capture(event),
            )
            .await
        });
    }
}

/// Records, only on the opt-out click, that this install opted out.
/// Final event sent; bypasses the enabled check since the setting is already off.
pub fn track_analytics_opt_out(app: &tauri::AppHandle<AppRuntime>) {
    if let Some(event) = build_event(app, "analytics_opt_out", json!({}), false) {
        tauri::async_runtime::spawn(async move {
            let _ = posthog_rs::capture(event).await;
        });
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
/// LLM cleanup ran, plus the audio length and word count as plain numbers.
/// The transcribed text itself is never included.
pub fn track_transcription_completed(
    app: &tauri::AppHandle<AppRuntime>,
    mode: &str,
    model: Option<&str>,
    llm_cleaned: bool,
    audio_duration_seconds: f32,
    word_count: u32,
) {
    capture_event(
        app,
        "transcription_completed",
        json!({
            "mode": mode,
            "model": model.unwrap_or("unknown"),
            "llm_cleaned": llm_cleaned,
            "audio_duration_seconds": audio_duration_seconds,
            "word_count": word_count,
        }),
    );
}

/// Records that a transcription failed: which step and a short reason code only.
pub fn track_transcription_failed(app: &tauri::AppHandle<AppRuntime>, stage: &str, reason: &str) {
    capture_event(
        app,
        "transcription_failed",
        json!({ "stage": stage, "reason": reason }),
    );
}

/// Records the name of a speech model you downloaded.
pub fn track_model_downloaded(app: &tauri::AppHandle<AppRuntime>, model: &str) {
    capture_event(app, "model_downloaded", json!({ "model": model }));
}

/// Records that you finished the first-run setup.
pub fn track_onboarding_completed(app: &tauri::AppHandle<AppRuntime>) {
    capture_event(app, "onboarding_completed", json!({}));
}

/// Records, as you quit, how long the app ran and how many transcriptions it did.
pub fn track_app_exited(
    app: &tauri::AppHandle<AppRuntime>,
    uptime_seconds: f64,
    transcription_count: u32,
) {
    capture_event_blocking(
        app,
        "app_exited",
        json!({
            "uptime_seconds": uptime_seconds,
            "transcription_count": transcription_count,
        }),
    );
}

/// On a crash, leaves a small marker with only the version and the code location
/// (file:line) — never the crash message, which could echo your text.
pub fn install_crash_handler(marker_path: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let _ = std::fs::write(&marker_path, format!("{APP_VERSION}\n{location}"));
        previous(info);
    }));
}

/// If the last run left a crash marker, records it now and clears the marker.
pub fn report_pending_crash(app: &tauri::AppHandle<AppRuntime>, marker_path: &Path) {
    let Ok(contents) = std::fs::read_to_string(marker_path) else {
        return;
    };
    let _ = std::fs::remove_file(marker_path);

    let mut lines = contents.lines();
    let crashed_version = lines.next().unwrap_or("unknown");
    let location = lines.next().unwrap_or("unknown");
    capture_event(
        app,
        "app_crashed",
        json!({ "crashed_version": crashed_version, "location": location }),
    );
}
