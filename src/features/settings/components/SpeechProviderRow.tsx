import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_SPEECH_PROVIDERS,
  getSpeechProviderPreset,
  LOCAL_SPEECH_PROVIDERS,
  resolvedSpeechModel,
  supportsSpeechProviderModelDiscovery,
} from "../../../shared/lib/speechProviders";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import ModelRow, {
  FIELD_BUTTON_CLASS,
  ModelRowField,
  shortEndpoint,
} from "./ModelRow";
import type { RemoteSpeechProvider } from "../../../types";

type SpeechProviderRowProps = {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  configReady: boolean;
  provider: RemoteSpeechProvider;
  setProvider: (value: RemoteSpeechProvider) => void;
  endpoint: string;
  setEndpoint: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
};

const SpeechProviderRow = ({
  enabled,
  setEnabled,
  configReady,
  provider,
  setProvider,
  endpoint,
  setEndpoint,
  apiKey,
  setApiKey,
  model,
  setModel,
  availableModels,
  fetchAvailableModels,
}: SpeechProviderRowProps) => {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const preset = getSpeechProviderPreset(provider);
  const isServer =
    provider === "custom" ||
    LOCAL_SPEECH_PROVIDERS.some((p) => p.id === provider);
  const shown = enabled || configReady;
  const uniqueModels = Array.from(
    new Set(availableModels.map((value) => value.trim()).filter(Boolean)),
  );
  const modelValue = model || "auto";
  const defaultModel =
    preset?.defaultModel ||
    t({
      id: "settings.speech_model.model.provider_default",
      message: "provider default",
    });

  const selectProvider = (value: RemoteSpeechProvider) => {
    if (value === provider) return;
    const next = getSpeechProviderPreset(value);
    if (enabled) setEnabled(false);
    setProvider(value);
    if (next) {
      setEndpoint(next.endpoint);
      setModel("auto");
    }
  };

  return (
    <ModelRow
      title={
        shown && preset
          ? preset.label
          : t({
              id: "settings.models.provider.title",
              message: "Server or cloud",
            })
      }
      facts={
        shown
          ? [
              isServer
                ? t({
                    id: "settings.models.group.server",
                    message: "Local server",
                  })
                : t({ id: "settings.models.location.cloud", message: "Cloud" }),
              resolvedSpeechModel(provider, model) ?? defaultModel,
            ].join("  ·  ")
          : t({
              id: "settings.models.provider.facts",
              message: "Your own endpoint or API key",
            })
      }
      factsWarning={enabled && !configReady}
      state={
        enabled
          ? {
              kind: "active",
              label: t({
                id: "settings.models.card.active",
                message: "Active",
              }),
            }
          : configReady
            ? { kind: "use", onUse: () => setEnabled(true) }
            : {
                kind: "use",
                label: t({
                  id: "settings.models.provider.set_up",
                  message: "Set up",
                }),
                onUse: () => setExpanded(true),
              }
      }
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
    >
      <ModelRowField
        label={t({
          id: "settings.language_model.provider",
          message: "Provider",
        })}
      >
        <Dropdown<RemoteSpeechProvider>
          value={provider}
          ariaLabel={t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
          onChange={selectProvider}
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
              value: "_local_header" as RemoteSpeechProvider,
              label: t({
                id: "settings.models.group.server",
                message: "Local server",
              }),
              isHeader: true,
            },
            ...LOCAL_SPEECH_PROVIDERS.map((p) => ({
              value: p.id,
              label: p.label,
              description: shortEndpoint(p.endpoint),
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
              value: "_cloud_header" as RemoteSpeechProvider,
              label: t({
                id: "settings.speech_model.provider.cloud.v2",
                message: "Cloud (API key)",
              }),
              isHeader: true,
            },
            ...CLOUD_SPEECH_PROVIDERS.map((p) => ({
              value: p.id,
              label: p.label,
            })),
          ]}
          searchable
          searchPlaceholder={t({
            id: "settings.speech_model.provider.search",
            message: "Search speech providers...",
          })}
          buttonClassName={FIELD_BUTTON_CLASS}
        />
      </ModelRowField>
      <ModelRowField
        label={t({
          id: "settings.language_model.api_key.v2",
          message: "API key",
        })}
      >
        <ApiKeyField
          value={apiKey}
          onChange={setApiKey}
          placeholder={
            preset?.apiKeyRequired
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
      </ModelRowField>
      <ModelRowField
        label={t({ id: "settings.language_model.model", message: "Model" })}
      >
        <Dropdown
          value={modelValue}
          ariaLabel={t({ id: "settings.speech_model.model", message: "Model" })}
          onChange={(val) => setModel(val)}
          onOpen={
            supportsSpeechProviderModelDiscovery(provider)
              ? fetchAvailableModels
              : undefined
          }
          options={[
            {
              value: "auto",
              label: t({
                id: "settings.speech_model.model.automatic_default",
                message: `Automatic (${defaultModel})`,
              }),
            },
            ...uniqueModels.map((value) => ({ value, label: value })),
            ...(modelValue !== "auto" && !uniqueModels.includes(modelValue)
              ? [{ value: modelValue, label: modelValue }]
              : []),
          ]}
          searchable
          searchPlaceholder={t({
            id: "settings.speech_model.model.search",
            message: "Search available speech models...",
          })}
          buttonClassName={FIELD_BUTTON_CLASS}
        />
      </ModelRowField>
    </ModelRow>
  );
};

export default SpeechProviderRow;
