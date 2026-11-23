//! What one run of an action showed the person, kept for `glimpse actions
//! run|last` and the MCP tools. `glimpse` commands a script calls report to
//! its run through `GLIMPSE_RUN`.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};

const STDERR_LINES: usize = 20;
const STDERR_CHARS: usize = 4_000;
const OUTPUT_CHARS: usize = 4_000;
// Ended headless runs a late `glimpse` call can still name.
const ENDED_HEADLESS: usize = 64;

#[derive(Clone, Serialize)]
pub(crate) struct RunRecord {
    pub(crate) action: String,
    /// shortcut, say, event or run.
    pub(crate) trigger: &'static str,
    /// Spoken text went through the phrase matcher to get here.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(crate) routed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) phrase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) event: Option<String>,
    pub(crate) headless: bool,
    pub(crate) input_chars: usize,
    /// exited, timeout, stopped or not_started.
    pub(crate) ended: &'static str,
    pub(crate) exit_code: Option<i32>,
    pub(crate) ok: bool,
    /// From start to end, without the wait behind earlier runs.
    pub(crate) duration_ms: u64,
    pub(crate) waited_ms: u64,
    /// The trimmed stdout.
    pub(crate) output: String,
    /// In order.
    pub(crate) shown: Vec<Shown>,
    /// The last lines the script wrote to stderr.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) stderr: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Shown {
    Toast {
        #[serde(rename = "type")]
        toast_type: String,
        title: Option<String>,
        message: String,
    },
    Pill {
        text: String,
    },
    Insert {
        text: String,
        pasted: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        fallback_reason: Option<String>,
    },
    Ask {
        question: String,
        buttons: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        answer: Option<String>,
        skipped: bool,
    },
    Error {
        message: String,
    },
}

/// A run in progress.
pub(crate) struct Live {
    pub(crate) id: String,
    /// Shows nothing and types nothing; what would show is only recorded.
    pub(crate) headless: bool,
    insert: bool,
    /// The run whose script started this one.
    caller: Option<String>,
    /// Replies `glimpse ask` gets in a headless run, in order.
    answers: Mutex<VecDeque<String>>,
    record: Mutex<RunRecord>,
    created: Instant,
    began: Mutex<Option<Instant>>,
}

static LIVE: Mutex<Vec<Arc<Live>>> = Mutex::new(Vec::new());
static ENDED: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

impl Live {
    pub(crate) fn start(
        record: RunRecord,
        insert: bool,
        caller: Option<String>,
        answers: Vec<String>,
    ) -> Arc<Self> {
        let live = Arc::new(Self {
            id: uuid::Uuid::new_v4().to_string(),
            headless: record.headless,
            insert,
            caller,
            answers: Mutex::new(answers.into()),
            record: Mutex::new(record),
            created: Instant::now(),
            began: Mutex::new(None),
        });
        LIVE.lock().push(Arc::clone(&live));
        live
    }

    /// Its turn came after the earlier runs of the action.
    pub(crate) fn begin(&self) {
        *self.began.lock() = Some(Instant::now());
    }

    pub(crate) fn output(&self, stdout: &str) {
        self.record.lock().output = stdout.chars().take(OUTPUT_CHARS).collect();
    }

    pub(crate) fn note(&self, shown: Shown) {
        self.record.lock().shown.push(shown);
    }

    pub(crate) fn ended(&self, ended: &'static str, exit_code: Option<i32>, stderr: &str) {
        let mut record = self.record.lock();
        record.ended = ended;
        record.exit_code = exit_code;
        let lines: Vec<&str> = stderr.lines().collect();
        let tail = lines[lines.len().saturating_sub(STDERR_LINES)..].join("\n");
        let skip = tail.chars().count().saturating_sub(STDERR_CHARS);
        record.stderr = tail.chars().skip(skip).collect();
    }

    pub(crate) fn finish(&self) -> RunRecord {
        // Ended first, so a call that arrives in between is never shown.
        if self.headless {
            let mut ended = ENDED.lock();
            if ended.len() == ENDED_HEADLESS {
                ended.pop_front();
            }
            ended.push_back(self.id.clone());
        }
        LIVE.lock().retain(|live| live.id != self.id);
        let began = *self.began.lock();
        let mut record = self.record.lock().clone();
        record.ok = record.ended == "exited"
            && record.exit_code == Some(0)
            && !record
                .shown
                .iter()
                .any(|shown| matches!(shown, Shown::Error { .. }));
        record.waited_ms = began
            .unwrap_or_else(Instant::now)
            .duration_since(self.created)
            .as_millis() as u64;
        record.duration_ms = began.map_or(0, |began| began.elapsed().as_millis() as u64);
        record
    }
}

/// The live run `run` names. A headless run that has ended is an error, so
/// nothing it asks for late shows.
fn live(run: Option<&str>) -> Result<Option<Arc<Live>>, String> {
    let Some(run) = run else {
        return Ok(None);
    };
    if let Some(live) = LIVE.lock().iter().find(|live| live.id == run) {
        return Ok(Some(Arc::clone(live)));
    }
    if ENDED.lock().iter().any(|ended| ended == run) {
        return Err("The headless run that called this has ended.".to_string());
    }
    Ok(None)
}

/// Whether the run that called is headless, and whether it or a run that
/// started it is `action`.
pub(crate) fn caller(run: Option<&str>, action: &str) -> Result<(bool, bool), String> {
    let Some(first) = live(run)? else {
        return Ok((false, false));
    };
    let lives = LIVE.lock();
    let mut current = Some(first.id.clone());
    let mut recursive = false;
    while let Some(id) = current {
        let Some(live) = lives.iter().find(|live| live.id == id) else {
            break;
        };
        recursive |= live.record.lock().action == action;
        current = live.caller.clone();
    }
    Ok((first.headless, recursive))
}

/// Records a `glimpse toast` from a run. False when the run is headless and nothing shows.
pub(crate) fn toast(
    run: Option<&str>,
    toast_type: &str,
    title: Option<&str>,
    message: &str,
) -> Result<bool, String> {
    let Some(live) = live(run)? else {
        return Ok(true);
    };
    live.note(Shown::Toast {
        toast_type: toast_type.to_string(),
        title: title.map(str::to_string),
        message: message.to_string(),
    });
    Ok(!live.headless)
}

/// Shows `glimpse pill` text, which a headless run only records.
pub(crate) fn pill(
    run: Option<&str>,
    text: &str,
    show: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let live = live(run)?;
    match &live {
        Some(live) if live.headless => {
            if !live.insert {
                return Err(super::PILL_ONLY_INSERT.to_string());
            }
        }
        _ => show()?,
    }
    if let Some(live) = live {
        live.note(Shown::Pill {
            text: text.to_string(),
        });
    }
    Ok(())
}

/// Opens a `glimpse ask` question with `open`. A headless run answers at
/// once with its next reply instead, or skips without one.
pub(crate) fn ask(
    run: Option<&str>,
    question: &str,
    buttons: Vec<String>,
    open: impl FnOnce(Vec<String>) -> Result<Value, String>,
) -> Result<Value, String> {
    let Some(live) = live(run)? else {
        return open(buttons);
    };
    let (reply, answer) = if live.headless {
        crate::voice_prompt::check_question(question, &buttons)?;
        let answer = live.answers.lock().pop_front();
        let reply = match &answer {
            Some(answer) => json!({ "status": "answered", "answer": answer }),
            None => json!({ "status": "skipped" }),
        };
        (reply, answer)
    } else {
        (open(buttons.clone())?, None)
    };
    live.note(Shown::Ask {
        question: question.to_string(),
        buttons,
        skipped: live.headless && answer.is_none(),
        answer,
    });
    Ok(reply)
}

/// Records how the person answered the run's open question.
pub(crate) fn answered(run: Option<&str>, polled: &Value) {
    let Ok(Some(live)) = live(run) else {
        return;
    };
    let status = polled["status"].as_str().unwrap_or_default();
    if status == "waiting" {
        return;
    }
    let mut record = live.record.lock();
    if let Some(Shown::Ask {
        answer, skipped, ..
    }) = record.shown.iter_mut().rev().find(|shown| {
        matches!(
            shown,
            Shown::Ask {
                answer: None,
                skipped: false,
                ..
            }
        )
    }) {
        match polled["answer"].as_str().filter(|_| status == "answered") {
            Some(text) => *answer = Some(text.to_string()),
            None => *skipped = true,
        }
    }
}
