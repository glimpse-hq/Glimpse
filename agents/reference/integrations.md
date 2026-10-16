# CLI, MCP, and local API

Paths below are relative to `src-tauri/src/`. Keep adapters thin and reuse app owners.

## CLI and app control

- `main.rs` distinguishes GUI launch from CLI launch; `lib.rs::run_cli` dispatches app-owned verbs to `integrations/` and engine-owned verbs to Glimpse-Speech. Check `integrations/mod.rs` before adding a command.
- Headless reads open existing databases. Mutations and app-controlled transcription go through `integrations/client.rs`, the local socket protocol in `ipc.rs`, `server.rs`, and `handlers.rs` to the running app.
- Preserve JSON output and exit-code behavior in `integrations/mod.rs` and `output.rs`. Do not write directly to the database from a new CLI mutation and bypass settings events, licensing, or job scheduling.

## MCP

`integrations/mcp.rs` implements `glimpse mcp` over stdio with `rmcp`. Keep stdout reserved for the protocol. It uses the existing Library database in query-only mode and checks an active license at startup and on tool calls.

The default tools read Library data. `transcribe_file` is exposed only with `--allow-import` and queues work through the running app. Preserve this opt-in and reuse Library search, export, and queue behavior. The repository's `agents/plans/mcp-server.md` records design history; the implementation is authoritative.

## HTTP API

`local_api.rs` manages the app's Glimpse-Speech HTTP server and emits `local-api:status` and `local-api:log`. This is separate from CLI control IPC and MCP stdio. Preserve call-time license checks, shutdown handling, and the API-key requirement when listening on LAN (`0.0.0.0`).
