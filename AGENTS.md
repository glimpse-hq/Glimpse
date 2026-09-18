Glimpse is a local-first dictation app for macOS and Windows (never Linux). Tauri 2: Rust in `src-tauri/`, React + TypeScript in `src/`. Transcription engines live in the sibling crate Glimpse-Speech, pinned by git tag.

Read `agents/rules/` before changing code. Read `agents/reference/` when the task touches that area. If these docs and the code disagree, follow the code and fix the docs.

- Bun only, never npm or npx.
- Three native windows, routed by label in `src/app/App.tsx`: `main` (pill overlay), `toast`, `settings` (everything else).
- Rust owns logic, audio, storage, native windows, and anything privacy-sensitive. React renders and calls commands.
- The hot path is shortcut → record → transcribe → insert. Nothing may add latency before insertion.
- Local dictation is free and unlimited with every model. Paid features are the extras around it.
