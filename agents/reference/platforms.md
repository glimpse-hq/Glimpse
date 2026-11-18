# Platforms

Rust paths below are relative to `src-tauri/src/` unless prefixed with `src-tauri/`.

## Windows and capabilities

`src-tauri/tauri.conf.json` declares only `main` and `toast`. `tray.rs` creates `settings`; `recording/live_window.rs` creates `live`. All four route through `src/app/App.tsx`. When changing window behavior, inspect its native creation site as well as its React view.

`native_ui/` creates two more windows without Tauri: the pill and the toast, drawn with wgpu (Metal, DX12 through DirectComposition) in a non-activating NSPanel on macOS and a no-activate tool window on Windows (`platform/*/native_window.rs`). They draw only while on screen; a frame drawn into a hidden window holds a Metal drawable and stalls the next show. Screen readers reach them through AccessKit, and macOS announcements are posted from the app because VoiceOver never queries a panel that never takes focus. If the GPU can't be used or is lost, the `main` and `toast` webviews take over. Tauri's own window builder needs its `unstable` feature, which turns every webview into a child webview, so don't use it.

`src-tauri/capabilities/` scopes plugin permissions by window and platform. Match the window that actually makes the call; do not broaden every window's permissions to fix one failing call.

## macOS (14+)

- The pill is a non-activating, click-through panel. It never gets focus or hover events.
- FoundationModels must stay weak-linked in `src-tauri/build.rs`, or the app won't launch below macOS 26. Apple-only features are shown based on backend availability checks, not frontend platform checks. The build SDK can be newer than the minimum supported runtime; check `.github/workflows/platform.yml` for the native toolchain setup.
- The microphone permission check is a blocking XPC call. It stays off the keypress path (see `decisions.md`).

## Windows (10/11)

- One executable ships direct and via the Microsoft Store (MSIX). `platform/windows/store.rs` detects the Store build at runtime; the updater is off there, and launch at login uses the `GlimpseStartup` StartupTask, which must match `src-tauri/msix/AppxManifest.xml`.
- Native builds need short target and temporary paths. `bun run tauri dev` / `bun run tauri build` use `scripts/tauri.mjs` to configure both and find Visual Studio. Direct Cargo calls bypass that wrapper; follow `.github/workflows/platform.yml` for Windows prerequisites and environment setup.
- Windows Rust usually compiles only in CI (`platform.yml`). Say so when a Windows path is untested.

## Both

`src-tauri/Cargo.toml` and `package.json` versions must match.
