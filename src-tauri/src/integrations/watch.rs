//! `glimpse watch` - prints a line when a dictation lands or a Library item
//! changes. Headless: it reads the databases, so it needs no app connection.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::time::Duration;

use anyhow::Result;
use serde_json::{Value, json};

use super::{open_storage, wants_help};
use crate::library::LibraryFilter;
use crate::storage::StorageManager;

const POLL: Duration = Duration::from_secs(2);
const WINDOW: usize = 20;

fn help() {
    super::print_command_help(
        "Print a line for each new dictation and Library change until stopped. Lines carry ids and details, not text. Runs without the app.",
        "glimpse watch [options]",
        &[
            (
                "EVENTS",
                &[
                    ("dictation.saved", "A dictation was saved to history."),
                    ("library.added", "A recording or file joined the Library."),
                    ("library.complete", "A Library item finished transcribing."),
                    ("library.error", "A Library item failed."),
                ],
            ),
            (
                "OPTIONS",
                &[
                    ("--json", "Output one JSON object per line."),
                    ("-h, --help", "Show help information."),
                ],
            ),
        ],
    );
}

pub(crate) fn run(identifier: &str, args: &[String], json: bool) -> Result<()> {
    if wants_help(args) {
        help();
        return Ok(());
    }
    let storage = open_storage(identifier)?;
    storage.set_query_only()?;
    let mut seen = Seen::default();
    seen.events(&storage)?;
    let mut stdout = std::io::stdout();
    loop {
        std::thread::sleep(POLL);
        for event in seen.events(&storage)? {
            // A closed pipe, like `glimpse watch | head`, ends the watch.
            if writeln!(stdout, "{}", render(&event, json)).is_err() {
                return Ok(());
            }
        }
    }
}

fn render(event: &Value, json: bool) -> String {
    if json {
        return event.to_string();
    }
    let name = event["name"].as_str().unwrap_or_default();
    format!(
        "{} {} {name}",
        event["event"].as_str().unwrap_or_default(),
        event["id"].as_str().unwrap_or_default(),
    )
    .trim_end()
    .to_string()
}

#[derive(Default)]
struct Seen {
    dictations: HashSet<String>,
    library: HashMap<String, String>,
}

impl Seen {
    /// Changes since the last call, oldest first.
    fn events(&mut self, storage: &StorageManager) -> Result<Vec<Value>> {
        let mut events = Vec::new();
        for record in storage.get_recent_transcriptions(WINDOW)?.iter().rev() {
            if self.dictations.insert(record.id.clone()) {
                events.push(json!({
                    "event": "dictation.saved",
                    "id": record.id,
                    "timestamp_ms": record.timestamp.timestamp_millis(),
                    "word_count": record.word_count,
                    "mode": record.mode_name,
                }));
            }
        }
        let (items, _) = storage.get_library_items_page(LibraryFilter::default(), WINDOW, 0)?;
        for item in items.iter().rev() {
            let (status, _, _) = item.status.as_fields();
            let previous = self.library.insert(item.id.clone(), status.clone());
            let mut changes = Vec::new();
            if previous.is_none() {
                changes.push("library.added");
            }
            if previous.as_deref() != Some(status.as_str()) {
                match status.as_str() {
                    "complete" => changes.push("library.complete"),
                    "error" => changes.push("library.error"),
                    _ => {}
                }
            }
            events.extend(changes.into_iter().map(|event| {
                json!({
                    "event": event,
                    "id": item.id,
                    "name": item.name,
                    "kind": item.kind,
                })
            }));
        }
        Ok(events)
    }
}
