import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { RecordingSessionState } from "../../types";

// A source that stays silent this long into a recording gets a warning.
const SILENCE_WARNING_MS = 20_000;
const HEARD_LEVEL = 0.4;

// Names the first source that has stayed silent, or null.
export function useSilenceWarning(state: RecordingSessionState) {
  const { t } = useLingui();
  const [heard, setHeard] = useState({ microphone: false, system: false });
  const recording = state.status === "recording";
  const active = recording || state.status === "paused";

  useEffect(() => {
    if (!recording) return;
    setHeard((prev) => {
      const microphone =
        prev.microphone || state.levels.microphone > HEARD_LEVEL;
      const system = prev.system || state.levels.system_audio > HEARD_LEVEL;
      return microphone === prev.microphone && system === prev.system
        ? prev
        : { microphone, system };
    });
  }, [recording, state.levels.microphone, state.levels.system_audio]);

  useEffect(() => {
    if (!active) setHeard({ microphone: false, system: false });
  }, [active]);

  if (!recording || state.elapsed_ms < SILENCE_WARNING_MS) return null;
  const systemApps = state.sources.system_audio ?? [];
  if (state.sources.system_audio && !heard.system) {
    return systemApps.length === 1
      ? t({
          id: "live.silent.app",
          message: `No sound from ${systemApps[0]} yet.`,
        })
      : t({ id: "live.silent.system", message: "No system audio yet." });
  }
  if (state.sources.microphone && !heard.microphone) {
    return t({
      id: "live.silent.microphone",
      message: "No sound from the microphone yet.",
    });
  }
  return null;
}
