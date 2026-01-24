0.5.4

### Changes
- Improved local transcription reliability for longer recordings by chunking and VAD gating.
- Centralized scrollbar styling for more consistent UI polish.

### Fixes
- Added the ability to cancel in-progress transcription retries.
- Updates whisper prompt, this should make the dictionary perform better
- Removed username from the personality prompt

---

0.5.3

### Features
- When the app is open, you can now use spotlight / raycast to open the main window again without having to reopen it from the tray.

- Added proper mac menu bar options (the top left) allowing you to more easily change model, and adjust other settings.

- Added proper GitHub issue templates, making it easier to report bugs or request features.
### Changes
- Several internal cleanups to keep the code cleaner & slimmer.

---

0.5.2

### Features

- Added model preloading when the hotkey is pressed.

### Changes

- Enhanced accessibility and improved UI consistency across components.

- Clarified edit mode "(i) message" in General Settings.

- Cleaned up padding around the transcription list.

### Fixes

- Added guarding for unadded Appwrite credentials. (Mainly for local dev)

---

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
