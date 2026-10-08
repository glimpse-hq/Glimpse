<div align="center">
  <h1>Glimpse</h1>
  <p>Voice dictation and meeting transcription that run on your computer.<br />Free and unlimited dictation, on Mac and Windows.</p>
  <img
    src="./assets/readme/icon.png"
    width="256"
    height="256"
    alt="Glimpse"
  />
  <p>
    <a href="https://tryglimpse.cc/download">Download</a> ·
    <a href="https://tryglimpse.cc/">Website</a> ·
    <a href="https://tryglimpse.cc/#pricing">Pricing</a> ·
    <a href="https://tryglimpse.cc/privacy">Privacy</a>
  </p>
  <p>
    <a href="https://tryglimpse.cc/download">
      <img src="https://img.shields.io/badge/macOS%2014%2B-1d1d1f?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 14+" />
    </a>
    <a href="https://apps.microsoft.com/detail/9PJWF4W8V4WG">
      <img src="https://img.shields.io/badge/Windows%2010%2B-0078D6?style=for-the-badge&logo=windows11&logoColor=white" alt="Windows 10+, on the Microsoft Store" />
    </a>
  </p>
</div>

---

Hey! Glimpse is made mostly by me. I talk a lot faster than I type, and I wanted dictation that worked everywhere without sending my voice to someone's server or charging me every month. Nothing I tried really did all of that, so I built it.

Press your shortcut, talk, and your words show up wherever you're typing. It works offline, and dictation is free with no word limits on every model. I don't think you should have to pay to talk to your own computer. A license adds the extras, like recording meetings, AI cleanup and transcribing audio and video, and it's how I keep working on Glimpse.

Something broken or bugging you? [Open an issue](https://github.com/glimpse-hq/Glimpse/issues) or email me at [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc). I do my best to respond ASAP.

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

- **Local transcription.** Turn your wifi off, it still works. ANE supported on Apple Silicon. Pick a model in **Settings → Models**.
- **Custom dictionary.** Teach it names, brands, or terms.
- **Auto Dictionary.** It picks up your custom words on its own.
- **Replacements.** Say "my address," get 221B Baker Street.
- **History and search.** Find anything you've dictated.
- **Import.** Bring your dictionary, replacements, and history over from another dictation app.

**With a license** (14-day trial included)

- **Recording Mode.** Record meetings, calls and lectures from your microphone and your computer's audio, or only the apps you pick, like Zoom or your browser. No bot joins the call. Follow a live transcript while you record, and drop bookmarks. [More](https://tryglimpse.cc/meeting-transcription)
- **Speaker detection.** [NVIDIA Nemotron 3 Diarization](https://tryglimpse.cc/nemotron-3-diarization) labels up to 8 speakers on your computer, live and after the recording. Runs on Metal, Vulkan or CPU, no NVIDIA card needed.
- **Library.** Drop in audio or video, scrub the synced transcript, assign speakers, export to `.txt`, `.md`, `.srt`, or `.vtt`.
- **AI Cleanup.** Polish dictated text with your own LLM, set up in **Settings → Providers**.
- **Edit Mode.** Highlight text, say what you want, and watch it rewrite in place.
- **Personalization.** Different tones per app or site, with [snippets](https://github.com/glimpse-hq/Glimpse/wiki/snippets) for dynamic context.

**License only** (not included in the trial)

- **Local API.** An OpenAI-compatible speech endpoint, running on your machine.
- **CLI.** An optional `glimpse` command for the terminal.

## Integrations

- **[Raycast](https://www.raycast.com/garon/glimpse)**. Search dictations, transcribe files, switch models, and more, without leaving Raycast. Requires a [license](#pricing).
- **AI agents.** `glimpse mcp` lets Claude Code, Claude Desktop, Cursor and other MCP clients search and read your Library, on your machine. Connect it with `claude mcp add glimpse -- glimpse mcp`. Requires a [license](#pricing).
- **Your own.** The [CLI guide](https://github.com/glimpse-hq/Glimpse/wiki/CLI) covers scripting Glimpse from Shortcuts, Finder, or anything else that can run a command.

## Pricing

| Edition      | Price             | For                                       |
| ------------ | ----------------- | ----------------------------------------- |
| **Solo**     | $25 one-time      | You, on 1 device                          |
| **Plus**     | $39 one-time      | You, on up to 3 devices                   |
| **Business** | $48 / seat / year | Work use, one seat per person, one device |

Start with the 14-day trial, then buy or paste a license key in **Settings → Account**.

## Privacy

Transcription stays on-device by default. Enabling an external speech or LLM provider sends audio or text directly to that provider. Your API keys stay local.

The app sends anonymous usage telemetry to [PostHog EU](https://posthog.com/) to help prioritize development. It's tied to a random install ID, not your identity, and stored in the EU. Opt out anytime in **Settings → App**.

<details>
<summary>Exactly what's sent, and what isn't</summary>

- **Collected:** app version and platform, launches and uptime, whether the app quit normally, durations and counts, which built-in features you use, whether microphone and accessibility permissions are granted, your dictation and display language settings, a coarse hardware class (memory size range, chip family, graphics vendor), country, and bounded error/crash categories. A crash also records a code location (source file and line, or module and offset) so we can find the bug. If the app crashed, the next launch reads the crash report your OS saved and sends only the error type and module and offset frames.
- **Never sent:** transcripts, audio, API keys, prompts, raw error text or stacks, full file paths, microphone names, the apps you record, model or provider names you type in, provider endpoints, your IP address, or anything personally identifiable.

Opting out sends one final ping, then nothing, ever.

</details>

For the full picture, see the [analytics wiki](https://github.com/glimpse-hq/Glimpse/wiki/Analytics) or [`analytics/`](src-tauri/src/analytics). The website is a separate system with its own [privacy policy](https://tryglimpse.cc/privacy).

## Contributing

The [Contributing Guide](CONTRIBUTING.md) covers everything from translations to code to bug reports.

Questions, bugs, or feedback: [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc) or [GitHub Issues](https://github.com/glimpse-hq/Glimpse/issues).

## Acknowledgments

- <a href="https://lokalise.com/"><img src="./assets/readme/lokalise.png" width="16" alt="Lokalise" align="center" /></a> [Lokalise](https://lokalise.com/), localization platform and OSS supporter
- [Tauri](https://v2.tauri.app/), app framework
- [Glimpse-Speech](https://github.com/glimpse-hq/Glimpse-Speech) (MIT), local transcription engine
- [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) (MIT), on-device inference for Whisper and other speech models, through [our fork](https://github.com/glimpse-hq/transcribe.cpp)
- [Silero VAD](https://github.com/snakers4/silero-vad) (MIT), voice activity detection model

Speech models are downloaded in-app from Hugging Face. The live list lives in **Settings → Models**. By family:

- **Whisper GGUF** (MIT), via [`handy-computer`](https://huggingface.co/handy-computer)
- **Distil-Whisper GGUF** (MIT, English-only), via [Glimpse's conversions](https://huggingface.co/Glimpse-Dictation) of [`distil-whisper`](https://huggingface.co/distil-whisper)
- **Parakeet TDT V3 GGUF** (CC-BY-4.0), via [`handy-computer`](https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf), with a Neural Engine build from [`Glimpse-Dictation`](https://huggingface.co/Glimpse-Dictation/Parakeet-TDT-0.6B-V3-coreml)
- **Parakeet Ultra GGUF** (CC-BY-4.0), via [Glimpse's conversion](https://huggingface.co/Glimpse-Dictation/Parakeet-Ultra-coreml) of [`moondream/parakeet-ultra`](https://huggingface.co/moondream/parakeet-ultra), with a Neural Engine build
- **Parakeet Unified GGUF** (CC-BY-4.0, English-only), via [`handy-computer`](https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf)
- **Nemotron Streaming GGUF** (NVIDIA Open Model License), English and 3.5 multilingual, via [`handy-computer`](https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf)
- **NVIDIA Nemotron 3 Diarization GGUF** (OpenMDW 1.1), speaker detection, via [Glimpse's conversion](https://huggingface.co/Glimpse-Dictation/Nemotron-3-Diarization-gguf) of [`nvidia/Nemotron-3-Diarization`](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- **Qwen3-ASR GGUF** (Apache-2.0), via [`handy-computer`](https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf)

## License

Glimpse is open source under the [GNU AGPL-3.0](LICENSE). In short:

- **Use it freely.** Run, study, modify, and redistribute it, including commercially.
- **Share your changes.** If you distribute a modified version, or run one as a network service, its source must be available under AGPL-3.0.
- **Keep the attribution.** Copyright and license notices stay intact, and a fork must state that it is based on Glimpse and link back to this repository.
- **Pick your own name.** The Glimpse name and logo are trademarks and not covered by the license. Forks and redistributions need a different name and icon.

The [full license text](LICENSE) and [NOTICE](NOTICE) are what apply; this summary is not a substitute for them.
