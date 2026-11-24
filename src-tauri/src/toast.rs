use crate::tray::SettingsPage;
use crate::{AppRuntime, AppState, pill};
use tauri::{AppHandle, Manager};

/// What a toast button does.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Only closes the toast.
    Close,
    OpenSettings(SettingsPage),
    OpenAccount,
    #[cfg(target_os = "macos")]
    OpenAccessibilitySettings,
    OpenMicrophoneSettings,
    OpenSoundSettings,
    OpenFfmpegHelp,
    CopyLastTranscription,
    AcceptDictionarySuggestion(String),
    RejectDictionarySuggestion(String),
    /// Answers voice prompt `id` with its first or second button.
    PickVoicePrompt(String, usize),
    SkipVoicePrompt(String),
    TurnOffAgentNotice,
    RunAnnouncement,
    OpenAnnouncement,
}

impl Action {
    pub fn run(self, app: &AppHandle<AppRuntime>) -> Result<(), String> {
        match self {
            Self::Close => Ok(()),
            Self::OpenSettings(page) => crate::open_settings_page(app, page),
            Self::OpenAccount => crate::open_account_page(app.clone()),
            #[cfg(target_os = "macos")]
            Self::OpenAccessibilitySettings => crate::open_accessibility_settings(app.clone()),
            Self::OpenMicrophoneSettings => crate::permissions::open_microphone_settings(),
            Self::OpenSoundSettings => crate::permissions::open_sound_settings(),
            Self::OpenFfmpegHelp => crate::open_ffmpeg_install(app.clone()),
            Self::CopyLastTranscription => crate::copy_last_transcription(app.clone(), app.state()),
            Self::AcceptDictionarySuggestion(word) => {
                crate::auto_dictionary::accept_auto_dictionary_suggestion(
                    word,
                    app.clone(),
                    app.state(),
                )
                .map(drop)
            }
            Self::RejectDictionarySuggestion(word) => {
                crate::auto_dictionary::reject_auto_dictionary_suggestion(
                    word,
                    app.clone(),
                    app.state(),
                )
                .map(drop)
            }
            Self::PickVoicePrompt(id, button) => {
                crate::voice_prompt::pick(&id, button);
                Ok(())
            }
            Self::SkipVoicePrompt(id) => {
                crate::voice_prompt::skip(&id);
                Ok(())
            }
            Self::TurnOffAgentNotice => crate::recording::turn_off_agent_notice(app),
            Self::RunAnnouncement => crate::announcements::run_toasted_announcement(app),
            Self::OpenAnnouncement => crate::announcements::open_toasted_announcement(app),
        }
    }
}

#[derive(Clone, Default)]
pub struct Payload {
    pub toast_type: String,
    pub title: Option<String>,
    pub message: String,
    pub auto_dismiss: Option<bool>,
    pub duration: Option<u64>,
    pub action: Option<Action>,
    pub action_label: Option<String>,
    pub secondary_action: Option<Action>,
    pub secondary_action_label: Option<String>,
    pub detail: Option<String>,
    /// Runs when the user closes the toast.
    pub close_action: Option<Action>,
    pub keep_while_recording: Option<bool>,
}

pub fn emit_toast(_app: &AppHandle<AppRuntime>, payload: Payload) {
    if payload.toast_type != "ask" {
        crate::voice_prompt::toast_covered();
    }
    crate::native_ui::toast::show(payload);
}

pub fn native(app: &AppHandle<AppRuntime>, key: &'static str) -> String {
    let settings = app.state::<AppState>().current_settings();
    crate::native_i18n::MenuStrings::resolve(&settings)
        .get(key)
        .to_string()
}

pub fn native_format(
    app: &AppHandle<AppRuntime>,
    key: &'static str,
    args: &[(&str, &str)],
) -> String {
    let settings = app.state::<AppState>().current_settings();
    crate::native_i18n::MenuStrings::resolve(&settings).format(key, args)
}

pub fn show(app: &AppHandle<AppRuntime>, toast_type: &str, title: Option<&str>, message: &str) {
    emit_toast(
        app,
        Payload {
            toast_type: toast_type.to_string(),
            title: title.map(String::from),
            message: message.to_string(),
            ..Default::default()
        },
    );
}

pub fn show_with_action(
    app: &AppHandle<AppRuntime>,
    toast_type: &str,
    title: Option<&str>,
    message: &str,
    action: Action,
    action_label: &str,
) {
    emit_toast(
        app,
        Payload {
            toast_type: toast_type.to_string(),
            title: title.map(String::from),
            message: message.to_string(),
            action: Some(action),
            action_label: Some(action_label.to_string()),
            ..Default::default()
        },
    );
}

/// Plays the toast's exit animation, then closes it.
pub fn hide(_app: &AppHandle<AppRuntime>) {
    crate::native_ui::toast::hide();
}

/// After a toast closed: an error pill goes back to idle, and the next voice prompt can show.
pub fn toast_dismissed(app: &AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    if state.pill().status() == pill::PillStatus::Error {
        state.pill().reset(app);
    }
    crate::voice_prompt::toast_closed(app);
}

#[tauri::command]
pub fn debug_show_toast(toast_type: String, message: String, app: AppHandle<AppRuntime>) {
    emit_toast(
        &app,
        Payload {
            toast_type,
            message,
            auto_dismiss: Some(true),
            duration: Some(8000),
            ..Default::default()
        },
    );
}

/// Lifetime word counts that earn a celebration toast.
pub const WORD_MILESTONES: [u64; 4] = [1_000, 10_000, 100_000, 1_000_000];

/// Celebrates the highest milestone crossed between `before` and `after` lifetime words.
pub fn show_word_milestone(app: &AppHandle<AppRuntime>, before: u64, after: u64) -> bool {
    let Some(milestone) = WORD_MILESTONES
        .iter()
        .rev()
        .find(|m| before < **m && **m <= after)
    else {
        return false;
    };
    let settings = app.state::<AppState>().current_settings();
    let strings = crate::native_i18n::MenuStrings::resolve(&settings);
    emit_toast(
        app,
        Payload {
            toast_type: "celebration".to_string(),
            message: strings.format(
                "native.toast.milestone",
                &[("count", &format_thousands(*milestone))],
            ),
            auto_dismiss: Some(true),
            duration: Some(6000),
            ..Default::default()
        },
    );
    true
}

fn format_thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}
