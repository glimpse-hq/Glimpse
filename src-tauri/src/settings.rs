use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Days, Local, Months};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Manager};

const SETTINGS_DB_FILE_NAME: &str = "settings.db";
const SETTINGS_BACKUP_FILE_NAME: &str = "settings-backup.db";
const KEY_ONBOARDING_COMPLETED: &str = "onboarding_completed";
const KEY_SMART_SHORTCUT: &str = "smart_shortcut";
const KEY_SMART_ENABLED: &str = "smart_enabled";
const KEY_HOLD_SHORTCUT: &str = "hold_shortcut";
const KEY_HOLD_ENABLED: &str = "hold_enabled";
const KEY_TOGGLE_SHORTCUT: &str = "toggle_shortcut";
const KEY_TOGGLE_ENABLED: &str = "toggle_enabled";
const KEY_SHORTCUT_BINDINGS: &str = "shortcut_bindings";
const KEY_TRANSCRIPTION_MODE: &str = "transcription_mode";
const KEY_LOCAL_MODEL: &str = "local_model";
const KEY_REMOTE_SPEECH_ENABLED: &str = "remote_speech_enabled";
const KEY_REMOTE_SPEECH_PROVIDER: &str = "remote_speech_provider";
const KEY_REMOTE_SPEECH_ENDPOINT: &str = "remote_speech_endpoint";
const KEY_REMOTE_SPEECH_API_KEY: &str = "remote_speech_api_key";
const KEY_REMOTE_SPEECH_MODEL: &str = "remote_speech_model";
const KEY_MICROPHONE_DEVICE: &str = "microphone_device";
const KEY_LANGUAGE: &str = "language";
const KEY_APP_LOCALE: &str = "app_locale";
const KEY_THEME_MODE: &str = "theme_mode";

const KEY_LLM_ENABLED: &str = "llm_enabled";
const KEY_CLEANUP_ENABLED: &str = "cleanup_enabled";
const KEY_LLM_PROVIDER: &str = "llm_provider";
const KEY_LLM_ENDPOINT: &str = "llm_endpoint";
const KEY_LLM_API_KEY: &str = "llm_api_key";
const KEY_LLM_MODEL: &str = "llm_model";
const KEY_PERSONALITIES_NOTES_SEEDED: &str = "personalities_notes_seeded";
const KEY_DICTIONARY: &str = "dictionary";
const KEY_AUTO_DICTIONARY_ENABLED: &str = "auto_dictionary_enabled";
const KEY_AUTO_DICTIONARY_IGNORED: &str = "auto_dictionary_ignored";
const KEY_REPLACEMENTS: &str = "replacements";
const KEY_PERSONALITIES: &str = "personalities";
const KEY_MEDIA_ACTION: &str = "media_action";
const LEGACY_KEY_MEDIA_CONTROL_ENABLED: &str = "media_control_enabled";
const KEY_AUTO_UPDATE_ENABLED: &str = "auto_update_enabled";
const KEY_AUTO_LAUNCH_ENABLED: &str = "auto_launch_enabled";
const KEY_START_IN_BACKGROUND: &str = "start_in_background";
const KEY_AUTO_DELETE_TARGET: &str = "auto_delete_target";
const KEY_AUTO_DELETE_DURATION: &str = "auto_delete_duration";
const LEGACY_KEY_RECORDING_PRUNE_POLICY: &str = "recording_prune_policy";
const LEGACY_KEY_TRANSCRIPTION_PRUNE_POLICY: &str = "transcription_prune_policy";
const KEY_ANALYTICS_ENABLED: &str = "analytics_enabled";
pub(crate) const KEY_ANALYTICS_INSTALL_ID: &str = "analytics_install_id";
const KEY_LOCAL_API_KEY: &str = "local_api_key";
const KEY_LOCAL_API_PORT: &str = "local_api_port";
const KEY_LOCAL_API_MODEL: &str = "local_api_model";
const KEY_LOCAL_API_HOST: &str = "local_api_host";
const KEY_LOCAL_API_START_ON_LAUNCH: &str = "local_api_start_on_launch";
const KEY_LOCAL_API_CORS: &str = "local_api_cors";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Replacement {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Personality {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub apps: Vec<String>,
    #[serde(default)]
    pub websites: Vec<String>,
    #[serde(default)]
    pub instructions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShortcutBinding {
    pub shortcut: String,
    #[serde(default)]
    pub temporary: bool,
    #[serde(default)]
    pub cleanup_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShortcutBindings {
    #[serde(default)]
    pub smart: Vec<ShortcutBinding>,
    #[serde(default)]
    pub hold: Vec<ShortcutBinding>,
    #[serde(default)]
    pub toggle: Vec<ShortcutBinding>,
}

impl ShortcutBindings {
    pub fn any_cleanup_enabled(&self) -> bool {
        self.smart
            .iter()
            .chain(self.hold.iter())
            .chain(self.toggle.iter())
            .any(|binding| binding.cleanup_enabled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSettings {
    #[serde(default)]
    pub onboarding_completed: bool,

    #[serde(default = "default_smart_shortcut")]
    pub smart_shortcut: String,
    #[serde(default = "default_true")]
    pub smart_enabled: bool,

    #[serde(default = "default_hold_shortcut")]
    pub hold_shortcut: String,
    #[serde(default)]
    pub hold_enabled: bool,
    #[serde(default = "default_toggle_shortcut")]
    pub toggle_shortcut: String,
    #[serde(default)]
    pub toggle_enabled: bool,
    #[serde(default = "default_shortcut_bindings")]
    pub shortcut_bindings: ShortcutBindings,
    #[serde(default = "default_transcription_mode")]
    pub transcription_mode: TranscriptionMode,
    #[serde(default = "default_local_model")]
    pub local_model: String,
    #[serde(default)]
    pub remote_speech_enabled: bool,
    #[serde(default = "default_remote_speech_provider")]
    pub remote_speech_provider: String,
    #[serde(default = "default_remote_speech_endpoint")]
    pub remote_speech_endpoint: String,
    #[serde(default)]
    pub remote_speech_api_key: String,
    #[serde(default = "default_remote_speech_model")]
    pub remote_speech_model: String,
    pub microphone_device: Option<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_app_locale")]
    pub app_locale: String,
    #[serde(default)]
    pub theme_mode: ThemeMode,

    #[serde(default)]
    pub llm_enabled: bool,
    #[serde(default)]
    pub cleanup_enabled: bool,
    #[serde(default = "default_llm_provider")]
    pub llm_provider: String,
    #[serde(default)]
    pub llm_endpoint: String,
    #[serde(default)]
    pub llm_api_key: String,
    #[serde(default)]
    pub llm_model: String,
    #[serde(default)]
    pub personalities_notes_seeded: bool,
    #[serde(default)]
    pub dictionary: Vec<String>,
    #[serde(default)]
    pub auto_dictionary_enabled: bool,
    #[serde(default)]
    pub auto_dictionary_ignored: Vec<String>,
    #[serde(default)]
    pub replacements: Vec<Replacement>,
    #[serde(default = "default_personalities")]
    pub personalities: Vec<Personality>,
    #[serde(default)]
    pub media_action: MediaAction,
    #[serde(default)]
    pub auto_update_enabled: bool,
    #[serde(default)]
    pub auto_launch_enabled: bool,
    #[serde(default)]
    pub start_in_background: bool,
    #[serde(default = "default_auto_delete_target")]
    pub auto_delete_target: AutoDeleteTarget,
    #[serde(default = "default_auto_delete_duration")]
    pub auto_delete_duration: RecordingPrunePolicy,
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
    #[serde(default)]
    pub analytics_install_id: String,
    #[serde(skip)]
    pub analytics_first_run: bool,
    pub local_api_key: String,
    #[serde(default = "default_local_api_port")]
    pub local_api_port: u16,
    #[serde(default = "default_local_api_model")]
    pub local_api_model: String,
    #[serde(default = "default_local_api_host")]
    pub local_api_host: String,
    #[serde(default)]
    pub local_api_start_on_launch: bool,
    #[serde(default = "default_local_api_cors")]
    pub local_api_cors: bool,
}

// Alt+Space opens the window menu on Windows, so the hotkey never reaches us.
fn default_smart_shortcut() -> String {
    if cfg!(target_os = "windows") {
        "Control+Shift+Space".to_string()
    } else {
        "Alt+Space".to_string()
    }
}

fn default_hold_shortcut() -> String {
    if cfg!(target_os = "windows") {
        "Control+Alt+Space".to_string()
    } else {
        "Control+Shift+Space".to_string()
    }
}

fn default_toggle_shortcut() -> String {
    if cfg!(target_os = "windows") {
        "Control+Shift+Alt+Space".to_string()
    } else {
        "Control+Alt+Space".to_string()
    }
}

pub fn default_shortcut_bindings() -> ShortcutBindings {
    ShortcutBindings {
        smart: vec![ShortcutBinding {
            shortcut: default_smart_shortcut(),
            temporary: false,
            cleanup_enabled: false,
        }],
        hold: vec![ShortcutBinding {
            shortcut: default_hold_shortcut(),
            temporary: false,
            cleanup_enabled: false,
        }],
        toggle: vec![ShortcutBinding {
            shortcut: default_toggle_shortcut(),
            temporary: false,
            cleanup_enabled: false,
        }],
    }
}

pub fn sync_legacy_shortcuts_from_bindings(settings: &mut UserSettings) {
    if let Some(binding) = settings.shortcut_bindings.smart.first() {
        settings.smart_shortcut = binding.shortcut.clone();
    }
    if let Some(binding) = settings.shortcut_bindings.hold.first() {
        settings.hold_shortcut = binding.shortcut.clone();
    }
    if let Some(binding) = settings.shortcut_bindings.toggle.first() {
        settings.toggle_shortcut = binding.shortcut.clone();
    }
}

fn default_true() -> bool {
    true
}

fn owned_app_names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_string()).collect()
}

#[derive(Clone, Copy)]
struct PersonalityAppDefaults {
    messaging: &'static [&'static str],
    email: &'static [&'static str],
    notes: &'static [&'static str],
    coding: &'static [&'static str],
}

impl PersonalityAppDefaults {
    fn for_personality(self, id: &str) -> Option<&'static [&'static str]> {
        match id {
            "messaging" => Some(self.messaging),
            "email" => Some(self.email),
            "notes" => Some(self.notes),
            "coding" => Some(self.coding),
            _ => None,
        }
    }
}

#[cfg(target_os = "windows")]
const PERSONALITY_APP_DEFAULTS: PersonalityAppDefaults = PersonalityAppDefaults {
    messaging: &["Microsoft Teams", "Slack", "Discord", "WhatsApp"],
    email: &["Outlook", "Thunderbird"],
    notes: &["OneNote", "Sticky Notes", "Notion", "Obsidian"],
    coding: &[
        "Cursor",
        "Visual Studio Code",
        "Visual Studio",
        "WebStorm",
        "IntelliJ IDEA",
    ],
};

#[cfg(not(target_os = "windows"))]
const PERSONALITY_APP_DEFAULTS: PersonalityAppDefaults = PersonalityAppDefaults {
    messaging: &["Messages", "Slack"],
    email: &["Mail", "Outlook", "Spark"],
    notes: &["Notes", "Notion", "Obsidian", "Craft", "Affine"],
    coding: &[
        "Cursor",
        "Visual Studio Code",
        "Xcode",
        "WebStorm",
        "IntelliJ IDEA",
    ],
};

fn default_apps_for(personality_id: &str) -> Vec<String> {
    owned_app_names(
        PERSONALITY_APP_DEFAULTS
            .for_personality(personality_id)
            .expect("known default personality"),
    )
}

fn default_personalities() -> Vec<Personality> {
    vec![
        Personality {
            id: "messaging".to_string(),
            name: "Messaging".to_string(),
            enabled: false,
            apps: default_apps_for("messaging"),
            websites: vec!["slack.com".to_string()],
            instructions: vec![],
        },
        Personality {
            id: "email".to_string(),
            name: "Email".to_string(),
            enabled: false,
            apps: default_apps_for("email"),
            websites: vec![
                "mail.google.com".to_string(),
                "outlook.com".to_string(),
                "mail.yahoo.com".to_string(),
            ],
            instructions: vec![],
        },
        Personality {
            id: "notes".to_string(),
            name: "Notes".to_string(),
            enabled: false,
            apps: default_apps_for("notes"),
            websites: vec![
                "notion.so".to_string(),
                "craft.do".to_string(),
                "affine.pro".to_string(),
                "obsidian.md".to_string(),
            ],
            instructions: vec![],
        },
        Personality {
            id: "coding".to_string(),
            name: "Coding".to_string(),
            enabled: false,
            apps: default_apps_for("coding"),
            websites: vec![
                "github.com".to_string(),
                "gitlab.com".to_string(),
                "bitbucket.org".to_string(),
            ],
            instructions: vec![],
        },
    ]
}

fn seed_personality_notes(personalities: &mut [Personality]) {
    for personality in personalities.iter_mut() {
        if !personality.instructions.is_empty() {
            continue;
        }

        let defaults = match personality.id.as_str() {
            "messaging" => vec![
                "- Write semi-casual, friendly, as if you're messaging someone".to_string(),
                "".to_string(),
                "- Transcribe spoken emoji descriptions directly into icons (e.g., 'laughing face' becomes 😂).".to_string(),
                "".to_string(),
                "- Retain all internet slang, acronyms, and text-speak (e.g., 'tmrw', 'rn', 'omg') exactly as said.".to_string(),
            ],
            "email" => vec![
                "- Write in correct email semi-formal, friendly, formatting with new lines and paragraphs.".to_string(),
                "".to_string(),
                "- Fix run-on sentences by breaking them into distinct, logical statements.".to_string(),
                "".to_string(),
                "- Ensure standard capitalization and punctuation rules are applied strictly.".to_string(),
                "".to_string(),
                "- Sign off emails with [My Name].".to_string(),
            ],
            "notes" => vec![
                "- Distill into a concise, scannable format based on the user's speech.".to_string(),
                "".to_string(),
                "- Remove conversational filler (ums, ahs), repetitive thoughts, and fluff.".to_string(),
                "".to_string(),
                "- Utilize Markdown syntax: Use bullet points for lists and bold text for key concepts.".to_string(),
                "".to_string(),
                "- Rephrase rambling narrative into direct, active-voice statements based on the user's speech.".to_string(),
            ],
            "coding" => vec![
                "- Treat technical keywords, library names, and logic as immutable constants based on the user's speech; do not rephrase them.".to_string(),
                "".to_string(),
                "- Apply proper casing conventions to variables and functions based on context (e.g., camelCase for JS, snake_case for Python) based on the user's speech.".to_string(),
                "".to_string(),
                "- Prioritize syntax accuracy over conversational flow based on the user's speech.".to_string(),
            ],
            _ => Vec::new(),
        };

        if !defaults.is_empty() {
            personality.instructions = defaults;
        }
    }
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            smart_shortcut: default_smart_shortcut(),
            smart_enabled: true,
            hold_shortcut: default_hold_shortcut(),
            hold_enabled: false,
            toggle_shortcut: default_toggle_shortcut(),
            toggle_enabled: false,
            shortcut_bindings: default_shortcut_bindings(),
            transcription_mode: default_transcription_mode(),
            local_model: default_local_model(),
            remote_speech_enabled: false,
            remote_speech_provider: default_remote_speech_provider(),
            remote_speech_endpoint: default_remote_speech_endpoint(),
            remote_speech_api_key: String::new(),
            remote_speech_model: default_remote_speech_model(),
            microphone_device: None,
            language: default_language(),
            app_locale: default_app_locale(),
            theme_mode: ThemeMode::default(),

            llm_enabled: false,
            cleanup_enabled: false,
            llm_provider: default_llm_provider(),
            llm_endpoint: String::new(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            personalities_notes_seeded: false,
            dictionary: Vec::new(),
            auto_dictionary_enabled: false,
            auto_dictionary_ignored: Vec::new(),
            replacements: Vec::new(),
            personalities: default_personalities(),
            media_action: MediaAction::Off,
            auto_update_enabled: true,
            auto_launch_enabled: false,
            start_in_background: true,
            auto_delete_target: default_auto_delete_target(),
            auto_delete_duration: default_auto_delete_duration(),
            analytics_enabled: true,
            analytics_install_id: String::new(),
            analytics_first_run: false,
            local_api_key: String::new(),
            local_api_port: default_local_api_port(),
            local_api_model: default_local_api_model(),
            local_api_host: default_local_api_host(),
            local_api_start_on_launch: false,
            local_api_cors: default_local_api_cors(),
        }
    }
}

pub fn default_local_api_port() -> u16 {
    11435
}

pub fn default_local_api_cors() -> bool {
    false
}

pub fn default_local_api_model() -> String {
    "auto".to_string()
}

pub fn default_remote_speech_provider() -> String {
    "openai".to_string()
}

pub fn default_remote_speech_endpoint() -> String {
    "https://api.openai.com/v1".to_string()
}

pub fn default_remote_speech_model() -> String {
    "auto".to_string()
}

pub fn default_local_api_host() -> String {
    "127.0.0.1".to_string()
}

pub fn canonicalize_local_api_host(value: &str) -> String {
    if value == "0.0.0.0" {
        "0.0.0.0".to_string()
    } else {
        default_local_api_host()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionMode {
    #[default]
    Local,
    Cloud,
}

fn default_transcription_mode() -> TranscriptionMode {
    TranscriptionMode::Local
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecordingPrunePolicy {
    #[default]
    Never,
    Immediately,
    Day,
    Week,
    Month,
    Year,
}

fn default_auto_delete_duration() -> RecordingPrunePolicy {
    RecordingPrunePolicy::Never
}

pub(crate) fn recording_prune_cutoff(
    policy: RecordingPrunePolicy,
    now: DateTime<Local>,
) -> Option<DateTime<Local>> {
    match policy {
        RecordingPrunePolicy::Never => None,
        RecordingPrunePolicy::Immediately => Some(now),
        RecordingPrunePolicy::Day => now.checked_sub_days(Days::new(1)),
        RecordingPrunePolicy::Week => now.checked_sub_days(Days::new(7)),
        RecordingPrunePolicy::Month => now.checked_sub_months(Months::new(1)),
        RecordingPrunePolicy::Year => now.checked_sub_months(Months::new(12)),
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AutoDeleteTarget {
    #[default]
    Transcripts,
    Audio,
}

fn default_auto_delete_target() -> AutoDeleteTarget {
    AutoDeleteTarget::Transcripts
}

pub fn auto_delete_recording_policy(settings: &UserSettings) -> RecordingPrunePolicy {
    match settings.auto_delete_target {
        AutoDeleteTarget::Audio => settings.auto_delete_duration,
        AutoDeleteTarget::Transcripts => RecordingPrunePolicy::Never,
    }
}

pub fn auto_delete_transcription_policy(settings: &UserSettings) -> RecordingPrunePolicy {
    match settings.auto_delete_target {
        AutoDeleteTarget::Audio => RecordingPrunePolicy::Never,
        AutoDeleteTarget::Transcripts => settings.auto_delete_duration,
    }
}

/// ElevenLabs and Deepgram presets used to point at a local OpenAI-compatible
/// proxy. Moves the untouched preset endpoint to the provider's own API.
fn migrate_proxy_speech_endpoint(settings: &mut UserSettings) -> bool {
    let native = match settings.remote_speech_provider.as_str() {
        "elevenlabs" => "https://api.elevenlabs.io/v1",
        "deepgram" => "https://api.deepgram.com/v1",
        _ => return false,
    };
    if settings.remote_speech_endpoint.trim() != "http://localhost:4000/v1" {
        return false;
    }
    settings.remote_speech_endpoint = native.to_string();
    true
}

fn migrate_auto_delete_from_legacy(
    settings: &mut UserSettings,
    legacy_recording: RecordingPrunePolicy,
    legacy_transcription: RecordingPrunePolicy,
) {
    if legacy_transcription != RecordingPrunePolicy::Never {
        settings.auto_delete_target = AutoDeleteTarget::Transcripts;
        settings.auto_delete_duration = legacy_transcription;
        return;
    }

    if legacy_recording != RecordingPrunePolicy::Never {
        settings.auto_delete_target = AutoDeleteTarget::Audio;
        settings.auto_delete_duration = legacy_recording;
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MediaAction {
    #[default]
    Off,
    Pause,
    Duck10,
    Duck25,
    Duck50,
    Duck75,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

fn default_llm_provider() -> String {
    "none".to_string()
}

pub fn default_local_model() -> String {
    "parakeet_tdt_v3_gguf".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

fn default_app_locale() -> String {
    "system".to_string()
}

const SUPPORTED_APP_LOCALES_JSON: &str = include_str!("../../supported-app-locales.json");
static SUPPORTED_APP_LOCALES: OnceLock<Vec<String>> = OnceLock::new();

fn supported_app_locales() -> &'static [String] {
    SUPPORTED_APP_LOCALES
        .get_or_init(|| {
            // Main source of truth for shipped app translations.
            let locales: Vec<String> = serde_json::from_str(SUPPORTED_APP_LOCALES_JSON)
                .expect("supported-app-locales.json must be a JSON array of locale strings");

            if locales.is_empty() {
                panic!("supported-app-locales.json must not be empty");
            }

            let mut seen = HashSet::new();
            for locale in &locales {
                if locale.is_empty()
                    || locale.trim() != locale
                    || locale.to_ascii_lowercase() != *locale
                {
                    panic!("supported-app-locales.json must use lowercase, trimmed locale codes");
                }

                if !seen.insert(locale.clone()) {
                    panic!("supported-app-locales.json cannot contain duplicate locale codes");
                }
            }

            locales
        })
        .as_slice()
}

pub fn canonicalize_app_locale(value: &str) -> Option<String> {
    let normalized = value.trim().replace('_', "-").to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized == default_app_locale() {
        return Some(normalized);
    }

    if supported_app_locales()
        .iter()
        .any(|locale| locale == &normalized)
    {
        return Some(normalized);
    }

    None
}

pub fn canonicalize_app_locale_or_default(value: &str) -> String {
    canonicalize_app_locale(value).unwrap_or_else(default_app_locale)
}

/// Decrypts a stored key. On failure the ciphertext is kept so `save` writes it back untouched.
fn decrypt_stored_setting(encrypted: String, label: &str, cache: &Mutex<Option<String>>) -> String {
    if encrypted.is_empty() {
        *cache.lock() = None;
        return String::new();
    }
    let failure = match crate::crypto::get_hardware_uuid() {
        Some(hardware_uuid) => match crate::crypto::decrypt(&encrypted, &hardware_uuid) {
            Ok(decrypted) => {
                *cache.lock() = None;
                return decrypted;
            }
            Err(e) => format!("Failed to decrypt {label}: {e}. Preserving encrypted value."),
        },
        None => format!("Could not get hardware UUID, preserving stored {label}"),
    };
    tracing::error!("{failure}");
    *cache.lock() = Some(encrypted);
    String::new()
}

/// Ciphertext to store for `plain`, or `None` when the value should be stored
/// as given: it is already the cached ciphertext, or this device cannot encrypt.
fn encrypt_setting_for_storage(
    plain: &str,
    label: &str,
    cache: &Mutex<Option<String>>,
) -> Result<Option<String>> {
    let mut cached = cache.lock();
    if plain.is_empty() {
        return Ok(Some(cached.clone().unwrap_or_default()));
    }
    if cached.as_deref() == Some(plain) {
        return Ok(None);
    }
    *cached = None;
    match crate::crypto::get_hardware_uuid() {
        Some(hardware_uuid) => crate::crypto::encrypt(plain, &hardware_uuid)
            .map(Some)
            .map_err(|e| anyhow::anyhow!("Failed to encrypt {label}: {e}")),
        None => {
            tracing::error!("Could not get hardware UUID, storing {label} unencrypted");
            Ok(None)
        }
    }
}

pub struct SettingsStore {
    conn: Mutex<Connection>,
    llm_api_key_ciphertext: Mutex<Option<String>>,
    remote_speech_api_key_ciphertext: Mutex<Option<String>>,
    local_api_key_ciphertext: Mutex<Option<String>>,
    /// Keys `load` could not parse, each with the JSON of the value `load` fell
    /// back to. `save` leaves them as stored while that value is unchanged, so a
    /// value written by a newer version survives a downgrade.
    unreadable: Mutex<HashMap<&'static str, String>>,
    /// Set until a load reads every value; the next save backs up the DB first.
    backup_before_save: AtomicBool,
}

impl SettingsStore {
    pub fn new(app: &AppHandle) -> Result<Self> {
        Self::open(db_path(app)?)
    }

    pub(crate) fn for_cli(app_identifier: &str) -> Result<Self> {
        Self::open(settings_db_path(cli_app_config_dir(app_identifier)?))
    }

    fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create settings dir {}", parent.display()))?;
        }

        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open settings DB at {}", path.display()))?;
        conn.busy_timeout(Duration::from_secs(2))?;
        conn.execute_batch("PRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;")?;

        let store = Self {
            conn: Mutex::new(conn),
            llm_api_key_ciphertext: Mutex::new(None),
            remote_speech_api_key_ciphertext: Mutex::new(None),
            local_api_key_ciphertext: Mutex::new(None),
            unreadable: Mutex::new(HashMap::new()),
            backup_before_save: AtomicBool::new(true),
        };

        store.init_schema()?;

        Ok(store)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .context("Failed to create settings table")?;
        Ok(())
    }

    /// Load settings from DB, falling back to defaults if empty.
    pub fn load(&self) -> Result<UserSettings> {
        let mut settings = UserSettings::default();
        let mut should_persist = false;
        let encrypted_llm_api_key: String;
        let encrypted_remote_speech_api_key: String;
        let encrypted_local_api_key: String;
        let theme_mode_exists: bool;
        let unreadable_keys;
        {
            let conn = self.conn.lock();
            let mut loader = Loader {
                conn: &conn,
                unreadable: Vec::new(),
            };

            settings.onboarding_completed =
                loader.value(KEY_ONBOARDING_COMPLETED, settings.onboarding_completed)?;
            settings.smart_shortcut =
                loader.value(KEY_SMART_SHORTCUT, settings.smart_shortcut.clone())?;
            settings.smart_enabled = loader.value(KEY_SMART_ENABLED, settings.smart_enabled)?;
            settings.hold_shortcut =
                loader.value(KEY_HOLD_SHORTCUT, settings.hold_shortcut.clone())?;
            settings.hold_enabled = loader.value(KEY_HOLD_ENABLED, settings.hold_enabled)?;
            settings.toggle_shortcut =
                loader.value(KEY_TOGGLE_SHORTCUT, settings.toggle_shortcut.clone())?;
            settings.toggle_enabled = loader.value(KEY_TOGGLE_ENABLED, settings.toggle_enabled)?;
            if let Some(shortcut_bindings) =
                loader.optional::<ShortcutBindings>(KEY_SHORTCUT_BINDINGS)?
            {
                settings.shortcut_bindings = shortcut_bindings;
            }
            settings.transcription_mode =
                loader.value(KEY_TRANSCRIPTION_MODE, settings.transcription_mode.clone())?;
            settings.local_model = loader.value(KEY_LOCAL_MODEL, settings.local_model.clone())?;
            settings.remote_speech_enabled =
                loader.value(KEY_REMOTE_SPEECH_ENABLED, settings.remote_speech_enabled)?;
            settings.remote_speech_provider = loader.value(
                KEY_REMOTE_SPEECH_PROVIDER,
                settings.remote_speech_provider.clone(),
            )?;
            settings.remote_speech_endpoint = loader.value(
                KEY_REMOTE_SPEECH_ENDPOINT,
                settings.remote_speech_endpoint.clone(),
            )?;
            encrypted_remote_speech_api_key =
                loader.value(KEY_REMOTE_SPEECH_API_KEY, String::new())?;
            settings.remote_speech_model = loader.value(
                KEY_REMOTE_SPEECH_MODEL,
                settings.remote_speech_model.clone(),
            )?;
            settings.microphone_device =
                loader.value(KEY_MICROPHONE_DEVICE, settings.microphone_device.clone())?;
            settings.language = loader.value(KEY_LANGUAGE, settings.language.clone())?;
            settings.app_locale = loader.value(KEY_APP_LOCALE, settings.app_locale.clone())?;
            let theme_mode = loader.optional::<ThemeMode>(KEY_THEME_MODE)?;
            theme_mode_exists = theme_mode.is_some();
            settings.theme_mode = theme_mode.unwrap_or(settings.theme_mode);

            settings.llm_enabled = loader.value(KEY_LLM_ENABLED, settings.llm_enabled)?;
            settings.cleanup_enabled =
                loader.value(KEY_CLEANUP_ENABLED, settings.cleanup_enabled)?;
            settings.llm_provider =
                loader.value(KEY_LLM_PROVIDER, settings.llm_provider.clone())?;
            settings.llm_endpoint =
                loader.value(KEY_LLM_ENDPOINT, settings.llm_endpoint.clone())?;

            encrypted_llm_api_key = loader.value(KEY_LLM_API_KEY, String::new())?;

            settings.llm_model = loader.value(KEY_LLM_MODEL, settings.llm_model.clone())?;
            settings.personalities_notes_seeded = loader.value(
                KEY_PERSONALITIES_NOTES_SEEDED,
                settings.personalities_notes_seeded,
            )?;
            settings.dictionary = loader.value(KEY_DICTIONARY, settings.dictionary.clone())?;
            settings.auto_dictionary_enabled = loader.value(
                KEY_AUTO_DICTIONARY_ENABLED,
                settings.auto_dictionary_enabled,
            )?;
            settings.auto_dictionary_ignored = loader.value(
                KEY_AUTO_DICTIONARY_IGNORED,
                settings.auto_dictionary_ignored.clone(),
            )?;
            settings.replacements =
                loader.value(KEY_REPLACEMENTS, settings.replacements.clone())?;
            settings.personalities =
                loader.value(KEY_PERSONALITIES, settings.personalities.clone())?;
            if let Some(media_action) = loader.optional::<MediaAction>(KEY_MEDIA_ACTION)? {
                settings.media_action = media_action;
            } else if let Some(legacy_enabled) =
                loader.optional::<bool>(LEGACY_KEY_MEDIA_CONTROL_ENABLED)?
            {
                settings.media_action = if legacy_enabled {
                    MediaAction::Pause
                } else {
                    MediaAction::Off
                };
                should_persist = true;
            }
            settings.auto_update_enabled =
                loader.value(KEY_AUTO_UPDATE_ENABLED, settings.auto_update_enabled)?;
            settings.auto_launch_enabled =
                loader.value(KEY_AUTO_LAUNCH_ENABLED, settings.auto_launch_enabled)?;
            settings.start_in_background =
                loader.value(KEY_START_IN_BACKGROUND, settings.start_in_background)?;
            settings.auto_delete_target =
                loader.value(KEY_AUTO_DELETE_TARGET, settings.auto_delete_target)?;
            let auto_delete_duration =
                loader.optional::<RecordingPrunePolicy>(KEY_AUTO_DELETE_DURATION)?;
            if let Some(duration) = auto_delete_duration {
                settings.auto_delete_duration = duration;
            } else if !loader.unreadable.contains(&KEY_AUTO_DELETE_DURATION) {
                // An unreadable duration came from a newer version; the legacy keys are older than it.
                let legacy_recording = loader.value(
                    LEGACY_KEY_RECORDING_PRUNE_POLICY,
                    RecordingPrunePolicy::Never,
                )?;
                let legacy_transcription = loader.value(
                    LEGACY_KEY_TRANSCRIPTION_PRUNE_POLICY,
                    RecordingPrunePolicy::Never,
                )?;
                migrate_auto_delete_from_legacy(
                    &mut settings,
                    legacy_recording,
                    legacy_transcription,
                );
                should_persist = true;
            }
            settings.analytics_enabled =
                loader.value(KEY_ANALYTICS_ENABLED, settings.analytics_enabled)?;
            settings.analytics_install_id = loader.value(
                KEY_ANALYTICS_INSTALL_ID,
                settings.analytics_install_id.clone(),
            )?;
            encrypted_local_api_key = loader.value(KEY_LOCAL_API_KEY, String::new())?;
            settings.local_api_port = loader.value(KEY_LOCAL_API_PORT, settings.local_api_port)?;
            settings.local_api_model =
                loader.value(KEY_LOCAL_API_MODEL, settings.local_api_model.clone())?;
            settings.local_api_host =
                loader.value(KEY_LOCAL_API_HOST, settings.local_api_host.clone())?;
            settings.local_api_start_on_launch = loader.value(
                KEY_LOCAL_API_START_ON_LAUNCH,
                settings.local_api_start_on_launch,
            )?;
            settings.local_api_cors = loader.value(KEY_LOCAL_API_CORS, settings.local_api_cors)?;
            unreadable_keys = loader.unreadable;
        }

        settings.llm_api_key = decrypt_stored_setting(
            encrypted_llm_api_key,
            "API key",
            &self.llm_api_key_ciphertext,
        );
        settings.remote_speech_api_key = decrypt_stored_setting(
            encrypted_remote_speech_api_key,
            "remote speech API key",
            &self.remote_speech_api_key_ciphertext,
        );
        settings.local_api_key = decrypt_stored_setting(
            encrypted_local_api_key,
            "Local API key",
            &self.local_api_key_ciphertext,
        );

        if settings.analytics_install_id.is_empty() {
            settings.analytics_install_id = uuid::Uuid::new_v4().to_string();
            settings.analytics_first_run = true;
            should_persist = true;
        }

        if !settings.personalities_notes_seeded {
            seed_personality_notes(&mut settings.personalities);
            settings.personalities_notes_seeded = true;
            should_persist = true;
        }

        if !theme_mode_exists {
            should_persist = true;
        }

        sync_legacy_shortcuts_from_bindings(&mut settings);

        if migrate_proxy_speech_endpoint(&mut settings) {
            should_persist = true;
        }

        if crate::model_manager::definition(&settings.local_model).is_none() {
            settings.local_model = default_local_model();
            should_persist = true;
        }

        if matches!(settings.transcription_mode, TranscriptionMode::Cloud) {
            settings.transcription_mode = TranscriptionMode::Local;
            should_persist = true;
        }

        let canonical_locale = canonicalize_app_locale_or_default(&settings.app_locale);
        if settings.app_locale != canonical_locale {
            settings.app_locale = canonical_locale;
            should_persist = true;
        }

        if settings.local_api_port == 0 {
            settings.local_api_port = default_local_api_port();
            should_persist = true;
        }

        if settings.local_api_model.trim().is_empty()
            || (settings.local_api_model != "auto"
                && crate::model_manager::definition(&settings.local_api_model).is_none())
        {
            settings.local_api_model = default_local_api_model();
            should_persist = true;
        }

        let canonical_host = canonicalize_local_api_host(&settings.local_api_host);
        if settings.local_api_host != canonical_host {
            settings.local_api_host = canonical_host;
            should_persist = true;
        }

        let mut fallbacks = HashMap::new();
        if unreadable_keys.is_empty() {
            self.backup_before_save.store(false, Ordering::Relaxed);
        } else {
            match self.stored_entries(&settings) {
                Ok(entries) => fallbacks.extend(
                    entries
                        .into_iter()
                        .filter(|(key, _)| unreadable_keys.contains(key)),
                ),
                Err(err) => tracing::error!("Failed to note unreadable settings: {err:#}"),
            }
        }
        *self.unreadable.lock() = fallbacks;

        if should_persist && let Err(err) = self.save(&settings) {
            tracing::error!("Failed to save migrated settings: {err}");
        }

        Ok(settings)
    }

    /// Persist settings into DB immediately.
    pub fn save(&self, settings: &UserSettings) -> Result<()> {
        let entries = self.stored_entries(settings)?;
        let mut connection = self.conn.lock();
        if self.backup_before_save.swap(false, Ordering::Relaxed)
            && let Err(err) = back_up_settings_db(&connection)
        {
            tracing::error!("{err:#}");
        }
        let mut unreadable = self.unreadable.lock();
        let conn = connection
            .transaction()
            .context("Failed to start settings transaction")?;
        let mut replaced = Vec::new();
        for (key, value) in entries {
            match unreadable.get(key) {
                Some(fallback) if *fallback == value => continue,
                Some(_) => replaced.push(key),
                None => {}
            }
            self.write_raw_value(&conn, key, &value)?;
        }
        conn.commit()
            .context("Failed to commit settings transaction")?;
        for key in replaced {
            unreadable.remove(key);
        }
        Ok(())
    }

    /// Each stored key with the JSON `save` writes for it.
    fn stored_entries(&self, settings: &UserSettings) -> Result<Vec<(&'static str, String)>> {
        use serde_json::to_string as json;

        let stored_app_locale = canonicalize_app_locale_or_default(&settings.app_locale);
        let stored_key = encrypt_setting_for_storage(
            &settings.llm_api_key,
            "API key",
            &self.llm_api_key_ciphertext,
        )?
        .unwrap_or_else(|| settings.llm_api_key.clone());
        let stored_remote_speech_api_key = encrypt_setting_for_storage(
            &settings.remote_speech_api_key,
            "remote speech API key",
            &self.remote_speech_api_key_ciphertext,
        )?
        .unwrap_or_else(|| settings.remote_speech_api_key.clone());
        let stored_local_api_key = encrypt_setting_for_storage(
            &settings.local_api_key,
            "Local API key",
            &self.local_api_key_ciphertext,
        )?
        .unwrap_or_else(|| settings.local_api_key.clone());

        Ok(vec![
            (
                KEY_ONBOARDING_COMPLETED,
                json(&settings.onboarding_completed)?,
            ),
            (KEY_SMART_SHORTCUT, json(&settings.smart_shortcut)?),
            (KEY_SMART_ENABLED, json(&settings.smart_enabled)?),
            (KEY_HOLD_SHORTCUT, json(&settings.hold_shortcut)?),
            (KEY_HOLD_ENABLED, json(&settings.hold_enabled)?),
            (KEY_TOGGLE_SHORTCUT, json(&settings.toggle_shortcut)?),
            (KEY_TOGGLE_ENABLED, json(&settings.toggle_enabled)?),
            (KEY_SHORTCUT_BINDINGS, json(&settings.shortcut_bindings)?),
            (KEY_TRANSCRIPTION_MODE, json(&settings.transcription_mode)?),
            (KEY_LOCAL_MODEL, json(&settings.local_model)?),
            (
                KEY_REMOTE_SPEECH_ENABLED,
                json(&settings.remote_speech_enabled)?,
            ),
            (
                KEY_REMOTE_SPEECH_PROVIDER,
                json(&settings.remote_speech_provider)?,
            ),
            (
                KEY_REMOTE_SPEECH_ENDPOINT,
                json(&settings.remote_speech_endpoint)?,
            ),
            (
                KEY_REMOTE_SPEECH_API_KEY,
                json(&stored_remote_speech_api_key)?,
            ),
            (
                KEY_REMOTE_SPEECH_MODEL,
                json(&settings.remote_speech_model)?,
            ),
            (KEY_MICROPHONE_DEVICE, json(&settings.microphone_device)?),
            (KEY_LANGUAGE, json(&settings.language)?),
            (KEY_APP_LOCALE, json(&stored_app_locale)?),
            (KEY_THEME_MODE, json(&settings.theme_mode)?),
            (KEY_LLM_ENABLED, json(&settings.llm_enabled)?),
            (KEY_CLEANUP_ENABLED, json(&settings.cleanup_enabled)?),
            (KEY_LLM_PROVIDER, json(&settings.llm_provider)?),
            (KEY_LLM_ENDPOINT, json(&settings.llm_endpoint)?),
            (KEY_LLM_API_KEY, json(&stored_key)?),
            (KEY_LLM_MODEL, json(&settings.llm_model)?),
            (
                KEY_PERSONALITIES_NOTES_SEEDED,
                json(&settings.personalities_notes_seeded)?,
            ),
            (KEY_DICTIONARY, json(&settings.dictionary)?),
            (
                KEY_AUTO_DICTIONARY_ENABLED,
                json(&settings.auto_dictionary_enabled)?,
            ),
            (
                KEY_AUTO_DICTIONARY_IGNORED,
                json(&settings.auto_dictionary_ignored)?,
            ),
            (KEY_REPLACEMENTS, json(&settings.replacements)?),
            (KEY_PERSONALITIES, json(&settings.personalities)?),
            (KEY_MEDIA_ACTION, json(&settings.media_action)?),
            (
                KEY_AUTO_UPDATE_ENABLED,
                json(&settings.auto_update_enabled)?,
            ),
            (
                KEY_AUTO_LAUNCH_ENABLED,
                json(&settings.auto_launch_enabled)?,
            ),
            (
                KEY_START_IN_BACKGROUND,
                json(&settings.start_in_background)?,
            ),
            (KEY_AUTO_DELETE_TARGET, json(&settings.auto_delete_target)?),
            (
                KEY_AUTO_DELETE_DURATION,
                json(&settings.auto_delete_duration)?,
            ),
            (KEY_ANALYTICS_ENABLED, json(&settings.analytics_enabled)?),
            (
                KEY_ANALYTICS_INSTALL_ID,
                json(&settings.analytics_install_id)?,
            ),
            (KEY_LOCAL_API_KEY, json(&stored_local_api_key)?),
            (KEY_LOCAL_API_PORT, json(&settings.local_api_port)?),
            (KEY_LOCAL_API_MODEL, json(&settings.local_api_model)?),
            (KEY_LOCAL_API_HOST, json(&settings.local_api_host)?),
            (
                KEY_LOCAL_API_START_ON_LAUNCH,
                json(&settings.local_api_start_on_launch)?,
            ),
            (KEY_LOCAL_API_CORS, json(&settings.local_api_cors)?),
        ])
    }

    fn read_value<T>(&self, conn: &Connection, key: &str, default: T) -> Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        if let Some(raw) = read_optional_raw_value(conn, key)? {
            serde_json::from_str(&raw).context("Malformed setting JSON in DB")
        } else {
            Ok(default)
        }
    }

    pub(crate) fn read_app_value<T: DeserializeOwned>(&self, key: &str, default: T) -> Result<T> {
        let conn = self.conn.lock();
        self.read_value(&conn, key, default)
    }

    pub(crate) fn write_app_value<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let conn = self.conn.lock();
        self.write_value(&conn, key, value)
    }

    fn write_value<T>(&self, conn: &Connection, key: &str, value: &T) -> Result<()>
    where
        T: Serialize,
    {
        self.write_raw_value(conn, key, &serde_json::to_string(value)?)
    }

    fn write_raw_value(&self, conn: &Connection, key: &str, data: &str) -> Result<()> {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, data],
        )
        .with_context(|| format!("Failed to upsert setting '{key}' into DB"))?;
        Ok(())
    }
}

fn read_optional_raw_value(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .context("Failed to read setting from DB")
}

/// Reads stored settings for `load`. A value this build can't parse is logged
/// and treated as missing, and its key recorded so `save` keeps it.
struct Loader<'a> {
    conn: &'a Connection,
    unreadable: Vec<&'static str>,
}

impl Loader<'_> {
    fn optional<T: DeserializeOwned>(&mut self, key: &'static str) -> Result<Option<T>> {
        let Some(raw) = read_optional_raw_value(self.conn, key)? else {
            return Ok(None);
        };
        match serde_json::from_str(&raw) {
            Ok(value) => Ok(Some(value)),
            Err(err) => {
                tracing::warn!(
                    "Setting '{key}' is unreadable ({:?}), using the default",
                    err.classify()
                );
                self.unreadable.push(key);
                Ok(None)
            }
        }
    }

    fn value<T: DeserializeOwned>(&mut self, key: &'static str, default: T) -> Result<T> {
        Ok(self.optional(key)?.unwrap_or(default))
    }
}

/// Copies the settings DB next to itself, keeping an earlier backup if one exists.
fn back_up_settings_db(conn: &Connection) -> Result<()> {
    let Some(db) = conn.path().filter(|path| !path.is_empty()) else {
        return Ok(());
    };
    let backup = Path::new(db).with_file_name(SETTINGS_BACKUP_FILE_NAME);
    if backup.exists() {
        return Ok(());
    }
    conn.execute("VACUUM INTO ?1", params![backup.to_string_lossy()])
        .with_context(|| format!("Failed to back up settings to {}", backup.display()))?;
    tracing::info!("Backed up settings to {}", backup.display());
    Ok(())
}

fn db_path(app: &AppHandle) -> Result<PathBuf> {
    let resolver = app.path();
    let dir = resolver
        .app_config_dir()
        .or_else(|_| resolver.app_data_dir())
        .context("Unable to resolve config directory")?;

    Ok(settings_db_path(dir))
}

fn cli_app_config_dir(app_identifier: &str) -> Result<PathBuf> {
    Ok(platform_config_dir()?.join(app_identifier))
}

/// Resolve the app data directory for headless CLI use (no Tauri app handle).
/// Mirrors the directory Tauri's `app_data_dir()` resolves to at runtime.
pub(crate) fn cli_data_dir(app_identifier: &str) -> Result<PathBuf> {
    cli_app_config_dir(app_identifier)
}

#[cfg(target_os = "macos")]
fn platform_config_dir() -> Result<PathBuf> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .context("Unable to resolve home directory")?;
    Ok(home.join("Library").join("Application Support"))
}

#[cfg(target_os = "windows")]
fn platform_config_dir() -> Result<PathBuf> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .context("Unable to resolve roaming app data directory")
}

fn settings_db_path(mut dir: PathBuf) -> PathBuf {
    dir.push("Glimpse");
    dir.push(SETTINGS_DB_FILE_NAME);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> SettingsStore {
        let store = SettingsStore {
            conn: Mutex::new(Connection::open_in_memory().expect("open in-memory sqlite DB")),
            llm_api_key_ciphertext: Mutex::new(None),
            remote_speech_api_key_ciphertext: Mutex::new(None),
            local_api_key_ciphertext: Mutex::new(None),
            unreadable: Mutex::new(HashMap::new()),
            backup_before_save: AtomicBool::new(true),
        };
        store.init_schema().expect("init settings schema");
        store
    }

    fn write_setting<T: Serialize>(store: &SettingsStore, key: &str, value: &T) {
        let conn = store.conn.lock();
        store
            .write_value(&conn, key, value)
            .expect("write test setting");
    }

    #[test]
    fn unreadable_encrypted_api_key_is_preserved_without_exposing_plaintext() {
        let store = test_store();
        let ciphertext = crate::crypto::encrypt("api-key-value", "different-hardware-id")
            .expect("encrypt fixture key");

        write_setting(&store, KEY_LLM_API_KEY, &ciphertext);
        write_setting(&store, KEY_TRANSCRIPTION_MODE, &TranscriptionMode::Cloud);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let loaded = store.load().expect("load settings");
        let conn = store.conn.lock();
        let stored_ciphertext = store
            .read_value(&conn, KEY_LLM_API_KEY, String::new())
            .expect("read stored ciphertext");

        assert!(loaded.llm_api_key.is_empty());
        assert_eq!(stored_ciphertext, ciphertext);
        assert_eq!(
            store.llm_api_key_ciphertext.lock().clone(),
            Some(ciphertext)
        );
    }

    #[test]
    fn decryptable_api_key_replaces_cached_ciphertext_after_reload() {
        let Some(hardware_uuid) = crate::crypto::get_hardware_uuid() else {
            return;
        };

        let store = test_store();
        let unreadable_ciphertext =
            crate::crypto::encrypt("api-key-value", "different-hardware-id")
                .expect("encrypt unreadable fixture");
        write_setting(&store, KEY_LLM_API_KEY, &unreadable_ciphertext);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let first = store.load().expect("first load");
        assert!(first.llm_api_key.is_empty());

        let readable_ciphertext = crate::crypto::encrypt("api-key-value", &hardware_uuid)
            .expect("encrypt readable fixture");
        write_setting(&store, KEY_LLM_API_KEY, &readable_ciphertext);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let second = store.load().expect("second load");

        assert_eq!(second.llm_api_key, "api-key-value");
        assert_eq!(store.llm_api_key_ciphertext.lock().clone(), None);
    }

    fn raw_setting(store: &SettingsStore, key: &str) -> Option<String> {
        let conn = store.conn.lock();
        read_optional_raw_value(&conn, key).expect("read raw setting")
    }

    #[test]
    fn first_load_persists_defaults_and_a_stable_install_id() {
        let store = test_store();
        let first = store.load().expect("first load");
        assert!(first.analytics_first_run);
        assert!(uuid::Uuid::parse_str(&first.analytics_install_id).is_ok());
        assert!(first.personalities_notes_seeded);
        assert!(raw_setting(&store, KEY_THEME_MODE).is_some());

        let second = store.load().expect("second load");
        assert_eq!(second.analytics_install_id, first.analytics_install_id);
        assert!(!second.analytics_first_run);
        assert_eq!(second.local_model, default_local_model());
    }

    #[test]
    fn save_then_load_round_trips_user_choices() {
        let store = test_store();
        let mut settings = store.load().expect("load");
        settings.dictionary = vec!["Glimpse".to_string()];
        settings.replacements = vec![Replacement {
            from: "gonna".to_string(),
            to: "going to".to_string(),
        }];
        settings.theme_mode = ThemeMode::Dark;
        settings.media_action = MediaAction::Duck25;
        settings.local_api_port = 9000;
        settings.local_api_host = "0.0.0.0".to_string();
        settings.app_locale = "fr".to_string();
        store.save(&settings).expect("save");

        let loaded = store.load().expect("reload");
        assert_eq!(loaded.dictionary, settings.dictionary);
        assert_eq!(loaded.replacements, settings.replacements);
        assert_eq!(loaded.theme_mode, ThemeMode::Dark);
        assert_eq!(loaded.media_action, MediaAction::Duck25);
        assert_eq!(loaded.local_api_port, 9000);
        assert_eq!(loaded.local_api_host, "0.0.0.0");
        assert_eq!(loaded.app_locale, "fr");
    }

    #[test]
    fn legacy_media_control_flag_becomes_a_media_action() {
        for (legacy, expected) in [(true, MediaAction::Pause), (false, MediaAction::Off)] {
            let store = test_store();
            write_setting(&store, LEGACY_KEY_MEDIA_CONTROL_ENABLED, &legacy);
            assert_eq!(store.load().expect("load").media_action, expected);
            assert_eq!(
                raw_setting(&store, KEY_MEDIA_ACTION),
                Some(serde_json::to_string(&expected).unwrap())
            );
        }
    }

    #[test]
    fn media_action_wins_over_the_legacy_flag() {
        let store = test_store();
        write_setting(&store, LEGACY_KEY_MEDIA_CONTROL_ENABLED, &true);
        write_setting(&store, KEY_MEDIA_ACTION, &MediaAction::Duck50);
        assert_eq!(
            store.load().expect("load").media_action,
            MediaAction::Duck50
        );
    }

    #[test]
    fn legacy_prune_policies_migrate_to_one_auto_delete_rule() {
        let store = test_store();
        write_setting(
            &store,
            LEGACY_KEY_RECORDING_PRUNE_POLICY,
            &RecordingPrunePolicy::Week,
        );
        let loaded = store.load().expect("load");
        assert_eq!(loaded.auto_delete_target, AutoDeleteTarget::Audio);
        assert_eq!(loaded.auto_delete_duration, RecordingPrunePolicy::Week);
        assert!(raw_setting(&store, KEY_AUTO_DELETE_DURATION).is_some());

        let store = test_store();
        write_setting(
            &store,
            LEGACY_KEY_RECORDING_PRUNE_POLICY,
            &RecordingPrunePolicy::Week,
        );
        write_setting(
            &store,
            LEGACY_KEY_TRANSCRIPTION_PRUNE_POLICY,
            &RecordingPrunePolicy::Month,
        );
        let loaded = store.load().expect("load");
        assert_eq!(loaded.auto_delete_target, AutoDeleteTarget::Transcripts);
        assert_eq!(loaded.auto_delete_duration, RecordingPrunePolicy::Month);
    }

    #[test]
    fn stored_auto_delete_duration_skips_the_legacy_migration() {
        let store = test_store();
        write_setting(
            &store,
            LEGACY_KEY_TRANSCRIPTION_PRUNE_POLICY,
            &RecordingPrunePolicy::Day,
        );
        write_setting(
            &store,
            KEY_AUTO_DELETE_DURATION,
            &RecordingPrunePolicy::Never,
        );
        let loaded = store.load().expect("load");
        assert_eq!(loaded.auto_delete_duration, RecordingPrunePolicy::Never);
        assert_eq!(loaded.auto_delete_target, AutoDeleteTarget::Transcripts);
    }

    #[test]
    fn untouched_proxy_presets_move_to_the_native_api() {
        for (provider, native) in [
            ("elevenlabs", "https://api.elevenlabs.io/v1"),
            ("deepgram", "https://api.deepgram.com/v1"),
        ] {
            let store = test_store();
            write_setting(&store, KEY_REMOTE_SPEECH_PROVIDER, &provider);
            write_setting(
                &store,
                KEY_REMOTE_SPEECH_ENDPOINT,
                &" http://localhost:4000/v1 ",
            );
            assert_eq!(store.load().expect("load").remote_speech_endpoint, native);
        }
    }

    #[test]
    fn custom_or_other_provider_endpoints_are_left_alone() {
        let store = test_store();
        write_setting(&store, KEY_REMOTE_SPEECH_PROVIDER, &"deepgram");
        write_setting(
            &store,
            KEY_REMOTE_SPEECH_ENDPOINT,
            &"http://localhost:5000/v1",
        );
        assert_eq!(
            store.load().expect("load").remote_speech_endpoint,
            "http://localhost:5000/v1"
        );

        let store = test_store();
        write_setting(&store, KEY_REMOTE_SPEECH_PROVIDER, &"litellm");
        write_setting(
            &store,
            KEY_REMOTE_SPEECH_ENDPOINT,
            &"http://localhost:4000/v1",
        );
        assert_eq!(
            store.load().expect("load").remote_speech_endpoint,
            "http://localhost:4000/v1"
        );
    }

    #[test]
    fn invalid_stored_values_are_repaired_on_load() {
        let store = test_store();
        write_setting(&store, KEY_LOCAL_MODEL, &"retired_model");
        write_setting(&store, KEY_TRANSCRIPTION_MODE, &TranscriptionMode::Cloud);
        write_setting(&store, KEY_APP_LOCALE, &"klingon");
        write_setting(&store, KEY_LOCAL_API_PORT, &0u16);
        write_setting(&store, KEY_LOCAL_API_MODEL, &"retired_model");
        write_setting(&store, KEY_LOCAL_API_HOST, &"192.168.1.10");

        let loaded = store.load().expect("load");
        assert_eq!(loaded.local_model, default_local_model());
        assert_eq!(loaded.transcription_mode, TranscriptionMode::Local);
        assert_eq!(loaded.app_locale, "system");
        assert_eq!(loaded.local_api_port, default_local_api_port());
        assert_eq!(loaded.local_api_model, "auto");
        assert_eq!(loaded.local_api_host, "127.0.0.1");
        assert_eq!(
            raw_setting(&store, KEY_LOCAL_MODEL),
            Some(serde_json::to_string(&default_local_model()).unwrap())
        );
    }

    #[test]
    fn known_local_api_models_and_locale_spellings_are_kept_canonically() {
        let store = test_store();
        write_setting(&store, KEY_LOCAL_API_MODEL, &"whisper_large_v3_turbo_q8");
        write_setting(&store, KEY_APP_LOCALE, &" FR ");
        let loaded = store.load().expect("load");
        assert_eq!(loaded.local_api_model, "whisper_large_v3_turbo_q8");
        assert_eq!(loaded.app_locale, "fr");
    }

    #[test]
    fn legacy_shortcut_fields_follow_the_first_binding() {
        let store = test_store();
        let mut bindings = default_shortcut_bindings();
        bindings.smart[0].shortcut = "Alt+K".to_string();
        bindings.hold.clear();
        write_setting(&store, KEY_SHORTCUT_BINDINGS, &bindings);
        write_setting(&store, KEY_HOLD_SHORTCUT, &"Alt+H");

        let loaded = store.load().expect("load");
        assert_eq!(loaded.smart_shortcut, "Alt+K");
        assert_eq!(loaded.hold_shortcut, "Alt+H");
        assert_eq!(loaded.toggle_shortcut, default_toggle_shortcut());
    }

    #[test]
    fn seeding_fills_only_empty_built_in_personality_notes() {
        let store = test_store();
        let mut personalities = default_personalities();
        for personality in personalities.iter_mut() {
            personality.instructions.clear();
        }
        personalities[0].instructions = vec!["keep mine".to_string()];
        let kept_id = personalities[0].id.clone();
        personalities.push(Personality {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            enabled: true,
            apps: Vec::new(),
            websites: Vec::new(),
            instructions: Vec::new(),
        });
        write_setting(&store, KEY_PERSONALITIES, &personalities);

        let loaded = store.load().expect("load");
        let by_id = |id: &str| loaded.personalities.iter().find(|p| p.id == id).unwrap();
        assert_eq!(by_id(&kept_id).instructions, ["keep mine"]);
        assert!(by_id("custom").instructions.is_empty());
        assert!(
            loaded
                .personalities
                .iter()
                .filter(|p| p.id != kept_id && p.id != "custom")
                .any(|p| !p.instructions.is_empty())
        );
    }

    #[test]
    fn app_locales_canonicalize_case_and_separators() {
        assert_eq!(canonicalize_app_locale(" EN ").as_deref(), Some("en"));
        assert_eq!(canonicalize_app_locale("System").as_deref(), Some("system"));
        assert_eq!(canonicalize_app_locale("en_US"), None);
        assert_eq!(canonicalize_app_locale(""), None);
        assert_eq!(canonicalize_app_locale_or_default("xx"), "system");
    }

    #[test]
    fn auto_delete_policy_applies_to_one_target_only() {
        let mut settings = UserSettings {
            auto_delete_duration: RecordingPrunePolicy::Week,
            ..UserSettings::default()
        };
        assert_eq!(
            auto_delete_recording_policy(&settings),
            RecordingPrunePolicy::Never
        );
        assert_eq!(
            auto_delete_transcription_policy(&settings),
            RecordingPrunePolicy::Week
        );

        settings.auto_delete_target = AutoDeleteTarget::Audio;
        assert_eq!(
            auto_delete_recording_policy(&settings),
            RecordingPrunePolicy::Week
        );
        assert_eq!(
            auto_delete_transcription_policy(&settings),
            RecordingPrunePolicy::Never
        );
    }

    #[test]
    fn prune_cutoffs_step_back_by_calendar_units() {
        use chrono::TimeZone;
        let now = Local.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).unwrap();
        let cutoff = |policy| recording_prune_cutoff(policy, now);
        assert_eq!(cutoff(RecordingPrunePolicy::Never), None);
        assert_eq!(cutoff(RecordingPrunePolicy::Immediately), Some(now));
        assert_eq!(
            cutoff(RecordingPrunePolicy::Day).map(|at| at.date_naive().to_string()),
            Some("2026-03-30".to_string())
        );
        assert_eq!(
            cutoff(RecordingPrunePolicy::Week).map(|at| at.date_naive().to_string()),
            Some("2026-03-24".to_string())
        );
        assert_eq!(
            cutoff(RecordingPrunePolicy::Month).map(|at| at.date_naive().to_string()),
            Some("2026-02-28".to_string())
        );
        assert_eq!(
            cutoff(RecordingPrunePolicy::Year).map(|at| at.date_naive().to_string()),
            Some("2025-03-31".to_string())
        );
    }

    // A newer version can store a value this build can't parse, for example
    // an enum variant it doesn't know after a downgrade.
    #[test]
    fn one_unreadable_setting_does_not_discard_the_others() {
        let store = test_store();
        write_setting(&store, KEY_DICTIONARY, &vec!["Glimpse".to_string()]);
        write_setting(&store, KEY_THEME_MODE, &"sepia");
        let loaded = store.load().expect("load despite one unreadable value");
        assert_eq!(loaded.dictionary, ["Glimpse"]);
        assert_eq!(loaded.theme_mode, ThemeMode::System);
    }

    #[test]
    fn unreadable_values_and_keys_survive_saves_until_changed() {
        let store = test_store();
        let ciphertext = crate::crypto::encrypt("api-key-value", "different-hardware-id")
            .expect("encrypt fixture key");
        write_setting(&store, KEY_LLM_API_KEY, &ciphertext);
        write_setting(&store, KEY_LOCAL_API_KEY, &42);
        write_setting(&store, KEY_THEME_MODE, &"sepia");
        write_setting(&store, KEY_LOCAL_API_PORT, &"not a port");
        write_setting(&store, KEY_DICTIONARY, &vec!["Glimpse".to_string()]);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let mut loaded = store.load().expect("load despite unreadable values");
        assert_eq!(loaded.theme_mode, ThemeMode::System);
        assert_eq!(loaded.local_api_port, default_local_api_port());
        assert_eq!(loaded.dictionary, ["Glimpse"]);
        assert!(loaded.llm_api_key.is_empty());
        assert!(loaded.local_api_key.is_empty());

        loaded.dictionary.push("Tauri".to_string());
        store.save(&loaded).expect("save");
        assert_eq!(
            raw_setting(&store, KEY_DICTIONARY).as_deref(),
            Some(r#"["Glimpse","Tauri"]"#)
        );
        assert_eq!(
            raw_setting(&store, KEY_THEME_MODE).as_deref(),
            Some(r#""sepia""#)
        );
        assert_eq!(
            raw_setting(&store, KEY_LOCAL_API_PORT).as_deref(),
            Some(r#""not a port""#)
        );
        assert_eq!(
            raw_setting(&store, KEY_LOCAL_API_KEY).as_deref(),
            Some("42")
        );
        assert_eq!(
            raw_setting(&store, KEY_LLM_API_KEY),
            Some(serde_json::to_string(&ciphertext).unwrap())
        );

        loaded.theme_mode = ThemeMode::Dark;
        store.save(&loaded).expect("save changed theme");
        assert_eq!(
            raw_setting(&store, KEY_THEME_MODE).as_deref(),
            Some(r#""dark""#)
        );
        assert_eq!(
            raw_setting(&store, KEY_LOCAL_API_PORT).as_deref(),
            Some(r#""not a port""#)
        );
        assert_eq!(store.load().expect("reload").theme_mode, ThemeMode::Dark);
    }

    #[test]
    fn only_a_partial_load_backs_up_the_db_before_saving() {
        let dir = env::temp_dir().join(format!("glimpse-settings-{}", uuid::Uuid::new_v4()));
        let backup = dir.join(SETTINGS_BACKUP_FILE_NAME);

        let clean = SettingsStore::open(dir.join(SETTINGS_DB_FILE_NAME)).expect("open DB");
        clean.load().expect("first load");
        assert!(!backup.exists());

        write_setting(&clean, KEY_THEME_MODE, &"sepia");
        drop(clean);
        let partial = SettingsStore::open(dir.join(SETTINGS_DB_FILE_NAME)).expect("reopen DB");
        let settings = partial.load().expect("partial load");
        partial.save(&settings).expect("save after partial load");
        let backed_up: String = Connection::open(&backup)
            .expect("open backup")
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![KEY_THEME_MODE],
                |row| row.get(0),
            )
            .expect("read backed up theme");
        assert_eq!(backed_up, r#""sepia""#);

        drop(partial);
        fs::remove_dir_all(&dir).expect("remove test dir");
    }
}
