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
  const [dismissed, setDismissed] = useState<string[]>([]);
  if (state.status === "idle" && dismissed.length > 0) setDismissed([]);
  const warning =
    useCurrentWarnings(state).find((shown) => !dismissed.includes(shown)) ??
    null;
  return {
    warning,
    dismiss: () => warning && setDismissed([...dismissed, warning]),
  };
}

function useCurrentWarnings(state: RecordingSessionState) {
  const { t } = useLingui();
  const warnings: string[] = [];
  if (state.status !== "recording") return warnings;

  const { microphone, system_audio } = state.sound;
  const elapsed = state.elapsed_ms;
  const systemApps = state.sources.system_audio ?? [];
  const systemOn = state.sources.system_audio && !state.system_audio_off;
  if (systemOn && state.system_audio_missed) {
    warnings.push(
      systemApps.length === 1
        ? t({
            id: "live.missed.app",
            message: `${systemApps[0]} calls can only be recorded with Entire system.`,
          })
        : t({
            id: "live.missed.apps",
            message:
              "Calls in these apps can only be recorded with Entire system.",
          }),
    );
  }
  if (systemOn && system_audio !== "heard" && elapsed >= SILENT_SYSTEM_MS) {
    warnings.push(
      systemApps.length === 1
        ? t({
            id: "live.silent.app",
            message: `No sound from ${systemApps[0]} yet.`,
          })
        : t({ id: "live.silent.system", message: "No system audio yet." }),
    );
  }
  const microphoneSilent =
    (microphone === "none" && elapsed >= MUTED_MICROPHONE_MS) ||
    (microphone === "quiet" && elapsed >= QUIET_MICROPHONE_MS);
  if (state.sources.microphone && !state.microphone_off && microphoneSilent) {
    warnings.push(
      t({
        id: "live.silent.microphone",
        message: "No sound from the microphone yet.",
      }),
    );
  }
  return warnings;
}
