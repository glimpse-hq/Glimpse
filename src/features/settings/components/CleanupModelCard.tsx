import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import { detectAppPlatform } from "../../../platform/service";

type AppleLlmAvailability =
  "available" | "not_enabled" | "not_ready" | "unsupported";

type G1Status = {
  supported: boolean;
  installed: boolean;
};

type CleanupModelCardProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
  activeLicense: boolean;
  cleanupShortcutsOn: boolean;
};

const FIELD_BUTTON_CLASS =
  "!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary";

const CleanupModelCard = ({
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  availableModels,
  fetchAvailableModels,
  activeLicense,
  cleanupShortcutsOn,
}: CleanupModelCardProps) => {
  const { t } = useLingui();
  const providerPreset = getProviderPreset(llmProvider);
  const onDevice = Boolean(providerPreset?.onDevice);
  const usesService = Boolean(providerPreset && !providerPreset.onDevice);
  const isMac = detectAppPlatform() === "macos";
  const [appleAvailability, setAppleAvailability] =
    useState<AppleLlmAvailability | null>(null);
  const [g1Status, setG1Status] = useState<G1Status | null>(null);
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );

  useEffect(() => {
    if (!isMac) {
      return;
    }
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
    if (!isMac) {
      return;
    }
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

  // Backend probe hides this on Windows, Intel Macs, and macOS < 26.
  const showApple =
    isMac && appleAvailability !== null && appleAvailability !== "unsupported";
  // Hidden on Windows and Intel Macs.
  const showG1 = isMac && Boolean(g1Status?.supported);
  const onDeviceLabel = t({
    id: "settings.language_model.provider.on_device",
    message: "On-device",
  });
  const g1LockedText = t({
    id: "settings.language_model.g1.locked",
    message: "Needs a purchased Glimpse Plus license",
  });

  const selectProvider = (value: LlmProvider) => {
    if (value === llmProvider) return;
    setLlmProvider(value);
    const preset = getProviderPreset(value);
    if (preset) {
      setLlmEndpoint(preset.endpoint);
      setLlmModel(preset.defaultModel);
    }
  };

  const notReadyText = cleanupShortcutsOn
    ? t({
        id: "settings.general.cleanup.paste_as_spoken",
        message:
          "Until then, shortcuts with Clean up type exactly what you said.",
      })
    : null;

  const status = (() => {
    if (llmProvider === "bonsai") {
      if (!activeLicense) return { text: g1LockedText, ready: false };
      if (g1Status === null) return null;
      return g1Status.installed
        ? {
            text: t({
              id: "settings.general.cleanup.g1_ready",
              message: "Runs on this Mac.",
            }),
            ready: true,
          }
        : {
            text: t({
              id: "settings.general.cleanup.g1_not_installed",
              message: "G1 isn't installed on this Mac yet.",
            }),
            ready: false,
          };
    }
    if (llmProvider === "apple") {
      if (appleAvailability === null) return null;
      switch (appleAvailability) {
        case "available":
          return {
            text: t({
              id: "settings.language_model.apple.ready",
              message: "Built into this Mac.",
            }),
            ready: true,
          };
        case "not_enabled":
          return {
            text: t({
              id: "settings.language_model.apple.not_enabled",
              message:
                "Turn on Apple Intelligence in System Settings to use this.",
            }),
            ready: false,
          };
        case "not_ready":
          return {
            text: t({
              id: "settings.language_model.apple.not_ready",
              message: "The Apple Intelligence model is still downloading.",
            }),
            ready: false,
          };
        default:
          return {
            text: t({
              id: "settings.language_model.apple.unsupported",
              message: "Not supported on this Mac.",
            }),
            ready: false,
          };
      }
    }
    return {
      text: t({
        id: "settings.general.cleanup.choose_hint",
        message: "Choose a model to clean up dictation.",
      }),
      ready: false,
    };
  })();

  return (
    <div className="space-y-3 rounded-lg bg-surface-surface p-2.5">
      <div className="px-2 pt-1.5">
        <span className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.general.cleanup.with",
            message: "Clean up with",
          })}
        </span>
        <Dropdown<LlmProvider>
          value={providerPreset ? llmProvider : null}
          ariaLabel={t({
            id: "settings.general.cleanup.with",
            message: "Clean up with",
          })}
          onChange={selectProvider}
          editableInput={
            llmProvider === "custom"
              ? {
                  value: llmEndpoint,
                  onChange: setLlmEndpoint,
                  placeholder: t({
                    id: "settings.language_model.endpoint.placeholder.v2",
                    message: "https://api.example.com/v1",
                  }),
                  ariaLabel: t({
                    id: "settings.language_model.endpoint.aria",
                    message: "LLM Endpoint URL",
                  }),
                }
              : undefined
          }
          options={[
            ...(showApple || showG1
              ? [
                  {
                    value: "_device_header" as LlmProvider,
                    label: t({
                      id: "settings.general.cleanup.group.this_mac",
                      message: "On this Mac",
                    }),
                    isHeader: true,
                  },
                ]
              : []),
            ...(showG1
              ? [
                  {
                    value: "bonsai" as const,
                    label: "G1",
                    locked: !activeLicense,
                    description: activeLicense ? onDeviceLabel : g1LockedText,
                  },
                ]
              : []),
            ...(showApple
              ? [
                  {
                    value: "apple" as const,
                    label: "Apple Intelligence",
                    description: onDeviceLabel,
                  },
                ]
              : []),
            {
              value: "_local_header" as LlmProvider,
              label: t({
                id: "settings.general.cleanup.group.server",
                message: "Local server",
              }),
              isHeader: true,
            },
            ...LOCAL_PROVIDERS.filter(
              (p) => !p.onDevice && p.id !== "custom",
            ).map((p) => ({
              value: p.id,
              label: p.label,
              description: p.endpoint,
            })),
            {
              value: "custom" as LlmProvider,
              label: t({
                id: "settings.language_model.provider.custom",
                message: "Custom",
              }),
              description: t({
                id: "settings.language_model.provider.custom.description",
                message: "Enter your own endpoint URL",
              }),
            },
            {
              value: "_cloud_header" as LlmProvider,
              label: t({
                id: "settings.language_model.provider.cloud.v2",
                message: "Cloud (API key)",
              }),
              isHeader: true,
            },
            ...CLOUD_PROVIDERS.map((p) => ({
              value: p.id,
              label: p.label,
              description: p.endpoint,
            })),
          ]}
          placeholder={t({
            id: "settings.general.cleanup.model_placeholder",
            message: "Choose a model",
          })}
          searchable
          searchPlaceholder={t({
            id: "settings.language_model.provider.search",
            message: "Search providers...",
          })}
          className="mt-2"
          buttonClassName={FIELD_BUTTON_CLASS}
          menuClassName="min-w-[260px]"
        />
      </div>

      <div
        // Both layouts share one cell so the card keeps its height.
        className="grid px-2 pb-1"
      >
        <div
          className={`col-start-1 row-start-1 space-y-3 ${usesService ? "" : "invisible"}`}
          inert={!usesService}
        >
          <div>
            <span className="ui-text-label-strong ui-color-primary block">
              {t({
                id: "settings.language_model.api_key.v2",
                message: "API key",
              })}
            </span>
            <ApiKeyField
              value={llmApiKey}
              onChange={setLlmApiKey}
              placeholder={
                providerPreset?.apiKeyRequired
                  ? t({
                      id: "settings.language_model.api_key.required",
                      message: "Required",
                    })
                  : t({
                      id: "settings.language_model.api_key.optional",
                      message: "Optional",
                    })
              }
              ariaLabel={t({
                id: "settings.language_model.api_key.aria.v2",
                message: "Writing model API key",
              })}
            />
          </div>
          <div>
            <span className="ui-text-label-strong ui-color-primary block">
              {t({
                id: "settings.language_model.model",
                message: "Model",
              })}
            </span>
            <Dropdown
              value={llmModel}
              ariaLabel={t({
                id: "settings.language_model.model",
                message: "Model",
              })}
              onChange={(val) => setLlmModel(val)}
              onOpen={usesService ? fetchAvailableModels : undefined}
              options={[
                ...uniqueModels.map((model) => ({
                  value: model,
                  label: model,
                })),
                ...(llmModel && !uniqueModels.includes(llmModel)
                  ? [{ value: llmModel, label: llmModel }]
                  : []),
              ]}
              placeholder={t({
                id: "settings.language_model.model.placeholder",
                message: `Model (default: ${providerPreset?.defaultModel || "none"})`,
              })}
              searchable
              searchPlaceholder={t({
                id: "settings.language_model.model.search",
                message: "Search available models...",
              })}
              className="mt-2"
              buttonClassName={FIELD_BUTTON_CLASS}
              menuClassName="min-w-[260px]"
            />
          </div>
        </div>
        <p
          className={`col-start-1 row-start-1 ui-text-meta ${
            usesService ? "invisible" : ""
          } ${status && !status.ready && cleanupShortcutsOn ? "ui-color-warning" : "ui-color-muted"}`}
          aria-live="polite"
        >
          {status?.text}
          {onDevice && status && !status.ready && notReadyText && (
            <> {notReadyText}</>
          )}
        </p>
      </div>
    </div>
  );
};

export default CleanupModelCard;
