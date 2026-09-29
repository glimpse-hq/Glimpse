import { invoke } from "@tauri-apps/api/core";
import type {
  AudioApp,
  Bookmark,
  LibraryItem,
  LiveTranscript,
  RecordingCapabilities,
  RecordingSessionState,
  RecordingSources,
} from "../../types";

export const RECORDING_STATE_EVENT = "recording-session:state";
export const LIVE_TRANSCRIPT_EVENT = "recording-session:transcript";

export async function getRecordingCapabilities(): Promise<RecordingCapabilities> {
  return invoke<RecordingCapabilities>("get_recording_capabilities");
}

export async function listAudioApps(): Promise<AudioApp[]> {
  return invoke<AudioApp[]>("list_audio_apps");
}

export async function getRecordingSessionState(): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("get_recording_session_state");
}

export async function getLastRecordingSources(): Promise<RecordingSources | null> {
  return invoke<RecordingSources | null>("get_last_recording_sources");
}

export async function startRecordingSession(
  sources: RecordingSources,
): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("start_recording_session", { sources });
}

export async function pauseRecordingSession(
  finishing = false,
): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("pause_recording_session", {
    finishing,
  });
}

export async function resumeRecordingSession(): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("resume_recording_session");
}

export async function addRecordingBookmark(): Promise<Bookmark> {
  return invoke<Bookmark>("add_recording_bookmark");
}

export async function updateRecordingBookmark(
  id: string,
  label: string | null,
): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("update_recording_bookmark", {
    id,
    label,
  });
}

export async function removeRecordingBookmark(
  id: string,
): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("remove_recording_bookmark", { id });
}

export async function discardRecordingSession(): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("discard_recording_session");
}

export async function finishRecordingSession(
  name: string,
): Promise<LibraryItem> {
  return invoke<LibraryItem>("finish_recording_session", { name });
}

export async function openSystemAudioSettings(): Promise<void> {
  await invoke("open_system_audio_settings");
}

export async function openLiveView(): Promise<void> {
  await invoke("open_live_view");
}

export async function hideLiveView(expand: boolean): Promise<void> {
  await invoke("hide_live_view", { expand });
}

export async function finishFromLiveView(): Promise<void> {
  await invoke("finish_from_live_view");
}

export async function getLiveTranscript(): Promise<LiveTranscript> {
  return invoke<LiveTranscript>("get_live_transcript");
}

export async function renameLiveSpeaker(
  id: string,
  name: string,
): Promise<void> {
  await invoke("rename_live_speaker", { id, name });
}

export async function mergeLiveSpeaker(
  from: string,
  into: string,
): Promise<void> {
  await invoke("merge_live_speaker", { from, into });
}

export async function setLiveSpeakerColor(
  id: string,
  color: string | null,
): Promise<void> {
  await invoke("set_live_speaker_color", { id, color });
}

export async function setLiveViewCompact(compact: boolean): Promise<void> {
  await invoke("set_live_view_compact", { compact });
}
