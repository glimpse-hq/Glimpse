# Contributing to Glimpse

Thanks for your interest in contributing to Glimpse! There are several ways to help out, whether you write code or not.

## Translations

Translation contributors are currently added by invite only.

1. Apply here: [Translation contributor form](https://tally.so/r/EkLeyL)
2. If accepted, you'll receive a [Lokalise](https://lokalise.com/) invite by email.

Applications are reviewed manually, and contributors may not be approved for every requested language.

> <a href="https://lokalise.com/"><img src="./assets/readme/lokalise.png" width="18" alt="Lokalise" align="center" /></a>&ensp;Translations supported by [Lokalise](https://lokalise.com/)

## Bug Reports

Found a bug? [Open an issue](https://github.com/LegendarySpy/Glimpse/issues/new) with:

- Steps to reproduce
- What you expected vs. what happened
- Your macOS version and Glimpse version

## Feature Requests

Have an idea? [Open an issue](https://github.com/LegendarySpy/Glimpse/issues/new) describing what you'd like and why it would be useful. Check existing issues first to avoid duplicates.

## Code Contributions

1. Fork the repo and create a branch from `main`.
2. Follow the [Building Locally](#building-locally) steps to get set up.
3. Make your changes and test them.
4. Open a pull request **targeting `main`** with a clear description of what you changed and why.

All PRs should target `main` regardless of the current release version.

## Spread the Word

Star the repo, share Glimpse with others, or write about it. More visibility helps the project grow!


## Building Locally

### macOS

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

### Windows

**Prerequisites:** Windows 10/11, [Bun](https://bun.sh/) 1.3+, [Rust](https://rustup.rs/) with the MSVC toolchain, Visual Studio Build Tools with **Desktop development with C++** / MSVC, and the Microsoft Edge WebView2 Runtime.
```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc
git clone https://github.com/LegendarySpy/Glimpse.git
cd Glimpse
bun install
```
```powershell
bun tauri dev       # Development with hot reload
bun tauri build     # Production build
```

> [!TIP]
> After a production build, you may need to re-enable accessibility permissions in System Settings for text insertion to work.
