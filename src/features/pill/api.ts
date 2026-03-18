import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PillStatePayload, AudioSpectrumPayload } from "../../types";

export async function cancelRecording(): Promise<void> {
  await invoke("cancel_recording");
}

export function onRecordingStart(handler: () => void): Promise<UnlistenFn> {
  return listen("recording:start", () => handler());
}

export function onAudioSpectrum(
  handler: (payload: AudioSpectrumPayload) => void,
): Promise<UnlistenFn> {
  return listen<AudioSpectrumPayload>("audio:spectrum", (e) =>
    handler(e.payload),
  );
}

export function onPillState(
  handler: (payload: PillStatePayload) => void,
): Promise<UnlistenFn> {
  return listen<PillStatePayload>("pill:state", (e) => handler(e.payload));
}
