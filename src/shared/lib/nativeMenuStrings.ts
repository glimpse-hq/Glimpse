import { msg } from "@lingui/core/macro";

// Tray and macOS menu bar labels, built in Rust. Nothing imports this: it
// exists so lingui extract writes these keys into messages.po, which
// src-tauri/build.rs compiles into a Rust table. The `native.` prefix is
// the contract build.rs selects on.
export const NATIVE_MENU_STRINGS = [
  // license switch from a checkout link
  msg({
    id: "native.license.switch_title",
    message: "Switch to a different license?",
  }),
  msg({
    id: "native.license.switch_message",
    message:
      "You opened a link for license {new_key}. Switching removes license {current_key} from this device. Only switch if you just bought the new license.",
  }),
  msg({
    id: "native.license.switch_downgrade",
    message: "The new license may include less than your current one.",
  }),
  msg({ id: "native.license.switch_confirm", message: "Switch License" }),
  msg({ id: "native.license.switch_keep", message: "Keep Current License" }),
  msg({
    id: "native.toast.license_switch_failed",
    message:
      "Glimpse couldn't activate the license from that link. Your current license was not changed.",
  }),
  // shared between the tray and the macOS menu bar
  msg({ id: "native.menu.check_updates", message: "Check for Updates" }),
  msg({
    id: "native.menu.check_updates_long",
    message: "Check for Updates...",
  }),
  msg({ id: "native.menu.microphone", message: "Microphone" }),
  msg({ id: "native.menu.recording_start", message: "Start Recording" }),
  msg({ id: "native.menu.recording_active", message: "Recording" }),
  msg({ id: "native.menu.recording_paused", message: "Recording paused" }),
  msg({ id: "native.menu.recording_pause", message: "Pause Recording" }),
  msg({ id: "native.menu.recording_resume", message: "Resume Recording" }),
  msg({ id: "native.menu.recording_bookmark", message: "Add Bookmark" }),
  msg({ id: "native.menu.recording_finish", message: "Finish Recording..." }),
  msg({ id: "native.menu.mic_system_default", message: "System Default" }),
  msg({ id: "native.menu.mic_none", message: "No input devices found" }),
  msg({ id: "native.menu.mic_default_suffix", message: "{name} (Default)" }),
  msg({
    id: "native.menu.mic_unavailable",
    message: "Microphone unavailable ({error})",
  }),
  msg({ id: "native.menu.models", message: "Models" }),
  msg({ id: "native.menu.model_fallback", message: "Fallback: {model}" }),
  msg({ id: "native.menu.recent", message: "Last Transcriptions" }),
  msg({ id: "native.menu.copy_last", message: "Copy Last Transcription" }),
  msg({ id: "native.menu.recent_empty", message: "No transcriptions yet" }),
  msg({ id: "native.menu.recent_empty_item", message: "Empty transcription" }),
  msg({
    id: "native.menu.recent_error",
    message: "Unable to load transcriptions",
  }),
  msg({ id: "native.menu.send_feedback", message: "Send Feedback" }),

  // tray only
  msg({ id: "native.tray.open", message: "Open {app}" }),
  msg({ id: "native.tray.quit", message: "Quit {app}" }),

  // macOS menu bar only
  msg({ id: "native.menu.services", message: "Services" }),
  msg({ id: "native.menu.hide", message: "Hide {app}" }),
  msg({ id: "native.menu.hide_others", message: "Hide Others" }),
  msg({ id: "native.menu.show_all", message: "Show All" }),
  msg({ id: "native.menu.quit", message: "Quit {app}" }),
  msg({ id: "native.menu.view", message: "View" }),
  msg({ id: "native.menu.close_window", message: "Close Window" }),
  msg({ id: "native.menu.fullscreen", message: "Toggle Full Screen" }),
  msg({ id: "native.menu.minimize", message: "Minimize" }),
  msg({ id: "native.menu.zoom", message: "Zoom" }),
  msg({ id: "native.menu.edit", message: "Edit" }),
  msg({ id: "native.menu.undo", message: "Undo" }),
  msg({ id: "native.menu.redo", message: "Redo" }),
  msg({ id: "native.menu.cut", message: "Cut" }),
  msg({ id: "native.menu.copy", message: "Copy" }),
  msg({ id: "native.menu.paste", message: "Paste" }),
  msg({ id: "native.menu.select_all", message: "Select All" }),
  msg({ id: "native.menu.help", message: "Help" }),
  msg({ id: "native.menu.github.v2", message: "GitHub" }),

  msg({
    id: "native.toast.too_quiet",
    message: "That was too quiet to hear. Recording deleted.",
  }),
  msg({
    id: "native.toast.no_speech",
    message: "No speech detected. Recording deleted.",
  }),
  msg({
    id: "native.toast.no_words",
    message: "No words detected. Recording deleted.",
  }),
  msg({ id: "native.toast.writing_model_title", message: "Writing model" }),
  msg({
    id: "native.toast.writing_model_edit_kept",
    message: "Your selected text was left alone.",
  }),
  msg({
    id: "native.toast.writing_model_raw_kept",
    message: "Your words were left as dictated.",
  }),
  msg({ id: "native.toast.open_settings_action", message: "Open Settings" }),
  msg({
    id: "native.toast.dictionary_suggest",
    message: 'Add "{word}" to the dictionary?',
  }),
  msg({ id: "native.toast.dictionary_add", message: "Add" }),
  msg({ id: "native.toast.dictionary_never", message: "Never" }),
  msg({ id: "native.toast.update_available", message: "Update available." }),
  msg({ id: "native.toast.update_action", message: "Update" }),
  msg({ id: "native.provider.speech", message: "Speech provider" }),
  msg({ id: "native.provider.writing", message: "Writing model" }),
  msg({
    id: "native.provider.rate_limited",
    message: "{subject} rate limit reached.",
  }),
  msg({
    id: "native.provider.rate_limited_retry",
    message: "{subject} rate limit reached. Try again in about {seconds} s.",
  }),
  msg({ id: "native.provider.quota", message: "{subject} quota exceeded." }),
  msg({
    id: "native.provider.unauthorized",
    message: "{subject} API key is invalid or expired.",
  }),
  msg({
    id: "native.provider.rejected",
    message: "{subject} rejected the request.",
  }),
  msg({
    id: "native.provider.rejected_detail",
    message: "{subject} rejected the request: {detail}",
  }),
  msg({
    id: "native.provider.not_found",
    message: "{subject} endpoint or model was not found.",
  }),
  msg({
    id: "native.provider.unreachable",
    message: "{subject} is unreachable.",
  }),
  msg({
    id: "native.provider.cleanup_language_unsupported",
    message: "The cleanup model doesn't support this language yet.",
  }),
  msg({
    id: "native.provider.fallback_local",
    message: "Using your local model instead.",
  }),
  msg({
    id: "native.provider.no_fallback",
    message: "No local model is installed to fall back to.",
  }),
  msg({
    id: "native.provider.not_configured",
    message:
      "Finish setting up the speech provider in Settings before turning it on.",
  }),
  msg({
    id: "native.toast.speech_provider_title",
    message: "Speech provider",
  }),
  msg({
    id: "native.error.no_model_installed",
    message: "No transcription model installed",
  }),
  msg({
    id: "native.error.no_model_selected",
    message: "No transcription model selected",
  }),
  msg({
    id: "native.error.edit_needs_writing_model",
    message: "Editing selected text needs a writing model",
  }),
  msg({ id: "native.error.microphone", message: "Microphone error" }),
  msg({ id: "native.error.permission", message: "Permission denied" }),
  msg({
    id: "native.error.pasted_to_clipboard",
    message: "Pasted to clipboard instead",
  }),
  msg({
    id: "native.error.transcription_timeout",
    message: "Transcription took too long. You can retry it from Home.",
  }),
  msg({
    id: "native.error.transcription_failed",
    message: "Transcription failed",
  }),
  msg({
    id: "native.error.mic_permission_mac",
    message:
      "Glimpse needs microphone access. Allow it in System Settings > Privacy & Security > Microphone.",
  }),
  msg({
    id: "native.error.mic_permission_windows",
    message:
      "Glimpse needs microphone access. Allow it in Settings > Privacy & security > Microphone.",
  }),
  msg({
    id: "native.error.mic_unavailable",
    message: "Your microphone isn't available. Check that it's connected.",
  }),
  msg({
    id: "native.error.mic_stuck",
    message: "Glimpse can't open your microphone. Try restarting Glimpse.",
  }),
  msg({ id: "native.error.recording_failed", message: "Recording failed" }),
  msg({
    id: "native.toast.admin_app_shortcut",
    message:
      "Windows doesn't let Glimpse hear your shortcut in apps running as administrator. To dictate there, run Glimpse as administrator too.",
  }),
  msg({
    id: "native.toast.admin_app_paste",
    message:
      "That app runs as administrator, so Windows doesn't let Glimpse type into it. Your text is on the clipboard. Press Ctrl+V to paste it.",
  }),
  msg({
    id: "native.toast.no_audio",
    message:
      "Glimpse got no sound from your microphone. Check which microphone is selected in Settings.",
  }),
  msg({
    id: "native.transcription.no_words",
    message: "No words detected",
  }),
  msg({
    id: "native.toast.no_words_kept",
    message:
      "No words detected. The recording is in Home, where you can retry it.",
  }),
  msg({ id: "native.toast.cancelled", message: "Transcription cancelled" }),
  msg({
    id: "native.toast.mic_removed.v2",
    message:
      "Microphone disconnected. The recording stopped and was saved to Home.",
  }),
  msg({
    id: "native.toast.recording_mic_switched",
    message:
      "The microphone stopped responding. The recording continues with {name}.",
  }),
  msg({
    id: "native.toast.recording_mic_lost",
    message:
      "The microphone stopped responding and no other microphone was found. Glimpse will switch to one as soon as it's connected.",
  }),
  msg({
    id: "native.toast.recording_disk_full",
    message:
      "Your disk is full, so Glimpse stopped recording. What was recorded so far is saved.",
  }),
  msg({
    id: "native.toast.recording_write_failed",
    message:
      "Glimpse couldn't keep writing the recording, so it stopped. What was recorded so far is saved.",
  }),
  msg({
    id: "native.quit_recording.title",
    message: "Quit while recording?",
  }),
  msg({
    id: "native.quit_recording.message",
    message:
      "The recording is saved to your Library and transcribed the next time you open Glimpse.",
  }),
  msg({ id: "native.quit_recording.save", message: "Save and Quit" }),
  msg({ id: "native.quit_recording.keep", message: "Keep Recording" }),
  msg({
    id: "native.update.recording",
    message: "Finish the recording before installing the update.",
  }),
  msg({
    id: "native.toast.recording_low_disk",
    message:
      "Your disk is almost full. Glimpse will stop recording if it runs out of space.",
  }),
  msg({
    id: "native.toast.dictation_disk_full",
    message: "Your disk is full, so Glimpse couldn't save this dictation.",
  }),
  msg({
    id: "native.toast.retranscribe_failed",
    message:
      "Glimpse couldn't transcribe this again, so it kept the earlier transcript.",
  }),
  msg({
    id: "native.toast.milestone",
    message: "{count} words dictated with Glimpse!",
  }),
  msg({ id: "native.toast.copied", message: "Copied to clipboard" }),
  msg({
    id: "native.toast.copy_failed",
    message: "Unable to copy to clipboard",
  }),
  msg({
    id: "native.toast.copy_missing",
    message: "Transcription no longer available",
  }),
  msg({ id: "native.toast.copy_empty", message: "Transcription is empty" }),
  msg({
    id: "native.toast.library_trash_failed",
    message:
      "Couldn't move the audio to the Trash or Recycle Bin, so the item is back in your Library.",
  }),

  msg({
    id: "native.toast.export_done",
    message: "Exported {pairs} audio and text pairs.",
  }),
  msg({
    id: "native.toast.export_skipped_short",
    message: "Skipped {count} short clips.",
  }),
  msg({
    id: "native.toast.transcripts_exported",
    message: "Exported {count} transcripts.",
  }),
  msg({
    id: "native.toast.export_skipped_files",
    message: "{count} files couldn't be copied.",
  }),

  msg({
    id: "native.toast.license_inactive",
    message:
      "Your license is inactive. Dictation stays free. Some features need an active license.",
  }),
  msg({
    id: "native.toast.trial_expired.v4",
    message:
      "Your trial ended. Dictation stays free. Library, Record and Personalization need a Glimpse license.",
  }),
  msg({
    id: "native.toast.trial_last_day.v4",
    message:
      "Last day of your trial. Dictation stays free. After today, Library, Record and Personalization need a Glimpse license.",
  }),
  msg({
    id: "native.toast.trial_days_left.v4",
    message:
      "{days} days left in your trial. Dictation stays free. After that, Library, Record and Personalization need a Glimpse license.",
  }),
  msg({ id: "native.toast.manage_license", message: "Manage license" }),
  msg({ id: "native.toast.see_options", message: "See options" }),

  msg({
    id: "native.toast.model_downloading",
    message: "Your speech model is still downloading. {percent}% done.",
  }),
  msg({
    id: "native.toast.model_preparing",
    message: "Getting your speech model ready. This runs in the background.",
  }),
  msg({
    id: "native.toast.model_none",
    message: "Glimpse needs a speech model before it can type for you.",
  }),
  msg({ id: "native.toast.model_action", message: "Open Models" }),
  msg({
    id: "native.toast.model_ready",
    message: "Your speech model is ready. Press your shortcut to dictate.",
  }),

  msg({ id: "native.toast.accessibility_title", message: "Accessibility" }),
  msg({
    id: "native.toast.accessibility_shortcut",
    message:
      "Your shortcut won't work until you allow Glimpse in Accessibility. If Glimpse is already on, turn it off and on again.",
  }),
  msg({
    id: "native.toast.accessibility_paste",
    message:
      "Glimpse couldn't type this because Accessibility access is off. Your text is on the clipboard, so you can paste it with Command-V.",
  }),
  msg({
    id: "native.toast.accessibility_granted",
    message: "Accessibility is on. Your shortcut works now.",
  }),
  msg({
    id: "native.toast.open_system_settings",
    message: "Open System Settings",
  }),

  msg({
    id: "native.toast.model_switched_title",
    message: "Now using {model}",
  }),
  msg({
    id: "native.toast.model_switched",
    message:
      "Automatic picked a newer model for you. Change it anytime in Settings.",
  }),
  msg({ id: "native.toast.open_settings", message: "Settings" }),
  msg({
    id: "native.toast.speaker_model_upgraded",
    message:
      "Speaker detection now uses a new model that tells people apart more accurately.",
  }),
  msg({
    id: "native.toast.recovering",
    message: "Recovering your last recording...",
  }),
  msg({ id: "native.toast.recovered_one", message: "Recording recovered" }),
  msg({ id: "native.toast.recovered_many", message: "Recordings recovered" }),
  msg({
    id: "native.recording.default_name",
    message: "Recording - {date}",
  }),
  msg({
    id: "native.toast.recovered_saved_one.v2",
    message: "Recording saved to Home.",
  }),
  msg({
    id: "native.toast.recovered_saved_many.v2",
    message: "Recordings saved to Home.",
  }),
  msg({ id: "native.toast.view_home", message: "Open Home" }),
];
