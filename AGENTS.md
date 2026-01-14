Glimpse is a macOS voice-to-text app built with a Tauri (Rust) core and a
React/TypeScript frontend. This file sets expectations for how we build and
change the system. Keep it readable, fast, and stable.

## What matters

- Speed: invoke → record → transcribe → insert stays low-latency and resilient.
- Native macOS behavior: follow conventions for focus, shortcuts, permissions,
  accessibility, and menu bar behavior.
- Local-first: on-device processing and storage by default; cloud is optional
  and must degrade gracefully offline.
- Simplicity: prefer direct code; avoid abstraction without a concrete need.

## Architecture (high level)

Tauri is split by design:

- Rust core: OS integration, audio capture, transcription, storage, global state,
  and security-sensitive logic.
- WebView UI: renders state and collects user intent via a small set of explicit
  commands/events.

Boundary rule: business logic and secrets live in Rust. The UI should not become
a second backend.

### UI surfaces
- Pill/overlay: transient capture + status. Minimal and responsive.
- Settings: standard window for configuration and accounts.

### Data flow
Audio capture → chunking/file → transcription → optional post-processing →
insertion. Each step should have clear ownership and predictable failure modes.

### Storage
Local SQLite is the source of truth. Treat transcripts and audio as sensitive.

## Code organization and app structure

- Organize code by **responsibility and domain**, not by technical trivia.
- Files and modules should map to how someone thinks about the app
  (recording, transcription, storage, UI surfaces), not incidental helpers.
- Avoid mega-files that bundle unrelated behavior, but also avoid splitting
  logic into dozens of tiny files that only make sense when read together.
- Prefer **cohesive modules**: related logic lives together, even if the file
  is moderately sized.
- Split code when responsibilities diverge, not just because a file feels
  “large”.
- A good file or module can be understood end-to-end without jumping across
  the repo.

The goal is clarity of ownership, not an arbitrary file size.

## How we solve problems

Avoid patching around symptoms.

- Find the cause, fix the cause. Workarounds are last resort and must be
  justified.
- Prefer a clean model over scattered conditionals. If edge-case checks spread,
  the ownership/state model is likely wrong.
- Make fixes that hold up over time: address the general failure mode, not just
  one instance.
- Reduce complexity as part of fixing when possible.

## Quality bar

A change is not done until:

- The hot path works end-to-end (invoke, record, transcribe, insert).
- UI remains responsive during recording/transcription.
- Errors surface in a user-actionable way (no silent failures).
- If storage schema changes, a migration is included and tested against existing
  data.

Keep diffs small and reviewable. Prefer targeted improvements over rewrites.

## Privacy and debugging

- Do not log or leak user audio/transcripts. Debug logs must redact sensitive
  content by default.
- Cloud transcription/sync must require explicit user action and clear UI.

## Agent / contributor rule

Before writing code, read the existing implementation. Do not invent APIs,
types, or utilities that don’t exist. If you are uncertain about how something
works, surface that uncertainty instead of guessing.

This document is intentionally concise. If a change conflicts with these rules,
the change is probably wrong.
