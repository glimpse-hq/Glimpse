# Architecture

Rust paths below are relative to `src-tauri/src/`. Frontend paths start with `src/`.

## Hot path

1. `core/keyboard/` detects the shortcut; `pill.rs` runs the recording lifecycle, captures selected text for Edit Mode, and shows the overlay.
2. `recorder.rs` captures and preprocesses audio and persists the WAV for crash recovery.
3. `transcribe.rs` chunks, calls `speech::transcribe()`, filters, applies replacements, personalization, and optional `llm_cleanup.rs`.
4. Its post-processing path calls `assistive::paste_text` before completion reporting and history persistence. Preserve cancellation checks before the paste.

Work that can wait (notices, asks, analytics) runs after insertion. For analytics that means not even an enqueue: keep outcomes in locals and report after the paste. `analytics::set_activity` (one atomic store) and the stall watchdog's single timer spawn are the exceptions.

## Where things go

- New Tauri commands go in their owning module, registered in `lib.rs`. `lib.rs` still holds older commands; don't add to them.
- `speech/` owns model lifecycle and routing mechanisms; recording and transcription callers reuse them. The local model catalog is `speech/catalog.rs`. Do not introduce another loader or catalog in a feature.
- Engines, remote provider HTTP, and VAD belong in Glimpse-Speech. On-device language models (Apple Intelligence, G1) belong in Glimpse-Language; `llm_cleanup.rs` builds the prompts and `g1.rs` manages G1's files and loaded model. Glimpse only passes config from settings. A local `[patch]` for testing is never committed.
- `integrations/` adapts CLI and MCP requests to existing owners; see `integrations.md`. `local_api.rs` manages the HTTP transcription server backed by Glimpse-Speech.
- Frontend model lists and labels come through `src/features/settings/models-queries.ts`.
- `src/shared/lib/` is static metadata and formatting, not a service layer.
- Event payloads change together: Rust emitter, frontend consumer, `src/types/*`.
- Mode, model, or mic changes keep the tray and macOS app menu in sync.

## Toasts

Toasts render only in the `toast` window, which must be shown natively, so always raise them from Rust (`toast::emit_toast`, `toast::show_with_action`). A toast button calls `invoke(action)`, so actions must be real commands; `retryId` carries per-toast data, mapped in `handleToastAction`. If another window must react, the command emits an event it listens for.

## Storage

`settings.db` holds settings; `transcriptions.db` holds history and Library metadata. Audio, model files, and recording recovery manifests also live on disk. Reuse the existing storage owners instead of adding a parallel store.

## Library and Recording Mode

- `recording/` captures long-form microphone and system-audio tracks, persists recovery data under `recording-sessions`, and produces Library items. `recording/live.rs` and `recording/live_window.rs` own live transcription and the native sidebar.
- `library/commands.rs` is the command boundary; `queue.rs` schedules jobs and cancellation; `processing.rs` handles media processing and export; `repo.rs` handles Library SQL through `StorageManager` in `storage.rs`.
- Reuse the Library queue for background transcription. Preserve its cancellation tokens and lock ordering; do not launch a competing job runner from a new UI or integration.
- `data_export.rs` owns dataset export and delete-all. Keep file traversal and cleanup there; deletion must disable launch at login before removing settings directories.
