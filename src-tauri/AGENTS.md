# Native app

Read `../agents/reference/architecture.md` and `../agents/reference/platforms.md` before native changes. Read `../agents/reference/decisions.md` before removing surprising behavior. Paths below are relative to `src-tauri/`.

- `src/lib.rs` wires startup, AppState, plugins, and command registration. Add commands to the owning module and register them in `generate_handler!`; do not grow the legacy command collection in `lib.rs`.
- Use the dictation or Recording Mode path identified in the architecture reference. Preserve cancellation, crash recovery, and insertion ordering; do not move background Library work onto the dictation path.
- `src/speech/` adapts the pinned Glimpse-Speech crate. Check `Cargo.toml` for the actual tag and features; do not copy engine implementations into this app. `model_manager` and `remote_speech` in `lib.rs` are aliases of existing speech modules.
- Settings persistence is `src/settings.rs`; full settings updates are `src/core/settings.rs`. Read the settings reference before adding fields or changing mutation behavior.
- CLI and MCP work belongs in `src/integrations/`; the app-managed HTTP API is `src/local_api.rs`. Read `../agents/reference/integrations.md` for their different execution and licensing paths.
- Follow existing `#[cfg]` boundaries in `src/platform/`, `src/core/keyboard/`, and `src/recording/system_audio_*.rs`. Do not introduce Linux support or assume a macOS build checks Windows code.
- `src/license.rs` has separate trial-inclusive and purchased-license guards. Use the existing feature's guard at the operation boundary; frontend visibility is not enforcement. See the settings reference before changing a gate.
- Native window changes must account for `capabilities/`, `tauri.conf.json`, and windows created in Rust. See the platform reference for creation sites and distribution differences.

Run the relevant Rust checks from `../agents/rules/done.md`; use `../scripts/tauri.mjs` through Bun for native development and packaging.
