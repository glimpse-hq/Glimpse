//! Questions waiting for the user's next dictation. Whoever opens one polls for
//! the answer. It shows in the toast window, and the next dictation started
//! while it is showing goes to the asker instead of the cursor.

use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{Value, json};
use tauri::AppHandle;
use tauri::Manager;

use crate::{AppRuntime, AppState, pill, toast};

const MAX_OPEN: usize = 5;
const MAX_QUESTION_CHARS: usize = 160;
// An asker that stops polling this long is treated as gone, so its question
// can't keep taking dictations.
const ABANDONED_AFTER: Duration = Duration::from_secs(90);
const REAP_EVERY: Duration = Duration::from_secs(5);

enum Stage {
    Waiting,
    Answering,
    Answered(String),
    Skipped,
}

struct Prompt {
    id: String,
    client: String,
    question: String,
    stage: Stage,
    last_poll: Instant,
}

impl Prompt {
    fn is_open(&self) -> bool {
        matches!(self.stage, Stage::Waiting | Stage::Answering)
    }
}

struct Prompts {
    items: Vec<Prompt>,
    shown: Option<String>,
    // Another toast is on top of the shown question until it closes.
    covered: bool,
    reaping: bool,
}

static PROMPTS: Mutex<Prompts> = Mutex::new(Prompts {
    items: Vec::new(),
    shown: None,
    covered: false,
    reaping: false,
});

pub(crate) fn open(
    app: &AppHandle<AppRuntime>,
    client: &str,
    question: &str,
) -> Result<String, String> {
    let question = question.trim();
    if question.is_empty() {
        return Err("question must not be empty".to_string());
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(format!(
            "question must be {MAX_QUESTION_CHARS} characters or fewer"
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let start_reaper = {
        let mut prompts = PROMPTS.lock();
        if prompts.items.iter().filter(|p| p.is_open()).count() >= MAX_OPEN {
            return Err("Too many questions are already waiting for the user.".to_string());
        }
        prompts.items.push(Prompt {
            id: id.clone(),
            client: client.trim().to_string(),
            question: question.to_string(),
            stage: Stage::Waiting,
            last_poll: Instant::now(),
        });
        !std::mem::replace(&mut prompts.reaping, true)
    };
    if start_reaper {
        let app = app.clone();
        std::thread::spawn(move || reap(app));
    }
    show_current(app);
    Ok(id)
}

/// `waiting`, `answered` with the text, `skipped`, or `expired` once the
/// question is gone. An answered or skipped question is removed when read.
pub(crate) fn poll(id: &str) -> Value {
    let mut prompts = PROMPTS.lock();
    let Some(index) = prompts.items.iter().position(|p| p.id == id) else {
        return json!({ "status": "expired" });
    };
    prompts.items[index].last_poll = Instant::now();
    if prompts.items[index].is_open() {
        return json!({ "status": "waiting" });
    }
    match prompts.items.remove(index).stage {
        Stage::Answered(answer) => json!({ "status": "answered", "answer": answer }),
        _ => json!({ "status": "skipped" }),
    }
}

/// Removes a question whose asker has gone.
pub(crate) fn close(app: &AppHandle<AppRuntime>, id: &str) {
    let was_shown = {
        let mut prompts = PROMPTS.lock();
        prompts.items.retain(|p| p.id != id);
        take_shown(&mut prompts, id)
    };
    if was_shown {
        toast::hide(app);
    }
}

#[cfg(debug_assertions)]
pub(crate) fn close_all() {
    let mut prompts = PROMPTS.lock();
    prompts.items.clear();
    prompts.shown = None;
}

#[tauri::command]
pub fn voice_prompt_skip(id: String) {
    let mut prompts = PROMPTS.lock();
    if let Some(prompt) = prompts.items.iter_mut().find(|p| p.id == id) {
        prompt.stage = Stage::Skipped;
    }
    take_shown(&mut prompts, &id);
}

// Not while answering: Escape is used in other apps during a dictation.
fn shown_waiting_index(prompts: &Prompts) -> Option<usize> {
    if prompts.covered {
        return None;
    }
    prompts.items.iter().position(|p| {
        prompts.shown.as_deref() == Some(p.id.as_str()) && matches!(p.stage, Stage::Waiting)
    })
}

pub(crate) fn escape_skips() -> bool {
    shown_waiting_index(&PROMPTS.lock()).is_some()
}

/// Skips the question on screen.
pub(crate) fn skip_shown(app: &AppHandle<AppRuntime>) -> bool {
    {
        let mut prompts = PROMPTS.lock();
        let Some(index) = shown_waiting_index(&prompts) else {
            return false;
        };
        prompts.items[index].stage = Stage::Skipped;
        prompts.shown = None;
    }
    toast::hide(app);
    true
}

/// A dictation just started: it answers the question on screen, if any.
pub(crate) fn claim_for_dictation() {
    let mut prompts = PROMPTS.lock();
    if let Some(index) = shown_waiting_index(&prompts) {
        prompts.items[index].stage = Stage::Answering;
    }
}

pub(crate) fn is_answering() -> bool {
    PROMPTS
        .lock()
        .items
        .iter()
        .any(|p| matches!(p.stage, Stage::Answering))
}

pub(crate) struct AnsweredQuestion {
    pub(crate) question: String,
    pub(crate) client: String,
}

/// Hands the text to the question this dictation claimed. None means no
/// question claimed it, so it should go to the cursor.
pub(crate) fn answer(app: &AppHandle<AppRuntime>, text: &str) -> Option<AnsweredQuestion> {
    let answered = {
        let mut prompts = PROMPTS.lock();
        let Some(prompt) = prompts
            .items
            .iter_mut()
            .find(|p| matches!(p.stage, Stage::Answering))
        else {
            return None;
        };
        prompt.stage = Stage::Answered(text.to_string());
        let answered = AnsweredQuestion {
            question: prompt.question.clone(),
            client: prompt.client.clone(),
        };
        prompts.shown = None;
        answered
    };
    toast::hide(app);
    Some(answered)
}

/// A dictation that ended without an answer leaves its question open.
pub(crate) fn pill_became_idle(app: &AppHandle<AppRuntime>) {
    for prompt in PROMPTS.lock().items.iter_mut() {
        if matches!(prompt.stage, Stage::Answering) {
            prompt.stage = Stage::Waiting;
        }
    }
    show_current(app);
}

/// Another toast replaced the card. The question returns when that toast closes.
pub(crate) fn toast_covered() {
    let mut prompts = PROMPTS.lock();
    prompts.covered = prompts.shown.is_some();
}

/// The toast window closed its card. Returns true when a question took its place.
pub(crate) fn toast_closed(app: &AppHandle<AppRuntime>) -> bool {
    {
        let mut prompts = PROMPTS.lock();
        prompts.shown = None;
        prompts.covered = false;
    }
    show_current(app);
    PROMPTS.lock().shown.is_some()
}

fn take_shown(prompts: &mut Prompts, id: &str) -> bool {
    let was_shown = prompts.shown.as_deref() == Some(id);
    if was_shown {
        prompts.shown = None;
    }
    was_shown
}

// A question appearing mid-dictation waits, so it can't look like it is
// taking the text already being spoken.
fn show_current(app: &AppHandle<AppRuntime>) {
    let idle = app.state::<AppState>().pill().status() == pill::PillStatus::Idle;
    let (id, client, question) = {
        let mut prompts = PROMPTS.lock();
        if prompts.shown.is_some() || prompts.covered {
            return;
        }
        let Some(prompt) = prompts.items.iter().find(|p| p.is_open()) else {
            return;
        };
        if !idle && matches!(prompt.stage, Stage::Waiting) {
            return;
        }
        let current = (
            prompt.id.clone(),
            prompt.client.clone(),
            prompt.question.clone(),
        );
        prompts.shown = Some(current.0.clone());
        current
    };
    let title = if client.is_empty() {
        toast::native(app, "native.toast.ask_title_unnamed")
    } else {
        toast::native_format(app, "native.toast.ask_title", &[("client", &client)])
    };
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "ask".to_string(),
            title: Some(title),
            message: question,
            detail: Some(toast::native(app, "native.toast.ask_hint")),
            auto_dismiss: Some(false),
            keep_while_recording: Some(true),
            action: Some("voice_prompt_skip".to_string()),
            action_label: Some(toast::native(app, "native.toast.ask_skip")),
            action_args: Some(json!({ "id": id })),
            close_action: Some("voice_prompt_skip".to_string()),
            ..Default::default()
        },
    );
}

fn reap(app: AppHandle<AppRuntime>) {
    loop {
        std::thread::sleep(REAP_EVERY);
        let hide = {
            let mut prompts = PROMPTS.lock();
            let abandoned: Vec<String> = prompts
                .items
                .iter()
                .filter(|p| {
                    !matches!(p.stage, Stage::Answering) && p.last_poll.elapsed() >= ABANDONED_AFTER
                })
                .map(|p| p.id.clone())
                .collect();
            prompts.items.retain(|p| !abandoned.contains(&p.id));
            let hide = abandoned.iter().any(|id| take_shown(&mut prompts, id));
            if prompts.items.is_empty() {
                prompts.reaping = false;
                if hide {
                    drop(prompts);
                    toast::hide(&app);
                }
                return;
            }
            hide
        };
        if hide {
            toast::hide(&app);
        }
    }
}
