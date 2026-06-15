//! `glimpse open …` — bring up the app and navigate. Always needs the app.

use anyhow::Result;
use serde_json::json;

use super::{client, output, positionals, str_flag, wants_help};

const USAGE: &str = "\
glimpse open [target] [options]

Targets:
  (none) | settings   Open the Glimpse window
  history             Open the history view
  models              Open the models view

Options:
  --tab <name>        Settings tab (general|models|history)
  --json              Machine-readable output";

pub(crate) fn run(args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        println!("{USAGE}");
        return Ok(());
    }

    let mut payload = json!({});
    if let Some(target) = positionals(args, &["--tab", "--id"]).first() {
        payload["target"] = json!(target);
    }
    if let Some(tab) = str_flag(args, "--tab")? {
        payload["tab"] = json!(tab);
    }
    if let Some(id) = str_flag(args, "--id")? {
        payload["id"] = json!(id);
    }

    let data = client::request_data("open", payload)?;
    if json {
        output::print_json(&json!({ "ok": true, "opened": data.get("opened") }));
    }
    Ok(())
}
