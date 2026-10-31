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
// Enough for a large import, which stays active while it works through the queue.
const MAX_ACTIVE: usize = 500;

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
    seen.remember_library(&storage)?;
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

fn is_active(status: &str) -> bool {
    !matches!(status, "complete" | "error" | "cancelled")
}

impl Seen {
    // Everything here now counts as already added, wherever it sits in the list later.
    fn remember_library(&mut self, storage: &StorageManager) -> Result<()> {
        let mut offset = 0;
        loop {
            let (items, has_more) =
                storage.get_library_items_page(LibraryFilter::default(), WINDOW, offset)?;
            offset += items.len();
            for item in &items {
                let (status, _, _) = item.status.as_fields();
                self.library.insert(item.id.clone(), status);
            }
            if !has_more {
                return Ok(());
            }
        }
    }

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
        let (mut items, _) = storage.get_library_items_page(LibraryFilter::default(), WINDOW, 0)?;
        // Retried items stay at their old place in the list, past the newest page.
        let active = LibraryFilter {
            status: Some("active".to_string()),
            ..Default::default()
        };
        items.extend(storage.get_library_items_page(active, MAX_ACTIVE, 0)?.0);
        for (id, status) in &self.library {
            if is_active(status) {
                items.extend(storage.get_library_item(id)?);
            }
        }
        let mut visited = HashSet::new();
        items.retain(|item| visited.insert(item.id.clone()));
        items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        for item in &items {
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
