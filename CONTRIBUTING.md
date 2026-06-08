# Contributing to Glimpse

Thanks for helping out. Glimpse is a small project with a big surface area: local speech, native integrations, two platforms. Code, translations, bug reports, or just spreading the word all help it grow.

## Ways to help

| | What you can do |
| --- | --- |
| **Translations** | Help localize Glimpse into your language |
| **Bug reports** | Tell us when something breaks |
| **Feature ideas** | Suggest improvements on GitHub |
| **Code** | Fix bugs, polish UI, improve the Rust backend |
| **Word of mouth** | Star the repo, share Glimpse, write about it |

---

## Translations

Translations run on [Lokalise](https://lokalise.com/), by invite. Email [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc) with:

- The language(s) you want to translate
- Whether you're a native speaker
- Any prior translation experience (optional)

Applications are reviewed by hand, and not every language gets approved, depending on demand and capacity. If you're in, you'll get a Lokalise invite by email.

Active translators get a **Personal** license (full access on up to 5 devices) as thanks.

> <a href="https://lokalise.com/"><img src="./assets/readme/lokalise.png" width="18" alt="Lokalise" align="center" /></a>&ensp;Translations supported by [Lokalise](https://lokalise.com/)

---

## Bug reports

Found a bug? [Open an issue](https://github.com/LegendarySpy/Glimpse/issues/new) and include:

- **Steps to reproduce:** what you did, in order
- **Expected vs. actual:** what you thought would happen, and what did
- **Environment:** your OS version, and your Glimpse version (Settings → About)

For UI bugs, a screenshot or screen recording goes a long way.

For security or privacy issues, email [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc) instead of opening a public issue.

---

## Feature requests

Have an idea? [Open an issue](https://github.com/LegendarySpy/Glimpse/issues/new) with what you'd like and why it's useful. Check [existing issues](https://github.com/LegendarySpy/Glimpse/issues) first to avoid duplicates.

Glimpse is local-first by design. Features that send audio or transcripts to a server by default probably won't fit the project's direction.

---

## Code contributions

1. Fork the repo and create a branch from `main`.
2. Set up a local build ([Building locally](#building-locally)).
3. Make your changes and test them on the platform(s) you touched.
4. Open a pull request **targeting `main`** with a clear description of what changed and why.

All PRs target `main`, regardless of the current release version.

**What we're looking for in PRs:**

- Changes that extend existing code rather than adding parallel systems
- Platform parity when touching macOS- or Windows-specific behavior
- `bun run build` and `cargo check --manifest-path src-tauri/Cargo.toml` passing

---

## Spread the word

Star the repo, tell a friend, mention Glimpse in a post or on social. Visibility is what keeps a small project going.

---

## Building locally

### macOS

**Prerequisites:** macOS 14+, [Rust](https://rustup.rs/) 1.74+, [Bun](https://bun.sh/) 1.3+, Xcode Command Line Tools

```bash
xcode-select --install
git clone https://github.com/LegendarySpy/Glimpse.git
cd Glimpse
bun install
bun tauri dev    # Development with hot reload
bun tauri build  # Production build
```

### Windows

**Prerequisites:** Windows 10/11, [Bun](https://bun.sh/) 1.3+, [Rust](https://rustup.rs/) with the MSVC toolchain, Visual Studio Build Tools with **Desktop development with C++** / MSVC, and the Microsoft Edge WebView2 Runtime.

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc
git clone https://github.com/LegendarySpy/Glimpse.git
cd Glimpse
bun install
bun tauri dev    # Development with hot reload
bun tauri build  # Production build
```

On Windows, `bun tauri ...` stores Cargo build artifacts in `C:\.glimpse-cargo-target` to avoid long native build paths. Override with `CARGO_TARGET_DIR` or `GLIMPSE_CARGO_TARGET_DIR` if needed.

If you run Cargo directly on Windows, set a short target directory first:

```powershell
$env:CARGO_TARGET_DIR = "C:\.glimpse-cargo-target"
cargo check --manifest-path src-tauri/Cargo.toml
```

> [!TIP]
> After a production build on macOS, you may need to re-enable accessibility permissions in System Settings for text insertion to work.
