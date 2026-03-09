0.7.0

### Features
- Apps & websites in personalization now show their icons.
- AI Cleanup and LLM model providers are now separate, allowing you to use features like personalization without using Cleanup.


### Changes
- Removed Moonshine support, as it didn't serve a purpose.
- Glimpse now requires MacOS 14+
- Parakeet V3 now only supports Auto mode.
- Glimpse now uses Glimpse-Speech as the local transcription backend. Whisper transcription is now 30% faster.
- Added a copy button to error toasts


### Fixes
- Text would create newlines at end of chunk.
- Capital letters from merged library recordings. 
- Dictionary would not apply past 30 seconds on transcription & library.
- Fixed a bug where library item's could be stuck cancelling.
---
0.6.7

### Features

- Added the ability to try pre-release builds. (If you like to test things and sending feedback, this would be a big help!)

### Changes

- Reverted back to the previous hotkey system. This should fix using hotkeys with macros.

### Fixes
- Setting hotkeys should be much less finicky now, recording shouldn't trigger when trying to set hotkeys.
- Many other hyper-niche bug fixes





---
0.6.6

### Fixes

- Fixed Whisper hallucinations where "Thank you." would be added in silent pieces of audio.
- Fixed "An error occurred" errors from happening when spamming the transcribe button too much.

### Changes

- Added a debounce when starting and stopping recordings, this should prevent accidental double taps.

---

0.6.5

### Features

- Added the ability to change text size. (Advanced settings)

- Changed the backend hotkey manager to allow for more hotkey combinations instead of modifier key plus key; support for fn/globe key is still in the works.


### Changes

- Gently reorganized some text and sizing elements.

---


0.6.4


### Features

- Updated the Transcription Language dropdown to show available languages based on the installed model, and what models support which languages if multiple are installed.


**Personalization**

- Personalization modes now support up to 3,000 custom instruction characters with a live counter.

- You can now resize the custom instructions box.

- Holding Shift on a card now lets you quickly delete it.

### Changes

- Redesigned the model download screen and removed AI cleanup from onboarding.

- Updated design of AI Cleanup to fit the app better.

- Updated how some background tasks are run to reduce CPU usage.

### Fixes

- Cleaned up how expanding the sidebar looks in library view to feel smoother.

- Fixed custom instructions getting cut off early after closing/reopening.

- New modes now start with an empty name field when you click to rename.

- Smoothed and cleaned up the Applications/Websites list scrolling so cards keep clear space from the scrollbar.

- Improved search in AI Cleanup window
---

0.6.3


### Fixes

- Fixed "Failed to read chunk" which could happen when downloading models


---


0.6.2

### Features

- Added the ability when tagging a library item to see a list of already existing tags.

- Added the ability in the menu bar to see & copy last transcriptions.

### Changes

- Changed the ordering of the tray menu to match the Glimpse menu

### Fixes

- Fixed a visual bug where opening settings would feel laggy.



---

0.6.1

### Changes

- LLM preflight now runs in the background. If recording with LLM cleanup used to feel delayed, that lag is gone.
- Cleaned up analytics so session length is tracked more accurately. We now record which keybind was used (hold, toggle, smart) and separate active vs background time.
- New background art for the DMG install screen (temporary, still iterating).

### Fixes

- Fixed a visual bug where buttons would shift when opening the overlay.
- Library view hitboxes feel better, tag add jitter is gone, and the `+` button is a touch larger.



---

0.6.0

### Library mode
Added a new Library tab where you can drag files anywhere in the app to transcribe.

- Files can be imported into the app or transcribed from where they are.
- Tag, rename, delete, search, and filter your library items.
- Export transcripts as TXT, MD, SRT, or VTT.
- Retranscribe items with a different local model.
- Using Whisper & Parakeet models you can timestamp speech and play it back with auto highlighting.

---

0.5.5

### Changes
- Made the tray icon slightly smaller to match other apps better.
- Add slight visual fixes across the app for better uniformity.

### Fixes
- Pasting API keys & Endpoints wouldn't work.
---

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
