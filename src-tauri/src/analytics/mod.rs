// Anonymous, opt-out usage analytics. You are a random UUID, never your
// identity, and your transcripts/audio are never sent. Every function below
// notes in plain English exactly what it records.

pub mod classify;
pub mod crash;
pub mod dictation;
pub mod events;
pub mod os_reports;
pub mod recording;
pub mod system;

pub use classify::*;
pub use crash::*;
pub use dictation::*;
pub use events::*;
pub use recording::*;
pub use system::*;

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use parking_lot::Mutex;

use serde_json::json;
use tauri::Manager;

use crate::{AppRuntime, AppState};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const POSTHOG_API_KEY: Option<&str> = option_env!("POSTHOG_API_KEY");
const POSTHOG_HOST: Option<&str> = option_env!("POSTHOG_HOST");

static APP: OnceLock<tauri::AppHandle<AppRuntime>> = OnceLock::new();

/// Lets code without an `AppHandle` (hotkey workers, hooks) report events.
pub fn set_app(app: &tauri::AppHandle<AppRuntime>) {
    let _ = APP.set(app.clone());
}

pub(crate) fn app() -> Option<&'static tauri::AppHandle<AppRuntime>> {
    APP.get()
}

/// What the app is doing right now. Written into crash markers so a crash
/// report says whether a dictation or recording was in flight. One relaxed
/// atomic store, so it is safe on the hot path.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Activity {
    Idle = 0,
    Recording,
    Transcribing,
    Llm,
    Inserting,
    RecordingSession,
    ModelLoading,
    Updating,
}

impl Activity {
    pub fn as_str(self) -> &'static str {
        match self {
            Activity::Idle => "idle",
            Activity::Recording => "recording",
            Activity::Transcribing => "transcribing",
            Activity::Llm => "llm",
            Activity::Inserting => "inserting",
            Activity::RecordingSession => "recording_session",
            Activity::ModelLoading => "model_loading",
            Activity::Updating => "updating",
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Activity::Recording,
            2 => Activity::Transcribing,
            3 => Activity::Llm,
            4 => Activity::Inserting,
            5 => Activity::RecordingSession,
            6 => Activity::ModelLoading,
            7 => Activity::Updating,
            _ => Activity::Idle,
        }
    }
}

static ACTIVITY: AtomicU8 = AtomicU8::new(0);

pub fn set_activity(activity: Activity) {
    ACTIVITY.store(activity as u8, Ordering::Relaxed);
}

pub fn activity() -> Activity {
    Activity::from_u8(ACTIVITY.load(Ordering::Relaxed))
}

/// Debug builds log events instead of sending them when
/// `GLIMPSE_ANALYTICS_LOG=1`, so new events can be checked locally.
fn debug_log_enabled() -> bool {
    cfg!(debug_assertions) && std::env::var("GLIMPSE_ANALYTICS_LOG").is_ok_and(|value| value == "1")
}

// posthog-rs drops events captured before `init_global`, so events from
// early setup (deep links, recovery) wait here until the client is ready.
static CLIENT_READY: AtomicBool = AtomicBool::new(false);
static EARLY_EVENTS: Mutex<Vec<posthog_rs::Event>> = Mutex::new(Vec::new());
const MAX_EARLY_EVENTS: usize = 32;

fn send(event: posthog_rs::Event) {
    if debug_log_enabled() {
        match serde_json::to_string(&event) {
            Ok(json) => tracing::info!("analytics event: {json}"),
            Err(err) => tracing::warn!("analytics event not serializable: {err}"),
        }
        return;
    }
    if !CLIENT_READY.load(Ordering::Acquire) {
        let mut early = EARLY_EVENTS.lock();
        if !CLIENT_READY.load(Ordering::Acquire) {
            if early.len() < MAX_EARLY_EVENTS {
                early.push(event);
            }
            return;
        }
    }
    posthog_rs::capture(event);
}

fn mark_client_ready() {
    let early = {
        let mut early = EARLY_EVENTS.lock();
        CLIENT_READY.store(true, Ordering::Release);
        std::mem::take(&mut *early)
    };
    for event in early {
        posthog_rs::capture(event);
    }
}

/// Buckets a duration so exact lengths never leave the device.
pub fn audio_length_bucket(seconds: Option<f32>) -> &'static str {
    match seconds {
        None => "unknown",
        Some(s) if s < 1.0 => "under_1s",
        Some(s) if s < 3.0 => "1_to_3s",
        Some(s) if s < 10.0 => "3_to_10s",
        Some(_) => "over_10s",
    }
}

const REMOTE_SPEECH_PROVIDERS: &[&str] = &[
    "custom",
    "openai",
    "groq",
    "xai",
    "mistral",
    "fireworks",
    "openrouter",
    "deepgram",
    "elevenlabs",
    "vllm",
    "localai",
    "whisper-cpp",
    "llamaedge",
    "litellm",
];

// Remote model names are typed by the user, so only well-known public ids pass.
const REMOTE_SPEECH_MODELS: &[&str] = &[
    "gpt-transcribe",
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "whisper-1",
    "whisper-large-v3",
    "whisper-large-v3-turbo",
    "distil-whisper-large-v3-en",
    "whisper-v3",
    "whisper-v3-turbo",
    "openai/whisper-1",
    "openai/whisper-large-v3",
    "openai/whisper-large-v3-turbo",
    "openai/gpt-transcribe",
    "x-ai/grok-stt-1.0",
    "grok-voice-transcribe-1.0",
    "grok-voice-transcribe-2.0",
    "deepgram/nova-3",
    "mistralai/voxtral-mini-transcribe",
    "voxtral-mini-latest",
    "voxtral-small-latest",
    "nova-2",
    "nova-3",
    "scribe_v1",
    "scribe_v2",
];

/// Reduces a remote speech provider to a known id, else `custom`.
pub(crate) fn remote_provider_label(provider: &str) -> &'static str {
    let provider = provider.trim().to_ascii_lowercase();
    REMOTE_SPEECH_PROVIDERS
        .iter()
        .find(|known| **known == provider)
        .copied()
        .unwrap_or("custom")
}

/// Rewrites `remote:<provider>:<model>` labels so a typed provider or model
/// name never leaves the device.
fn bound_remote_labels(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => {
            let Some(rest) = text.strip_prefix(crate::speech::remote::SPEECH_MODEL_REMOTE_PREFIX)
            else {
                return;
            };
            let (provider, model) = rest.split_once(':').unwrap_or((rest, ""));
            let provider = remote_provider_label(provider);
            let model = model.trim();
            let prefix = crate::speech::remote::SPEECH_MODEL_REMOTE_PREFIX;
            *text = if model.is_empty() {
                format!("{prefix}{provider}")
            } else if REMOTE_SPEECH_MODELS.contains(&model) {
                format!("{prefix}{provider}:{model}")
            } else {
                format!("{prefix}{provider}:custom")
            };
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(bound_remote_labels),
        serde_json::Value::Object(map) => map.values_mut().for_each(bound_remote_labels),
        _ => {}
    }
}

/// Debug builds stay out of the production project, so `tauri dev` never reports.
fn credentials() -> Option<(&'static str, &'static str)> {
    if cfg!(debug_assertions) {
        return None;
    }
    match (POSTHOG_API_KEY, POSTHOG_HOST) {
        (Some(key), Some(host)) if !key.is_empty() && !host.is_empty() => Some((key, host)),
        _ => None,
    }
}

/// Starts analytics and records your app version, OS, install type, coarse
/// hardware (memory bucket, chip family, graphics vendor), and (once) install date.
pub async fn init(app: &tauri::AppHandle<AppRuntime>) {
    let credentials = credentials();
    if credentials.is_none() && !debug_log_enabled() {
        return;
    }

    let (enabled, distinct_id) = app.state::<AppState>().analytics_state();
    if !enabled || distinct_id.is_empty() {
        return;
    }

    if let Some((api_key, host)) = credentials {
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
    }

    let mut profile = json!({
        "app_version": APP_VERSION,
        "platform": std::env::consts::OS,
        "install_type": crate::platform::install_type(),
        "arch": std::env::consts::ARCH,
    });
    if let Ok(hardware) = tauri::async_runtime::spawn_blocking(system::hardware_profile).await
        && let Some(profile) = profile.as_object_mut()
    {
        profile.extend(hardware);
    }
    let mut identify = posthog_rs::Event::new("$identify", &distinct_id);
    let _ = identify.insert_prop("$set", profile);
    let _ = identify.insert_prop(
        "$set_once",
        json!({ "install_date": chrono::Utc::now().to_rfc3339() }),
    );
    mark_client_ready();
    send(identify);
}

fn build_event(
    app: &tauri::AppHandle<AppRuntime>,
    event_name: &str,
    props: serde_json::Value,
    require_enabled: bool,
) -> Option<posthog_rs::Event> {
    if credentials().is_none() && !debug_log_enabled() {
        return None;
    }

    let (enabled, distinct_id) = app.state::<AppState>().analytics_state();
    if (require_enabled && !enabled) || distinct_id.is_empty() {
        return None;
    }

    let mut event = posthog_rs::Event::new(event_name, &distinct_id);
    let _ = event.insert_prop("app_version", APP_VERSION);
    let _ = event.insert_prop("platform", std::env::consts::OS);
    let _ = event.insert_prop("install_type", crate::platform::install_type());
    if let Some(license) = app.state::<AppState>().license_snapshot() {
        let _ = event.insert_prop("license_status", license.status);
        if let Some(edition) = license.edition {
            let _ = event.insert_prop("license_edition", edition);
        }
    }
    let mut props = props;
    bound_remote_labels(&mut props);
    if let Some(obj) = props.as_object() {
        for (key, value) in obj {
            let _ = event.insert_prop(key.as_str(), value.clone());
        }
    }
    Some(event)
}

fn capture_event(app: &tauri::AppHandle<AppRuntime>, event_name: &str, props: serde_json::Value) {
    if let Some(event) = build_event(app, event_name, props, true) {
        send(event);
    }
}

/// `capture_event` for code that has no `AppHandle` of its own.
fn capture_global(event_name: &str, props: serde_json::Value) {
    if let Some(app) = app() {
        capture_event(app, event_name, props);
    }
}
