import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import ModelSourcePanel, { FIELD_BUTTON_CLASS } from "./ModelSourcePanel";
import { useLanguageModelStatus } from "../useLanguageModelStatus";

type LanguageModelPanelProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmConfigReady: boolean;
  availableModels: string[];
  fetchAvailableModels: () => void;
  activeLicense: boolean;
  cleanupShortcutsOn: boolean;
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
  llmConfigReady,
  availableModels,
  fetchAvailableModels,
  activeLicense,
  cleanupShortcutsOn,
}: LanguageModelPanelProps) => {
  const { t } = useLingui();
  const providerPreset = getProviderPreset(llmProvider);
  const usesService = Boolean(providerPreset && !providerPreset.onDevice);
  const { appleAvailability, g1Installed, showApple, showG1, ready } =
    useLanguageModelStatus(llmProvider, llmConfigReady, activeLicense);
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );
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

  const statusText = (() => {
    if (llmProvider === "bonsai") {
      if (!activeLicense) return g1LockedText;
      if (g1Installed === null) return null;
      return g1Installed
        ? t({
            id: "settings.models.language.runs_on_mac",
            message: "Runs on this Mac.",
          })
        : t({
            id: "settings.models.language.g1_not_installed",
            message: "G1 isn't installed on this Mac yet.",
          });
    }
    if (llmProvider === "apple") {
      switch (appleAvailability) {
        case null:
          return null;
        case "available":
          return t({
            id: "settings.language_model.apple.ready",
            message: "Built into this Mac.",
          });
        case "not_enabled":
          return t({
            id: "settings.language_model.apple.not_enabled",
            message:
              "Turn on Apple Intelligence in System Settings to use this.",
          });
        case "not_ready":
          return t({
            id: "settings.language_model.apple.not_ready",
            message: "The Apple Intelligence model is still downloading.",
          });
        default:
          return t({
            id: "settings.language_model.apple.unsupported",
            message: "Not supported on this Mac.",
          });
      }
    }
    return t({
      id: "settings.models.language.choose_hint",
      message: "Choose a model to clean up dictation.",
    });
  })();
  const warning = cleanupShortcutsOn && ready === false;

  return (
    <ModelSourcePanel
      label={t({
        id: "settings.models.language.clean_up_with",
        message: "Clean up with",
      })}
      warning={warning}
      showFields={usesService}
      status={
        <>
          {statusText}
          {warning && providerPreset?.onDevice && (
            <>
              {" "}
              {t({
                id: "settings.models.language.paste_as_spoken",
                message:
                  "Until then, shortcuts with Clean up type exactly what you said.",
              })}
            </>
          )}
        </>
      }
      select={
        <Dropdown<LlmProvider>
          value={providerPreset ? llmProvider : null}
          ariaLabel={t({
            id: "settings.models.language.clean_up_with",
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
                      id: "settings.models.group.this_mac",
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
                id: "settings.models.group.server",
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
      }
      fields={
        <>
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
        </>
      }
    />
  );
};

export default LanguageModelPanel;
