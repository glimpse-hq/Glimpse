0.5.1

### Changes

- Removed animations between pages.

- Redesigned models tab to group by model type, and other QoL changes

### Fixes

- Fixed a bug where the info button would reopen after it was clicked while already open.

---

0.5.0


## New Features & improvements

**Edit Mode:** 
You can now use voice commands to edit highlighted text ("Make this more professional"). This can be enabled in settings under 'edit mode' and requires LLM cleanup if on local mode

**Auto unloading:** 
Added an idle unloading feature for local models to save your system memory when not in use (5 min).

**Redesigned Toasts:**
Toasts are now fully redesigned to use space better, check for auto updates, and be overall cleaner. 

### UI/UX Changes:

- Redesigned Settings and Account views for a cleaner look.
- Updated "What's New" to show history of past releases.
- Onboarding now displays model sizes and includes account confirmation steps.
- Transcription list now has MarkDown support.

### Fixes
- Fixed a bug where toast notifications could cause the app to soft-lock.
- Fixed issues causing duplicate transcriptions and weird whitespace pasting.
- Improved handling for "Smart Press" vs. "Hold" shortcuts so they don't conflict.
- Fixed the startup "blip" and made window expansion smoother.
- Removed all user content (transcripts/responses) from application logs.


### Technical changes
- Switched from MP3 encoding to WAV.
- Switched to Accessibility API for grabbing selected text (with clipboard fallback).
- Pinned `tauri-plugin-aptabase` and `tauri-nspanel` versions.