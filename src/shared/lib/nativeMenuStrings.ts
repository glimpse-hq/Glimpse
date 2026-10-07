import { msg } from "@lingui/core/macro";

// Tray and macOS menu bar labels, built in Rust. Nothing imports this: it
// exists so lingui extract writes these keys into messages.po, which
// src-tauri/build.rs compiles into a Rust table. The `native.` prefix is
// the contract build.rs selects on.
export const NATIVE_MENU_STRINGS = [
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
  msg({ id: "native.menu.github", message: "Github" }),

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
  msg({ id: "native.toast.cancelled", message: "Transcription cancelled" }),
  msg({
    id: "native.toast.mic_removed",
    message: "Microphone disconnected. Recording stopped and saved to History.",
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
    id: "native.toast.export_done",
    message: "Exported {pairs} audio and text pairs.",
  }),
  msg({
    id: "native.toast.export_skipped_short",
    message: "Skipped {count} short clips.",
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
    id: "native.toast.trial_expired",
    message:
      "Your trial ended. Dictation stays free. Some features need a license.",
  }),
  msg({
    id: "native.toast.trial_last_day",
    message:
      "Last day of your trial. Dictation stays free. Some features need a license.",
  }),
  msg({
    id: "native.toast.trial_days_left",
    message:
      "{days} days left in your trial. Dictation stays free. Some features need a license.",
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
    id: "native.toast.model_switched",
    message: "Glimpse now uses {model} for dictation.",
  }),
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
    id: "native.toast.recovered_saved_one",
    message: "Recording saved to History.",
  }),
  msg({
    id: "native.toast.recovered_saved_many",
    message: "Recordings saved to History.",
  }),
  msg({ id: "native.toast.view_history", message: "View History" }),
];
