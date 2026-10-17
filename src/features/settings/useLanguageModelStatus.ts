import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getProviderPreset } from "../../shared/lib/llmProviders";
import { detectAppPlatform } from "../../platform/service";
import type { LlmProvider } from "../../types";

export type AppleLlmAvailability =
  "available" | "not_enabled" | "not_ready" | "unsupported";

type G1Status = {
  supported: boolean;
  installed: boolean;
};

// Whether the chosen language model can clean up dictation right now.
export function useLanguageModelStatus(
  llmProvider: LlmProvider,
  llmConfigReady: boolean,
  activeLicense: boolean,
) {
  const isMac = detectAppPlatform() === "macos";
  const [appleAvailability, setAppleAvailability] =
    useState<AppleLlmAvailability | null>(null);
  const [g1Status, setG1Status] = useState<G1Status | null>(null);

  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;
    invoke<AppleLlmAvailability>("apple_llm_availability")
      .then((value) => {
        if (!cancelled) setAppleAvailability(value);
      })
      .catch(() => {
        if (!cancelled) setAppleAvailability("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [isMac]);

  // Rescans on provider changes, so model files copied in meanwhile show up.
  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;
    invoke<G1Status>("g1_status")
      .then((value) => {
        if (!cancelled) setG1Status(value);
      })
      .catch(() => {
        if (!cancelled) setG1Status({ supported: false, installed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isMac, llmProvider]);

  // Null while an on-device probe is still answering.
  const ready: boolean | null =
    llmProvider === "bonsai"
      ? activeLicense && (g1Status === null ? null : g1Status.installed)
      : llmProvider === "apple"
        ? appleAvailability === null
          ? null
          : appleAvailability === "available"
        : !getProviderPreset(llmProvider)?.onDevice && llmConfigReady;

  return {
    appleAvailability,
    g1Installed: g1Status?.installed ?? null,
    // The backend probe hides Apple on Windows, Intel Macs, and macOS < 26.
    showApple:
      isMac &&
      appleAvailability !== null &&
      appleAvailability !== "unsupported",
    showG1: isMac && Boolean(g1Status?.supported),
    ready,
  };
}
