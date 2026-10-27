import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { RecordingSessionState } from "../../types";

// Nothing but digital silence means a muted, blocked or dead microphone.
const MUTED_MICROPHONE_MS = 3_000;
// A working microphone may just not have been spoken into yet.
const QUIET_MICROPHONE_MS = 20_000;
// Apps are often silent at first, before a call or video starts.
const SILENT_SYSTEM_MS = 10_000;

// Names the first source that has stayed silent, or null. A dismissed
// warning stays hidden until the recording ends.
export function useSilenceWarning(state: RecordingSessionState) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (state.status === "idle" && dismissed !== null) setDismissed(null);
  const warning = useCurrentWarning(state);
  return {
    warning: warning === dismissed ? null : warning,
    dismiss: () => setDismissed(warning),
  };
}

function useCurrentWarning(state: RecordingSessionState) {
  const { t } = useLingui();
  if (state.status !== "recording") return null;

  const { microphone, system_audio } = state.sound;
  const elapsed = state.elapsed_ms;
  const systemApps = state.sources.system_audio ?? [];
  if (
    state.sources.system_audio &&
    !state.system_audio_off &&
    system_audio !== "heard" &&
    elapsed >= SILENT_SYSTEM_MS
  ) {
    return systemApps.length === 1
      ? t({
          id: "live.silent.app",
          message: `No sound from ${systemApps[0]} yet.`,
        })
      : t({ id: "live.silent.system", message: "No system audio yet." });
  }
  const microphoneSilent =
    (microphone === "none" && elapsed >= MUTED_MICROPHONE_MS) ||
    (microphone === "quiet" && elapsed >= QUIET_MICROPHONE_MS);
  if (state.sources.microphone && !state.microphone_off && microphoneSilent) {
    return t({
      id: "live.silent.microphone",
      message: "No sound from the microphone yet.",
    });
  }
  return null;
}
