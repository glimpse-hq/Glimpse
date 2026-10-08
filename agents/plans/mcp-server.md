# MCP server over the Library

Let AI agents (Claude Code, Claude Desktop, Cursor) search and read the user's Library transcripts through a local Model Context Protocol server. Granola, Jamie, Otter and Monologue ship one; Handy lists one as upcoming.

## Shape

- **Transport: stdio, from the existing CLI binary.** `glimpse mcp` speaks MCP on stdin/stdout. Agents launch MCP servers as child processes, so there is no port, no auth token, nothing listening, and the server lives exactly as long as the agent session.
- **One more integration verb, not a new layer.** `mcp` joins the owned commands in `src-tauri/src/integrations/` next to `library`, `history` and `transcribe`. It opens the same `transcriptions.db` through `integrations::open_storage`, queries it through `StorageManager` and `library::repo`, and reuses `LibraryFilter` search, `extract_search_terms`, `item_summary` and `build_export_content`. No new store, cache, or index.
- **Nothing in Glimpse-Speech.** This is app data and an app concern.

## Tools

| Tool              | Reads                                                                                                              | Reuses                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `search_library`  | Items whose name or transcript match every word; `#tag` terms filter by tag                                        | `LibraryFilter.search`, the same query the Library search box runs                                |
| `list_recent`     | Newest items, optional status filter and `since_days`                                                              | `get_library_items_page`, same as `glimpse library list`                                          |
| `get_transcript`  | One item: metadata, speakers, and timestamped segments with speaker names; or a rendered `txt`/`md`/`srt`/`vtt`    | `get_library_item`, `speaker_name`, `build_export_content`, same as `glimpse library export`      |
| `transcribe_file` | Only with `--allow-import`. Queues a file into the Library and returns its id; read it later with `get_transcript` | `library.import` over the control socket, same as `glimpse library import`; needs the app running |

Search and list return a short snippet instead of the full transcript, so a broad query doesn't flood the agent's context. `get_transcript` returns the whole thing.

## Licensing

The CLI and the Local API are "license only" (not in the trial). `glimpse mcp` runs the same startup gate as `glimpse serve`: refresh the cached grant when due, then require `license::active_license_gate`. The gate moves out of `run_cli` into one function both paths call. Each tool call checks the cached license again, locally, because an agent session can outlast it. `transcribe_file` is also gated per call inside the app by `handlers::require_license`, like every app-routed CLI command.

## Privacy

- Local only. stdio, no network listener; the process never sends data anywhere. The agent the user connected decides what happens with the text it reads, which is the user's choice of client.
- Read-only by default. The only write, `transcribe_file`, needs `--allow-import` on the command line the user put in their agent config.
- Nothing is logged: stdout is the protocol channel, and stderr never carries transcripts, queries or file paths. No telemetry, matching the CLI.

## SDK

`rmcp` 3.5.1, the official Rust SDK (modelcontextprotocol/rust-sdk). `initialize` negotiates up to MCP 2025-11-25, the last revision with a handshake; rmcp also serves 2026-07-28 clients through per-request metadata. Features: `server`, `macros`, `transport-io`, default features off. It handles version negotiation, capabilities and JSON Schema for tool inputs (via `schemars`), which a hand-rolled JSON-RPC loop over `serde_json` would have to track by hand as the spec moves. The lockfile gains `rmcp`, `rmcp-macros`, `futures`, and second versions of `schemars_derive` (1.x) and `serde_derive_internals` (0.30); `schemars`, `pastey`, `tokio` and `serde` are already in the tree. Resolving them also moves a few crates from `windows-sys` 0.60 to 0.61, which was already locked. The CLI already spins a tokio runtime for license refresh.

## Connecting

Claude Code:

```sh
claude mcp add glimpse -- glimpse mcp
```

On Windows, `glimpse` is a `.cmd` shim, which agents can't launch without `cmd`:

```sh
claude mcp add glimpse -- cmd /c glimpse mcp
```

Claude Desktop, in `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "glimpse": { "command": "glimpse", "args": ["mcp"] }
  }
}
```

On Windows, use `"command": "cmd", "args": ["/c", "glimpse", "mcp"]`.

Claude Desktop doesn't inherit the shell `PATH`, so use the full path from `which glimpse` (`/usr/local/bin/glimpse` or `/opt/homebrew/bin/glimpse` on macOS; the shim under `%LOCALAPPDATA%` on Windows) if it can't find the command. Cursor takes the same `mcpServers` block in `~/.cursor/mcp.json`. Add `"--allow-import"` to `args` to let the agent queue files.

## Later

- Dictation history tools (`search_history`) over the same `history` queries.
- Paging long transcripts by time range, so a two-hour meeting fits a small context.
- MCP resources (`glimpse://library/<id>`) for clients that browse rather than call tools.
- A Settings → Integrations row that copies the `claude mcp add` line.
