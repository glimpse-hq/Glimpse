# Decisions

These look wrong or redundant but are deliberate. Don't "fix" them. Add one line when you make a decision the code can't explain.

- **Cached mic permission gate** in `pill.rs`. The fresh check can block for minutes; a failed stream start shows the permission toast and refreshes the cache.
- **The pill shows pre-roll until audio arrives.** It must never look ready before the mic is live.
- **Hold and Toggle modes stay next to Smart.** Pedals and switch access need deterministic behavior.
- **Edit Mode is its own toggle, not part of cleanup.** It changes what the words mean.
- **Whole-struct `update_settings`.** See `settings.md`.
- **Whisper runs with non-speech tokens allowed, plus segment × VAD masking** against hallucinated phrases. Phrase blocklists, audio trimming, `no_speech_prob`, and `avg_logprob` were measured and failed.
- **Apple Speech is batch-only.** Its streaming output is too bursty for the pill.
- **Writing features need a license whatever model runs them**, including on-device Apple models.
- **Trial expiry degrades to free.** Notices are in-app only, fire only after a dictation, and have a budget. No OS notifications, nothing on a timer or at launch.
- **No sentiment gate before review asks.** Store policy forbids it.
- **The trial is not hardened against tampering.** The app is open source.
- **The commercial license card copy ("per seat", device suffix) is intentional.**
- **`transcription_mode` stays although the Cloud/Local UI is gone.** It's a placeholder for a possible managed service.
- **CLI writes and the local API check the license at call time**, not only at install.
