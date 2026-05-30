Glimpse is a macOS / Windows Tauri app: Rust backend, React/TypeScript frontend,
three native windows (not a routed SPA).

## Agent rule

- Read the existing implementation before changing it.
- Extend the existing owner. Do not add routers, stores, service layers, design
  systems, or query wrappers alongside what is here.
- If a file is large but cohesive, keep it cohesive. Split only on real
  responsibility boundaries.
- If this document and the code disagree, follow the code and fix this document.

## What matters

- Speed: keep invoke → record → transcribe → insert low-latency.
- Native platform behavior: menu bar/accessory, shortcuts, permissions, focus,
  overlay — correct on both macOS and Windows.
- Local-first: transcripts, audio, and API keys stay local by default.
- Simplicity: extend existing owners instead of adding layers.

## Mental model

- Rust owns business logic, native windows, hotkeys, audio, transcription,
  storage, updater, permissions, tray/menu, and privacy-sensitive code.
- React owns rendering, local interaction state, query cache, and thin
  command/event clients.
- Supported on macOS and Windows. Keep platform-specific code behind
  `platform/{macos,windows}/` and `#[cfg]` boundaries; do not let one platform
  regress the other.
- Tooling is intentionally simple: Bun + Vite, Cargo + Tauri. Do not add build
  layers.

## Windows

`main` (pill overlay), `toast` (transient), `settings` (settings/history/library).
Labels and behavior must stay aligned across `tauri.conf.json`,
`capabilities/*.json`, `src-tauri/src/lib.rs`, `src-tauri/src/platform/**`, and
`src/app/App.tsx`.

## Backend ownership

- `lib.rs`: composition root, `AppState`, plugin/command registration. Wiring
  only.
- `pill.rs`: shortcut-driven recording lifecycle, overlay state, selected-text
  capture, media pause/resume.
- `recorder.rs`: recorder thread, audio preprocessing, WAV persistence.
- `transcribe.rs`: dictation orchestration, chunking/dedupe, completion/error
  events, storage writes.
- `speech/`: single owner of transcription model orchestration.
  - `mod.rs`: `transcribe()` router (model id decides local vs remote),
    `selected_model()`, `warm()`, shared chunk/VAD constants.
  - `catalog.rs`: `list_models()` (remote entry first, then locals).
  - `engine.rs`: loaded local ASR engine lifecycle. No duplicate warm/load
    logic elsewhere.
  - `install.rs`: local model catalog, install state, downloads.
  - `remote.rs`: remote provider HTTP, fallback, toasts.
- `assistive.rs`: text insertion and selected-text access.
- `mode_context.rs`, `accessibility_context.rs`: active app/site context.
- `llm_cleanup.rs`: optional LLM cleanup/edit, provider routing, preflight cache.
- `settings.rs` + `core/settings.rs`: schema/persistence in `settings.db`,
  validation, post-save side effects.
- `storage.rs`: dictation history and migrations in `transcriptions.db`.
- `library/`: `repo.rs` (SQL), `processing.rs` (filesystem/transcode),
  `queue.rs` (single-flight + progress/cancellation/recovery), `commands.rs`
  (Tauri boundary).
- `dictionary.rs`, `personalization.rs`: domain logic.
- `toast.rs`, `tray.rs`, `platform/macos/menu.rs`: chrome ownership.
- `update_checker.rs`: background checks, install flow, restart marker.
- `crypto.rs`: API-key encryption.

## Frontend ownership

- `app/App.tsx`: routes by Tauri window label, not URL.
- `Home.tsx`: settings-window shell.
- `features/settings/useSettingsForm.ts`: editable settings + autosave.
- `features/settings/models-queries.ts`: `useSpeechModels()` and
  `resolveSpeechModelLabel()` — single source for model lists and display
  labels across pickers, history, and library.
- `features/onboarding/{machine,OnboardingScreen}.ts(x)`: step flow + first
  settings write.
- `features/pill/`: XState + canvas overlay.
- `features/toast/`: event-driven window.
- `features/transcriptions/`, `features/library/`: React Query + event-driven.
- `features/dictionary/`, `features/personalization/`: local state + direct
  invoke.
- `shared/lib/*`: static metadata/formatting only — not a service layer.
- `shared/ui/*`: small reusable primitives.
- `types/*`: shared frontend types.

## Change map

- Persisted setting → `settings.rs`, `core/settings.rs`,
  `useSettingsForm.ts`, and onboarding if first-use-relevant.
- Mode/model/mic behavior → keep tray + macOS app menu in sync. Preserve
  save → menu refresh → `settings:changed`.
- Transcription payloads/events → update Rust emitter, frontend consumer, and
  `src/types/*` together.
- Permissions/plugin access → `tauri.conf.json`, `capabilities/*.json`,
  `Info.plist`, `Entitlements.plist`.
- Library storage/status → `storage.rs`, `library/repo.rs`,
  `library/queue.rs`, `library/processing.rs`, `features/library/queries.ts`.
- Window behavior → Rust window config, native platform code, frontend
  label-based routing.

## Storage and privacy

- `settings.db`: settings KV.
- `transcriptions.db`: dictation history + `library_items`.
- `app_data_dir/library`: imported media, transcoded files, exports.
- No alternate stores for settings or history.
- Do not log transcripts, audio, prompts, or API keys.
- Secret handling stays in `settings.rs` and `crypto.rs`.

## Done means

- `bun run build` and `cargo check --manifest-path src-tauri/Cargo.toml` pass.
- The affected hot path still works end-to-end: invoke → record → transcribe
  → insert, with responsive UI and actionable errors.
- Targeted tests for parser/validation/migration/hotkey logic. No broad test
  scaffolding.
