# Architecture

## Hot path

1. `core/keyboard/` detects the shortcut; `pill.rs` runs the recording lifecycle, captures selected text for Edit Mode, and shows the overlay.
2. `recorder.rs` captures and preprocesses audio and persists the WAV for crash recovery.
3. `transcribe.rs` chunks, calls `speech::transcribe()`, filters, applies replacements, personalization, and optional `llm_cleanup.rs`, then stores and emits.
4. `assistive.rs` inserts the text.

Work that can wait (notices, asks, analytics) runs after insertion.

## Where things go

- New Tauri commands go in their owning module, registered in `lib.rs`. `lib.rs` still holds older commands; don't add to them.
- `speech/` is the only place that loads, warms, or routes models. The local model catalog is `speech/catalog.rs`.
- Engines, remote provider HTTP, and VAD belong in Glimpse-Speech. Glimpse only passes config from settings. A local `[patch]` for testing is never committed.
- `integrations/` is only the CLI layer; logic stays in its owners.
- Frontend model lists and labels come only from `features/settings/models-queries.ts`.
- `shared/lib/` is static metadata and formatting, not a service layer.
- Event payloads change together: Rust emitter, frontend consumer, `src/types/*`.
- Mode, model, or mic changes keep the tray and macOS app menu in sync.

## Toasts

Toasts render only in the `toast` window, which must be shown natively, so always raise them from Rust (`toast::emit_toast`, `toast::show_with_action`). A toast button calls `invoke(action)`, so actions must be real commands; `retryId` carries per-toast data, mapped in `handleToastAction`. If another window must react, the command emits an event it listens for.

## Storage

`settings.db` holds settings; `transcriptions.db` holds history and Library items. No other stores.
