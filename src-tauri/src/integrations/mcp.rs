//! `glimpse mcp` - a Model Context Protocol server on stdio, so AI agents can
//! search and read the Library and dictations, follow a recording live, ask the
//! user a question and transcribe files. Queuing files needs `--allow-import`;
//! starting or finishing a recording needs `--allow-recording`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use rmcp::{
    RoleServer, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerConfig},
    schemars,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::history::HistoryRecord;
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
const LIVE_POLL: Duration = Duration::from_secs(1);
// A transcript line starts over after this long, even with the same speaker.
const LIVE_LINE_MS: u64 = 60_000;
const ASK_POLL: Duration = Duration::from_millis(500);

fn help() {
    super::print_command_help(
        "Serve your Library, dictations, live recordings and transcription to AI agents over the Model Context Protocol (stdio).",
        "glimpse mcp [options]",
        &[
            (
                "OPTIONS",
                &[
                    (
                        "--allow-import",
                        "Let the agent queue files for transcription.",
                    ),
                    (
                        "--allow-recording",
                        "Let the agent start and finish recordings.",
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
        has_flag(args, "--allow-recording"),
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

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TranscribeAudioParams {
    #[schemars(description = "Absolute path to an audio or video file on this computer.")]
    path: String,
    #[schemars(
        description = "Include segment and word timings in milliseconds. Defaults to false."
    )]
    timestamps: Option<bool>,
    #[schemars(description = "Language code, like en. Defaults to the language set in Glimpse.")]
    language: Option<String>,
    #[schemars(description = "Speech model id. Defaults to the model selected in Glimpse.")]
    model: Option<String>,
    #[schemars(
        description = "Clean up the text with the user's cleanup model. Defaults to their setting."
    )]
    cleanup: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct LiveParams {
    #[schemars(
        description = "Name the speaker on each line: You is the microphone, Others or Speaker N is system audio. Defaults to true."
    )]
    speakers: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct WaitLiveParams {
    #[schemars(
        description = "Seconds of silence that end a chunk once it has min_words. Defaults to 4."
    )]
    pause_seconds: Option<f32>,
    #[schemars(description = "Words a chunk needs before a pause can end it. Defaults to 15.")]
    min_words: Option<usize>,
    #[schemars(
        description = "Seconds after its first words that a chunk is returned even without a pause. Defaults to 60."
    )]
    max_seconds: Option<u64>,
    #[schemars(
        description = "Seconds to wait before returning with what there is. Defaults to 55, under common client time limits."
    )]
    timeout_seconds: Option<u64>,
    #[schemars(
        description = "Name the speaker on each line: You is the microphone, Others or Speaker N is system audio. Defaults to true."
    )]
    speakers: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct AskParams {
    #[schemars(description = "The question to show the user, in 160 characters or fewer.")]
    question: Option<String>,
    #[schemars(
        description = "Keep waiting on an earlier question instead of asking a new one: the ask_id from a waiting result."
    )]
    ask_id: Option<String>,
    #[schemars(
        description = "Seconds to wait before returning status waiting. Defaults to 55, under common client time limits."
    )]
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct RecentDictationsParams {
    #[schemars(description = "Only dictations containing these words.")]
    query: Option<String>,
    #[schemars(description = "Maximum results, 1 to 50. Defaults to 10.")]
    limit: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct BookmarkParams {
    #[schemars(description = "A short note for this moment, like Decision made.")]
    label: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct FinishRecordingParams {
    #[schemars(description = "A name for the Library item. Glimpse picks one if left out.")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct LiveSegment {
    id: String,
    start_ms: u64,
    speaker: String,
    text: String,
}

/// What `wait_for_live_transcript` has returned for the current recording.
#[derive(Default)]
struct LiveCursor {
    session: Option<String>,
    delivered: HashSet<String>,
    ended: bool,
}

impl LiveCursor {
    /// Settled segments not returned yet. A new recording starts over.
    fn pending(&mut self, snapshot: &Value) -> Vec<LiveSegment> {
        if let Some(started_at) = snapshot["started_at"].as_str()
            && self.session.as_deref() != Some(started_at)
        {
            *self = Self {
                session: Some(started_at.to_string()),
                ..Default::default()
            };
        }
        live_segments(snapshot)
            .into_iter()
            .filter(|segment| !self.delivered.contains(&segment.id))
            .collect()
    }

    fn ended(&self, snapshot: &Value) -> bool {
        self.session.is_some()
            && !self.ended
            && !matches!(snapshot["status"].as_str(), Some("recording" | "paused"))
    }
}

#[derive(Clone)]
struct LibraryServer {
    storage: Arc<StorageManager>,
    settings: Arc<SettingsStore>,
    live: Arc<Mutex<LiveCursor>>,
    // Each connection keeps its question open; dropping one withdraws it.
    asks: Arc<Mutex<HashMap<String, interprocess::local_socket::Stream>>>,
    tool_router: ToolRouter<Self>,
}

impl LibraryServer {
    fn new(
        storage: Arc<StorageManager>,
        settings: Arc<SettingsStore>,
        allow_import: bool,
        allow_recording: bool,
    ) -> Self {
        let mut tool_router = Self::tool_router();
        if !allow_import {
            tool_router.remove_route("transcribe_file");
        }
        if !allow_recording {
            tool_router.remove_route("start_recording");
            tool_router.remove_route("finish_recording");
        }
        Self {
            storage,
            settings,
            live: Arc::default(),
            asks: Arc::default(),
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

    #[tool(
        description = "Transcribe an audio or video file with Glimpse and return the text, optionally with segment and word timings. Nothing is added to the Library. Opens Glimpse if it isn't running.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn transcribe_audio(
        &self,
        Parameters(params): Parameters<TranscribeAudioParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let path = std::fs::canonicalize(&params.path)
            .map_err(|_| format!("File not found: {}", params.path))?;
        let mut payload = json!({
            "path": path.to_string_lossy(),
            "timestamps": params.timestamps.unwrap_or(false),
        });
        if let Some(language) = params.language {
            payload["language"] = json!(language);
        }
        if let Some(model) = params.model {
            payload["model"] = json!(model);
        }
        if let Some(cleanup) = params.cleanup {
            payload["cleanup"] = json!(cleanup);
        }
        let result =
            tokio::task::spawn_blocking(move || client::request_data("transcribe", payload))
                .await
                .map_err(|err| format!("{err:#}"))?
                .map_err(|err| format!("{err:#}"))?;
        Ok(result.to_string())
    }

    #[tool(
        description = "Read what has been said so far in the recording in progress in Glimpse, as timestamped lines. Starts live transcription if it is off, catching up on what was said earlier first.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn get_live_transcript(
        &self,
        Parameters(params): Parameters<LiveParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<String, String> {
        self.require_license()?;
        let snapshot = live_snapshot(client_name(&context)).await?;
        let segments = live_segments(&snapshot);
        Ok(live_chunk(&snapshot, &segments, false, params.speakers.unwrap_or(true)).to_string())
    }

    #[tool(
        description = "Follow the recording in progress in Glimpse, such as a lecture or meeting, one chunk at a time. Waits until the speaker pauses or max_seconds pass, then returns the new timestamped lines since the last call (the first call returns everything so far). Call it again after handling each chunk to keep listening. Waits for a recording to start if none is in progress, and reports status ended when it stops.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn wait_for_live_transcript(
        &self,
        Parameters(params): Parameters<WaitLiveParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<String, String> {
        self.require_license()?;
        let follower = client_name(&context);
        let pause = Duration::from_secs_f32(params.pause_seconds.unwrap_or(4.0).clamp(0.5, 60.0));
        let min_words = params.min_words.unwrap_or(15);
        let max = Duration::from_secs(params.max_seconds.unwrap_or(60).clamp(5, 600));
        let timeout = Duration::from_secs(params.timeout_seconds.unwrap_or(55).clamp(5, 3600));
        let deadline = Instant::now() + timeout;
        let mut first_heard: Option<Instant> = None;
        let mut quiet_since = Instant::now();
        let mut heard = 0;
        loop {
            let snapshot = live_snapshot(follower.clone()).await?;
            let (pending, ended) = {
                let mut cursor = self.live.lock().expect("live cursor");
                let pending = cursor.pending(&snapshot);
                let ended = cursor.ended(&snapshot);
                (pending, ended)
            };
            let now = Instant::now();
            if pending.len() != heard || snapshot["speaking"] == true {
                heard = pending.len();
                quiet_since = now;
            }
            if !pending.is_empty() {
                first_heard.get_or_insert(now);
            }
            let words: usize = pending
                .iter()
                .map(|segment| segment.text.split_whitespace().count())
                .sum();
            let ready = ended
                || first_heard.is_some_and(|at| now - at >= max)
                || (words >= min_words && now - quiet_since >= pause);
            if ready || now >= deadline {
                let mut cursor = self.live.lock().expect("live cursor");
                cursor
                    .delivered
                    .extend(pending.iter().map(|segment| segment.id.clone()));
                cursor.ended |= ended;
                drop(cursor);
                let speakers = params.speakers.unwrap_or(true);
                return Ok(live_chunk(&snapshot, &pending, ended, speakers).to_string());
            }
            tokio::time::sleep(LIVE_POLL).await;
        }
    }

    #[tool(
        description = "Ask the user a question and get their spoken answer as text. The question appears on their screen and their next dictation goes to you instead of their cursor. They may take a while or skip it. Ask one question at a time, and only when a spoken answer is useful, like when the user asked for it or is away from the chat. The answer is transcribed speech and can contain mistakes, so confirm anything that looks wrong before acting on it. Returns status answered with the answer, skipped, or waiting with an ask_id: call again with that ask_id to keep waiting, within about a minute or the question is withdrawn (status expired). Opens Glimpse if it isn't running.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn ask_user(
        &self,
        Parameters(params): Parameters<AskParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<String, String> {
        self.require_license()?;
        let id = match (params.ask_id, params.question) {
            (Some(id), _) => id,
            (None, Some(question)) => {
                let args = json!({ "question": question, "client": client_name(&context) });
                let (opened, connection) =
                    tokio::task::spawn_blocking(move || client::open_prompt(args))
                        .await
                        .map_err(|err| format!("{err:#}"))?
                        .map_err(|err| format!("{err:#}"))?;
                let id = opened["id"].as_str().unwrap_or_default().to_string();
                self.asks
                    .lock()
                    .expect("open asks")
                    .insert(id.clone(), connection);
                id
            }
            (None, None) => return Err("Pass a question or an ask_id.".to_string()),
        };
        let timeout = Duration::from_secs(params.timeout_seconds.unwrap_or(55).clamp(5, 3600));
        let deadline = Instant::now() + timeout;
        loop {
            // A cancelled call stops polling, so its question must not outlive it.
            if context.ct.is_cancelled() {
                self.asks.lock().expect("open asks").remove(&id);
                return Err("Cancelled.".to_string());
            }
            // Polling must not reopen an app the user just quit.
            let polled = running_app_request("prompt.poll", json!({ "id": id }))
                .await?
                .unwrap_or_else(|| json!({ "status": "expired" }));
            if polled["status"] != "waiting" {
                self.asks.lock().expect("open asks").remove(&id);
                return Ok(polled.to_string());
            }
            if Instant::now() >= deadline {
                return Ok(json!({ "status": "waiting", "ask_id": id }).to_string());
            }
            tokio::time::sleep(ASK_POLL).await;
        }
    }

    #[tool(
        description = "Read the user's recent dictations, newest first, optionally only those containing some words. These are the short texts they spoke into other apps, separate from the Library.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    fn recent_dictations(
        &self,
        Parameters(params): Parameters<RecentDictationsParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let records = match params.query.as_deref().map(str::trim) {
            Some(query) if !query.is_empty() => self.storage.search_transcriptions(query, limit),
            _ => self.storage.get_recent_transcriptions_page(limit, 0),
        }
        .map_err(|err| format!("{err:#}"))?;
        let dictations: Vec<HistoryRecord> = records.iter().map(HistoryRecord::from).collect();
        Ok(json!({ "count": dictations.len(), "dictations": dictations }).to_string())
    }

    #[tool(
        description = "Bookmark the current moment in the recording in progress in Glimpse, with an optional note. It stays with the recording in the Library.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn add_bookmark(
        &self,
        Parameters(params): Parameters<BookmarkParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let args = params
            .label
            .map_or(json!({}), |label| json!({ "label": label }));
        running_app_request("record.bookmark", args)
            .await?
            .map(|data| data.to_string())
            .ok_or_else(|| "No recording is in progress.".to_string())
    }

    #[tool(
        description = "Start recording in Glimpse with the sources the user last used. Opens Glimpse if it isn't running.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn start_recording(&self) -> Result<String, String> {
        self.require_license()?;
        Ok(app_request("record.start", json!({})).await?.to_string())
    }

    #[tool(
        description = "Stop the recording in progress in Glimpse and save it to the Library. Returns the new item's id.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn finish_recording(
        &self,
        Parameters(params): Parameters<FinishRecordingParams>,
    ) -> Result<String, String> {
        self.require_license()?;
        let args = json!({ "name": params.name.unwrap_or_default() });
        running_app_request("record.finish", args)
            .await?
            .map(|data| data.to_string())
            .ok_or_else(|| "No recording is in progress.".to_string())
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
                 Their dictations are in recent_dictations. To get a spoken answer from them, call ask_user. \
                 Find items with search_library or list_recent, then read one with get_transcript. \
                 To work along with a recording in progress, call wait_for_live_transcript in a loop. \
                 Transcribe a file directly with transcribe_audio.",
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

/// The name the client gave, shown in Glimpse while it follows a recording.
/// Names are often ids like `claude-code`, so those are title-cased.
fn client_name(context: &RequestContext<RoleServer>) -> String {
    let Some(client) = context.client_info() else {
        return String::new();
    };
    if let Some(title) = client.title.filter(|title| !title.is_empty()) {
        return title;
    }
    client
        .name
        .split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// The control socket client blocks while it connects or launches the app.
async fn app_request(command: &'static str, args: Value) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || client::request_data(command, args))
        .await
        .map_err(|err| format!("{err:#}"))?
        .map_err(|err| format!("{err:#}"))
}

async fn running_app_request(command: &'static str, args: Value) -> Result<Option<Value>, String> {
    tokio::task::spawn_blocking(move || {
        client::try_request_data(command, args, "Glimpse reported an error")
    })
    .await
    .map_err(|err| format!("{err:#}"))?
    .map_err(|err| format!("{err:#}"))
}

async fn live_snapshot(follower: String) -> Result<Value, String> {
    let snapshot = tokio::task::spawn_blocking(move || {
        client::try_request_data(
            "record.live",
            json!({ "client": follower }),
            "Glimpse could not read the live transcript",
        )
    })
    .await
    .map_err(|err| format!("{err:#}"))?
    .map_err(|err| format!("{err:#}"))?
    .unwrap_or_else(|| json!({ "status": "not_running" }));
    if snapshot["live"] == "unavailable" {
        return Err("Live transcription needs a downloaded local speech model in Glimpse.".into());
    }
    Ok(snapshot)
}

fn live_segments(snapshot: &Value) -> Vec<LiveSegment> {
    snapshot
        .get("segments")
        .and_then(|segments| serde_json::from_value(segments.clone()).ok())
        .unwrap_or_default()
}

fn live_chunk(snapshot: &Value, segments: &[LiveSegment], ended: bool, speakers: bool) -> Value {
    let status = if ended {
        "ended"
    } else {
        snapshot["status"].as_str().unwrap_or("idle")
    };
    let mut out = json!({ "status": status, "transcript": live_lines(segments, speakers) });
    if let Some(started_at) = snapshot.get("started_at") {
        out["started_at"] = started_at.clone();
    }
    let note = match status {
        "ended" => Some(
            "The recording ended. Its full transcript is in the Library: find it with list_recent, then read it with get_transcript.",
        ),
        "recording" | "paused" if segments.is_empty() => Some("Nothing new has been said yet."),
        "recording" | "paused" => None,
        _ => Some("No recording is in progress in Glimpse."),
    };
    if let Some(note) = note {
        out["note"] = json!(note);
    }
    out
}

/// One line per speaker turn, `[m:ss] Speaker: text`, times from the start of
/// the recording.
fn live_lines(segments: &[LiveSegment], speakers: bool) -> String {
    let mut lines: Vec<(u64, &str, String)> = Vec::new();
    for segment in segments {
        match lines.last_mut() {
            Some((start_ms, speaker, text))
                if *speaker == segment.speaker && segment.start_ms < *start_ms + LIVE_LINE_MS =>
            {
                text.push(' ');
                text.push_str(&segment.text);
            }
            _ => lines.push((segment.start_ms, &segment.speaker, segment.text.clone())),
        }
    }
    lines
        .iter()
        .map(|(start_ms, speaker, text)| {
            let at = super::record::clock(*start_ms);
            if speakers {
                format!("[{at}] {speaker}: {text}")
            } else {
                format!("[{at}] {text}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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
        let server = LibraryServer::new(Arc::new(storage), Arc::new(settings), false, false);

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
            assert_eq!(
                names,
                [
                    "add_bookmark",
                    "ask_user",
                    "get_live_transcript",
                    "get_transcript",
                    "list_recent",
                    "recent_dictations",
                    "search_library",
                    "transcribe_audio",
                    "wait_for_live_transcript"
                ]
            );

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
