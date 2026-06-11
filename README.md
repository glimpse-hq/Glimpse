<div align="center">
  <h1>Glimpse</h1>
  <p>On-device voice dictation. Open-source, local-first, private by default.</p>
  <img
    src="https://github.com/user-attachments/assets/c34a35a5-e2c9-469f-87c4-4c0d20c8082d"
    width="256"
    height="256"
    alt="Glimpse"
  />
  <p>
    <a href="https://github.com/LegendarySpy/Glimpse/releases/latest">Download</a> ·
    <a href="https://tryglimpse.cc/">Website</a> ·
    <a href="#pricing">Pricing</a> ·
    <a href="#roadmap">Roadmap</a> ·
    <a href="https://tryglimpse.cc/privacy">Privacy</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Beta-FF8C42?style=for-the-badge&labelColor=2b2b2b" alt="Beta" />
    <img src="https://img.shields.io/badge/macOS%2014%2B-1d1d1f?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 14+" />
    <img src="https://img.shields.io/badge/Windows%2010%2B-0078D6?style=for-the-badge&logo=windows11&logoColor=white" alt="Windows 10+" />
  </p>
</div>

---

Glimpse is a local-first voice dictation app, an open-source take on Superwhisper and WisprFlow.

Core dictation is free, with no subscription and no cloud. It all runs on your device. The AI writing features are optional, and they use your own LLM provider only when you turn them on.

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

**Free, always**

- **Local transcription.** Turn your wifi off, it still works. ANE supported on Apple Silicon.
- **Custom dictionary.** Teach it names, brands, or terms.
- **Auto Dictionary.** It picks up your custom words on its own.
- **Replacements.** Say "my address," get 221B Baker Street.
- **History and search.** Find anything you've dictated.

**Glimpse Personal**

Included in a 14-day trial, then a one-time [license](#pricing):

- **Library.** Drop in audio or video, scrub the synced transcript, assign speakers, export to `.txt`, `.md`, `.srt`, or `.vtt`.
- **AI Cleanup.** Polish dictated text with your own LLM.
- **Edit Mode.** Highlight text, say what you want, and watch it rewrite in place.
- **Personalization.** Different tones per app or site, with [snippets](https://github.com/LegendarySpy/Glimpse/wiki/snippets) for dynamic context.
- **Local API.** An OpenAI-compatible speech endpoint, running on your machine.
- **CLI.** An optional `glimpse` command for the terminal.

Configure AI writing in **Settings → Providers**. Speech models live in **Settings → Models**.

## Pricing

Glimpse Personal is a one-time purchase, not a subscription. Core dictation stays free.

| Edition        | Price              | For                              |
| -------------- | ------------------ | -------------------------------- |
| **Personal**   | $24.99             | You, on up to 5 personal devices |
| **Commercial** | from $19.99 / seat | Work use, one person per seat    |

Commercial volume pricing:

| Seats    | Price per seat |
| -------- | -------------- |
| 1 to 5   | $19.99         |
| 6 to 15  | $17.99         |
| 16 to 30 | $14.99         |
| 31+      | $11.99         |

Start with the 14-day trial, then buy or paste a license key in **Settings → Account**.

## Roadmap

- [ ] Meeting mode
- [ ] Speaker diarization
- [x] Library overhaul
- [x] Speakers & speaker-labeled exports
- [x] CLI
- [x] API
- [x] BYOK STT
- [x] Import from other apps

## Privacy

Transcription stays on-device by default. Glimpse does not collect your transcriptions, audio, prompts, or API keys.

Anonymous usage telemetry, via [PostHog EU](https://posthog.com/), helps prioritize development:

- **Collected:** launches, exits, uptime, transcription count, transcription engine and model, model downloads, onboarding completion.
- **Never collected:** transcripts, audio, API keys, prompts, or anything personally identifiable.

Telemetry is tied to a random install ID, not your identity, and stored in the EU. Opt out anytime in **Settings → App**. See [`analytics.rs`](src-tauri/src/analytics.rs) and the [wiki](https://github.com/LegendarySpy/Glimpse/wiki/Analytics) for the full picture.

If you enable an external LLM provider, text for Cleanup, Edit Mode, and Personalization is sent directly to that provider when those features run. Your API key stays stored locally.

## License

**Source code** is licensed under [AGPL-3.0](LICENSE). If you distribute Glimpse or run it as a network service, you must make your modified source available under AGPL-3.0.

**Official app builds** include free core dictation. Advanced features (Library, AI writing, Edit Mode, Local API, CLI) require Glimpse Personal after the trial.

A hosted cloud tier (faster speeds, cloud-only features) is planned for the future.

## Contributing

Want to help? The [Contributing Guide](CONTRIBUTING.md) covers everything from translations to code to bug reports.

Questions, bugs, or feedback: [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc) or GitHub Issues.

## Acknowledgments

- <a href="https://lokalise.com/"><img src="./assets/readme/lokalise.png" width="16" alt="Lokalise" align="center" /></a> [Lokalise](https://lokalise.com/) (localization platform, OSS supporter)
- [Tauri](https://v2.tauri.app/) (app framework)
- [Glimpse-Speech](https://github.com/LegendarySpy/Glimpse-Speech) (MIT, local transcription engine)
- [whisper-rs](https://codeberg.org/tazz4843/whisper-rs) (Unlicense, Rust bindings for Whisper)
- [parakeet-rs](https://github.com/altunenes/parakeet-rs) (MIT OR Apache-2.0, ONNX Runtime bindings for Parakeet)

**Bundled speech models** (downloaded in-app from Hugging Face):

- Whisper GGML (MIT): Tiny, Base, Small, Medium, Large V3, and Large V3 Turbo, in multiple quantizations (full, Q8_0, Q5), via [`ggerganov/whisper.cpp`](https://huggingface.co/ggerganov/whisper.cpp)
- Distil-Whisper GGML (MIT, English-only): Small, Medium, and Large V3.5 (Q8_0), via [Pomni's allquants conversions](https://huggingface.co/Pomni) of [`distil-whisper`](https://huggingface.co/distil-whisper)
- Parakeet TDT 0.6B v3 ONNX (CC-BY-4.0, all builds except Intel macOS): Int8 variant via [`istupakov/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)
- Nemotron Streaming 0.6B ONNX (NVIDIA Open Model License, all builds except Intel macOS): English and multilingual 3.5 variants, via [`altunenes/parakeet-rs`](https://huggingface.co/altunenes/parakeet-rs)
