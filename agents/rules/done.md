# Done

Choose checks for the change. Run commands from the repository root. Do not run app builds for prose-only edits or reformat unrelated files.

| Changed area                   | Validation                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation only             | Check referenced paths and commands, format the edited Markdown, and run `git diff --check`.                                                                                                                  |
| Frontend                       | Format edited files, then `bun run lint:ci` and `bun run build`. Run relevant existing tests in `tests/frontend/` when behavior changes.                                                                      |
| Rust                           | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo check --manifest-path src-tauri/Cargo.toml`, and relevant existing tests with `cargo test --manifest-path src-tauri/Cargo.toml <filter>`. |
| User-facing strings            | Follow `../reference/i18n.md`, run `bun run lingui:extract` and `bun run lingui:compile`, and inspect catalog changes. Check Rust too when native menu strings change.                                        |
| Native UI or platform behavior | Exercise the affected flow in the native app on the available platform. A frontend build cannot validate focus, shortcuts, permissions, paste, audio capture, or deep links.                                  |

- Format specific frontend or Markdown files with `bun run prettier --write <paths>`. For Rust formatting fixes use `cargo fmt --manifest-path src-tauri/Cargo.toml` and inspect its scope. `bun run format` rewrites the entire repository; use it only when that scope is intended.
- `bun run format:check` is the read-only repository formatting check. `bun run test:frontend` runs the full existing frontend suite; a focused run is `bun --no-install test tests/frontend/<file>.test.ts`.
- Do not add tests unless asked. Run relevant existing coverage; when asked for tests, target meaningful regressions rather than prose, styling, or checks that mirror implementation.
- `.github/workflows/ci.yml` checks versions, formatting, strict lint, frontend build, and frontend tests. `.github/workflows/platform.yml` runs Rust tests on macOS and Windows. Linux CI is for platform-independent checks, not a supported app target.
- Reread the complete diff, including new files, and run `git diff --check`. Report what passed, failed, or was not verified. A macOS Cargo check does not validate Windows-only code; do not claim CI passed without observing it.
- `CHANGELOG.md` is for users: short `Fixed ...` / `Improved ...` bullets describing what they notice, never internals. Documentation maintenance alone does not need an app changelog entry.

## Git

- Commit only when asked. Never push unless asked.
- Stage only files you changed, by name. Other work may be in progress in the tree.
- No AI attribution trailers.
