import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getProviderPreset,
  resolvedLlmEndpoint,
} from "../../shared/lib/llmProviders";
import { detectAppPlatform } from "../../platform/service";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import type { LlmProvider } from "../../types";

export type AppleLlmAvailability =
  "available" | "not_enabled" | "not_ready" | "unsupported";

type CleanupModelStatus = {
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
  licenseGateActive: boolean;
};

// Whether a server or cloud provider has what it needs to run.
export function isLlmProviderReady(setup: {
  provider: LlmProvider;
  endpoint: string;
  apiKey: string;
  model: string;
}): boolean {
  const preset = getProviderPreset(setup.provider);
  return Boolean(
    preset &&
    resolvedLlmEndpoint(setup.provider, setup.endpoint) &&
    (!preset.apiKeyRequired || setup.apiKey.trim()) &&
    setup.model.trim(),
  );
}

// Which language model cleans up right now, and whether it can. Automatic
// follows `llm_cleanup::active_provider` in Rust: the cleanup model, then Apple
// Intelligence, then the set-up server or cloud provider.
export function useLanguageModelStatus({
  llmProvider,
  llmAuto,
  llmServiceProvider,
  llmEndpoint,
  llmApiKey,
  llmModel,
  licenseGateActive,
}: LanguageSetup) {
  const isMac = detectAppPlatform() === "macos";
  const [appleAvailability, setAppleAvailability] =
    useState<AppleLlmAvailability | null>(null);
  const [cleanupModelStatus, setCleanupModelStatus] =
    useState<CleanupModelStatus | null>(null);
  const [downloadsDone, setDownloadsDone] = useState(0);
  useModelDownloadEvents({
    onComplete: () => setDownloadsDone((count) => count + 1),
  });

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

  // Rescans on provider changes and finished downloads.
  useEffect(() => {
    let cancelled = false;
    invoke<CleanupModelStatus>("cleanup_model_status")
      .then((value) => {
        if (!cancelled) setCleanupModelStatus(value);
      })
      .catch(() => {
        if (!cancelled)
          setCleanupModelStatus({ supported: false, installed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [llmProvider, downloadsDone]);

  const service = getProviderPreset(llmServiceProvider as LlmProvider);
  const serviceReady =
    Boolean(service && !service.onDevice) &&
    isLlmProviderReady({
      provider: llmServiceProvider as LlmProvider,
      endpoint: llmEndpoint,
      apiKey: llmApiKey,
      model: llmModel,
    });
  const cleanupModelInstalled = cleanupModelStatus?.installed ?? null;
  const probing =
    cleanupModelStatus === null || (isMac && appleAvailability === null);
  const activeProvider: LlmProvider | "none" | null = !llmAuto
    ? llmProvider
    : probing
      ? null
      : cleanupModelInstalled
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
        ? licenseGateActive &&
          (cleanupModelStatus === null ? null : cleanupModelStatus.installed)
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
    cleanupModelInstalled,
    showCleanupModel: Boolean(cleanupModelStatus?.supported),
    ready,
  };
}
