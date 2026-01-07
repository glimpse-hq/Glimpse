
## New Features & improvements

## Cloud Mode


**Edit Mode:** 
You can now use voice commands to edit highlighted text ("Make this more professional"). This can be enabled in settings under 'edit mode'.
**Auto unloading:** 
Added an idle unloading feature for local models to save your system memory when not in use.
### **UI/UX Changes:**
- Redesigned Settings and Account views for a cleaner look.
- Updated "What's New" to show history of past releases.
- Onboarding now displays model sizes and includes account confirmation steps.

### Fixes
- Fixed a bug where toast notifications could cause the app to soft-lock.
- Fixed issues causing duplicate transcriptions and weird whitespace pasting.
- Improved handling for "Smart Press" vs. "Hold" shortcuts so they don't conflict.
- Fixed the startup "blip" and made window expansion smoother.
- Removed all user content (transcripts/responses) from application logs.


### Technical changes
- Switched from MP3 encoding to WAV.
- Reduced API calls via batching, debouncing, and increased JWT refresh times.
- Major cleanup of frontend-backend communication and separated Cloud Mode logic from the core library.
- Switched to Accessibility API for grabbing selected text (with clipboard fallback).
- Enforced 25MB limit for audio and 10KB limit for selected text context.
- Pinned `tauri-plugin-aptabase` and `tauri-nspanel` versions.