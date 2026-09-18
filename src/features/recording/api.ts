import { invoke } from "@tauri-apps/api/core";
import type {
  AudioApp,
  Bookmark,
  LibraryItem,
  RecordingCapabilities,
  RecordingSessionState,
  RecordingSources,
} from "../../types";

export const RECORDING_STATE_EVENT = "recording-session:state";

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

export async function pauseRecordingSession(): Promise<RecordingSessionState> {
  return invoke<RecordingSessionState>("pause_recording_session");
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
