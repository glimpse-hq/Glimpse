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
    <a href="https://github.com/LegendarySpy/Glimpse/wiki/Analytics">Privacy</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Beta-FF8C42?style=for-the-badge&labelColor=2b2b2b" alt="Beta" />
    <img src="https://img.shields.io/badge/macOS%2014%2B-1d1d1f?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 14+" />
    <img src="https://img.shields.io/badge/Windows%2010%2B-0078D6?style=for-the-badge&logo=windows11&logoColor=white" alt="Windows 10+" />
  </p>
</div>

---

Glimpse is a local-first voice dictation app. No subscription, no cloud required. Core transcription runs entirely on-device, with optional AI cleanup and edit providers if you want them.

Built as an open-source alternative to Superwhisper and WisprFlow, for people who left (or never started) because of pricing or privacy concerns.

## Screenshots

<p align="center">
  <img src="./assets/readme/home.png" width="49%" alt="Glimpse home screen showing recent transcriptions" />
  <img src="./assets/readme/dictionary.png" width="49%" alt="Glimpse dictionary screen" />
</p>

<p align="center">
  <img src="./assets/readme/personalization.png" width="49%" alt="Glimpse personalization screen" />
  <img src="./assets/readme/library.png" width="49%" alt="Glimpse library screen for imported audio and video files" />
</p>

## Features

- **Local transcription.** Unplug your wifi. It still works.
- **Edit mode.** Highlight a sentence, say *"make it less formal,"* watch it rewrite in place.
- **Personalization.** Casual one-liners in Slack, full sentences in email. Different rules per app.
- **Custom dictionary.** Teach it *Tauri*, *Groq*, or your coworker's hard-to-spell last name.
- **Replacements.** Say *"my address"*, get `221B Baker Street`.
- **Library.** Drop in an `.mp4`, scrub the synced transcript, export to `.srt`, `.txt`, or `.json`.

## Roadmap

- [x] Custom dictionary
- [x] Built-in updater
- [x] Per-app personalization
- [x] Edit mode
- [x] Audio & video transcription
- [x] Auto media pausing
- [x] Recording auto deletion
- [ ] Temporary mode (transcribe without saving)
- [x] App localization
- [x] Better customizable keybinds
- [ ] Auto-dictionary
- [ ] Personalization snippets
- [x] Windows support

## Contributing

Interested in helping out? Check the [Contributing Guide](CONTRIBUTING.md) for ways to get involved, from translations to code to bug reports.

## Privacy

Glimpse keeps core transcription on-device by default. Glimpse itself does **not** collect your transcriptions, audio, prompts, or API keys.

Glimpse collects **anonymous usage telemetry** via [PostHog EU](https://posthog.com/) to help prioritize development:

- **Collected:** app launches/exits, uptime, recording count, transcription engine and keybind mode, model downloads, onboarding completion
- **Never collected by Glimpse:** transcripts, audio, API keys, prompts, or any personally identifiable information

If you enable an external LLM provider for Cleanup, Edit Mode, or Personalization, the relevant text and prompt are sent directly to that provider when those features run. Your API key stays stored locally in Glimpse.

Telemetry is tied to a random install ID (not your identity) and stored in the EU. You can **opt out** at any time in **Settings → App**. For complete transparency, see [`src-tauri/src/analytics.rs`](src-tauri/src/analytics.rs) and the [Glimpse Wiki](https://github.com/LegendarySpy/Glimpse/wiki/Analytics).

## License

Glimpse is licensed under [AGPL-3.0](LICENSE). When you distribute Glimpse or provide it as a network service, you must make the corresponding source code, including your modifications, available under the AGPL-3.0 license. An optional paid cloud tier is planned for users who want faster speeds or cloud-only features.

## Acknowledgments

- <a href="https://lokalise.com/"><img src="./assets/readme/lokalise.png" width="16" alt="Lokalise" align="center" /></a> [Lokalise](https://lokalise.com/) (localization platform, OSS supporter)
- [Tauri](https://v2.tauri.app/) (app framework)
- [Glimpse-Speech](https://github.com/LegendarySpy/Glimpse-Speech) (MIT, local transcription engine)
- [whisper-rs](https://codeberg.org/tazz4843/whisper-rs) (Unlicense, Rust bindings for Whisper)
- [parakeet-rs](https://github.com/altunenes/parakeet-rs) (MIT OR Apache-2.0, ONNX Runtime bindings for Parakeet)

**Bundled speech models** (downloaded in-app from Hugging Face):
- Whisper GGML (MIT): `ggml-large-v3-turbo-q8_0.bin`, `ggml-small-q5_1.bin` via [`ggerganov/whisper.cpp`](https://huggingface.co/ggerganov/whisper.cpp)
- Parakeet TDT 0.6B v3 ONNX (CC-BY-4.0, all builds except Intel macOS): Int8 variant via [`istupakov/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)
- Nemotron Streaming 0.6B Int8 (PolyForm Shield 1.0.0, all builds except Intel macOS): via [`lokkju/nemotron-speech-streaming-en-0.6b-int8`](https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8), with `encoder.onnx.data` from [`altunenes/parakeet-rs`](https://huggingface.co/altunenes/parakeet-rs)
