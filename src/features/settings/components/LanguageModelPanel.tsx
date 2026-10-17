import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import ModelSourcePanel, {
  FIELD_BUTTON_CLASS,
  MENU_CLASS,
  shortEndpoint,
  type ModelLocation,
} from "./ModelSourcePanel";
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
  const chooseModelText = t({
    id: "settings.general.cleanup.model_placeholder",
    message: "Choose a model",
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

  const location: ModelLocation | null = !providerPreset
    ? null
    : providerPreset.onDevice
      ? "device"
      : LOCAL_PROVIDERS.some((p) => p.id === llmProvider)
        ? "server"
        : "cloud";
  const readyText = t({ id: "settings.models.status.ready", message: "Ready" });

  const { status, guidance } = ((): {
    status: { text: string; ready: boolean } | null;
    guidance: string | null;
  } => {
    if (llmProvider === "bonsai") {
      if (!activeLicense) {
        return {
          status: {
            text: t({ id: "settings.models.status.locked", message: "Locked" }),
            ready: false,
          },
          guidance: g1LockedText,
        };
      }
      if (g1Installed === null) return { status: null, guidance: null };
      return {
        status: g1Installed
          ? { text: readyText, ready: true }
          : {
              text: t({
                id: "settings.models.status.not_installed",
                message: "Not installed",
              }),
              ready: false,
            },
        guidance: null,
      };
    }
    if (llmProvider === "apple") {
      switch (appleAvailability) {
        case null:
          return { status: null, guidance: null };
        case "available":
          return { status: { text: readyText, ready: true }, guidance: null };
        case "not_enabled":
          return {
            status: {
              text: t({ id: "settings.models.status.off", message: "Off" }),
              ready: false,
            },
            guidance: t({
              id: "settings.language_model.apple.not_enabled",
              message:
                "Turn on Apple Intelligence in System Settings to use this.",
            }),
          };
        case "not_ready":
          return {
            status: {
              text: t({
                id: "settings.models.status.downloading",
                message: "Downloading",
              }),
              ready: false,
            },
            guidance: null,
          };
        default:
          return {
            status: {
              text: t({
                id: "settings.models.status.unsupported",
                message: "Not supported",
              }),
              ready: false,
            },
            guidance: null,
          };
      }
    }
    return {
      status: {
        text: t({
          id: "settings.models.status.not_set_up",
          message: "Not set up",
        }),
        ready: false,
      },
      guidance: t({
        id: "settings.models.language.choose_hint",
        message: "Choose a model to clean up dictation.",
      }),
    };
  })();

  return (
    <ModelSourcePanel
      label={t({
        id: "settings.models.language.clean_up_with",
        message: "Clean up with",
      })}
      warning={cleanupShortcutsOn && ready === false}
      location={location}
      showFields={usesService}
      status={status}
      guidance={guidance}
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
              description: shortEndpoint(p.endpoint),
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
            })),
          ]}
          placeholder={chooseModelText}
          searchable
          searchPlaceholder={t({
            id: "settings.language_model.provider.search",
            message: "Search providers...",
          })}
          buttonClassName={FIELD_BUTTON_CLASS}
          menuClassName={MENU_CLASS}
        />
      }
      apiKeyField={
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
      }
      modelField={
        <Dropdown
          value={llmModel || null}
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
          placeholder={chooseModelText}
          searchable
          searchPlaceholder={t({
            id: "settings.language_model.model.search",
            message: "Search available models...",
          })}
          buttonClassName={FIELD_BUTTON_CLASS}
          menuClassName={MENU_CLASS}
        />
      }
    />
  );
};

export default LanguageModelPanel;
