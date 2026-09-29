import type { AudioSources, Bookmark, Speaker } from "./library";

export type RecordingCapabilities = {
  system_audio: boolean;
  app_selection: boolean;
};

export type AudioApp = {
  id: string;
  name: string;
  icon?: string | null;
};

export type SelectedApp = {
  id: string;
  name: string;
  icon?: string | null;
};

export type RecordingSources = {
  microphone: { device_id: string | null } | null;
  system_audio: { apps: SelectedApp[] | null } | null;
};

export type RecordingSessionStatus = "idle" | "recording" | "paused" | "saving";

// "none" is digital silence, "quiet" some signal but never speech-loud.
export type SourceSound = "none" | "quiet" | "heard";

export type RecordingSessionState = {
  status: RecordingSessionStatus;
  elapsed_ms: number;
  sources: AudioSources;
  levels: { microphone: number; system_audio: number };
  sound: { microphone: SourceSound; system_audio: SourceSound };
  bookmarks: Bookmark[];
  finish_requested: boolean;
};

export type LiveSegment = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_id: string;
  settled: boolean;
};

export type LiveTranscriptStatus =
  "off" | "starting" | "live" | "catching_up" | "unavailable";

// Payload of `recording-session:transcript`. `segments` replaces the list from
// `from_index` on; when `revision` skips one, refetch with `get_live_transcript`,
// which always starts at 0.
export type LiveTranscript = {
  revision: number;
  from_index: number;
  segments: LiveSegment[];
  speakers: Speaker[];
  active_speaker_id: string | null;
  status: LiveTranscriptStatus;
};
