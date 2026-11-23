//! Commands for action scripts: `toast`, `pill`, `ask`, `llm`, `clean`, and
//! `actions` to list, run and stop them. All need the app.

use std::io::{IsTerminal, Read};
use std::time::Duration;

use anyhow::{Result, bail};
use serde_json::{Value, json};

use super::{client, coded, has_flag, output, positionals, str_flag, str_flags, wants_help};

const TOAST_TYPES: [&str; 4] = ["info", "success", "warning", "error"];
const ASK_POLL: Duration = Duration::from_millis(300);
const MAX_TOAST_SECONDS: f64 = 3600.0;

fn joined(args: &[String], value_flags: &[&str]) -> String {
    positionals(args, value_flags)
        .iter()
        .map(|arg| arg.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

fn read_stdin() -> Result<String> {
    let mut text = String::new();
    if !std::io::stdin().is_terminal() {
        std::io::stdin().read_to_string(&mut text)?;
    }
    Ok(text)
}

fn print_text(data: &Value, json: bool) {
    if json {
        output::print_json_ok(data.clone());
    } else {
        println!("{}", data["text"].as_str().unwrap_or_default());
    }
}

pub(crate) fn toast(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        super::print_command_help(
            "Show a toast. Line breaks are kept. Returns at once.",
            "glimpse toast <message> [options]",
            &[(
                "OPTIONS",
                &[
                    ("--title <title>", "A title above the message."),
                    (
                        "--type <type>",
                        "info (default), success, warning or error.",
                    ),
                    (
                        "--duration <seconds>",
                        "How long it shows. 0 keeps it until closed.",
                    ),
                    ("--json", "Output machine-readable JSON."),
                ],
            )],
        );
        return Ok(());
    }
    let message = joined(args, &["--title", "--type", "--duration"]);
    if message.trim().is_empty() {
        bail!("Pass the message to show.");
    }
    let kind = str_flag(args, "--type")?.unwrap_or("info");
    if !TOAST_TYPES.contains(&kind) {
        bail!("--type must be one of: {}", TOAST_TYPES.join(", "));
    }
    let duration = str_flag(args, "--duration")?
        .map(|value| {
            value
                .parse::<f64>()
                .ok()
                .filter(|seconds| (0.0..=MAX_TOAST_SECONDS).contains(seconds))
                .ok_or_else(|| anyhow::anyhow!("--duration must be a number of seconds up to 3600"))
        })
        .transpose()?;
    client::request_data(
        "toast",
        json!({
            "message": message,
            "title": str_flag(args, "--title")?,
            "type": kind,
            "duration": duration,
        }),
    )?;
    if json {
        output::print_json_ok(json!({}));
    }
    Ok(())
}

pub(crate) fn pill(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        super::print_command_help(
            "Show text in the pill while an insert action runs.",
            "glimpse pill <text>",
            &[("OPTIONS", &[("--json", "Output machine-readable JSON.")])],
        );
        return Ok(());
    }
    client::try_request_data("pill", json!({ "text": joined(args, &[]) }), "pill failed")?
        .ok_or_else(|| coded(2, "Glimpse is not running."))?;
    if json {
        output::print_json_ok(json!({}));
    }
    Ok(())
}

pub(crate) fn ask(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        super::print_command_help(
            "Ask the person a question and print the answer they speak or click. Exits with 1 when skipped.",
            "glimpse ask <question> [options]",
            &[(
                "OPTIONS",
                &[
                    ("--button <label>", "A button to answer with. Up to two."),
                    ("--json", "Output machine-readable JSON."),
                ],
            )],
        );
        return Ok(());
    }
    let buttons = str_flags(args, "--button")?;
    if buttons.len() > 2 {
        bail!("Use up to two --button labels.");
    }
    let (opened, _connection) = client::open_prompt(json!({
        "question": joined(args, &["--button"]),
        "buttons": buttons,
        "client": std::env::var("GLIMPSE_CLIENT").unwrap_or_default(),
    }))?;
    let id = opened["id"].as_str().unwrap_or_default().to_string();
    // A headless action run replies at once, without a question to poll.
    let mut polled = opened;
    loop {
        match polled["status"].as_str() {
            None | Some("waiting") => {
                std::thread::sleep(ASK_POLL);
                polled =
                    client::try_request_data("prompt.poll", json!({ "id": id }), "ask failed")?
                        .unwrap_or_else(|| json!({ "status": "expired" }));
            }
            Some("answered") => {
                let answer = polled["answer"].as_str().unwrap_or_default();
                if json {
                    output::print_json_ok(json!({ "answer": answer }));
                } else {
                    println!("{answer}");
                }
                return Ok(());
            }
            Some("skipped") => return Err(coded(1, "Skipped.")),
            _ => return Err(coded(1, "The question was withdrawn.")),
        }
    }
}

pub(crate) fn llm(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        super::print_command_help(
            "Run the instruction on stdin with the language model from Settings.",
            "glimpse llm <instruction> [options]",
            &[(
                "OPTIONS",
                &[
                    (
                        "--local",
                        "Use the on-device model. Input has to fit its 2,048-token context.",
                    ),
                    ("--json", "Output machine-readable JSON."),
                ],
            )],
        );
        return Ok(());
    }
    let instruction = joined(args, &[]);
    if instruction.trim().is_empty() {
        bail!("Pass the instruction.");
    }
    let text = read_stdin()?;
    if text.trim().is_empty() {
        bail!("Pass text on standard input.");
    }
    let data = client::request_data(
        "llm",
        json!({
            "instruction": instruction,
            "text": text,
            "local": has_flag(args, "--local"),
        }),
    )?;
    print_text(&data, json);
    Ok(())
}

pub(crate) fn clean(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        super::print_command_help(
            "Clean up the text on stdin like a dictation, with the mode for the app in front.",
            "glimpse clean",
            &[("OPTIONS", &[("--json", "Output machine-readable JSON.")])],
        );
        return Ok(());
    }
    let data = client::request_data("clean", json!({ "text": read_stdin()? }))?;
    print_text(&data, json);
    Ok(())
}

fn actions_help() {
    super::print_command_help(
        "List, run and stop actions.",
        "glimpse actions <subcommand> [options]",
        &[
            (
                "SUBCOMMANDS",
                &[
                    ("list", "Show the actions folder and every action."),
                    (
                        "run [name] [text]",
                        "Run an action with text as input, wait, and print what it showed. Exits with 3 when it fails, 4 when stopped.",
                    ),
                    (
                        "last <name>",
                        "Print what its last run showed, from any trigger.",
                    ),
                    ("stop <name>", "End its run and the runs waiting."),
                ],
            ),
            (
                "OPTIONS",
                &[
                    (
                        "--headless",
                        "Run without showing or typing anything (run).",
                    ),
                    (
                        "--answer <text>",
                        "Reply to the next glimpse ask in a headless run. Repeatable.",
                    ),
                    (
                        "--say <text>",
                        "Route spoken text through the phrases, like a dictation; the name is optional (run).",
                    ),
                    (
                        "--key <shortcut>",
                        "With --say, dictate on this action shortcut instead of Glimpse's own.",
                    ),
                    (
                        "--event <name>",
                        "Run as this event, with the text as input (run).",
                    ),
                    (
                        "--env <KEY=VALUE>",
                        "Set GLIMPSE_APP, GLIMPSE_WINDOW_TITLE, GLIMPSE_URL, GLIMPSE_SELECTED_TEXT, GLIMPSE_FIELD_TEXT, GLIMPSE_LANGUAGE or GLIMPSE_ID. Repeatable (run).",
                    ),
                    ("--json", "Output machine-readable JSON."),
                ],
            ),
        ],
    );
}

pub(crate) fn actions(args: &[String], json: bool) -> Result<()> {
    if args.is_empty() || wants_help(args) {
        actions_help();
        return Ok(());
    }
    let (sub, rest) = args.split_first().expect("non-empty checked above");
    let words = positionals(rest, &["--answer", "--say", "--key", "--event", "--env"]);
    let name = words.first();
    match (sub.as_str(), name) {
        ("list", _) => list(json),
        ("run", _) => {
            let say = str_flag(rest, "--say")?;
            let (name, text) = match (say, words.split_first()) {
                (Some(_), _) => (words.first(), String::new()),
                (None, Some((name, text))) => (
                    Some(name),
                    text.iter()
                        .map(|word| word.as_str())
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                (None, None) => bail!("Pass the action's name, or --say."),
            };
            let mut env = serde_json::Map::new();
            for pair in str_flags(rest, "--env")? {
                let Some((key, value)) = pair.split_once('=') else {
                    bail!("--env takes KEY=VALUE");
                };
                env.insert(key.to_string(), json!(value));
            }
            let record = client::request_data(
                "actions.run",
                json!({
                    "name": name,
                    "text": text,
                    "headless": has_flag(rest, "--headless"),
                    "answers": str_flags(rest, "--answer")?,
                    "say": say,
                    "key": str_flag(rest, "--key")?,
                    "event": str_flag(rest, "--event")?,
                    "env": env,
                }),
            )?;
            print_record(&record, json);
            match (record["ok"].as_bool(), record["ended"].as_str()) {
                (Some(true), _) => Ok(()),
                (_, Some("stopped")) => Err(coded(4, "Stopped.")),
                _ => Err(coded(3, "The action failed.")),
            }
        }
        ("last" | "stop", None) => bail!("Pass the action's name."),
        ("last", Some(name)) => {
            let record = client::request_data("actions.last", json!({ "name": name }))?;
            print_record(&record, json);
            Ok(())
        }
        ("stop", Some(name)) => {
            let data = client::request_data("actions.stop", json!({ "name": name }))?;
            if json {
                output::print_json_ok(data);
            }
            Ok(())
        }
        (other, _) => bail!("Unknown actions subcommand: {other}. Run 'glimpse actions --help'."),
    }
}

/// One line for the run, then one for each thing it showed, in order.
fn print_record(record: &Value, json: bool) {
    if json {
        output::print_json(record);
        return;
    }
    let text = |key: &str| record[key].as_str().unwrap_or_default();
    let trigger = match (record["phrase"].as_str(), record["event"].as_str()) {
        (Some(phrase), _) => format!("{} \"{phrase}\"", text("trigger")),
        (None, Some(event)) => format!("{} {event}", text("trigger")),
        (None, None) => text("trigger").to_string(),
    };
    let ended = match (text("ended"), record["exit_code"].as_i64()) {
        ("exited", Some(code)) => format!("exit {code}"),
        ("exited", None) => "ended by a signal".to_string(),
        ("timeout", _) => "timed out".to_string(),
        ("not_started", _) => "didn't start".to_string(),
        (other, _) => other.to_string(),
    };
    let headless = if record["headless"].as_bool() == Some(true) {
        ", headless"
    } else {
        ""
    };
    println!(
        "{}  {trigger}, {} ms, {ended}{headless}",
        text("action"),
        record["duration_ms"].as_u64().unwrap_or_default()
    );
    let print = |label: &str, line: &str| {
        println!("{label}  {}", line.replace('\n', "\n    "));
    };
    for shown in record["shown"].as_array().into_iter().flatten() {
        let field = |key: &str| shown[key].as_str().unwrap_or_default();
        let kind = match (field("kind"), field("type")) {
            ("toast", toast_type) if toast_type != "info" => format!("toast[{toast_type}]"),
            (kind, _) => kind.to_string(),
        };
        let line = match field("kind") {
            "toast" => match shown["title"].as_str() {
                Some(title) => format!("{title}: {}", field("message")),
                None => field("message").to_string(),
            },
            "insert" => match (shown["pasted"].as_bool(), shown["fallback_reason"].as_str()) {
                (Some(true), _) => format!("{} (pasted)", field("text")),
                (_, Some(reason)) => format!("{} (not pasted: {reason})", field("text")),
                _ => field("text").to_string(),
            },
            "ask" => {
                let buttons: Vec<&str> = shown["buttons"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                let buttons = if buttons.is_empty() {
                    String::new()
                } else {
                    format!(" [{}]", buttons.join(" | "))
                };
                let answer = shown["answer"].as_str().unwrap_or(
                    if shown["skipped"].as_bool() == Some(true) {
                        "skipped"
                    } else {
                        "no answer"
                    },
                );
                format!("{}{buttons} -> {answer}", field("question"))
            }
            "pill" => field("text").to_string(),
            _ => field("message").to_string(),
        };
        print(&kind, &line);
    }
    if text("ended") == "exited" && text("output").is_empty() {
        println!("no output");
    }
    if !text("stderr").is_empty() {
        println!("stderr\n    {}", text("stderr").replace('\n', "\n    "));
    }
}

fn list(json: bool) -> Result<()> {
    let data = client::request_data("actions.list", json!({}))?;
    if json {
        output::print_json_ok(data);
        return Ok(());
    }
    println!("{}", data["folder"].as_str().unwrap_or_default());
    let strings = |value: &Value| -> Vec<String> {
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect()
    };
    for action in data["actions"].as_array().into_iter().flatten() {
        let listen = action["listen"].as_bool().unwrap_or(true);
        let mut triggers: Vec<String> = action["shortcuts"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|shortcut| {
                let how = if listen {
                    shortcut["behavior"].as_str().unwrap_or_default()
                } else {
                    "press"
                };
                format!(
                    "{} ({how})",
                    shortcut["shortcut"].as_str().unwrap_or_default()
                )
            })
            .collect();
        triggers.extend(
            strings(&action["phrases"])
                .iter()
                .map(|phrase| format!("\"{phrase}\"")),
        );
        triggers.extend(strings(&action["events"]));
        println!(
            "\n{}  {}  {}",
            action["name"].as_str().unwrap_or_default(),
            if action["enabled"].as_bool().unwrap_or(false) {
                "on"
            } else {
                "off"
            },
            triggers.join(", ")
        );
        let shortcut_problems = action["shortcuts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|shortcut| shortcut["problem"].as_str().map(str::to_string));
        for problem in strings(&action["problems"])
            .into_iter()
            .chain(shortcut_problems)
        {
            println!("  problem: {problem}");
        }
        if let Some(failure) = action["last_failure"].as_str() {
            println!("  last failure: {failure}");
        }
    }
    Ok(())
}
