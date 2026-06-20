//! `glimpse api start|stop|status` - control the local OpenAI-compatible API.

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{client, coded, output, wants_help};

const USAGE: &str = "\
glimpse api <subcommand>

Subcommands:
  status          Report whether the local API is running
  start           Start the local API server (requires the app)
  stop            Stop the local API server

Flags:
  --json          Machine-readable output";

pub(crate) fn run(args: &[String], json: bool) -> Result<()> {
    if args.is_empty() || wants_help(args) {
        println!("{USAGE}");
        return Ok(());
    }
    let (sub, _rest) = args.split_first().expect("non-empty checked above");
    match sub.as_str() {
        "status" => status(json),
        "start" => emit(client::request_data("api.start", json!({}))?, json),
        "stop" => emit(client::request_data("api.stop", json!({}))?, json),
        other => bail!("Unknown api subcommand: {other}\n\n{USAGE}"),
    }
}

fn status(json: bool) -> Result<()> {
    match client::try_request("api.status", json!({}))? {
        Some(response) if response.ok => emit(response.data, json),
        Some(response) => Err(coded(
            3,
            response
                .error
                .unwrap_or_else(|| "api status failed".to_string()),
        )),
        None => {
            if json {
                output::print_json(&json!({ "ok": true, "running": false }));
            } else {
                println!("running: false (Glimpse is not running)");
            }
            Ok(())
        }
    }
}

fn emit(data: Value, json: bool) -> Result<()> {
    if json {
        let mut value = data;
        if let Some(object) = value.as_object_mut() {
            object.insert("ok".to_string(), Value::Bool(true));
        }
        output::print_json(&value);
    } else {
        let running = data
            .get("running")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let host = data.get("host").and_then(Value::as_str).unwrap_or("");
        let port = data.get("port").and_then(Value::as_u64).unwrap_or(0);
        if running {
            println!("running: true  ({host}:{port})");
        } else {
            println!("running: false");
        }
    }
    Ok(())
}
