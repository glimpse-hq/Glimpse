//! `glimpse mcp` - a Model Context Protocol server on stdio, so AI agents can
//! search and read the Library. Read-only unless started with `--allow-import`.

use std::sync::Arc;

use anyhow::Result;
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::library::item_summary;
use super::{client, has_flag, open_storage, output, wants_help};
use crate::library::{
    ExportFormat, LibraryFilter, LibraryItem, build_export_content, repo::extract_search_terms,
    speaker_name,
};
use crate::settings::SettingsStore;
use crate::storage::StorageManager;

const DEFAULT_LIMIT: usize = 10;
const MAX_LIMIT: usize = 50;
const SNIPPET_CHARS: usize = 240;
const SNIPPET_LEAD_CHARS: usize = 60;

fn help() {
    super::print_command_help(
        "Serve your Library to AI agents over the Model Context Protocol (stdio).",
        "glimpse mcp [options]",
        &[
            (
                "OPTIONS",
                &[
                    (
                        "--allow-import",
                        "Let the agent queue files for transcription.",
                    ),
                    ("-h, --help", "Show help information."),
                ],
            ),
            (
                "CONNECT",
                &[
                    ("Claude Code", "claude mcp add glimpse -- glimpse mcp"),
                    (
                        "Claude Desktop",
                        "\"glimpse\": { \"command\": \"glimpse\", \"args\": [\"mcp\"] }",
                    ),
                    (
                        "Claude Code (Windows)",
                        "claude mcp add glimpse -- cmd /c glimpse mcp",
                    ),
                    (
                        "Claude Desktop (Windows)",
                        "\"glimpse\": { \"command\": \"cmd\", \"args\": [\"/c\", \"glimpse\", \"mcp\"] }",
                    ),
                ],
            ),
        ],
    );
}

pub(crate) fn run(identifier: &str, args: &[String]) -> Result<()> {
    if wants_help(args) {
        help();
        return Ok(());
    }
    crate::require_cli_license(identifier)?;
    let storage = open_storage(identifier)?;
    storage.set_query_only()?;
    let server = LibraryServer::new(
        Arc::new(storage),
        Arc::new(SettingsStore::for_cli(identifier)?),
        has_flag(args, "--allow-import"),
    );
    tokio::runtime::Runtime::new()?.block_on(async {
        let service = server.serve(rmcp::transport::stdio()).await?;
        service.waiting().await?;
        Ok(())
    })
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct SearchParams {
    #[schemars(
        description = "Words to find in item names and transcripts. Every word must match; #tag filters by tag."
    )]
    query: String,
    #[schemars(description = "Maximum results, 1 to 50. Defaults to 10.")]
    limit: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct ListParams {
    #[schemars(description = "Maximum results, 1 to 50. Defaults to 10.")]
    limit: Option<usize>,
    #[schemars(description = "Only items created in the last N days.")]
    since_days: Option<u32>,
    #[schemars(description = "Only items in this state. Defaults to complete.")]
    status: Option<Status>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "lowercase")]
enum Status {
    Complete,
    /// Waiting, importing or transcribing.
    Active,
    Error,
    Cancelled,
}

impl Status {
    fn as_filter(&self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Active => "active",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TranscriptParams {
    #[schemars(description = "Library item id from search_library or list_recent.")]
    id: String,
    #[schemars(
        description = "segments (default): JSON with timestamped, speaker-labeled segments. Or txt, md, srt, vtt."
    )]
    format: Option<Format>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(rename_all = "lowercase")]
enum Format {
    Segments,
    Txt,
    Md,
    Srt,
    Vtt,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TranscribeParams {
    #[schemars(description = "Absolute path to an audio or video file on this computer.")]
    path: String,
    #[schemars(description = "Speech model id. Defaults to the model selected in Glimpse.")]
    model: Option<String>,
}

#[derive(Clone)]
struct LibraryServer {
    storage: Arc<StorageManager>,
    settings: Arc<SettingsStore>,
    tool_router: ToolRouter<Self>,
}

impl LibraryServer {
    fn new(storage: Arc<StorageManager>, settings: Arc<SettingsStore>, allow_import: bool) -> Self {
        let mut tool_router = Self::tool_router();
        if !allow_import {
            tool_router.remove_route("transcribe_file");
        }
        Self {
            storage,
            settings,
            tool_router,
        }
    }

    // The server can outlive the license it started with.
    fn require_license(&self) -> Result<(), String> {
        crate::license::require_active_license(&self.settings, "glimpse mcp")
    }
}

#[tool_router]
impl LibraryServer {
    #[tool(
        description = "Search the user's Glimpse Library (transcribed meetings, recordings and imported files) by words in the name or transcript. Returns ids, metadata and a snippet; read one with get_transcript.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    fn search_library(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let query = params.query.trim();
        if query.is_empty() {
            return Err("query must not be empty".to_string());
        }
        let filter = LibraryFilter {
            search: Some(query.to_string()),
            ..Default::default()
        };
        let (terms, _) = extract_search_terms(query);
        self.page(filter, params.limit, &terms)
    }

    #[tool(
        description = "List the most recent items in the user's Glimpse Library, newest first. Returns ids, metadata and the start of each transcript.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    fn list_recent(&self, Parameters(params): Parameters<ListParams>) -> Result<String, String> {
        self.require_license()?;
        let status = params.status.unwrap_or(Status::Complete);
        let filter = LibraryFilter {
            status: Some(status.as_filter().to_string()),
            since_days: params.since_days,
            ..Default::default()
        };
        self.page(filter, params.limit, &[])
    }

    #[tool(
        description = "Read the full transcript of one Glimpse Library item, with speaker names and timestamps.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    fn get_transcript(
        &self,
        Parameters(params): Parameters<TranscriptParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let item = self
            .storage
            .get_library_item(params.id.trim())
            .map_err(|err| format!("{err:#}"))?
            .ok_or_else(|| format!("No Library item with id {}", params.id.trim()))?;
        let format = match params.format.unwrap_or(Format::Segments) {
            Format::Segments => return Ok(transcript_json(&item).to_string()),
            Format::Txt => ExportFormat::Txt,
            Format::Md => ExportFormat::Md,
            Format::Srt => ExportFormat::Srt,
            Format::Vtt => ExportFormat::Vtt,
        };
        build_export_content(&item, format).map_err(|err| format!("{err:#}"))
    }

    #[tool(
        description = "Queue an audio or video file for transcription in the Glimpse Library. Returns the new item's id; call get_transcript with it once its status is complete. Opens Glimpse if it isn't running.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn transcribe_file(
        &self,
        Parameters(params): Parameters<TranscribeParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let path = std::fs::canonicalize(&params.path)
            .map_err(|_| format!("File not found: {}", params.path))?;
        let mut payload = json!({ "path": path.to_string_lossy(), "store_original": false });
        if let Some(model) = params.model {
            payload["model"] = json!(model);
        }
        // The control socket client blocks while it connects or launches the app.
        let job =
            tokio::task::spawn_blocking(move || client::request_data("library.import", payload))
                .await
                .map_err(|err| format!("{err:#}"))?
                .map_err(|err| format!("{err:#}"))?;
        Ok(job.to_string())
    }
}

// The default router is rebuilt per call and would bring back routes removed in `new`.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for LibraryServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("glimpse", env!("CARGO_PKG_VERSION")).with_title("Glimpse"),
            )
            .with_instructions(
                "The user's Glimpse Library: meetings, calls and files transcribed on their computer. \
                 Find items with search_library or list_recent, then read one with get_transcript.",
            )
    }
}

impl LibraryServer {
    fn page(
        &self,
        filter: LibraryFilter,
        limit: Option<usize>,
        terms: &[String],
    ) -> Result<String, String> {
        let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let (items, has_more) = self
            .storage
            .get_library_items_page(filter, limit, 0)
            .map_err(|err| format!("{err:#}"))?;
        let items: Vec<Value> = items
            .iter()
            .map(|item| {
                let mut summary = item_summary(item);
                summary["transcript"] = json!(
                    item.transcript
                        .as_deref()
                        .map(|transcript| snippet(transcript, terms))
                );
                summary
            })
            .collect();
        Ok(json!({ "count": items.len(), "has_more": has_more, "items": items }).to_string())
    }
}

fn transcript_json(item: &LibraryItem) -> Value {
    let mut out = item_summary(item);
    out["tags"] = json!(item.tags);
    out["speakers"] = json!(
        item.speakers
            .iter()
            .flatten()
            .map(|speaker| &speaker.name)
            .collect::<Vec<_>>()
    );
    out["bookmarks"] = json!(
        item.bookmarks
            .iter()
            .flatten()
            .map(|bookmark| json!({ "at_ms": bookmark.at_ms, "label": bookmark.label }))
            .collect::<Vec<_>>()
    );
    // Edits and cleanup change only the transcript, so the segments keep the earlier text.
    let segments_match_transcript = !item.transcript_edited && !item.llm_cleanup_enabled;
    if segments_match_transcript
        && let Some(segments) = item
            .segments
            .as_ref()
            .filter(|segments| !segments.is_empty())
    {
        out["segments"] = segments
            .iter()
            .filter(|segment| !segment.text.trim().is_empty())
            .map(|segment| {
                json!({
                    "start_ms": segment.start_ms,
                    "end_ms": segment.end_ms,
                    "speaker": speaker_name(item, &segment.speaker_id),
                    "text": segment.text.trim(),
                })
            })
            .collect();
        // The segments carry the same text; sending both doubles the tokens.
        out.as_object_mut()
            .expect("item_summary is an object")
            .remove("transcript");
    }
    out
}

/// A one-line excerpt starting just before the first search term, or at the
/// start without terms.
fn snippet(text: &str, terms: &[String]) -> String {
    let hit = terms
        .iter()
        .filter_map(|term| find_ignore_ascii_case(text, term))
        .min()
        .unwrap_or(0);
    let start = text[..hit]
        .char_indices()
        .rev()
        .nth(SNIPPET_LEAD_CHARS)
        .map_or(0, |(index, _)| index);
    let excerpt = output::one_line(&text[start..], SNIPPET_CHARS);
    if start > 0 {
        format!("…{excerpt}")
    } else {
        excerpt
    }
}

// ASCII-only case folding matches SQLite's LIKE, which picked the item. A
// match always starts on a char boundary because the needle is valid UTF-8.
fn find_ignore_ascii_case(text: &str, needle: &str) -> Option<usize> {
    let needle = needle.as_bytes();
    if needle.is_empty() {
        return None;
    }
    text.as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{LibraryItemStatus, Speaker, TranscriptSegment};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn segment(start_ms: u64, speaker: &str, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            start_ms,
            end_ms: start_ms + 1_000,
            text: text.to_string(),
            speaker_id: Some(speaker.to_string()),
        }
    }

    fn meeting() -> LibraryItem {
        LibraryItem {
            id: "meeting-1".to_string(),
            name: "Roadmap sync".to_string(),
            audio_path: String::new(),
            source_path: String::new(),
            store_original: false,
            status: LibraryItemStatus::Complete,
            transcript: Some("Let's ship the MCP server. Agreed, after the beta.".to_string()),
            transcript_edited: false,
            segments: Some(vec![
                segment(0, "s1", "Let's ship the MCP server."),
                segment(1_000, "s2", " "),
                segment(2_000, "s2", "Agreed, after the beta."),
            ]),
            words: None,
            duration_seconds: 3.0,
            file_size_bytes: 0,
            original_format: "wav".to_string(),
            created_at: "2026-10-01T09:00:00Z".to_string(),
            transcribed_at: Some("2026-10-01T09:05:00Z".to_string()),
            tags: vec!["planning".to_string()],
            llm_cleanup_enabled: false,
            speech_model: "parakeet".to_string(),
            show_timestamps: true,
            detect_speakers: true,
            kind: "recording".to_string(),
            speakers: Some(vec![
                Speaker {
                    id: "s1".to_string(),
                    name: "Ada".to_string(),
                    color: None,
                },
                Speaker {
                    id: "s2".to_string(),
                    name: "Grace".to_string(),
                    color: None,
                },
            ]),
            secondary_audio_path: None,
            sources: None,
            bookmarks: None,
        }
    }

    #[test]
    fn snippet_starts_near_the_first_match() {
        let text = format!("{} the budget was approved", "filler ".repeat(40));
        let excerpt = snippet(&text, &["BUDGET".to_string()]);
        assert!(excerpt.starts_with('…'));
        assert!(excerpt.contains("the budget was approved"));
        assert_eq!(
            snippet("short text", &["missing".to_string()]),
            "short text"
        );
    }

    #[test]
    fn find_ignores_ascii_case_and_lands_on_char_boundaries() {
        let text = "Café notes: MCP rocks";
        let at = find_ignore_ascii_case(text, "mcp").expect("match");
        assert_eq!(&text[at..at + 3], "MCP");
        assert_eq!(find_ignore_ascii_case(text, ""), None);
    }

    #[test]
    fn transcript_json_names_speakers_and_drops_blank_segments() {
        let out = transcript_json(&meeting());
        let segments = out["segments"].as_array().expect("segments");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0]["speaker"], "Ada");
        assert_eq!(segments[1]["speaker"], "Grace");
        assert_eq!(segments[1]["start_ms"], 2_000);
        assert_eq!(out["speakers"], json!(["Ada", "Grace"]));
        assert!(out.get("transcript").is_none());
    }

    async fn call(
        lines: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
        writer: &mut tokio::io::DuplexStream,
        request: Value,
    ) -> Value {
        writer
            .write_all(format!("{request}\n").as_bytes())
            .await
            .expect("write request");
        let line = lines.next_line().await.expect("read").expect("response");
        serde_json::from_str(&line).expect("json response")
    }

    #[test]
    fn serves_the_library_over_json_rpc() {
        let root = std::env::temp_dir().join(format!("glimpse-mcp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let storage = StorageManager::new(root.join("transcriptions.db")).expect("storage");
        storage.insert_library_item(meeting()).expect("insert");
        storage.set_query_only().expect("query only");
        let settings = SettingsStore::open(root.join("settings.db")).expect("settings store");
        let server = LibraryServer::new(Arc::new(storage), Arc::new(settings), false);

        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (mut writer, server_read) = tokio::io::duplex(64 * 1024);
            let (server_write, client_read) = tokio::io::duplex(64 * 1024);
            tokio::spawn(async move {
                let service = server.serve((server_read, server_write)).await?;
                service.waiting().await?;
                anyhow::Ok(())
            });
            let mut lines = BufReader::new(client_read).lines();

            let init = call(
                &mut lines,
                &mut writer,
                json!({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": { "name": "test", "version": "0" }
                    }
                }),
            )
            .await;
            assert_eq!(init["result"]["serverInfo"]["name"], "glimpse");
            writer
                .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
                .await
                .unwrap();

            let tools = call(
                &mut lines,
                &mut writer,
                json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
            )
            .await;
            let mut names: Vec<&str> = tools["result"]["tools"]
                .as_array()
                .expect("tools")
                .iter()
                .filter_map(|tool| tool["name"].as_str())
                .collect();
            names.sort_unstable();
            assert_eq!(names, ["get_transcript", "list_recent", "search_library"]);

            let found = call(
                &mut lines,
                &mut writer,
                json!({
                    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": { "name": "search_library", "arguments": { "query": "beta" } }
                }),
            )
            .await;
            let text = found["result"]["content"][0]["text"].as_str().expect("text");
            let found: Value = serde_json::from_str(text).expect("search json");
            assert_eq!(found["items"][0]["id"], "meeting-1");

            let transcript = call(
                &mut lines,
                &mut writer,
                json!({
                    "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                    "params": { "name": "get_transcript", "arguments": { "id": "meeting-1", "format": "txt" } }
                }),
            )
            .await;
            let text = transcript["result"]["content"][0]["text"].as_str().expect("text");
            assert!(text.contains("Ada: Let's ship the MCP server."));

            let missing = call(
                &mut lines,
                &mut writer,
                json!({
                    "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                    "params": { "name": "get_transcript", "arguments": { "id": "nope" } }
                }),
            )
            .await;
            assert_eq!(missing["result"]["isError"], true);
        });
        let _ = std::fs::remove_dir_all(&root);
    }
}
