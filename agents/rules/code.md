# Code

- Extend the module that owns the behavior. Do not add routers, stores, service layers, registries, or wrappers next to what exists.
- Before tidying code, ask whether it needs to exist. Deleting beats abstracting; a one-use helper is premature.
- Read the implementation before claiming something is missing or broken.
- Prefer the plain mechanism: emit raw state from Rust and let CSS or the platform handle the feel.
- Exhaust std and existing dependencies before adding one.
- macOS and Windows only. Platform code stays behind `platform/{macos,windows}/` and `#[cfg]`; no Linux fallbacks. A change on one platform must not break the other.
- No dead code, commented-out code, or `#[allow(dead_code)]` for unused code. Check `reference/decisions.md` before removing something that looks unused or wrong.

## Privacy

- Never log transcripts, audio, prompts, LLM output, selected text, or API keys.
- API keys are encrypted by `crypto.rs` and handled only in `settings.rs`.
- Data stays local by default. Anything sent off the device goes to a provider the user configured.
- Never gate or cap free local dictation.

## Comments

Comment code that is not self-explanatory: a platform quirk, a hidden constraint, an ordering that matters, something that looks wrong on purpose. Do not comment code whose behavior is obvious from reading it.

- Short, `//` style. No block comments, no comments in CSS.
- State what is true, not more ("can happen when", not "always").
- Never narrate steps, explain the change, or reference a conversation or review.
- Update or delete a comment when its code changes.
