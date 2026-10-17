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
  installed: { key: string; label: string }[];
};

type LanguageModelPanelProps = {
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
};

const LanguageModelPanel = ({
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
}: LanguageModelPanelProps) => {
  const { t } = useLingui();
  const providerPreset = getProviderPreset(llmProvider);
  const hasSelectedProvider = Boolean(providerPreset);
  const isOnDevice = Boolean(providerPreset?.onDevice);
  const isG1 = llmProvider === "bonsai";
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
        if (!cancelled) setG1Status({ supported: false, installed: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isMac, llmProvider]);

  // Backend probe hides this on Windows, Intel Macs, and macOS < 26.
  const showAppleProvider =
    isMac && appleAvailability !== null && appleAvailability !== "unsupported";
  // Hidden on Windows and Intel Macs.
  const showG1Provider = isMac && Boolean(g1Status?.supported);
  const g1Installed = g1Status?.installed ?? [];
  const g1Model =
    g1Installed.find((model) => model.key === llmModel)?.key ??
    g1Installed[0]?.key ??
    null;
  const g1LockedText = t({
    id: "settings.language_model.g1.locked",
    message: "Needs a purchased Glimpse Plus license",
  });

  const g1StatusText = !activeLicense
    ? g1LockedText
    : g1Status === null
      ? " "
      : g1Installed.length > 0
        ? t({
            id: "settings.language_model.g1.ready",
            message: "Installed on this Mac.",
          })
        : t({
            id: "settings.language_model.g1.not_installed",
            message: "Not installed.",
          });

  const appleStatusText =
    appleAvailability === null
      ? " "
      : appleAvailability === "not_enabled"
        ? t({
            id: "settings.language_model.apple.not_enabled",
            message:
              "Turn on Apple Intelligence in System Settings to use this.",
          })
        : appleAvailability === "not_ready"
          ? t({
              id: "settings.language_model.apple.not_ready",
              message: "The Apple Intelligence model is still downloading.",
            })
          : appleAvailability === "unsupported"
            ? t({
                id: "settings.language_model.apple.unsupported",
                message: "Not supported on this Mac.",
              })
            : t({
                id: "settings.language_model.apple.ready",
                message: "Built into this Mac.",
              });

  return (
    <div className="grid row-span-4 [grid-template-rows:subgrid] gap-3 rounded-lg bg-surface-surface p-2.5">
      <div className="px-2 py-1.5">
        <h3 className="ui-text-label-strong ui-color-primary">
          {t({
            id: "settings.language_model.title.v2",
            message: "Writing model",
          })}
        </h3>
      </div>

      <div className="px-2">
        <label className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
        </label>
        <Dropdown
          value={llmProvider}
          ariaLabel={t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
          onChange={(val) => {
            setLlmProvider(val);
            const preset = getProviderPreset(val);
            if (preset) {
              setLlmEndpoint(preset.endpoint);
              setLlmModel(preset.defaultModel);
            }
          }}
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
              value: "_local_header" as LlmProvider,
              label: t({
                id: "settings.language_model.provider.local",
                message: "Local",
              }),
              isHeader: true,
            },
            ...LOCAL_PROVIDERS.filter((p) =>
              p.id === "apple"
                ? showAppleProvider
                : p.id === "bonsai"
                  ? showG1Provider
                  : p.id !== "custom",
            ).map((p) => ({
              value: p.id,
              label: p.label,
              locked: p.id === "bonsai" && !activeLicense,
              description:
                p.id === "bonsai" && !activeLicense
                  ? g1LockedText
                  : p.onDevice
                    ? t({
                        id: "settings.language_model.provider.on_device",
                        message: "On-device",
                      })
                    : p.endpoint,
            })),
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
            id: "settings.language_model.provider.select",
            message: "Select provider...",
          })}
          searchable
          searchPlaceholder={t({
            id: "settings.language_model.provider.search",
            message: "Search providers...",
          })}
          className="mt-2"
          buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
          menuClassName="min-w-[240px]"
        />
      </div>

      {isOnDevice && (
        <div className="px-2 pb-1">
          <p className="ui-text-meta ui-color-muted">
            {isG1 ? g1StatusText : appleStatusText}
          </p>
        </div>
      )}

      {!isOnDevice && (
        <div className="px-2">
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
      )}

      {isG1 && (
        <div className="px-2 pb-1">
          <span className="ui-text-label-strong ui-color-primary block">
            {t({
              id: "settings.language_model.model",
              message: "Model",
            })}
          </span>
          <Dropdown
            value={g1Model}
            ariaLabel={t({
              id: "settings.language_model.model",
              message: "Model",
            })}
            onChange={(val) => setLlmModel(val)}
            options={g1Installed.map((model) => ({
              value: model.key,
              label: model.label,
            }))}
            placeholder={t({
              id: "settings.language_model.g1.model.none",
              message: "None installed",
            })}
            disabled={g1Installed.length < 2}
            className="mt-2"
            buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
            menuClassName="min-w-[260px]"
          />
        </div>
      )}

      {!isOnDevice && (
        <div className="px-2 pb-1">
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
            onOpen={hasSelectedProvider ? fetchAvailableModels : undefined}
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
            buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
            menuClassName="min-w-[260px]"
          />
        </div>
      )}
    </div>
  );
};

export default LanguageModelPanel;
