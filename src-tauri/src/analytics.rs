use serde_json::json;
use tauri_plugin_aptabase::EventTracker;

use crate::AppRuntime;

pub fn track_transcription_completed(
    app: &tauri::AppHandle<AppRuntime>,
    mode: &str,
    keybind: &str,
    engine: &str,
    model: Option<&str>,
    llm_cleaned: bool,
    duration_secs: f64,
) {
    let props = json!({
        "mode": mode,
        "keybind": keybind,
        "engine": engine,
        "model": model.unwrap_or("unknown"),
        "llm_cleaned": llm_cleaned,
        "duration_secs": duration_secs
    });
    let _ = app.track_event("transcription_completed", Some(props));
}

pub fn track_transcription_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    engine: &str,
    reason: &str,
) {
    let props = json!({
        "stage": stage,
        "engine": engine,
        "reason": reason
    });
    let _ = app.track_event("transcription_failed", Some(props));
}

pub fn track_model_downloaded(app: &tauri::AppHandle<AppRuntime>, model: &str, size_mb: f32) {
    let props = json!({
        "model": model,
        "size_mb": size_mb
    });
    let _ = app.track_event("model_downloaded", Some(props));
}

pub fn track_onboarding_completed(app: &tauri::AppHandle<AppRuntime>, model_selected: &str) {
    let props = json!({
        "model_selected": model_selected
    });
    let _ = app.track_event("onboarding_completed", Some(props));
}

pub fn track_app_exited(
    app: &tauri::AppHandle<AppRuntime>,
    uptime_seconds: f64,
    recording_seconds: f64,
    transcription_count: u32,
) {
    let props = json!({
        "uptime_seconds": uptime_seconds,
        "recording_seconds": recording_seconds,
        "transcription_count": transcription_count
    });
    let _ = app.track_event("app_exited", Some(props));
}
