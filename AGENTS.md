Glimpse is a local-first dictation app for macOS and Windows (never Linux). Tauri 2: Rust in `src-tauri/`, React + TypeScript in `src/`. Transcription engines live in the sibling crate Glimpse-Speech and on-device language models in Glimpse-Language, both pinned by git tag.

## Before editing

- Read `agents/rules/code.md` and `agents/rules/done.md`. For interface changes, also read `agents/rules/ui.md`.
- Read `src/AGENTS.md` for frontend work and `src-tauri/AGENTS.md` for native work, even when starting from the repository root. Use `agents/README.md` to select the relevant reference docs.
- Check `git status --short` and the existing diff before editing. Preserve unrelated work.
- Research before implementing: trace the existing owner and callers, check dependencies already in use, and consult primary documentation for unfamiliar APIs or approaches. Extend the existing path instead of layering a second solution over it.
- Keep edits tied to the requested behavior. Finding a large file or a legacy exception is not a reason to reorganize unrelated code.
- If guidance and code disagree, verify the behavior and fix the stale guidance. Plans in `agents/plans/` are proposals, not implementation truth.

## Product boundaries

- Bun only, never npm or npx.
- Four native windows, routed by label in `src/app/App.tsx`: `main` (pill overlay), `toast`, `live` (recording sidebar), `settings` (everything else).
- Rust owns logic, audio, storage, native windows, and anything privacy-sensitive. React renders and calls commands.
- The hot path is shortcut → record → transcribe → insert. Nothing may add latency before insertion.
- Local dictation is free and unlimited with every model. Paid features are the extras around it.

## Commands

Run from the repository root. Use the Bun version declared in `package.json`.

- `bun install --frozen-lockfile`: install the locked frontend dependencies.
- `bun run tauri dev`: run and visually verify the native app through the platform-aware wrapper. The frontend and backend are coupled; do not launch a standalone frontend server for app work.
- Choose checks from `agents/rules/done.md` for the files and behavior changed. Do not add tests for every edit.
- Leave changes uncommitted unless asked to commit. Never push unless asked.
