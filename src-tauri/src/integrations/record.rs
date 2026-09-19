//! `glimpse record …` - control Recording Mode. Only `start` launches the app.

use anyhow::{Result, bail};
use serde_json::{Value, json};

use super::{client, coded, output, str_flag, wants_help};

fn help() {
    super::print_command_help(
        "Control Recording Mode.",
        "glimpse record <subcommand> [options]",
        &[
            (
                "SUBCOMMANDS",
                &[
                    ("status", "Show the current recording."),
                    ("start", "Record with the last used sources."),
                    ("pause", "Pause the recording."),
                    ("resume", "Resume a paused recording."),
                    ("bookmark", "Bookmark the current moment."),
                    ("finish", "Stop and save to the Library."),
                ],
            ),
            (
                "OPTIONS",
                &[
                    ("--name <name>", "Name for the saved recording (finish)."),
                    ("--json", "Output machine-readable JSON."),
                ],
            ),
        ],
    );
}

pub(crate) fn run(args: &[String], json: bool) -> Result<()> {
    if args.is_empty() || wants_help(args) {
        help();
        return Ok(());
    }
    let (sub, rest) = args.split_first().expect("non-empty checked above");
    match sub.as_str() {
        "status" => status(json),
        "start" => {
            print_state(&client::request_data("record.start", json!({}))?, json);
            Ok(())
        }
        "pause" | "resume" => {
            print_state(&request_running(&format!("record.{sub}"), json!({}))?, json);
            Ok(())
        }
        "bookmark" => bookmark(json),
        "finish" => finish(rest, json),
        other => bail!("Unknown record subcommand: {other}. Run 'glimpse record --help'."),
    }
}

/// Sends a command that needs an active recording. Without a running app there
/// is none, so this never launches it.
fn request_running(command: &str, args: Value) -> Result<Value> {
    client::try_request_data(command, args, "Glimpse reported an error")?
        .ok_or_else(|| coded(3, "No recording is in progress."))
}

fn status(json: bool) -> Result<()> {
    match client::try_request_data("record.status", json!({}), "record status failed")? {
        Some(data) => print_state(&data, json),
        None => {
            if json {
                output::print_json(&json!({ "ok": true, "app_running": false, "status": "idle" }));
            } else {
                println!("status:     idle (Glimpse is not running)");
            }
        }
    }
    Ok(())
}

fn bookmark(json: bool) -> Result<()> {
    let data = request_running("record.bookmark", json!({}))?;
    if json {
        output::print_json_ok(data);
    } else {
        let at_ms = data
            .get("bookmark")
            .and_then(|bookmark| bookmark.get("at_ms"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        println!("Bookmarked at {}", clock(at_ms));
    }
    Ok(())
}

fn finish(args: &[String], json: bool) -> Result<()> {
    let name = str_flag(args, "--name")?.unwrap_or_default();
    let data = request_running("record.finish", json!({ "name": name }))?;
    if json {
        output::print_json_ok(data);
    } else {
        let item = data.get("item").unwrap_or(&Value::Null);
        let id = item.get("id").and_then(Value::as_str).unwrap_or("");
        let name = item.get("name").and_then(Value::as_str).unwrap_or("");
        println!("{id}\t{name}");
    }
    Ok(())
}

fn print_state(data: &Value, json: bool) {
    if json {
        output::print_json_ok(data.clone());
        return;
    }
    let status = data
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let elapsed_ms = data.get("elapsed_ms").and_then(Value::as_u64).unwrap_or(0);
    let mic = data.get("mic").and_then(Value::as_bool).unwrap_or(false);
    let system = data.get("system").and_then(Value::as_str).unwrap_or("none");
    let bookmarks = data.get("bookmarks").and_then(Value::as_u64).unwrap_or(0);
    println!("status:     {status}");
    println!("elapsed:    {}", clock(elapsed_ms));
    println!("mic:        {mic}");
    println!("system:     {system}");
    println!("bookmarks:  {bookmarks}");
}

fn clock(ms: u64) -> String {
    let seconds = ms / 1000;
    let (hours, minutes, seconds) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}
