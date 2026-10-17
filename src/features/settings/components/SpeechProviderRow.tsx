import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AnimatePresence } from "framer-motion";
import {
  CLOUD_SPEECH_PROVIDERS,
  getSpeechProviderPreset,
  LOCAL_SPEECH_PROVIDERS,
  resolvedSpeechEndpoint,
  resolvedSpeechModel,
  supportsSpeechProviderModelDiscovery,
  type SpeechProviderPreset,
} from "../../../shared/lib/speechProviders";
import { useFetchRemoteSpeechModels } from "../models-queries";
import ProviderCard from "./ProviderCard";
import ProviderSheet, {
  ProviderSheetButton,
  type ProviderChoice,
  type ProviderDraft,
} from "./ProviderSheet";
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
};

const toChoice = (
  preset: SpeechProviderPreset,
  server: boolean,
): ProviderChoice => ({
  id: preset.id,
  label: preset.label,
  server,
  endpoint: preset.endpoint,
  editableEndpoint: server,
  apiKeyRequired: preset.apiKeyRequired,
  defaultModel: preset.defaultModel,
  canDiscoverModels: supportsSpeechProviderModelDiscovery(preset.id),
});

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
}: SpeechProviderRowProps) => {
  const { t } = useLingui();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Turns cloud speech on once the settings from the sheet have landed.
  const [enableWhenReady, setEnableWhenReady] = useState(false);
  const { mutateAsync: fetchSpeechModels } = useFetchRemoteSpeechModels();
  const preset = getSpeechProviderPreset(provider);
  const isServer =
    provider === "custom" ||
    LOCAL_SPEECH_PROVIDERS.some((item) => item.id === provider);
  const custom = getSpeechProviderPreset("custom");
  const choices = [
    ...LOCAL_SPEECH_PROVIDERS.map((item) => toChoice(item, true)),
    ...(custom
      ? [
          {
            ...toChoice(custom, true),
            label: t({
              id: "settings.speech_model.provider.custom",
              message: "Custom",
            }),
          },
        ]
      : []),
    ...CLOUD_SPEECH_PROVIDERS.map((item) => toChoice(item, false)),
  ];

  useEffect(() => {
    if (!enableWhenReady || !configReady) return;
    setEnableWhenReady(false);
    if (!enabled) setEnabled(true);
  }, [configReady, enableWhenReady, enabled, setEnabled]);

  const done = (draft: ProviderDraft) => {
    setSheetOpen(false);
    if (!draft.provider) return;
    const next = draft.provider as RemoteSpeechProvider;
    setProvider(next);
    setEndpoint(draft.endpoint);
    setApiKey(draft.apiKey);
    setModel(draft.model);
    setEnableWhenReady(true);
  };

  return (
    <>
      <ProviderCard
        kind={configReady ? (isServer ? "server" : "cloud") : "none"}
        seed={`${provider}:${model}`}
        title={
          configReady && preset
            ? preset.label
            : t({
                id: "settings.models.provider.title",
                message: "Server or cloud",
              })
        }
        facts={
          configReady
            ? `${
                isServer
                  ? t({
                      id: "settings.models.group.server",
                      message: "Local server",
                    })
                  : t({
                      id: "settings.models.location.cloud",
                      message: "Cloud",
                    })
              }  ·  ${resolvedSpeechModel(provider, model) ?? ""}`
            : t({
                id: "settings.models.status.not_set_up",
                message: "Not set up",
              })
        }
        state={
          enabled && configReady
            ? {
                kind: "active",
                label: t({
                  id: "settings.models.card.active",
                  message: "Active",
                }),
              }
            : configReady
              ? { kind: "use", onUse: () => setEnabled(true) }
              : { kind: "status", text: "" }
        }
        trailing={
          <ProviderSheetButton
            configured={configReady}
            onClick={() => setSheetOpen(true)}
          />
        }
      />
      <AnimatePresence>
        {sheetOpen && (
          <ProviderSheet
            title={t({
              id: "settings.models.provider.speech_title",
              message: "Speech provider",
            })}
            choices={choices}
            initial={{
              provider: configReady ? provider : null,
              endpoint: configReady ? endpoint : "",
              apiKey,
              model: configReady ? model : "auto",
            }}
            automaticModel={(choice) =>
              t({
                id: "settings.speech_model.model.automatic_default",
                message: `Automatic (${choice.defaultModel})`,
              })
            }
            isValid={(draft) => {
              const id = draft.provider as RemoteSpeechProvider | null;
              const choice = id ? getSpeechProviderPreset(id) : undefined;
              return Boolean(
                id &&
                choice &&
                resolvedSpeechEndpoint(id, draft.endpoint) &&
                resolvedSpeechModel(id, draft.model) !== undefined &&
                (!choice.apiKeyRequired || draft.apiKey.trim()),
              );
            }}
            fetchModels={(nextEndpoint, nextApiKey) =>
              fetchSpeechModels({ endpoint: nextEndpoint, apiKey: nextApiKey })
            }
            onCancel={() => setSheetOpen(false)}
            onDone={done}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default SpeechProviderRow;
