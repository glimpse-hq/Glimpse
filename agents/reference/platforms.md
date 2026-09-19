# Platforms

## macOS (14+)

- The pill is a non-activating, click-through panel. It never gets focus or hover events.
- FoundationModels must stay weak-linked in `build.rs`, or the app won't launch below macOS 26. Apple-only features are shown based on backend availability checks, not frontend platform checks.
- The microphone permission check is a blocking XPC call. It stays off the keypress path (see `decisions.md`).

## Windows (10/11)

- One executable ships direct and via the Microsoft Store (MSIX). `platform/windows/store.rs` detects the Store build at runtime; the updater is off there, and launch at login uses the `GlimpseStartup` StartupTask, which must match `src-tauri/msix/AppxManifest.xml`.
- Cargo needs a short target dir (`bun tauri` sets one; set `CARGO_TARGET_DIR` when running Cargo directly).
- Windows Rust usually compiles only in CI (`platform.yml`). Say so when a Windows path is untested.

## Both

`src-tauri/Cargo.toml` and `package.json` versions must match.
