# Done

Run these before saying done. Formatting is the one most often forgotten.

1. `bun run format`
2. `bun run lint` and `bun run build`
3. `cargo check --manifest-path src-tauri/Cargo.toml` if Rust changed
4. `bun run lingui:extract` and `bun run lingui:compile` if strings changed
5. Reread your own `git diff` and clean it before handing it over.

- Don't add tests unless asked.
- Report what passed, what failed, and what wasn't verified (for example, Windows-only code built only in CI).
- `CHANGELOG.md` is for users: describe what they will notice, never internals.

## Git

- Commit only when asked. Never push unless asked.
- Stage only files you changed, by name. Other work may be in progress in the tree.
- No AI attribution trailers.
