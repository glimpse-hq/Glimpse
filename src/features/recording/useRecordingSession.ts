import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as recordingApi from "./api";
import type { RecordingSessionState } from "../../types";

const IDLE_STATE: RecordingSessionState = {
  status: "idle",
  elapsed_ms: 0,
  sources: {},
  levels: { microphone: 0, system_audio: 0 },
  bookmarks: [],
  finish_requested: false,
};

// Meters rise fast and fall slowly so speech reads as movement, not flicker.
const LEVEL_ATTACK = 0.7;
const LEVEL_RELEASE = 0.25;

const smooth = (previous: number, next: number) => {
  const factor = next > previous ? LEVEL_ATTACK : LEVEL_RELEASE;
  const value = previous + (next - previous) * factor;
  return value < 0.02 ? 0 : value;
};

/// Mirrors the backend session; the backend streams state while active.
export function useRecordingSession() {
  const [state, setState] = useState<RecordingSessionState>(IDLE_STATE);
  const levelsRef = useRef(IDLE_STATE.levels);

  const applyState = useCallback((next: RecordingSessionState) => {
    levelsRef.current = {
      microphone: smooth(levelsRef.current.microphone, next.levels.microphone),
      system_audio: smooth(
        levelsRef.current.system_audio,
        next.levels.system_audio,
      ),
    };
    setState({ ...next, levels: levelsRef.current });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    recordingApi
      .getRecordingSessionState()
      .then((next) => {
        if (!cancelled) applyState(next);
      })
      .catch(() => {});

    listen<RecordingSessionState>(
      recordingApi.RECORDING_STATE_EVENT,
      (event) => {
        if (!cancelled) applyState(event.payload);
      },
    )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applyState]);

  return { state, applyState };
}
