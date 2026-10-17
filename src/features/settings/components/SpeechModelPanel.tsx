import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_SPEECH_PROVIDERS,
  getSpeechProviderPreset,
  LOCAL_SPEECH_PROVIDERS,
  supportsSpeechProviderModelDiscovery,
} from "../../../shared/lib/speechProviders";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import ModelSourcePanel, { FIELD_BUTTON_CLASS } from "./ModelSourcePanel";
import type { RemoteSpeechProvider } from "../../../types";

export type SpeechSource = RemoteSpeechProvider | "on_device";

type SpeechModelPanelProps = {
  source: SpeechSource;
  onSourceChange: (source: SpeechSource) => void;
  localModelLabel: string | null;
  endpoint: string;
  setEndpoint: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
};

const SpeechModelPanel = ({
  source,
  onSourceChange,
  localModelLabel,
  endpoint,
  setEndpoint,
  apiKey,
  setApiKey,
  model,
  setModel,
  availableModels,
  fetchAvailableModels,
}: SpeechModelPanelProps) => {
  const { t } = useLingui();
  const provider = source === "on_device" ? null : source;
  const providerPreset = provider ? getSpeechProviderPreset(provider) : null;
  const canDiscoverModels =
    provider !== null && supportsSpeechProviderModelDiscovery(provider);
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );
  const modelValue = model || "auto";
  const defaultModel =
    providerPreset?.defaultModel ||
    t({
      id: "settings.speech_model.model.provider_default",
      message: "provider default",
    });
  const label = t({
    id: "settings.models.speech.transcribe_with",
    message: "Transcribe with",
  });

  const selectSource = (value: SpeechSource) => {
    if (value === source) return;
    const preset =
      value === "on_device" ? null : getSpeechProviderPreset(value);
    if (preset) {
      setEndpoint(preset.endpoint);
      setModel("auto");
    }
    onSourceChange(value);
  };

  return (
    <ModelSourcePanel
      label={label}
      warning={source === "on_device" && !localModelLabel}
      showFields={provider !== null}
      status={
        localModelLabel
          ? t({
              id: "settings.models.speech.runs_on_mac",
              message: "Runs on this Mac.",
            })
          : t({
              id: "settings.models.speech.no_model",
              message: "Download a speech model below.",
            })
      }
      select={
        <Dropdown<SpeechSource>
          value={source}
          ariaLabel={label}
          onChange={selectSource}
          editableInput={
            provider === "custom"
              ? {
                  value: endpoint,
                  onChange: setEndpoint,
                  placeholder: t({
                    id: "settings.speech_model.endpoint.placeholder",
                    message: "https://your-speech-endpoint.com",
                  }),
                  ariaLabel: t({
                    id: "settings.speech_model.endpoint.aria",
                    message: "Remote speech endpoint URL",
                  }),
                }
              : undefined
          }
          options={[
            {
              value: "_device_header" as SpeechSource,
              label: t({
                id: "settings.models.group.this_mac",
                message: "On this Mac",
              }),
              isHeader: true,
            },
            {
              value: "on_device" as const,
              label:
                localModelLabel ??
                t({
                  id: "settings.models.speech.no_model_label",
                  message: "No model installed",
                }),
              description: t({
                id: "settings.language_model.provider.on_device",
                message: "On-device",
              }),
            },
            {
              value: "_local_header" as SpeechSource,
              label: t({
                id: "settings.models.group.server",
                message: "Local server",
              }),
              isHeader: true,
            },
            ...LOCAL_SPEECH_PROVIDERS.map((preset) => ({
              value: preset.id,
              label: preset.label,
              description: preset.endpoint,
            })),
            {
              value: "custom" as const,
              label: t({
                id: "settings.speech_model.provider.custom",
                message: "Custom",
              }),
              description: t({
                id: "settings.speech_model.provider.custom.description",
                message: "Enter your own endpoint URL",
              }),
            },
            {
              value: "_cloud_header" as SpeechSource,
              label: t({
                id: "settings.speech_model.provider.cloud.v2",
                message: "Cloud (API key)",
              }),
              isHeader: true,
            },
            ...CLOUD_SPEECH_PROVIDERS.map((preset) => ({
              value: preset.id,
              label: preset.label,
              description: preset.endpoint,
            })),
          ]}
          searchable
          searchPlaceholder={t({
            id: "settings.speech_model.provider.search",
            message: "Search speech providers...",
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
                id: "settings.speech_model.api_key.v2",
                message: "API key",
              })}
            </span>
            <ApiKeyField
              value={apiKey}
              onChange={setApiKey}
              placeholder={
                providerPreset?.apiKeyRequired
                  ? t({
                      id: "settings.speech_model.api_key.required",
                      message: "Required",
                    })
                  : t({
                      id: "settings.speech_model.api_key.optional",
                      message: "Optional",
                    })
              }
              ariaLabel={t({
                id: "settings.speech_model.api_key.aria",
                message: "Remote speech API key",
              })}
            />
          </div>
          <div>
            <span className="ui-text-label-strong ui-color-primary block">
              {t({
                id: "settings.speech_model.model",
                message: "Model",
              })}
            </span>
            <Dropdown
              value={modelValue}
              ariaLabel={t({
                id: "settings.speech_model.model",
                message: "Model",
              })}
              onChange={(val) => setModel(val)}
              onOpen={canDiscoverModels ? fetchAvailableModels : undefined}
              options={[
                {
                  value: "auto",
                  label: t({
                    id: "settings.speech_model.model.automatic_default",
                    message: `Automatic (${defaultModel})`,
                  }),
                },
                ...uniqueModels.map((model) => ({
                  value: model,
                  label: model,
                })),
                ...(modelValue !== "auto" && !uniqueModels.includes(modelValue)
                  ? [{ value: modelValue, label: modelValue }]
                  : []),
              ]}
              placeholder={t({
                id: "settings.speech_model.model.placeholder_default",
                message: `Model (default: ${defaultModel})`,
              })}
              searchable
              searchPlaceholder={t({
                id: "settings.speech_model.model.search",
                message: "Search available speech models...",
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

export default SpeechModelPanel;
