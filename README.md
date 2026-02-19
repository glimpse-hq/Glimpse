<div align="center">
  <h1>Glimpse</h1>
    <p>(in beta)</p>
  <img
    src="https://github.com/user-attachments/assets/c34a35a5-e2c9-469f-87c4-4c0d20c8082d"
    width="256"
    height="256"
    alt="current"
  />
    <p>Glimpse is a voice-to-text productivity app that lets you create and build at the speed of speech. Think of it as an open-source alternative to Superwhisper or Wisprflow.
</p>
</div>



> [!NOTE]
> **macOS only** — Glimpse currently supports macOS 13+ exclusively. Windows and Linux support may be added in the future.

## Download

Pre-built releases are available on the [Releases page](https://github.com/LegendarySpy/Glimpse/releases/latest). Download the latest `.dmg` and drag Glimpse to your Applications folder.

## Features

- **Local transcription** — Runs entirely on-device using Whisper, Parakeet, or Moonshine models
- **Replacements** - Directly replace words in sentences for other defined words
- **Custom dictionary** — Define custom words and phrases for accurate transcription
- **Assistive text insertion** — Automatically inserts transcribed text where you're typing
- **Edit mode** — Highlight any text and speak the changes to it
- **Personalization** — Teach Glimpse how to respond in each app or website
- **Library** — Transcribe audio & video files, export in multiple formats, and synced playback.

- **More coming soon** — See the [Roadmap](#roadmap) below

## Roadmap

- [x] Custom dictionary for words and phrases
- [ ] Temporary mode: transcribe without saving
- [x] Built-in updater
- [ ] App localization via lingui
- [x] Personalization & per-app context: per-app writing styles (email, messaging, etc.)
- [x] Edit mode: rewrite whats selected text with full context
- [x] Transcribe audio and video files
- [ ] Ask mode: query what's on your screen
- [ ] Better customizable keybinds


## Privacy

Glimpse collects anonymous usage analytics via [Aptabase](https://aptabase.com/) to help improve the app. This includes:

- App launches and exits (including uptime, recording seconds, and transcription count)
- Which transcription engine is used (local vs cloud), plus recording keybind mode (hold/toggle/smart)
- Model downloads and onboarding completion

**What's NOT collected:** transcription content, API keys, prompts, or any personally identifiable information.

Analytics are privacy-first and GDPR compliant. No opt-out is currently provided, but the data is fully anonymous. For full transparency, see [`src-tauri/src/analytics.rs`](src-tauri/src/analytics.rs) for exactly what's tracked.

## License

Glimpse is licensed under the **GNU Affero General Public License v3 (AGPL-3.0)**. You can self-host or modify it as long as changes remain open. A paid hosted option will be available for those who prefer it.

## Acknowledgments

- [Tauri](https://v2.tauri.app/) — the framework Glimpse is built on
- [Transcribe-rs](https://github.com/cjpais/transcribe-rs) (MIT) — the underlying STT engine that powers local transcription
- [whisper-rs](https://github.com/tazz4843/whisper-rs) (Unlicense) — Rust bindings used by the Whisper engine
- [ort](https://github.com/pykeio/ort) (MIT OR Apache-2.0) — ONNX Runtime bindings used by Parakeet and Moonshine

### Models

These are models that can be downloaded in the app from Huggingface (license shown is the license declared by the upstream model repository).

- Whisper (GGML) (MIT): `ggml-large-v3-turbo-q8_0.bin`, `ggml-small-q5_1.bin` from [`ggerganov/whisper.cpp`](https://huggingface.co/ggerganov/whisper.cpp) (derived from OpenAI Whisper models such as [`openai/whisper-large-v3-turbo`](https://huggingface.co/openai/whisper-large-v3-turbo), also MIT)
  
- Parakeet TDT 0.6B v3 (ONNX) (CC-BY-4.0): FP32/Int8 variants from [`istupakov/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) (base model [`nvidia/parakeet-tdt-0.6b-v3`](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), CC-BY-4.0)
  
- Moonshine (ONNX) (MIT): Tiny/Base variants from [`UsefulSensors/moonshine`](https://huggingface.co/UsefulSensors/moonshine)

## For Developers

### Building Locally

#### Prerequisites

- macOS 13+
- [Rust](https://rustup.rs/) 1.74+
- [Bun](https://bun.sh/) (or npm/pnpm)
- Xcode Command Line Tools

```bash
xcode-select --install
```

#### Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/LegendarySpy/Glimpse.git
cd Glimpse
bun install
```

#### Development

Run in development mode with hot reload:

```bash
bun tauri dev
```

#### Production Build

Build a release version:

```bash
bun tauri build
```

> [!TIP]
> After running production builds, you may need to re-enable accessibility permissions in System Settings for text insertion to work.
