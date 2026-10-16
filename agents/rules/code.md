# Code

- Extend the module that owns the behavior. Do not add routers, stores, service layers, registries, or wrappers next to what exists.
- Before tidying code, ask whether it needs to exist. Deleting beats abstracting; a one-use helper is premature.
- Read the implementation before claiming something is missing or broken.
- Prefer the plain mechanism: emit raw state from Rust and let CSS or the platform handle the feel.
- Exhaust std and existing dependencies before adding one.
- macOS and Windows only. Follow the existing platform module and `#[cfg]` boundaries, including `core/keyboard/` and `recording/system_audio_*.rs`; no Linux fallbacks. A change on one platform must not break the other.
- No dead code, commented-out code, or `#[allow(dead_code)]` for unused code. Check `../reference/decisions.md` before removing something that looks unused or wrong.

## Privacy

- Never log transcripts, audio, prompts, LLM output, selected text, or API keys.
- API-key persistence and encryption handling belong in `settings.rs` and `crypto.rs`. Reuse that path; never introduce another credential store or log settings structs containing keys.
- Audio and transcript processing stays local by default. Remote processing uses the provider the user configured. Existing licensing, updates, and opt-out analytics have separate network paths; do not send user content through them.
- Never gate or cap free local dictation.

## Comments

Comment code that is not self-explanatory: a platform quirk, a hidden constraint, an ordering that matters, something that looks wrong on purpose. Do not comment code whose behavior is obvious from reading it.

- Short, `//` style. No block comments, no comments in CSS.
- State what is true, not more ("can happen when", not "always").
- Never narrate steps, explain the change, or reference a conversation or review.
- Update or delete a comment when its code changes.
