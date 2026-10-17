import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getProviderPreset,
  resolvedLlmEndpoint,
} from "../../shared/lib/llmProviders";
import { detectAppPlatform } from "../../platform/service";
import type { LlmProvider } from "../../types";

export type AppleLlmAvailability =
  "available" | "not_enabled" | "not_ready" | "unsupported";

type G1Status = {
  supported: boolean;
  installed: boolean;
};

type LanguageSetup = {
  llmProvider: LlmProvider;
  llmAuto: boolean;
  llmServiceProvider: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  activeLicense: boolean;
};

// Which language model cleans up right now, and whether it can. Automatic
// follows `llm_cleanup::active_provider` in Rust: G1, then Apple
// Intelligence, then the set-up server or cloud provider.
export function useLanguageModelStatus({
  llmProvider,
  llmAuto,
  llmServiceProvider,
  llmEndpoint,
  llmApiKey,
  llmModel,
  activeLicense,
}: LanguageSetup) {
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

  const service = getProviderPreset(llmServiceProvider as LlmProvider);
  const serviceReady = Boolean(
    service &&
    !service.onDevice &&
    resolvedLlmEndpoint(service.id, llmEndpoint) &&
    (!service.apiKeyRequired || llmApiKey.trim()) &&
    llmModel.trim(),
  );
  const g1Installed = g1Status?.installed ?? null;
  const probing =
    (isMac && g1Status === null) || (isMac && appleAvailability === null);
  const activeProvider: LlmProvider | "none" | null = !llmAuto
    ? llmProvider
    : probing
      ? null
      : g1Installed
        ? "bonsai"
        : appleAvailability === "available"
          ? "apple"
          : serviceReady && service
            ? service.id
            : "none";

  // Null while an on-device probe is still answering.
  const ready: boolean | null =
    activeProvider === null
      ? null
      : activeProvider === "bonsai"
        ? activeLicense && (g1Status === null ? null : g1Status.installed)
        : activeProvider === "apple"
          ? appleAvailability === null
            ? null
            : appleAvailability === "available"
          : activeProvider === "none"
            ? false
            : activeProvider === llmServiceProvider
              ? serviceReady
              : false;

  return {
    activeProvider,
    serviceReady,
    appleAvailability,
    g1Installed,
    showG1: isMac && Boolean(g1Status?.supported),
    ready,
  };
}
