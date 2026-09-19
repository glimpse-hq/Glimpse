import type { AudioSources, Bookmark } from "./library";

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

export type RecordingSessionState = {
  status: RecordingSessionStatus;
  elapsed_ms: number;
  sources: AudioSources;
  levels: { microphone: number; system_audio: number };
  bookmarks: Bookmark[];
  finish_requested: boolean;
};
