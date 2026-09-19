// Recording mode, Library, screen, and integration events.

use std::collections::HashSet;

use parking_lot::Mutex;
use serde_json::json;

use super::*;
use crate::AppRuntime;

/// Records which main screen you opened: home, dictionary, brain, library,
/// or record. Anything else is recorded as "other".
#[tauri::command]
pub fn track_screen_viewed(app: tauri::AppHandle<AppRuntime>, screen: String) {
    let screen = match screen.as_str() {
        "home" | "dictionary" | "brain" | "library" | "record" => screen.as_str(),
        _ => "other",
    };
    capture_event(&app, "screen_viewed", json!({ "screen": screen }));
}

/// Records that the number of custom personalities changed, as a bucket
/// (0, 1, 2_5, 6_plus). Never their names or prompts.
pub fn track_personalities_changed(app: &tauri::AppHandle<AppRuntime>, custom_count: usize) {
    let custom_count = match custom_count {
        0 => "0",
        1 => "1",
        2..=5 => "2_5",
        _ => "6_plus",
    };
    capture_event(
        app,
        "personalities_changed",
        json!({ "custom_count": custom_count }),
    );
}

/// Records that a recording started: whether the microphone is on, and
/// whether system audio is off, the whole system, or selected apps
/// (none, all, app). Never which apps or which microphone.
pub fn track_recording_session_started(
    app: &tauri::AppHandle<AppRuntime>,
    mic: bool,
    system: &str,
) {
    capture_event(
        app,
        "recording_session_started",
        json!({ "mic": mic, "system": system }),
    );
}

/// Records that a recording could not start: the step that failed, a bounded
/// reason, and the system audio scope (none, all, app).
pub fn track_recording_session_failed(
    app: &tauri::AppHandle<AppRuntime>,
    stage: &str,
    reason: impl Into<ErrorDetail>,
    system: &str,
) {
    let mut props = json!({ "stage": stage, "system": system });
    reason.into().insert_into(&mut props);
    capture_event(app, "recording_session_failed", props);
}

/// What `recording_session_ended` records about a session.
pub struct RecordingSessionSummary {
    pub duration_seconds: f32,
    pub paused: bool,
    pub bookmarks: usize,
    pub mic: bool,
    /// none, all, or app.
    pub system: &'static str,
}

/// Records how a recording ended (saved, failed, or discarded), its length as
/// a bucket, whether you paused it, a bookmark count bucket, and which kinds
/// of source it used. A failure adds the step and a bounded reason. Never the
/// recording's name, audio, or transcript.
pub fn track_recording_session_ended(
    app: &tauri::AppHandle<AppRuntime>,
    outcome: &str,
    summary: &RecordingSessionSummary,
    failure: Option<(&str, ErrorDetail)>,
) {
    let minutes = summary.duration_seconds / 60.0;
    let duration = if minutes < 5.0 {
        "under_5m"
    } else if minutes < 30.0 {
        "5_30m"
    } else if minutes < 90.0 {
        "30_90m"
    } else {
        "over_90m"
    };
    let bookmarks = match summary.bookmarks {
        0 => "0",
        1..=5 => "1_5",
        _ => "6_plus",
    };
    let mut props = json!({
        "outcome": outcome,
        "duration": duration,
        "paused": summary.paused,
        "bookmarks": bookmarks,
        "mic": summary.mic,
        "system": summary.system,
    });
    if let Some((stage, reason)) = failure {
        props["stage"] = stage.into();
        reason.insert_into(&mut props);
    }
    capture_event(app, "recording_session_ended", props);
}

/// Records how many recordings interrupted by a crash or quit were saved to
/// the Library on launch, and how many could not be.
pub fn track_recording_recovered(app: &tauri::AppHandle<AppRuntime>, recovered: u32, failed: u32) {
    capture_event(
        app,
        "recording_recovered",
        json!({ "recovered": recovered, "failed": failed }),
    );
}

/// Records that the app opened a system permission page, and which one.
pub fn track_permission_prompt_opened(app: &tauri::AppHandle<AppRuntime>, permission: &str) {
    capture_event(
        app,
        "permission_prompt_opened",
        json!({ "permission": permission }),
    );
}

static INTEGRATIONS_SEEN: Mutex<Option<HashSet<(&'static str, &'static str)>>> = Mutex::new(None);

/// Records, once per app session, that an outside tool used a Glimpse
/// command: the surface (cli, raycast, shortcuts, api) and the fixed command
/// or endpoint name. Never its arguments, files, or text.
pub fn track_integration_used(
    app: &tauri::AppHandle<AppRuntime>,
    surface: &'static str,
    command: &'static str,
) {
    let first = INTEGRATIONS_SEEN
        .lock()
        .get_or_insert_with(HashSet::new)
        .insert((surface, command));
    if first {
        capture_event(
            app,
            "integration_used",
            json!({ "surface": surface, "command": command }),
        );
    }
}

// Control socket commands from `integrations::handlers::dispatch`.
const CLI_COMMANDS: &[&str] = &[
    "dictionary.add",
    "dictionary.remove",
    "replacements.add",
    "replacements.remove",
    "model.set",
    "open",
    "status",
    "library.import",
    "api.start",
    "api.stop",
    "api.status",
    "transcribe",
];

/// Records, once per app session, that the CLI ran a command in the app:
/// the tool that drove it (cli, raycast, shortcuts) and the command name.
/// Unknown commands are not recorded.
pub fn track_cli_command(app: &tauri::AppHandle<AppRuntime>, client: Option<&str>, command: &str) {
    let Some(command) = CLI_COMMANDS.iter().find(|known| **known == command) else {
        return;
    };
    let surface = match client {
        Some("raycast") => "raycast",
        Some("shortcuts") => "shortcuts",
        _ => "cli",
    };
    track_integration_used(app, surface, command);
}
