use std::{collections::HashSet, fs, path::PathBuf, sync::OnceLock};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SETTINGS_DB_FILE_NAME: &str = "settings.db";
const KEY_ONBOARDING_COMPLETED: &str = "onboarding_completed";
const KEY_SMART_SHORTCUT: &str = "smart_shortcut";
const KEY_SMART_ENABLED: &str = "smart_enabled";
const KEY_HOLD_SHORTCUT: &str = "hold_shortcut";
const KEY_HOLD_ENABLED: &str = "hold_enabled";
const KEY_TOGGLE_SHORTCUT: &str = "toggle_shortcut";
const KEY_TOGGLE_ENABLED: &str = "toggle_enabled";
const KEY_TRANSCRIPTION_MODE: &str = "transcription_mode";
const KEY_LOCAL_MODEL: &str = "local_model";
const KEY_MICROPHONE_DEVICE: &str = "microphone_device";
const KEY_LANGUAGE: &str = "language";
const KEY_APP_LOCALE: &str = "app_locale";

const LEGACY_KEY_LLM_CLEANUP_ENABLED: &str = "llm_cleanup_enabled";
const KEY_LLM_ENABLED: &str = "llm_enabled";
const KEY_CLEANUP_ENABLED: &str = "cleanup_enabled";
const KEY_LLM_PROVIDER: &str = "llm_provider";
const KEY_LLM_ENDPOINT: &str = "llm_endpoint";
const KEY_LLM_API_KEY: &str = "llm_api_key";
const KEY_LLM_MODEL: &str = "llm_model";
const KEY_USER_NAME: &str = "user_name";
const KEY_PERSONALITIES_NOTES_SEEDED: &str = "personalities_notes_seeded";
const KEY_DICTIONARY: &str = "dictionary";
const KEY_REPLACEMENTS: &str = "replacements";
const KEY_PERSONALITIES: &str = "personalities";
const KEY_EDIT_MODE_ENABLED: &str = "edit_mode_enabled";
const KEY_MEDIA_CONTROL_ENABLED: &str = "media_control_enabled";
const KEY_AUTO_UPDATE_ENABLED: &str = "auto_update_enabled";
const KEY_RECORDING_PRUNE_POLICY: &str = "recording_prune_policy";
const KEY_ANALYTICS_ENABLED: &str = "analytics_enabled";
const KEY_ANALYTICS_INSTALL_ID: &str = "analytics_install_id";

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
    #[serde(default = "default_transcription_mode")]
    pub transcription_mode: TranscriptionMode,
    #[serde(default = "default_local_model")]
    pub local_model: String,
    pub microphone_device: Option<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_app_locale")]
    pub app_locale: String,

    #[serde(default)]
    pub llm_enabled: bool,
    #[serde(default)]
    pub cleanup_enabled: bool,
    #[serde(default = "default_llm_provider")]
    pub llm_provider: LlmProvider,
    #[serde(default)]
    pub llm_endpoint: String,
    #[serde(default)]
    pub llm_api_key: String,
    #[serde(default)]
    pub llm_model: String,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub personalities_notes_seeded: bool,
    #[serde(default)]
    pub dictionary: Vec<String>,
    #[serde(default)]
    pub replacements: Vec<Replacement>,
    #[serde(default = "default_personalities")]
    pub personalities: Vec<Personality>,
    #[serde(default)]
    pub edit_mode_enabled: bool,
    #[serde(default)]
    pub media_control_enabled: bool,
    #[serde(default)]
    pub auto_update_enabled: bool,
    #[serde(default = "default_recording_prune_policy")]
    pub recording_prune_policy: RecordingPrunePolicy,
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
    #[serde(default)]
    pub analytics_install_id: String,
}

fn default_smart_shortcut() -> String {
    "Control+Space".to_string()
}

fn default_hold_shortcut() -> String {
    "Control+Shift+Space".to_string()
}

fn default_toggle_shortcut() -> String {
    "Control+Alt+Space".to_string()
}

fn default_true() -> bool {
    true
}

fn default_personalities() -> Vec<Personality> {
    vec![
        Personality {
            id: "messaging".to_string(),
            name: "Messaging".to_string(),
            enabled: true,
            apps: vec!["Messages".to_string(), "Slack".to_string()],
            websites: vec!["slack.com".to_string()],
            instructions: vec![],
        },
        Personality {
            id: "email".to_string(),
            name: "Email".to_string(),
            enabled: true,
            apps: vec![
                "Mail".to_string(),
                "Outlook".to_string(),
                "Spark".to_string(),
            ],
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
            enabled: true,
            apps: vec![
                "Notes".to_string(),
                "Notion".to_string(),
                "Obsidian".to_string(),
                "Craft".to_string(),
                "Affine".to_string(),
            ],
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
            enabled: true,
            apps: vec![
                "Cursor".to_string(),
                "Visual Studio Code".to_string(),
                "Xcode".to_string(),
                "WebStorm".to_string(),
                "IntelliJ IDEA".to_string(),
            ],
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
            transcription_mode: default_transcription_mode(),
            local_model: default_local_model(),
            microphone_device: None,
            language: default_language(),
            app_locale: default_app_locale(),

            llm_enabled: false,
            cleanup_enabled: false,
            llm_provider: default_llm_provider(),
            llm_endpoint: String::new(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            user_name: String::new(),
            personalities_notes_seeded: false,
            dictionary: Vec::new(),
            replacements: Vec::new(),
            personalities: default_personalities(),
            edit_mode_enabled: false,
            media_control_enabled: false,
            auto_update_enabled: false,
            recording_prune_policy: default_recording_prune_policy(),
            analytics_enabled: true,
            analytics_install_id: String::new(),
        }
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
    ThreeMonths,
    Year,
}

fn default_recording_prune_policy() -> RecordingPrunePolicy {
    RecordingPrunePolicy::Never
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    #[default]
    None,
    LmStudio,
    Ollama,
    OpenAI,
    Anthropic,
    Google,
    Xai,
    Groq,
    Cerebras,
    Sambanova,
    Together,
    OpenRouter,
    Perplexity,
    DeepSeek,
    Fireworks,
    Mistral,
    #[serde(other)]
    Custom,
}

fn default_llm_provider() -> LlmProvider {
    LlmProvider::None
}

pub fn default_local_model() -> String {
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "whisper_small_q5".to_string()
    }

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    {
        "parakeet_tdt_int8".to_string()
    }
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

pub struct SettingsStore {
    conn: Mutex<Connection>,
    llm_api_key_ciphertext: Mutex<Option<String>>,
}

impl SettingsStore {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let path = db_path(app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create settings dir {}", parent.display()))?;
        }

        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open settings DB at {}", path.display()))?;

        let store = Self {
            conn: Mutex::new(conn),
            llm_api_key_ciphertext: Mutex::new(None),
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
        let mut llm_api_key_ciphertext: Option<String> = None;
        let encrypted_key: String;
        let legacy_llm_cleanup_enabled_exists: bool;
        let llm_enabled_exists: bool;
        let cleanup_enabled_exists: bool;
        {
            let conn = self.conn.lock();

            settings.onboarding_completed = self.read_value(
                &conn,
                KEY_ONBOARDING_COMPLETED,
                settings.onboarding_completed,
            )?;
            settings.smart_shortcut =
                self.read_value(&conn, KEY_SMART_SHORTCUT, settings.smart_shortcut.clone())?;
            settings.smart_enabled =
                self.read_value(&conn, KEY_SMART_ENABLED, settings.smart_enabled)?;
            settings.hold_shortcut =
                self.read_value(&conn, KEY_HOLD_SHORTCUT, settings.hold_shortcut.clone())?;
            settings.hold_enabled =
                self.read_value(&conn, KEY_HOLD_ENABLED, settings.hold_enabled)?;
            settings.toggle_shortcut =
                self.read_value(&conn, KEY_TOGGLE_SHORTCUT, settings.toggle_shortcut.clone())?;
            settings.toggle_enabled =
                self.read_value(&conn, KEY_TOGGLE_ENABLED, settings.toggle_enabled)?;
            settings.transcription_mode = self.read_value(
                &conn,
                KEY_TRANSCRIPTION_MODE,
                settings.transcription_mode.clone(),
            )?;
            settings.local_model =
                self.read_value(&conn, KEY_LOCAL_MODEL, settings.local_model.clone())?;
            settings.microphone_device = self.read_value(
                &conn,
                KEY_MICROPHONE_DEVICE,
                settings.microphone_device.clone(),
            )?;
            settings.language = self.read_value(&conn, KEY_LANGUAGE, settings.language.clone())?;
            settings.app_locale =
                self.read_value(&conn, KEY_APP_LOCALE, settings.app_locale.clone())?;

            let legacy_llm_cleanup_enabled =
                self.read_optional_value::<bool>(&conn, LEGACY_KEY_LLM_CLEANUP_ENABLED)?;
            let llm_enabled = self.read_optional_value::<bool>(&conn, KEY_LLM_ENABLED)?;
            let cleanup_enabled = self.read_optional_value::<bool>(&conn, KEY_CLEANUP_ENABLED)?;
            legacy_llm_cleanup_enabled_exists = legacy_llm_cleanup_enabled.is_some();
            llm_enabled_exists = llm_enabled.is_some();
            cleanup_enabled_exists = cleanup_enabled.is_some();
            settings.llm_enabled = llm_enabled
                .or(legacy_llm_cleanup_enabled)
                .unwrap_or(settings.llm_enabled);
            settings.cleanup_enabled = cleanup_enabled
                .or(legacy_llm_cleanup_enabled)
                .unwrap_or(settings.cleanup_enabled);
            settings.llm_provider =
                self.read_value(&conn, KEY_LLM_PROVIDER, settings.llm_provider.clone())?;
            settings.llm_endpoint =
                self.read_value(&conn, KEY_LLM_ENDPOINT, settings.llm_endpoint.clone())?;

            encrypted_key = self.read_value(&conn, KEY_LLM_API_KEY, String::new())?;

            settings.llm_model =
                self.read_value(&conn, KEY_LLM_MODEL, settings.llm_model.clone())?;
            settings.user_name =
                self.read_value(&conn, KEY_USER_NAME, settings.user_name.clone())?;
            settings.personalities_notes_seeded = self.read_value(
                &conn,
                KEY_PERSONALITIES_NOTES_SEEDED,
                settings.personalities_notes_seeded,
            )?;
            settings.dictionary =
                self.read_value(&conn, KEY_DICTIONARY, settings.dictionary.clone())?;
            settings.replacements =
                self.read_value(&conn, KEY_REPLACEMENTS, settings.replacements.clone())?;
            settings.personalities =
                self.read_value(&conn, KEY_PERSONALITIES, settings.personalities.clone())?;
            settings.edit_mode_enabled =
                self.read_value(&conn, KEY_EDIT_MODE_ENABLED, settings.edit_mode_enabled)?;
            settings.media_control_enabled = self.read_value(
                &conn,
                KEY_MEDIA_CONTROL_ENABLED,
                settings.media_control_enabled,
            )?;
            settings.auto_update_enabled =
                self.read_value(&conn, KEY_AUTO_UPDATE_ENABLED, settings.auto_update_enabled)?;
            settings.recording_prune_policy = self.read_value(
                &conn,
                KEY_RECORDING_PRUNE_POLICY,
                settings.recording_prune_policy,
            )?;
            settings.analytics_enabled =
                self.read_value(&conn, KEY_ANALYTICS_ENABLED, settings.analytics_enabled)?;
            settings.analytics_install_id = self.read_value(
                &conn,
                KEY_ANALYTICS_INSTALL_ID,
                settings.analytics_install_id.clone(),
            )?;
        }

        if !encrypted_key.is_empty() {
            let key_looks_encrypted = crate::crypto::looks_encrypted(&encrypted_key);
            if let Some(hardware_uuid) = crate::crypto::get_hardware_uuid() {
                match crate::crypto::decrypt(&encrypted_key, &hardware_uuid) {
                    Ok(decrypted) => settings.llm_api_key = decrypted,
                    Err(e) => {
                        if !key_looks_encrypted {
                            settings.llm_api_key = encrypted_key;
                        } else {
                            eprintln!(
                                "Error: Failed to decrypt API key: {}. Preserving encrypted value.",
                                e
                            );
                            settings.llm_api_key = String::new();
                            llm_api_key_ciphertext = Some(encrypted_key);
                        }
                    }
                }
            } else {
                eprintln!("Warning: Could not get hardware UUID, preserving stored API key");
                if key_looks_encrypted {
                    settings.llm_api_key = String::new();
                    llm_api_key_ciphertext = Some(encrypted_key);
                } else {
                    settings.llm_api_key = encrypted_key;
                }
            }
        }
        *self.llm_api_key_ciphertext.lock() = llm_api_key_ciphertext;

        if settings.analytics_install_id.is_empty() {
            settings.analytics_install_id = uuid::Uuid::new_v4().to_string();
            should_persist = true;
        }

        if !settings.personalities_notes_seeded {
            seed_personality_notes(&mut settings.personalities);
            settings.personalities_notes_seeded = true;
            should_persist = true;
        }

        if legacy_llm_cleanup_enabled_exists && (!llm_enabled_exists || !cleanup_enabled_exists) {
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

        if should_persist {
            self.save(&settings)?;
        }

        if legacy_llm_cleanup_enabled_exists {
            let conn = self.conn.lock();
            self.delete_value(&conn, LEGACY_KEY_LLM_CLEANUP_ENABLED)?;
        }

        Ok(settings)
    }

    /// Persist settings into DB immediately.
    pub fn save(&self, settings: &UserSettings) -> Result<()> {
        let stored_app_locale = canonicalize_app_locale_or_default(&settings.app_locale);
        let stored_key = {
            let mut llm_api_key_ciphertext = self.llm_api_key_ciphertext.lock();
            if settings.llm_api_key.is_empty() {
                llm_api_key_ciphertext.clone().unwrap_or_default()
            } else if llm_api_key_ciphertext
                .as_ref()
                .is_some_and(|ciphertext| ciphertext == &settings.llm_api_key)
            {
                settings.llm_api_key.clone()
            } else if let Some(hardware_uuid) = crate::crypto::get_hardware_uuid() {
                *llm_api_key_ciphertext = None;
                crate::crypto::encrypt(&settings.llm_api_key, &hardware_uuid)
                    .map_err(|e| anyhow::anyhow!("Failed to encrypt API key: {}", e))?
            } else {
                *llm_api_key_ciphertext = None;
                eprintln!("Warning: Could not get hardware UUID, storing API key unencrypted");
                settings.llm_api_key.clone()
            }
        };

        let conn = self.conn.lock();
        self.write_value(
            &conn,
            KEY_ONBOARDING_COMPLETED,
            &settings.onboarding_completed,
        )?;
        self.write_value(&conn, KEY_SMART_SHORTCUT, &settings.smart_shortcut)?;
        self.write_value(&conn, KEY_SMART_ENABLED, &settings.smart_enabled)?;
        self.write_value(&conn, KEY_HOLD_SHORTCUT, &settings.hold_shortcut)?;
        self.write_value(&conn, KEY_HOLD_ENABLED, &settings.hold_enabled)?;
        self.write_value(&conn, KEY_TOGGLE_SHORTCUT, &settings.toggle_shortcut)?;
        self.write_value(&conn, KEY_TOGGLE_ENABLED, &settings.toggle_enabled)?;
        self.write_value(&conn, KEY_TRANSCRIPTION_MODE, &settings.transcription_mode)?;
        self.write_value(&conn, KEY_LOCAL_MODEL, &settings.local_model)?;
        self.write_value(&conn, KEY_MICROPHONE_DEVICE, &settings.microphone_device)?;
        self.write_value(&conn, KEY_LANGUAGE, &settings.language)?;
        self.write_value(&conn, KEY_APP_LOCALE, &stored_app_locale)?;

        self.write_value(&conn, KEY_LLM_ENABLED, &settings.llm_enabled)?;
        self.write_value(&conn, KEY_CLEANUP_ENABLED, &settings.cleanup_enabled)?;
        self.write_value(&conn, KEY_LLM_PROVIDER, &settings.llm_provider)?;
        self.write_value(&conn, KEY_LLM_ENDPOINT, &settings.llm_endpoint)?;
        self.write_value(&conn, KEY_LLM_API_KEY, &stored_key)?;

        self.write_value(&conn, KEY_LLM_MODEL, &settings.llm_model)?;
        self.write_value(&conn, KEY_USER_NAME, &settings.user_name)?;
        self.write_value(
            &conn,
            KEY_PERSONALITIES_NOTES_SEEDED,
            &settings.personalities_notes_seeded,
        )?;
        self.write_value(&conn, KEY_DICTIONARY, &settings.dictionary)?;
        self.write_value(&conn, KEY_REPLACEMENTS, &settings.replacements)?;
        self.write_value(&conn, KEY_PERSONALITIES, &settings.personalities)?;
        self.write_value(&conn, KEY_EDIT_MODE_ENABLED, &settings.edit_mode_enabled)?;
        self.write_value(
            &conn,
            KEY_MEDIA_CONTROL_ENABLED,
            &settings.media_control_enabled,
        )?;
        self.write_value(
            &conn,
            KEY_AUTO_UPDATE_ENABLED,
            &settings.auto_update_enabled,
        )?;
        self.write_value(
            &conn,
            KEY_RECORDING_PRUNE_POLICY,
            &settings.recording_prune_policy,
        )?;
        self.write_value(&conn, KEY_ANALYTICS_ENABLED, &settings.analytics_enabled)?;
        self.write_value(
            &conn,
            KEY_ANALYTICS_INSTALL_ID,
            &settings.analytics_install_id,
        )?;
        Ok(())
    }

    fn read_value<T>(&self, conn: &Connection, key: &str, default: T) -> Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        if let Some(raw) = self.read_optional_raw_value_from_conn(conn, key)? {
            serde_json::from_str(&raw).context("Malformed setting JSON in DB")
        } else {
            Ok(default)
        }
    }

    fn read_optional_value<T>(&self, conn: &Connection, key: &str) -> Result<Option<T>>
    where
        T: for<'de> Deserialize<'de>,
    {
        self.read_optional_raw_value_from_conn(conn, key)?
            .map(|raw| serde_json::from_str(&raw).context("Malformed setting JSON in DB"))
            .transpose()
    }

    fn read_optional_raw_value_from_conn(
        &self,
        conn: &Connection,
        key: &str,
    ) -> Result<Option<String>> {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .context("Failed to read setting from DB")
    }

    fn write_value<T>(&self, conn: &Connection, key: &str, value: &T) -> Result<()>
    where
        T: Serialize,
    {
        let data = serde_json::to_string(value)?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, data],
        )
        .with_context(|| format!("Failed to upsert setting '{key}' into DB"))?;
        Ok(())
    }

    fn delete_value(&self, conn: &Connection, key: &str) -> Result<()> {
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .with_context(|| format!("Failed to delete setting '{key}' from DB"))?;
        Ok(())
    }
}

fn db_path(app: &AppHandle) -> Result<PathBuf> {
    let resolver = app.path();
    let mut dir = resolver
        .app_config_dir()
        .or_else(|_| resolver.app_data_dir())
        .context("Unable to resolve config directory")?;
    dir.push("Glimpse");
    dir.push(SETTINGS_DB_FILE_NAME);
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> SettingsStore {
        let store = SettingsStore {
            conn: Mutex::new(Connection::open_in_memory().expect("open in-memory sqlite DB")),
            llm_api_key_ciphertext: Mutex::new(None),
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

    fn read_bool_setting(store: &SettingsStore, key: &str) -> bool {
        let conn = store.conn.lock();
        store
            .read_value(&conn, key, false)
            .expect("read bool setting")
    }

    #[test]
    fn legacy_cleanup_flag_migrates_and_removes_legacy_key() {
        let store = test_store();
        write_setting(&store, LEGACY_KEY_LLM_CLEANUP_ENABLED, &true);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let loaded = store.load().expect("load settings");

        assert!(loaded.llm_enabled);
        assert!(loaded.cleanup_enabled);
        assert!(read_bool_setting(&store, KEY_LLM_ENABLED));
        assert!(read_bool_setting(&store, KEY_CLEANUP_ENABLED));
        let conn = store.conn.lock();
        let legacy_raw = store
            .read_optional_raw_value_from_conn(&conn, LEGACY_KEY_LLM_CLEANUP_ENABLED)
            .expect("read legacy key");
        assert!(legacy_raw.is_none());
    }

    #[test]
    fn legacy_cleanup_flag_only_backfills_missing_new_keys() {
        let store = test_store();
        write_setting(&store, LEGACY_KEY_LLM_CLEANUP_ENABLED, &true);
        write_setting(&store, KEY_LLM_ENABLED, &false);
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let loaded = store.load().expect("load settings");

        assert!(!loaded.llm_enabled);
        assert!(loaded.cleanup_enabled);
        assert!(!read_bool_setting(&store, KEY_LLM_ENABLED));
        assert!(read_bool_setting(&store, KEY_CLEANUP_ENABLED));
        let conn = store.conn.lock();
        let legacy_raw = store
            .read_optional_raw_value_from_conn(&conn, LEGACY_KEY_LLM_CLEANUP_ENABLED)
            .expect("read legacy key");
        assert!(legacy_raw.is_none());
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
    fn canonicalizes_locale_codes() {
        assert_eq!(canonicalize_app_locale("fr"), Some("fr".to_string()));
        assert_eq!(canonicalize_app_locale("FR"), Some("fr".to_string()));
        assert_eq!(
            canonicalize_app_locale("SYSTEM"),
            Some("system".to_string())
        );
        assert_eq!(canonicalize_app_locale("it"), None);
    }

    #[test]
    fn invalid_app_locale_resets_to_system() {
        let store = test_store();
        write_setting(&store, KEY_APP_LOCALE, &"it");
        write_setting(&store, KEY_PERSONALITIES_NOTES_SEEDED, &true);

        let loaded = store.load().expect("load settings");

        let conn = store.conn.lock();
        let stored_locale = store
            .read_value(&conn, KEY_APP_LOCALE, String::new())
            .expect("read stored app locale");

        assert_eq!(loaded.app_locale, "system");
        assert_eq!(stored_locale, "system");
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
}
