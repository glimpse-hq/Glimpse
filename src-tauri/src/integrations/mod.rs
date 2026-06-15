//! CLI integration layer: plain domain verbs for external tools (Raycast,
//! Shortcuts, Finder, scripts). Reads run headless against the local DBs;
//! mutations and transcription are routed to the running app over a control
//! socket ([`ipc`]/[`client`]/[`server`], answered in [`handlers`]).

mod api;
mod client;
mod dictionary;
mod handlers;
mod history;
mod ipc;
mod library;
mod model;
mod open;
mod output;
mod replacements;
mod server;
mod status;
mod transcribe;

pub(crate) use server::start as start_control_server;

use anyhow::{bail, Result};

/// Domain verbs owned by this layer. `models` and `serve` stay with
/// glimpse-speech and are intentionally absent; `transcribe` is shared and
/// delegates back to glimpse-speech when no Glimpse-specific flags are present.
const OWNED_COMMANDS: &[&str] = &[
    "history",
    "dictionary",
    "replacements",
    "model",
    "library",
    "open",
    "status",
    "api",
    "transcribe",
];

pub fn is_integration_command(verb: &str) -> bool {
    OWNED_COMMANDS.contains(&verb)
}

/// Front door for every integration command. `args` includes the leading verb.
/// Owns process exit: maps errors to the documented exit codes and prints
/// machine-readable errors in `--json` mode.
pub fn dispatch(identifier: &str, args: &[String]) -> Result<()> {
    let json = args.iter().any(|arg| arg == "--json");
    match run(identifier, args, json) {
        Ok(()) => Ok(()),
        Err(err) => {
            let code = err
                .downcast_ref::<CodedError>()
                .map(|coded| coded.code)
                .unwrap_or(1);
            if json {
                output::print_error_json(&err.to_string());
            } else {
                eprintln!("{err}");
            }
            std::process::exit(code);
        }
    }
}

fn run(identifier: &str, args: &[String], json: bool) -> Result<()> {
    let (verb, rest) = args
        .split_first()
        .expect("dispatch is only called with a leading verb");
    match verb.as_str() {
        "history" => history::run(identifier, rest, json),
        "dictionary" => dictionary::run(identifier, rest, json),
        "replacements" => replacements::run(identifier, rest, json),
        "model" => model::run(identifier, rest, json),
        "library" => library::run(identifier, rest, json),
        "open" => open::run(rest, json),
        "status" => status::run(json),
        "api" => api::run(rest, json),
        "transcribe" => transcribe::run(identifier, rest, json),
        other => bail!("Unknown command: {other}"),
    }
}

/// Error carrying a specific process exit code (see the integration spec).
/// 1 = user error, 2 = app unavailable, 3 = job failed, 4 = cancelled/timeout.
#[derive(Debug)]
pub(crate) struct CodedError {
    pub code: i32,
    pub message: String,
}

impl std::fmt::Display for CodedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CodedError {}

pub(crate) fn coded(code: i32, message: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(CodedError {
        code,
        message: message.into(),
    })
}

/// Open the transcriptions/library SQLite database headless (no running app).
pub(crate) fn open_storage(identifier: &str) -> Result<crate::storage::StorageManager> {
    let path = crate::settings::cli_data_dir(identifier)?.join("transcriptions.db");
    if !path.exists() {
        bail!("No Glimpse database found. Run Glimpse at least once first.");
    }
    crate::storage::StorageManager::new(path)
}

/// Returns true if the args request help for a subcommand.
pub(crate) fn wants_help(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "-h" || arg == "--help")
}

/// A token that looks like a flag (e.g. `--json`, `-x`) rather than a value.
fn looks_like_flag(value: &str) -> bool {
    value.starts_with("--") || (value.starts_with('-') && value.len() > 1)
}

/// The value following `flag`, or an error if it's missing or another flag.
fn flag_value<'a>(args: &'a [String], flag: &str) -> Result<Option<&'a str>> {
    let Some(idx) = args.iter().position(|arg| arg == flag) else {
        return Ok(None);
    };
    let value = args
        .get(idx + 1)
        .ok_or_else(|| anyhow::anyhow!("{flag} requires a value"))?;
    if looks_like_flag(value) {
        bail!("{flag} requires a value");
    }
    Ok(Some(value.as_str()))
}

/// Parse a `--flag <value>` integer option. Returns the default if absent.
pub(crate) fn usize_flag(args: &[String], flag: &str, default: usize) -> Result<usize> {
    match flag_value(args, flag)? {
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| anyhow::anyhow!("{flag} must be a non-negative integer")),
        None => Ok(default),
    }
}

/// Parse a `--flag <value>` string option. Errors if the value is missing or is
/// itself another flag; returns None only when the flag is absent.
pub(crate) fn str_flag<'a>(args: &'a [String], flag: &str) -> Result<Option<&'a str>> {
    flag_value(args, flag)
}

pub(crate) fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

/// Collect positional args (everything that isn't a flag or a flag's value).
pub(crate) fn positionals<'a>(args: &'a [String], value_flags: &[&str]) -> Vec<&'a String> {
    let mut out = Vec::new();
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if value_flags.contains(&arg.as_str()) {
            skip_next = true;
            continue;
        }
        if arg.starts_with("--") || (arg.starts_with('-') && arg.len() > 1) {
            continue;
        }
        out.push(arg);
    }
    out
}
