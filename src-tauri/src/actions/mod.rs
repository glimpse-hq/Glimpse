//! Actions: one script per file in the `actions` folder of the app data,
//! started by a shortcut, a spoken phrase or an app event. Header lines in
//! each file say when (`header.rs`); `run.rs` starts the script.

mod header;
mod record;
mod run;

pub(crate) use record::{
    RunRecord, answered as record_answer, ask as record_ask, pill as record_pill,
    toast as record_toast,
};

use std::cell::Cell;
use std::cmp::Reverse;
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio_util::sync::CancellationToken;

use crate::accessibility_context::ActiveContext;
use crate::core::hotkeys::{self, Hotkey, RegisteredHotkey, ShortcutAction, ShortcutOptions};
use crate::settings::UserSettings;
use crate::{AppRuntime, AppState, mode_context, toast};
use record::Shown;

pub(crate) const EVENT_CHANGED: &str = "actions:changed";
// Editors save in several steps; reload once they settle, or after a second
// while something keeps writing.
const SETTLE: Duration = Duration::from_millis(200);
const MAX_SETTLE: Duration = Duration::from_secs(1);
// Header lines sit at the top.
const HEADER_BYTES: u64 = 64 * 1024;
const ERROR_LINE_CHARS: usize = 300;
const ENV_KEYS: [&str; 7] = [
    "GLIMPSE_APP",
    "GLIMPSE_WINDOW_TITLE",
    "GLIMPSE_URL",
    "GLIMPSE_SELECTED_TEXT",
    "GLIMPSE_FIELD_TEXT",
    "GLIMPSE_LANGUAGE",
    "GLIMPSE_ID",
];
pub(crate) const PILL_ONLY_INSERT: &str = "The pill only shows text while an insert action runs.";

struct Action {
    name: String,
    file: String,
    path: PathBuf,
    header: header::Header,
    phrase_words: Vec<Vec<String>>,
    /// What keeps it from running.
    problems: Vec<String>,
}

impl Action {
    /// Without `env`, the login environment hasn't been read yet and a
    /// missing program shows up when the action runs.
    fn load(path: PathBuf, env: Option<&run::Env>) -> Option<Self> {
        let file = path.file_name()?.to_str()?.to_string();
        let name = path.file_stem()?.to_str()?.to_string();
        let mut content = Vec::new();
        let read = std::fs::File::open(&path)
            .and_then(|file| file.take(HEADER_BYTES).read_to_end(&mut content));
        let unreadable = match read {
            Err(err) => Some(format!("Can't read the file: {err}")),
            Ok(_) if content.starts_with(&[0xFF, 0xFE]) || content.starts_with(&[0xFE, 0xFF]) => {
                content.clear();
                Some("Save the file as UTF-8".to_string())
            }
            Ok(_) => None,
        };
        let header = header::parse(&String::from_utf8_lossy(&content));
        let mut problems = header.problems.clone();
        problems.extend(unreadable);
        if let Some(Err(problem)) =
            env.map(|env| run::program(&path, header.shebang.as_deref(), env))
        {
            problems.push(problem);
        }
        Some(Self {
            name,
            file,
            path,
            phrase_words: header
                .phrases
                .iter()
                .map(|phrase| header::words(phrase))
                .collect(),
            header,
            problems,
        })
    }

    fn has_filters(&self) -> bool {
        !self.header.apps.is_empty() || !self.header.sites.is_empty()
    }

    /// Whether the app and site lines allow running in `context`.
    fn fits(&self, context: Option<&ActiveContext>) -> bool {
        let header = &self.header;
        if !self.has_filters() {
            return true;
        }
        context.is_some_and(|context| {
            (header.apps.is_empty() || mode_context::any_app_matches(&header.apps, context))
                && (header.sites.is_empty()
                    || mode_context::any_site_matches(&header.sites, context))
        })
    }
}

#[derive(Default)]
struct State {
    data_dir: PathBuf,
    actions: Vec<Arc<Action>>,
    /// Whether a switched-on action has a phrase for Glimpse's own keys, so
    /// dictation can skip routing.
    own_phrases: bool,
    /// The registered keys, and whether each records before running.
    keys: Vec<(Hotkey, ShortcutAction, bool)>,
    last_failure: HashMap<String, String>,
    last_runs: HashMap<String, RunRecord>,
    queues: HashMap<String, Arc<Queue>>,
    watcher: Option<notify::RecommendedWatcher>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);
static HOLDS: Mutex<Vec<Arc<Hold>>> = Mutex::new(Vec::new());

fn folder() -> PathBuf {
    STATE.lock().data_dir.join("actions")
}

pub(crate) fn init(app: &AppHandle<AppRuntime>) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    STATE.lock().data_dir = data_dir.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = crate::cli_install::write_link(&data_dir.join("bin")) {
            tracing::warn!("Actions can't call glimpse: {err}");
        }
        let folder = folder();
        if let Err(err) = std::fs::create_dir_all(&folder) {
            tracing::warn!("Actions folder unavailable: {err}");
            return;
        }
        watch(&app, &folder);
        reload(&app);
    });
}

fn watch(app: &AppHandle<AppRuntime>, folder: &Path) {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(watcher) => watcher,
        Err(err) => {
            tracing::warn!("Can't watch the actions folder: {err}");
            return;
        }
    };
    if let Err(err) =
        notify::Watcher::watch(&mut watcher, folder, notify::RecursiveMode::NonRecursive)
    {
        tracing::warn!("Can't watch the actions folder: {err}");
        return;
    }
    STATE.lock().watcher = Some(watcher);
    let app = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let first = Instant::now();
            while first.elapsed() < MAX_SETTLE && rx.recv_timeout(SETTLE).is_ok() {}
            reload(&app);
            changed(&app);
        }
    });
}

fn changed(app: &AppHandle<AppRuntime>) {
    let _ = app.emit(EVENT_CHANGED, ());
}

fn reload(app: &AppHandle<AppRuntime>) {
    let env = run::cached_env();
    let mut actions: Vec<Action> = std::fs::read_dir(folder())
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !name.starts_with('.') && !name.ends_with('~'))
        })
        .filter_map(|path| Action::load(path, env.as_deref()))
        .collect();
    actions.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.file.cmp(&b.file))
    });
    let same = |a: &Action, b: &Action| a.name.to_lowercase() == b.name.to_lowercase();
    for index in 0..actions.len() {
        let shared = (index > 0 && same(&actions[index], &actions[index - 1]))
            || actions
                .get(index + 1)
                .is_some_and(|next| same(&actions[index], next));
        if shared {
            let problem = format!("Another file is also named {}", actions[index].name);
            actions[index].problems.push(problem);
        }
    }
    STATE.lock().actions = actions.into_iter().map(Arc::new).collect();
    refresh(app);
}

/// Updates what the triggers use after the actions or their switches change,
/// and registers the keys again when they differ.
fn refresh(app: &AppHandle<AppRuntime>) {
    let settings = app.state::<AppState>().current_settings_unmasked();
    let previous = STATE.lock().keys.clone();
    if previous != update_live(app, &settings) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::pill::dictation_ended(&app).await;
            if let Err(err) = crate::pill::register_shortcuts(&app) {
                tracing::error!("Failed to register shortcuts: {err}");
            }
        });
    }
}

struct Row {
    enabled: bool,
    problems: Vec<String>,
    shortcut_problems: Vec<Option<String>>,
}

struct Key {
    hotkey: Hotkey,
    behavior: ShortcutAction,
    listen: bool,
    /// Actions on this key, by name.
    members: Vec<usize>,
}

struct Resolved {
    rows: Vec<Row>,
    keys: Vec<Key>,
    /// (action, phrase) pairs that Glimpse's own keys listen for.
    own_phrases: Vec<(usize, usize)>,
}

/// Which actions own which keys and phrases, and what is wrong with each.
/// Only switched-on actions count unless `every`, which lists problems before
/// the switch is on. Actions come sorted by name, so the first by name wins.
fn resolve(actions: &[Arc<Action>], settings: &UserSettings, every: bool) -> Resolved {
    let own = own_hotkeys(settings);
    let mut rows: Vec<Row> = actions
        .iter()
        .map(|action| Row {
            enabled: settings.enabled_actions.contains(&action.file),
            problems: action.problems.clone(),
            shortcut_problems: action
                .header
                .shortcuts
                .iter()
                .map(|line| match line.hotkey {
                    None => Some(format!("{} isn't a shortcut Glimpse can use", line.text)),
                    Some(hotkey) if own.iter().any(|o| hotkeys::shortcuts_conflict(o, &hotkey)) => {
                        Some("Used by a Glimpse shortcut".to_string())
                    }
                    Some(_) => None,
                })
                .collect(),
        })
        .collect();
    let live: Vec<bool> = rows
        .iter()
        .zip(actions)
        .map(|(row, action)| (every || row.enabled) && action.problems.is_empty())
        .collect();
    let mut keys: Vec<Key> = Vec::new();
    let mut own_phrases = Vec::new();
    for (index, action) in actions.iter().enumerate().filter(|(index, _)| live[*index]) {
        for (line_index, line) in action.header.shortcuts.iter().enumerate() {
            let Some(hotkey) = line
                .hotkey
                .filter(|_| rows[index].shortcut_problems[line_index].is_none())
            else {
                continue;
            };
            if let Some(key) = keys.iter_mut().find(|key| key.hotkey == hotkey) {
                if (key.behavior, key.listen) != (line.behavior, action.header.listen) {
                    let first = &actions[key.members[0]].name;
                    note(
                        &mut rows[index].problems,
                        format!("{first} sets how {} works", line.text),
                    );
                }
                if !key.members.contains(&index) {
                    key.members.push(index);
                }
            } else if let Some(key) = keys
                .iter()
                .find(|key| hotkeys::shortcuts_conflict(&key.hotkey, &hotkey))
            {
                rows[index].shortcut_problems[line_index] =
                    Some(format!("Clashes with {}", actions[key.members[0]].name));
            } else {
                keys.push(Key {
                    hotkey,
                    behavior: line.behavior,
                    listen: action.header.listen,
                    members: vec![index],
                });
            }
        }
        if action.header.shortcuts.is_empty() {
            for (phrase_index, phrase) in action.header.phrases.iter().enumerate() {
                if action.phrase_words[phrase_index].len() < 2 {
                    note(
                        &mut rows[index].problems,
                        format!("\"{phrase}\" needs a second word, or a shortcut"),
                    );
                } else {
                    own_phrases.push((index, phrase_index));
                }
            }
        }
    }
    let scopes = std::iter::once(own_phrases.clone()).chain(keys.iter().map(|key| {
        key.members
            .iter()
            .flat_map(|&index| (0..actions[index].phrase_words.len()).map(move |p| (index, p)))
            .collect()
    }));
    for scope in scopes {
        for (at, &(a, p)) in scope.iter().enumerate() {
            for &(b, q) in &scope[at + 1..] {
                if a != b
                    && actions[a].phrase_words[p] == actions[b].phrase_words[q]
                    && same_filters(&actions[a], &actions[b])
                {
                    let phrase = &actions[a].header.phrases[p];
                    let (first, second) = (&actions[a].name, &actions[b].name);
                    note(
                        &mut rows[a].problems,
                        format!("\"{phrase}\" is also in {second}"),
                    );
                    note(
                        &mut rows[b].problems,
                        format!("\"{phrase}\" is also in {first}"),
                    );
                }
            }
        }
    }
    for (row, action) in rows.iter_mut().zip(actions) {
        for (line, problem) in action.header.shortcuts.iter().zip(&row.shortcut_problems) {
            if let Some(problem) = problem {
                note(&mut row.problems, format!("{}: {problem}", line.text));
            }
        }
    }
    Resolved {
        rows,
        keys,
        own_phrases,
    }
}

fn note(problems: &mut Vec<String>, problem: String) {
    if !problems.contains(&problem) {
        problems.push(problem);
    }
}

fn same_filters(a: &Action, b: &Action) -> bool {
    let set = |list: &[String]| {
        let mut set: Vec<String> = list.iter().map(|item| item.to_lowercase()).collect();
        set.sort();
        set.dedup();
        set
    };
    set(&a.header.apps) == set(&b.header.apps) && set(&a.header.sites) == set(&b.header.sites)
}

fn own_hotkeys(settings: &UserSettings) -> Vec<Hotkey> {
    let bindings = &settings.shortcut_bindings;
    [
        (settings.smart_enabled, &bindings.smart),
        (settings.hold_enabled, &bindings.hold),
        (settings.toggle_enabled, &bindings.toggle),
    ]
    .into_iter()
    .filter(|(enabled, _)| *enabled)
    .flat_map(|(_, list)| list.iter())
    .filter_map(|binding| hotkeys::parse_shortcut(&binding.shortcut).ok())
    .collect()
}

fn licensed(app: &AppHandle<AppRuntime>) -> Result<(), String> {
    crate::license::require_license_gate(&app.state::<AppState>().settings_store, "actions")
}

/// Stores whether Glimpse's own keys have phrases and returns the keys of
/// switched-on actions. Nothing is live without a license.
fn update_live(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> Vec<(Hotkey, ShortcutAction, bool)> {
    let actions = STATE.lock().actions.clone();
    let resolved = licensed(app)
        .is_ok()
        .then(|| resolve(&actions, settings, false));
    STATE.lock().own_phrases = resolved
        .as_ref()
        .is_some_and(|resolved| !resolved.own_phrases.is_empty());
    resolved
        .iter()
        .flat_map(|resolved| resolved.keys.iter())
        .map(|key| (key.hotkey, key.behavior, key.listen))
        .collect()
}

/// The keys of switched-on actions, after Glimpse's own shortcuts.
pub(crate) fn shortcut_bindings(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> Vec<RegisteredHotkey> {
    let keys = update_live(app, settings);
    let bindings = keys
        .iter()
        .map(|&(hotkey, action, _)| RegisteredHotkey {
            hotkey,
            action,
            options: ShortcutOptions {
                action_key: Some(hotkey),
                ..Default::default()
            },
        })
        .collect();
    STATE.lock().keys = keys;
    bindings
}

/// False for a key whose actions run on press, without dictation.
pub(crate) fn key_listens(key: Hotkey) -> bool {
    STATE
        .lock()
        .keys
        .iter()
        .find(|(hotkey, ..)| *hotkey == key)
        .is_none_or(|(.., listen)| *listen)
}

/// A running insert action.
#[derive(Default)]
struct Hold {
    /// Set by a shortcut press while the run holds the pill.
    stop: AtomicBool,
    /// The pill shows Processing for this run.
    pill: AtomicBool,
}

#[cfg(target_os = "macos")]
pub(crate) use run::kill_all as kill_scripts;

/// An insert action is running.
pub(crate) fn inserting() -> bool {
    !HOLDS.lock().is_empty()
}

/// An insert action holds the pill in Processing.
pub(crate) fn holds_pill() -> bool {
    HOLDS
        .lock()
        .iter()
        .any(|hold| hold.pill.load(Ordering::SeqCst))
}

/// A shortcut press stops the insert actions holding the pill. False when none does.
pub(crate) fn stop_holding() -> bool {
    let mut stopped = false;
    for hold in HOLDS.lock().iter() {
        if hold.pill.load(Ordering::SeqCst) {
            hold.stop.store(true, Ordering::SeqCst);
            stopped = true;
        }
    }
    stopped
}

struct Holding {
    app: AppHandle<AppRuntime>,
    hold: Arc<Hold>,
}

impl Holding {
    fn new(app: &AppHandle<AppRuntime>) -> Self {
        let hold = Arc::new(Hold::default());
        HOLDS.lock().push(Arc::clone(&hold));
        Self {
            app: app.clone(),
            hold,
        }
    }
}

impl Drop for Holding {
    fn drop(&mut self) {
        HOLDS.lock().retain(|hold| !Arc::ptr_eq(hold, &self.hold));
        crate::pill::collapse_expanded_pill(&self.app);
    }
}

/// How a run uses the pill.
#[derive(Clone, Copy, PartialEq)]
enum PillUse {
    None,
    /// The dictation it came from holds the pill.
    Dictation,
    /// A press or `actions run` without dictation; a press of this kind stops it.
    Press(Option<ShortcutAction>),
}

pub(crate) fn set_pill_text(app: &AppHandle<AppRuntime>, text: &str) -> Result<(), String> {
    if !holds_pill() {
        return Err(PILL_ONLY_INSERT.to_string());
    }
    crate::pill::emit_pill_mode(app, true, text);
    Ok(())
}

#[derive(Default)]
struct Queue {
    /// Tickets of the waiting runs and the running one, in arrival order. The front one runs.
    line: Mutex<VecDeque<u64>>,
    next: AtomicU64,
    /// Moves on when the action is stopped, which ends its run and every run waiting.
    generation: AtomicU64,
}

/// A place in the queue, given up on drop.
struct Turn {
    queue: Arc<Queue>,
    ticket: u64,
}

impl Drop for Turn {
    fn drop(&mut self) {
        self.queue
            .line
            .lock()
            .retain(|ticket| *ticket != self.ticket);
    }
}

fn queue(name: &str) -> Arc<Queue> {
    Arc::clone(STATE.lock().queues.entry(name.to_string()).or_default())
}

pub(crate) fn stop(name: &str) -> Result<(), String> {
    find(name)?;
    queue(name).generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

pub(crate) struct Run {
    action: Arc<Action>,
    /// shortcut, say, event or run.
    trigger: &'static str,
    stdin: String,
    vars: Vec<(&'static str, String)>,
    /// Spoken text went through the phrase matcher to get here.
    routed: bool,
    /// Shows nothing and types nothing; `answers` reply to `glimpse ask` in order.
    headless: bool,
    answers: Vec<String>,
    /// The run whose script asked for this one.
    caller: Option<String>,
    /// The History or Library item it is about.
    id: Option<String>,
    /// The app in front at the trigger; inserted output only goes there.
    app_name: Option<String>,
}

/// A dictation that went to actions instead of the cursor.
pub(crate) enum Routed {
    /// No action took it, and the person was told.
    Skipped,
    Ran(DictationRun),
}

/// An action a dictation went to, saved with the dictation.
pub(crate) struct DictationRun {
    action: Arc<Action>,
    id: Option<String>,
    /// A toast action, started once the dictation is saved so its id can be read.
    pending: Option<Box<Run>>,
}

impl DictationRun {
    pub(crate) fn name(&self) -> &str {
        &self.action.name
    }

    pub(crate) fn id(&self) -> Option<String> {
        self.id.clone()
    }

    pub(crate) fn start(self, app: &AppHandle<AppRuntime>) {
        if let Some(run) = self.pending {
            run.spawn(app);
        }
    }
}

impl Run {
    fn spawn(self, app: &AppHandle<AppRuntime>) {
        let app = app.clone();
        std::thread::spawn(move || {
            self.perform(&app, &|| false, PillUse::None);
        });
    }

    /// An insert action runs now, while the dictation holds the pill; a toast
    /// action waits for the dictation to be saved. None when the dictation was
    /// cancelled; a stopped action keeps it.
    pub(crate) async fn dictated(
        self,
        app: &AppHandle<AppRuntime>,
        cancel: Option<&CancellationToken>,
    ) -> Option<(bool, DictationRun)> {
        let (action, id) = (Arc::clone(&self.action), self.id.clone());
        if !action.header.insert {
            return Some((
                false,
                DictationRun {
                    action,
                    id,
                    pending: Some(Box::new(self)),
                },
            ));
        }
        let app = app.clone();
        let cancel = cancel.cloned();
        let pasted = tauri::async_runtime::spawn_blocking(move || {
            let cancelled = || cancel.as_ref().is_some_and(CancellationToken::is_cancelled);
            match self.perform(&app, &cancelled, PillUse::Dictation).0 {
                None if cancelled() => None,
                pasted => Some(pasted.unwrap_or(false)),
            }
        })
        .await
        .ok()
        .flatten()?;
        Some((
            pasted,
            DictationRun {
                action,
                id,
                pending: None,
            },
        ))
    }

    /// Waits for earlier runs of the same action, runs, shows the output, and
    /// keeps a record of what showed. Some(true) when the output was pasted,
    /// None when stopped.
    fn perform(
        &self,
        app: &AppHandle<AppRuntime>,
        cancelled: &dyn Fn() -> bool,
        pill: PillUse,
    ) -> (Option<bool>, RunRecord) {
        let var = |name: &str| {
            self.vars
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.clone())
        };
        let live = record::Live::start(
            RunRecord {
                action: self.action.name.clone(),
                trigger: self.trigger,
                routed: self.routed,
                phrase: var("GLIMPSE_PHRASE"),
                event: var("GLIMPSE_EVENT"),
                headless: self.headless,
                input_chars: self.stdin.chars().count(),
                ended: "not_started",
                exit_code: None,
                ok: false,
                duration_ms: 0,
                waited_ms: 0,
                output: String::new(),
                shown: Vec::new(),
                stderr: String::new(),
            },
            self.action.header.insert,
            self.caller.clone(),
            self.answers.clone(),
        );
        let pill = if self.headless { PillUse::None } else { pill };
        let result = self.run_and_show(app, cancelled, pill, &live);
        let record = live.finish();
        STATE
            .lock()
            .last_runs
            .insert(self.action.name.clone(), record.clone());
        (result, record)
    }

    /// An insert action holds the pill in Processing, and a press stops it.
    /// While its own question waits for an answer it lets go, so a press
    /// starts the answering dictation, and holds again once the question is gone.
    fn run_and_show(
        &self,
        app: &AppHandle<AppRuntime>,
        cancelled: &dyn Fn() -> bool,
        pill: PillUse,
        live: &record::Live,
    ) -> Option<bool> {
        let name = &self.action.name;
        if let Err(message) = licensed(app) {
            show_error(app, live, name, &message);
            return Some(false);
        }
        let env = self.env(&live.id);
        let program = match run::program(
            &self.action.path,
            self.action.header.shebang.as_deref(),
            &env,
        ) {
            Ok(program) => program,
            Err(problem) => {
                failed(app, live, name, problem);
                return Some(false);
            }
        };
        let queue = queue(name);
        let generation = queue.generation.load(Ordering::SeqCst);
        let stopped = || cancelled() || queue.generation.load(Ordering::SeqCst) != generation;
        let ticket = queue.next.fetch_add(1, Ordering::SeqCst);
        queue.line.lock().push_back(ticket);
        let _turn = Turn {
            queue: Arc::clone(&queue),
            ticket,
        };
        while queue.line.lock().front() != Some(&ticket) {
            if stopped() {
                live.ended("stopped", None, "");
                return None;
            }
            std::thread::sleep(run::POLL);
        }
        live.begin();

        let state = app.state::<AppState>();
        let holding =
            (self.action.header.insert && pill != PillUse::None).then(|| Holding::new(app));
        let origin = match pill {
            PillUse::Press(origin) => origin,
            _ => state.pill().shortcut_origin(),
        };
        // Whether this run took the pill itself, and so hands it back.
        let owned = Cell::new(false);
        let released = Cell::new(false);
        if let Some(holding) = &holding {
            let held = match pill {
                PillUse::Press(origin) => state.pill().hold_for_action(app, origin),
                _ => true,
            };
            holding.hold.pill.store(held, Ordering::SeqCst);
            owned.set(held && pill != PillUse::Dictation);
        }
        let watch = || {
            if let Some(holding) = &holding {
                let hold = &holding.hold;
                if hold.stop.load(Ordering::SeqCst) {
                    return true;
                }
                let asking = crate::voice_prompt::question_open(name);
                if asking && hold.pill.load(Ordering::SeqCst) {
                    if state.pill().release_hold(app) {
                        hold.pill.store(false, Ordering::SeqCst);
                        released.set(true);
                    }
                } else if !asking && released.get() && state.pill().hold_for_action(app, origin) {
                    hold.pill.store(true, Ordering::SeqCst);
                    released.set(false);
                    owned.set(true);
                }
            }
            stopped()
        };

        let started = Instant::now();
        let ended = if watch() {
            run::Ended::Stopped
        } else {
            run::execute(
                &program,
                &self.action.path,
                &env,
                self.stdin.clone(),
                self.action.header.timeout,
                &watch,
            )
        };
        match &ended {
            run::Ended::Exited { code, stderr, .. } => live.ended("exited", *code, stderr),
            run::Ended::TimedOut => live.ended("timeout", None, ""),
            run::Ended::Stopped => live.ended("stopped", None, ""),
            run::Ended::Failed(_) => {}
        }
        let outcome = match &ended {
            run::Ended::Exited { code, .. } => {
                code.map_or("signal".to_string(), |code| code.to_string())
            }
            run::Ended::TimedOut => "timeout".to_string(),
            run::Ended::Stopped => "stopped".to_string(),
            run::Ended::Failed(_) => "failed to start".to_string(),
        };
        tracing::info!(
            "Action {name} ended ({outcome}) in {} ms",
            started.elapsed().as_millis()
        );
        let result = match ended {
            run::Ended::Stopped => None,
            run::Ended::TimedOut => {
                let seconds = self.action.header.timeout.unwrap_or_default().as_secs();
                failed(
                    app,
                    live,
                    name,
                    toast::native_format(
                        app,
                        "native.toast.action_timed_out",
                        &[("seconds", &seconds.to_string())],
                    ),
                );
                Some(false)
            }
            run::Ended::Failed(message) => {
                failed(app, live, name, message);
                Some(false)
            }
            run::Ended::Exited {
                success: false,
                code,
                stderr,
                ..
            } => {
                let last_line = stderr
                    .lines()
                    .map(str::trim)
                    .rfind(|line| !line.is_empty())
                    .map(|line| match line.char_indices().nth(ERROR_LINE_CHARS) {
                        Some((at, _)) => format!("{}…", &line[..at]),
                        None => line.to_string(),
                    });
                failed(
                    app,
                    live,
                    name,
                    last_line.unwrap_or_else(|| match code {
                        Some(code) => format!("Exited with code {code}"),
                        None => "Ended by a signal".to_string(),
                    }),
                );
                Some(false)
            }
            run::Ended::Exited { stdout: None, .. } => {
                failed(app, live, name, "Output is over 1 MB.".to_string());
                Some(false)
            }
            run::Ended::Exited {
                stdout: Some(stdout),
                ..
            } => {
                if !live.headless {
                    succeeded(app, name);
                }
                live.output(stdout.trim());
                Some(self.deliver(app, live, stdout.trim()))
            }
        };
        if owned.get()
            && holding
                .as_ref()
                .is_some_and(|holding| holding.hold.pill.load(Ordering::SeqCst))
        {
            state.pill().finish_processing(app);
        }
        result
    }

    fn deliver(&self, app: &AppHandle<AppRuntime>, live: &record::Live, output: &str) -> bool {
        if output.is_empty() {
            return false;
        }
        let insert = self.action.header.insert;
        if live.headless {
            live.note(if insert {
                Shown::Insert {
                    text: output.to_string(),
                    pasted: false,
                    fallback_reason: None,
                }
            } else {
                Shown::Toast {
                    toast_type: "info".to_string(),
                    title: Some(self.action.name.clone()),
                    message: output.to_string(),
                }
            });
            return false;
        }
        if insert {
            let fallback_reason = if self.app_name.is_none()
                || mode_context::active_context().map(|context| context.app_name) != self.app_name
            {
                "The app in front changed".to_string()
            } else {
                match crate::assistive::paste_text(output) {
                    Ok(()) => {
                        live.note(Shown::Insert {
                            text: output.to_string(),
                            pasted: true,
                            fallback_reason: None,
                        });
                        return true;
                    }
                    Err(err) => format!("Pasting failed: {err}"),
                }
            };
            live.note(Shown::Insert {
                text: output.to_string(),
                pasted: false,
                fallback_reason: Some(fallback_reason),
            });
        } else {
            live.note(Shown::Toast {
                toast_type: "info".to_string(),
                title: Some(self.action.name.clone()),
                message: output.to_string(),
            });
        }
        toast::emit_toast(
            app,
            toast::Payload {
                toast_type: "info".to_string(),
                title: Some(self.action.name.clone()),
                message: output.to_string(),
                auto_dismiss: Some(true),
                // Long enough to read the answer.
                duration: Some((1_000 + 60 * output.chars().count() as u64).clamp(3_000, 15_000)),
                ..Default::default()
            },
        );
        false
    }

    fn env(&self, run_id: &str) -> run::Env {
        let data_dir = STATE.lock().data_dir.clone();
        let mut env = run::env().as_ref().clone();
        let path: Vec<PathBuf> = std::iter::once(data_dir.join("bin"))
            .chain(
                run::get_var(&env, "PATH")
                    .map(|path| std::env::split_paths(path).collect::<Vec<_>>())
                    .unwrap_or_default(),
            )
            .collect();
        if let Ok(path) = std::env::join_paths(path) {
            run::set_var(&mut env, "PATH", path);
        }
        if run::get_var(&env, "LANG").is_none() {
            run::set_var(&mut env, "LANG", "en_US.UTF-8".into());
        }
        run::set_var(&mut env, "PYTHONUTF8", "1".into());
        // Names the action on `glimpse ask` questions.
        run::set_var(&mut env, "GLIMPSE_CLIENT", self.action.name.clone().into());
        let state_dir = data_dir.join("action-state").join(&self.action.name);
        let _ = std::fs::create_dir_all(&state_dir);
        run::set_var(&mut env, "GLIMPSE_STATE_DIR", state_dir.into_os_string());
        if let Some(id) = &self.id {
            run::set_var(&mut env, "GLIMPSE_ID", id.into());
        }
        run::set_var(&mut env, "GLIMPSE_RUN", run_id.into());
        if self.headless {
            run::set_var(&mut env, "GLIMPSE_HEADLESS", "1".into());
        }
        // `Glimpse` or `GLIMPSE.EXE` from a script would start the app instead of the CLI.
        #[cfg(target_os = "windows")]
        run::set_var(&mut env, "GLIMPSE_CLI_SHIM", "1".into());
        if let Ok(exe) = std::env::current_exe() {
            run::set_var(&mut env, "GLIMPSE_APP_EXECUTABLE", exe.into_os_string());
        }
        for (name, value) in &self.vars {
            // A NUL can't be passed in an environment variable.
            run::set_var(&mut env, name, value.replace('\0', "").into());
        }
        env
    }
}

fn show_error(app: &AppHandle<AppRuntime>, live: &record::Live, name: &str, message: &str) {
    live.note(Shown::Error {
        message: message.to_string(),
    });
    if live.headless {
        return;
    }
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "error".to_string(),
            title: Some(name.to_string()),
            message: message.to_string(),
            ..Default::default()
        },
    );
}

fn failed(app: &AppHandle<AppRuntime>, live: &record::Live, name: &str, message: String) {
    show_error(app, live, name, &message);
    if !live.headless {
        STATE.lock().last_failure.insert(name.to_string(), message);
        changed(app);
    }
}

fn succeeded(app: &AppHandle<AppRuntime>, name: &str) {
    if STATE.lock().last_failure.remove(name).is_some() {
        changed(app);
    }
}

/// The language and where the person was. The selection and field are read
/// only for triggers they work in, after an action matched.
fn trigger_vars(
    settings: &UserSettings,
    detected_language: Option<String>,
    context: Option<&ActiveContext>,
    selected: Option<String>,
    read_text: bool,
) -> Vec<(&'static str, String)> {
    let mut vars = Vec::new();
    let chosen = settings.language.trim();
    let language = detected_language.or_else(|| {
        (!chosen.is_empty() && !chosen.eq_ignore_ascii_case("auto")).then(|| chosen.to_string())
    });
    if let Some(language) = language {
        vars.push(("GLIMPSE_LANGUAGE", language));
    }
    if let Some(context) = context {
        vars.push(("GLIMPSE_APP", context.app_name.clone()));
        vars.push(("GLIMPSE_WINDOW_TITLE", context.window_title.clone()));
        if let Some(url) = &context.url {
            vars.push(("GLIMPSE_URL", url.clone()));
        }
    }
    if read_text {
        // Never by copying: Cmd+C beeps when nothing is selected, and Ctrl+C
        // stops a terminal program.
        let selected = selected.or_else(crate::assistive::selected_text_without_copy);
        if let Some(text) = selected {
            vars.push(("GLIMPSE_SELECTED_TEXT", text));
        }
        if let Some(field) = crate::assistive::focused_text_snapshot() {
            vars.push(("GLIMPSE_FIELD_TEXT", field.value));
        }
    }
    vars
}

pub(crate) struct DictationTrigger<'a> {
    /// The action key that recorded it, or None for Glimpse's own keys.
    pub(crate) key: Option<Hotkey>,
    pub(crate) temporary: bool,
    pub(crate) audio_path: &'a Path,
}

pub(crate) enum Route {
    /// Not for an action: normal dictation.
    Dictate,
    /// Nothing to run, and the person was told.
    Skip,
    Run(Run),
}

struct Dictated {
    key: Option<Hotkey>,
    temporary: bool,
    audio_path: PathBuf,
    raw: String,
    language: Option<String>,
    context: Option<ActiveContext>,
    selected: Option<String>,
}

/// Finds the action a dictation goes to. Without an action key and without
/// phrases for Glimpse's own keys this returns at once.
pub(crate) async fn route_dictation(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
    trigger: &DictationTrigger<'_>,
    raw: &str,
    language: Option<&str>,
    context: Option<&ActiveContext>,
    selected: Option<&str>,
) -> Route {
    if trigger.key.is_none() && !STATE.lock().own_phrases {
        return Route::Dictate;
    }
    let dictated = Dictated {
        key: trigger.key,
        temporary: trigger.temporary,
        audio_path: trigger.audio_path.to_path_buf(),
        raw: raw.to_string(),
        language: language.map(str::to_string),
        context: context.cloned(),
        selected: selected.map(str::to_string),
    };
    let (app, settings) = (app.clone(), settings.clone());
    tauri::async_runtime::spawn_blocking(move || route(&app, &settings, dictated))
        .await
        .unwrap_or(Route::Dictate)
}

struct Matched {
    index: usize,
    phrase: Option<usize>,
    stdin: String,
}

/// The phrases and actions of `key`, or of Glimpse's own keys without one.
fn scope(
    actions: &[Arc<Action>],
    resolved: &Resolved,
    key: Option<&Key>,
) -> (Vec<(usize, usize)>, Vec<usize>) {
    match key {
        None => (resolved.own_phrases.clone(), Vec::new()),
        Some(key) => (
            key.members
                .iter()
                .flat_map(|&index| (0..actions[index].phrase_words.len()).map(move |p| (index, p)))
                .collect(),
            key.members.clone(),
        ),
    }
}

/// The action spoken `text` goes to: the longest matching phrase, with an app
/// or site filter breaking a tie, else an action of `members` without
/// phrases. `context` is read only when there is something to check it against.
fn match_text(
    actions: &[Arc<Action>],
    phrases: &[(usize, usize)],
    members: &[usize],
    text: &str,
    context: impl FnOnce() -> Option<ActiveContext>,
) -> (Option<Matched>, Option<ActiveContext>) {
    let spans: Vec<_> = header::word_spans(text).collect();
    let words: Vec<String> = spans
        .iter()
        .map(|span| text[span.clone()].to_lowercase())
        .collect();
    let mut matched: Vec<(usize, usize, usize)> = phrases
        .iter()
        .filter_map(|&(index, p)| {
            header::phrase_end(&spans, &words, &actions[index].phrase_words[p])
                .map(|end| (index, p, end))
        })
        .collect();
    if matched.is_empty() && members.is_empty() {
        return (None, None);
    }
    matched.sort_by_key(|&(index, _, end)| (Reverse(end), !actions[index].has_filters(), index));
    let context = context();
    let picked = matched
        .iter()
        .find(|&&(index, ..)| actions[index].fits(context.as_ref()))
        .map(|&(index, p, end)| Matched {
            index,
            phrase: Some(p),
            stdin: text[end..]
                .trim_start_matches(|c: char| {
                    c.is_whitespace()
                        || matches!(
                            c,
                            ',' | '.'
                                | ':'
                                | ';'
                                | '!'
                                | '?'
                                | '-'
                                | '\u{0964}'
                                | '\u{0965}'
                                | '\u{3001}'
                                | '\u{3002}'
                                | '\u{FF0C}'
                                | '\u{FF1A}'
                        )
                })
                .to_string(),
        })
        .or_else(|| {
            members
                .iter()
                .find(|&&index| {
                    actions[index].header.phrases.is_empty()
                        && actions[index].fits(context.as_ref())
                })
                .map(|&index| Matched {
                    index,
                    phrase: None,
                    stdin: text.to_string(),
                })
        });
    (picked, context)
}

fn route(app: &AppHandle<AppRuntime>, settings: &UserSettings, dictated: Dictated) -> Route {
    if dictated.key.is_none() && licensed(app).is_err() {
        return Route::Dictate;
    }
    let actions = STATE.lock().actions.clone();
    let resolved = resolve(&actions, settings, false);
    let text = crate::dictionary::apply_replacements(&dictated.raw, &settings.replacements);
    let key = dictated
        .key
        .and_then(|hotkey| resolved.keys.iter().find(|key| key.hotkey == hotkey));
    let (phrases, members) = scope(&actions, &resolved, key);
    let given = dictated.context;
    let (picked, context) = match_text(&actions, &phrases, &members, &text, || {
        given.or_else(mode_context::active_context)
    });
    let Some(matched) = picked else {
        if dictated.key.is_none() {
            return Route::Dictate;
        }
        let message = toast::native_format(
            app,
            "native.toast.action_no_match",
            &[("text", text.trim())],
        );
        toast::show(app, "info", None, &message);
        return Route::Skip;
    };
    let action = Arc::clone(&actions[matched.index]);
    let mut vars = Vec::new();
    if let Some(p) = matched.phrase {
        vars.push(("GLIMPSE_PHRASE", action.header.phrases[p].clone()));
    }
    if !dictated.temporary {
        vars.push((
            "GLIMPSE_AUDIO_FILE",
            dictated.audio_path.display().to_string(),
        ));
    }
    vars.extend(trigger_vars(
        settings,
        dictated.language,
        context.as_ref(),
        dictated.selected,
        true,
    ));
    Route::Run(Run {
        action,
        trigger: if matched.phrase.is_some() {
            "say"
        } else {
            "shortcut"
        },
        stdin: matched.stdin,
        vars,
        routed: false,
        headless: false,
        answers: Vec::new(),
        caller: None,
        id: (!dictated.temporary).then(|| uuid::Uuid::new_v4().to_string()),
        app_name: context.map(|context| context.app_name),
    })
}

/// A press of a key whose actions run without dictation.
pub(crate) fn press(app: &AppHandle<AppRuntime>, key: Hotkey, origin: ShortcutAction) {
    let app = app.clone();
    std::thread::spawn(move || {
        let settings = app.state::<AppState>().current_settings_unmasked();
        let actions = STATE.lock().actions.clone();
        let resolved = resolve(&actions, &settings, false);
        let context = mode_context::active_context();
        let Some(&index) = resolved
            .keys
            .iter()
            .find(|candidate| candidate.hotkey == key)
            .and_then(|key| {
                key.members
                    .iter()
                    .find(|&&index| actions[index].fits(context.as_ref()))
            })
        else {
            let message = toast::native_format(
                &app,
                "native.toast.action_no_match",
                &[("text", &key.to_string())],
            );
            toast::show(&app, "info", None, &message);
            return;
        };
        let run = Run {
            action: Arc::clone(&actions[index]),
            trigger: "shortcut",
            stdin: String::new(),
            vars: trigger_vars(&settings, None, context.as_ref(), None, true),
            routed: false,
            headless: false,
            answers: Vec::new(),
            caller: None,
            id: None,
            app_name: context.map(|context| context.app_name),
        };
        run.perform(&app, &|| false, PillUse::Press(Some(origin)));
    });
}

/// What `glimpse actions run` and the MCP `run_action` ask for.
pub(crate) struct RunInput {
    pub(crate) name: Option<String>,
    pub(crate) text: String,
    pub(crate) headless: bool,
    pub(crate) answers: Vec<String>,
    /// Spoken text to route through the phrases, as a dictation on `key` or
    /// on Glimpse's own keys.
    pub(crate) say: Option<String>,
    pub(crate) key: Option<String>,
    pub(crate) event: Option<String>,
    /// Stands in for what Glimpse would read, like GLIMPSE_APP.
    pub(crate) env: Vec<(String, String)>,
    /// The run whose script asked, from its `GLIMPSE_RUN`.
    pub(crate) caller: Option<String>,
}

/// `glimpse actions run`: runs an action as its trigger would and waits for
/// it. The switch only turns triggers on, so this works when it's off.
pub(crate) fn run_named(app: &AppHandle<AppRuntime>, input: RunInput) -> Result<RunRecord, String> {
    licensed(app)?;
    if let Some((key, _)) = input
        .env
        .iter()
        .find(|(key, _)| !ENV_KEYS.contains(&key.as_str()))
    {
        return Err(format!(
            "{key} can't be set. Use one of {}.",
            ENV_KEYS.join(", ")
        ));
    }
    if let Some(event) = &input.event
        && !header::EVENTS.contains(&event.as_str())
    {
        return Err(format!("Unknown event {event}"));
    }
    reload(app);
    let settings = app.state::<AppState>().current_settings_unmasked();
    let (caller_headless, _) = record::caller(input.caller.as_deref(), "")?;
    // A headless run never reads the app in front or the selection: they
    // are the agent's, so only `env` gives them.
    let headless = input.headless || caller_headless;
    let given = |name: &str| {
        input
            .env
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let context = match (given("GLIMPSE_APP"), given("GLIMPSE_URL")) {
        (None, None) if !headless => mode_context::active_context(),
        (None, None) => None,
        (app_name, url) => Some(ActiveContext {
            app_name: app_name.unwrap_or_default(),
            other_names: Vec::new(),
            window_title: given("GLIMPSE_WINDOW_TITLE").unwrap_or_default(),
            url,
        }),
    };
    let mut vars = Vec::new();
    let (action, stdin, trigger) = match &input.say {
        Some(said) => {
            let actions = STATE.lock().actions.clone();
            let resolved = resolve(&actions, &settings, true);
            let text = crate::dictionary::apply_replacements(said, &settings.replacements);
            let key = match &input.key {
                Some(shortcut) => {
                    let hotkey =
                        hotkeys::parse_shortcut(shortcut).map_err(|err| err.to_string())?;
                    Some(
                        resolved
                            .keys
                            .iter()
                            .find(|key| key.hotkey == hotkey)
                            .ok_or_else(|| format!("No action has the shortcut {shortcut}"))?,
                    )
                }
                None => None,
            };
            let (phrases, members) = scope(&actions, &resolved, key);
            let (picked, _) = match_text(&actions, &phrases, &members, &text, || context.clone());
            let Some(matched) = picked else {
                return Err(toast::native_format(
                    app,
                    "native.toast.action_no_match",
                    &[("text", text.trim())],
                ));
            };
            let action = Arc::clone(&actions[matched.index]);
            if let Some(name) = input.name.as_ref().filter(|name| **name != action.name) {
                return Err(format!("\"{said}\" goes to {}, not {name}", action.name));
            }
            if let Some(p) = matched.phrase {
                vars.push(("GLIMPSE_PHRASE", action.header.phrases[p].clone()));
            }
            let trigger = if matched.phrase.is_some() {
                "say"
            } else {
                "shortcut"
            };
            (action, matched.stdin, trigger)
        }
        None => {
            let name = input
                .name
                .as_deref()
                .ok_or("Pass the action's name, or say.")?;
            let trigger = if input.event.is_some() {
                "event"
            } else {
                "run"
            };
            (find(name)?, input.text, trigger)
        }
    };
    if let Some(problem) = action.problems.first() {
        return Err(problem.clone());
    }
    if record::caller(input.caller.as_deref(), &action.name)?.1 {
        return Err(format!("{} can't run itself.", action.name));
    }
    if let Some(event) = input.event {
        vars.push(("GLIMPSE_EVENT", event));
    }
    // Not the selection or field: the terminal or agent is in front.
    vars.extend(trigger_vars(&settings, None, context.as_ref(), None, false));
    vars.extend(input.env.into_iter().filter_map(|(key, value)| {
        ENV_KEYS
            .iter()
            .find(|allowed| **allowed == key)
            .map(|allowed| (*allowed, value))
    }));
    let run = Run {
        action,
        trigger,
        stdin,
        vars,
        routed: input.say.is_some(),
        headless,
        answers: input.answers,
        caller: input.caller,
        id: None,
        app_name: context.map(|context| context.app_name),
    };
    Ok(run.perform(app, &|| false, PillUse::Press(None)).1)
}

/// The last run of the action, from any trigger.
pub(crate) fn last_run(name: &str) -> Result<RunRecord, String> {
    find(name)?;
    STATE
        .lock()
        .last_runs
        .get(name)
        .cloned()
        .ok_or_else(|| format!("{name} hasn't run since Glimpse started."))
}

/// Runs the switched-on actions with an `@glimpse.on` line for `event`.
pub(crate) fn fire_event(app: &AppHandle<AppRuntime>, event: &'static str, id: &str) {
    let listeners: Vec<Arc<Action>> = STATE
        .lock()
        .actions
        .iter()
        .filter(|action| action.header.events.iter().any(|on| on == event))
        .cloned()
        .collect();
    if listeners.is_empty() {
        return;
    }
    let app = app.clone();
    let id = id.to_string();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let settings = state.current_settings_unmasked();
        let listeners: Vec<Arc<Action>> = listeners
            .into_iter()
            .filter(|action| {
                settings.enabled_actions.contains(&action.file) && action.problems.is_empty()
            })
            .collect();
        if listeners.is_empty() || licensed(&app).is_err() {
            return;
        }
        let (audio_path, stdin) = if event == "dictation.saved" {
            match state.storage().get_by_id(&id) {
                Some(record) => (Some(record.audio_path), record.text),
                None => (None, String::new()),
            }
        } else {
            match state.storage().get_library_item(&id) {
                Ok(Some(item)) => (
                    Some(item.audio_path),
                    if event == "library.complete" {
                        item.transcript.unwrap_or_default()
                    } else {
                        String::new()
                    },
                ),
                _ => (None, String::new()),
            }
        };
        let context = mode_context::active_context();
        for action in listeners
            .into_iter()
            .filter(|action| action.fits(context.as_ref()))
        {
            let mut vars = vec![("GLIMPSE_EVENT", event.to_string())];
            if let Some(path) = audio_path.as_ref().filter(|path| !path.is_empty()) {
                vars.push(("GLIMPSE_AUDIO_FILE", path.clone()));
            }
            vars.extend(trigger_vars(&settings, None, context.as_ref(), None, false));
            Run {
                action,
                trigger: "event",
                stdin: stdin.clone(),
                vars,
                routed: false,
                headless: false,
                answers: Vec::new(),
                caller: None,
                id: Some(id.clone()),
                app_name: context.as_ref().map(|context| context.app_name.clone()),
            }
            .spawn(&app);
        }
    });
}

#[derive(Serialize)]
pub(crate) struct ActionList {
    folder: String,
    actions: Vec<ActionInfo>,
}

#[derive(Serialize)]
struct ActionInfo {
    name: String,
    file: String,
    description: Option<String>,
    enabled: bool,
    shortcuts: Vec<ShortcutInfo>,
    phrases: Vec<String>,
    events: Vec<String>,
    show: &'static str,
    listen: bool,
    problems: Vec<String>,
    last_failure: Option<String>,
}

#[derive(Serialize)]
struct ShortcutInfo {
    shortcut: String,
    behavior: &'static str,
    problem: Option<String>,
}

/// Rereads the folder, and with `refresh` the login environment, then lists every action.
pub(crate) fn list(app: &AppHandle<AppRuntime>, refresh: bool) -> ActionList {
    if refresh {
        run::refresh_env();
    }
    reload(app);
    let settings = app.state::<AppState>().current_settings_unmasked();
    let state = STATE.lock();
    let resolved = resolve(&state.actions, &settings, true);
    let actions = state
        .actions
        .iter()
        .zip(resolved.rows)
        .map(|(action, row)| ActionInfo {
            name: action.name.clone(),
            file: action.file.clone(),
            enabled: row.enabled,
            shortcuts: action
                .header
                .shortcuts
                .iter()
                .zip(row.shortcut_problems)
                .map(|(line, problem)| ShortcutInfo {
                    shortcut: line.text.clone(),
                    behavior: header::behavior_name(line.behavior),
                    problem,
                })
                .collect(),
            description: action.header.description.clone(),
            phrases: action.header.phrases.clone(),
            events: action.header.events.clone(),
            show: if action.header.insert {
                "insert"
            } else {
                "toast"
            },
            listen: action.header.listen,
            problems: row.problems,
            last_failure: state.last_failure.get(&action.name).cloned(),
        })
        .collect();
    ActionList {
        folder: state.data_dir.join("actions").display().to_string(),
        actions,
    }
}

fn find(name: &str) -> Result<Arc<Action>, String> {
    STATE
        .lock()
        .actions
        .iter()
        .find(|action| action.name == name)
        .cloned()
        .ok_or_else(|| format!("No action named {name}"))
}

fn find_file(file: &str) -> Result<Arc<Action>, String> {
    STATE
        .lock()
        .actions
        .iter()
        .find(|action| action.file == file)
        .cloned()
        .ok_or_else(|| format!("No action file named {file}"))
}

#[tauri::command]
pub async fn list_actions(refresh: bool, app: AppHandle<AppRuntime>) -> Result<ActionList, String> {
    tauri::async_runtime::spawn_blocking(move || list(&app, refresh))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_action_enabled(
    file: String,
    enabled: bool,
    app: AppHandle<AppRuntime>,
) -> Result<(), String> {
    if enabled {
        licensed(&app)?;
    }
    find_file(&file)?;
    app.state::<AppState>()
        .persist_settings_with(|_, next| {
            next.enabled_actions.retain(|enabled| *enabled != file);
            if enabled {
                next.enabled_actions.push(file.clone());
            }
        })
        .map_err(|err| err.to_string())?;
    refresh(&app);
    changed(&app);
    Ok(())
}

/// Rewrites the `index`th `@glimpse.shortcut` line of the action's file.
#[tauri::command]
pub fn set_action_shortcut(
    file: String,
    index: usize,
    shortcut: String,
    behavior: String,
    app: AppHandle<AppRuntime>,
) -> Result<(), String> {
    let behavior_word = match behavior.as_str() {
        "smart" | "hold" | "toggle" => behavior.as_str(),
        _ => return Err(format!("Unknown behavior {behavior}")),
    };
    let hotkey = hotkeys::parse_shortcut(&shortcut).map_err(|err| err.to_string())?;
    hotkeys::validate_recording_shortcut(&hotkey).map_err(|err| err.to_string())?;
    let settings = app.state::<AppState>().current_settings_unmasked();
    if own_hotkeys(&settings)
        .iter()
        .any(|own| hotkeys::shortcuts_conflict(own, &hotkey))
    {
        return Err("Used by a Glimpse shortcut".to_string());
    }
    let action = find_file(&file)?;
    let actions = STATE.lock().actions.clone();
    let resolved = resolve(&actions, &settings, false);
    let clash = resolved
        .keys
        .iter()
        .filter(|key| key.hotkey != hotkey && hotkeys::shortcuts_conflict(&key.hotkey, &hotkey))
        .flat_map(|key| key.members.iter())
        .map(|&member| &actions[member])
        .find(|member| member.file != file);
    if let Some(other) = clash {
        return Err(format!("Clashes with {}", other.name));
    }
    let mut content = std::fs::read_to_string(&action.path).map_err(|err| err.to_string())?;
    let parsed = header::parse(&content);
    let line = parsed
        .shortcuts
        .get(index)
        .ok_or_else(|| format!("{} has no shortcut line {}", action.name, index + 1))?;
    let value = if behavior_word == "smart" && !line.has_behavior_word {
        shortcut
    } else {
        format!("{shortcut} {behavior_word}")
    };
    content.replace_range(line.value.clone(), &value);
    std::fs::write(&action.path, content).map_err(|err| err.to_string())?;
    reload(&app);
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn open_actions_folder(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let folder = folder();
    if !folder.is_dir() {
        std::fs::create_dir_all(&folder).map_err(|err| err.to_string())?;
        watch(&app, &folder);
        reload(&app);
        changed(&app);
    }
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Moves the script to the Trash and forgets its switch, so a new file with
/// the same name starts off.
#[tauri::command]
pub fn trash_action_file(file: String, app: AppHandle<AppRuntime>) -> Result<(), String> {
    crate::platform::move_to_trash(&find_file(&file)?.path).map_err(|err| err.to_string())?;
    app.state::<AppState>()
        .persist_settings_with(|_, next| next.enabled_actions.retain(|enabled| *enabled != file))
        .map_err(|err| err.to_string())?;
    reload(&app);
    changed(&app);
    Ok(())
}

/// Shows the script in Finder or File Explorer, since opening it with its
/// default app can run it.
#[tauri::command]
pub fn reveal_action_file(file: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&find_file(&file)?.path).map_err(|err| err.to_string())
}
