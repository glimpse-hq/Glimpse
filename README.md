<div align="center">
  <h1>Glimpse</h1>
  <p>Voice dictation that stays on your device. Free, open-source, and built for people who actually care about privacy.</p>
  <img
    src="https://github.com/user-attachments/assets/c34a35a5-e2c9-469f-87c4-4c0d20c8082d"
    width="256"
    height="256"
    alt="Glimpse"
  />
  <p>
    <a href="https://github.com/LegendarySpy/Glimpse/releases/latest">Download</a> ·
    <a href="#roadmap">Roadmap</a> ·
    <a href="#privacy">Privacy</a>
  </p>
  <p><em>Currently in beta — macOS 14+ only</em></p>
</div>

---

Glimpse is a local-first voice dictation app for Mac. No subscription, no cloud required. It's just fast, accurate transcription powered by models running entirely on-device.

Built as an open-source alternative to Superwhisper and WisprFlow, for people who left (or never started) because of pricing or privacy concerns.

## Download

Grab the latest `.dmg` from the [Releases page](https://github.com/LegendarySpy/Glimpse/releases/latest) and drag Glimpse to your Applications folder.

## Features

- **Local transcription** — Runs entirely on-device using Whisper or Parakeet. Your audio and transcripts stay on-device.
- **Assistive text insertion** — Transcribed text is inserted directly where you're typing, in any app.
- **Edit mode** — Highlight any text, speak your changes, and Glimpse rewrites it in context.
- **Personalization** — Set per-app writing styles so Glimpse knows the difference between an email and a Slack message.
- **Custom dictionary** — Add names, jargon, or domain-specific words for more accurate transcription.
- **Replacements** — Define shortcuts that automatically expand into words, phrases, or anything else.
- **Library** — Transcribe audio and video files with synced playback and multi-format export.

## Roadmap

- [x] Custom dictionary
- [x] Built-in updater
- [x] Per-app personalization
- [x] Edit mode
- [x] Audio & video transcription
- [ ] Temporary mode (transcribe without saving)
- [ ] App localization
- [ ] Better customizable keybinds
- [ ] Auto-dictionary
- [ ] Auto media pausing
- [ ] Personalization snippets
- [ ] Windows
- [ ] Recording auto deletion

## Privacy

Glimpse runs fully on-device. Your transcriptions, audio, API keys, and prompts are **never** collected or transmitted.

Glimpse collects **anonymous usage telemetry** via [PostHog EU](https://posthog.com/) to help prioritize development:

- **Collected:** app launches/exits, uptime, recording count, transcription engine and keybind mode, model downloads, onboarding completion
- **Never collected:** transcripts, audio, API keys, prompts, or any personally identifiable information

Telemetry is tied to a random install ID (not your identity) and stored in the EU. You can **opt out** at any time in **Settings → App**. For complete transparency, see [`src-tauri/src/analytics.rs`](src-tauri/src/analytics.rs) and the [Glimpse Wiki](https://github.com/LegendarySpy/Glimpse/wiki/Analytics).

## License

Glimpse is licensed under [AGPL-3.0](LICENSE). Free to self-host and modify — just keep changes open. An optional paid cloud tier is planned for users who want faster speeds or cloud-only features.

## Acknowledgments

- [Tauri](https://v2.tauri.app/) — app framework
- [Glimpse-Speech](https://github.com/LegendarySpy/Glimpse-Speech) (MIT) — local transcription engine
- [whisper-rs](https://github.com/tazz4843/whisper-rs) (Unlicense) — Rust bindings for Whisper
- [parakeet-rs](https://github.com/altunenes/parakeet-rs) (MIT OR Apache-2.0) — ONNX Runtime bindings for Parakeet

**Bundled models** (downloaded in-app from Hugging Face):
- Whisper GGML (MIT): `ggml-large-v3-turbo-q8_0.bin`, `ggml-small-q5_1.bin` via [`ggerganov/whisper.cpp`](https://huggingface.co/ggerganov/whisper.cpp)
- Parakeet TDT 0.6B v3 ONNX (CC-BY-4.0): Int8 variant via [`istupakov/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)

## Building Locally

**Prerequisites:** macOS 14+, [Rust](https://rustup.rs/) 1.74+, [Bun](https://bun.sh/) 1.3+, Xcode Command Line Tools
```bash
xcode-select --install
git clone https://github.com/LegendarySpy/Glimpse.git
cd Glimpse
bun install
```
```bash
bun tauri dev       # Development with hot reload
bun tauri build     # Production build
```

> [!TIP]
> After a production build, you may need to re-enable accessibility permissions in System Settings for text insertion to work.
