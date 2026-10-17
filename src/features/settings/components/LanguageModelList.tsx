import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AnimatePresence } from "framer-motion";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
  resolvedLlmEndpoint,
  type LlmProviderPreset,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { useFetchLlmModels } from "../models-queries";
import ModelRow, { type ModelRowState } from "./ModelRow";
import ProviderSheet, {
  ProviderSheetButton,
  type ProviderChoice,
  type ProviderDraft,
} from "./ProviderSheet";
import { useLanguageModelStatus } from "../useLanguageModelStatus";

type LanguageModelListProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmConfigReady: boolean;
  activeLicense: boolean;
};

const toChoice = (
  preset: LlmProviderPreset,
  server: boolean,
): ProviderChoice => ({
  id: preset.id,
  label: preset.label,
  server,
  endpoint: preset.endpoint,
  editableEndpoint: server,
  apiKeyRequired: preset.apiKeyRequired,
  defaultModel: preset.defaultModel,
  canDiscoverModels: true,
});

const LanguageModelList = ({
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  llmConfigReady,
  activeLicense,
}: LanguageModelListProps) => {
  const { t } = useLingui();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { mutateAsync: fetchLlmModels } = useFetchLlmModels();
  const preset = getProviderPreset(llmProvider);
  const usesService = Boolean(preset && !preset.onDevice);
  const { appleAvailability, g1Installed, showG1 } = useLanguageModelStatus(
    llmProvider,
    llmConfigReady,
    activeLicense,
  );
  const active: ModelRowState = {
    kind: "active",
    label: t({ id: "settings.models.card.active", message: "Active" }),
  };
  const onDevice = t({
    id: "settings.language_model.provider.on_device",
    message: "On-device",
  });

  const choices = [
    ...LOCAL_PROVIDERS.filter((p) => !p.onDevice && p.id !== "custom").map(
      (p) => toChoice(p, true),
    ),
    ...LOCAL_PROVIDERS.filter((p) => p.id === "custom").map((p) => ({
      ...toChoice(p, true),
      label: t({
        id: "settings.language_model.provider.custom",
        message: "Custom",
      }),
    })),
    ...CLOUD_PROVIDERS.map((p) => toChoice(p, false)),
  ];

  const done = (draft: ProviderDraft) => {
    setSheetOpen(false);
    if (!draft.provider) return;
    setLlmProvider(draft.provider as LlmProvider);
    setLlmEndpoint(draft.endpoint);
    setLlmApiKey(draft.apiKey);
    setLlmModel(draft.model);
  };

  const select = (value: LlmProvider) => {
    if (value === llmProvider) return;
    setLlmProvider(value);
    const next = getProviderPreset(value);
    if (next) {
      setLlmEndpoint(next.endpoint);
      setLlmModel(next.defaultModel);
    }
  };

  const g1Blocker = !activeLicense
    ? t({ id: "settings.models.status.locked", message: "Locked" })
    : g1Installed === false
      ? t({
          id: "settings.models.status.not_installed",
          message: "Not installed",
        })
      : null;
  const appleBlocker =
    appleAvailability === "not_enabled"
      ? t({ id: "settings.models.status.off", message: "Off" })
      : appleAvailability === "not_ready"
        ? t({
            id: "settings.models.status.downloading",
            message: "Downloading",
          })
        : appleAvailability === "unsupported"
          ? t({
              id: "settings.models.status.unsupported",
              message: "Not supported",
            })
          : null;
  const g1Selected = llmProvider === "bonsai";
  const appleSelected = llmProvider === "apple";

  return (
    <div className="flex flex-col">
      {showG1 && (
        <ModelRow
          title="G1"
          facts={
            g1Selected && g1Blocker
              ? `${onDevice}  ·  ${g1Blocker}`
              : !activeLicense
                ? t({
                    id: "settings.language_model.g1.locked",
                    message: "Needs a purchased Glimpse Plus license",
                  })
                : onDevice
          }
          factsWarning={g1Selected && Boolean(g1Blocker)}
          state={
            g1Selected
              ? active
              : g1Blocker
                ? { kind: "status", text: g1Blocker }
                : g1Installed === null
                  ? { kind: "status", text: "" }
                  : { kind: "use", onUse: () => select("bonsai") }
          }
        />
      )}
      {appleAvailability !== null && (
        <ModelRow
          title="Apple Intelligence"
          facts={
            appleSelected && appleAvailability === "not_enabled"
              ? t({
                  id: "settings.language_model.apple.not_enabled",
                  message:
                    "Turn on Apple Intelligence in System Settings to use this.",
                })
              : appleSelected && appleBlocker
                ? `${onDevice}  ·  ${appleBlocker}`
                : onDevice
          }
          factsWarning={appleSelected && Boolean(appleBlocker)}
          state={
            appleSelected
              ? active
              : appleBlocker
                ? { kind: "status", text: appleBlocker }
                : { kind: "use", onUse: () => select("apple") }
          }
        />
      )}
      <ModelRow
        title={
          usesService && preset
            ? preset.label
            : t({
                id: "settings.models.provider.title",
                message: "Server or cloud",
              })
        }
        facts={
          usesService && llmConfigReady
            ? llmModel || preset?.defaultModel || ""
            : t({
                id: "settings.models.status.not_set_up",
                message: "Not set up",
              })
        }
        factsWarning={usesService && !llmConfigReady}
        state={usesService ? active : { kind: "status", text: "" }}
        trailing={
          <ProviderSheetButton
            configured={usesService && llmConfigReady}
            onClick={() => setSheetOpen(true)}
          />
        }
      />
      <AnimatePresence>
        {sheetOpen && (
          <ProviderSheet
            title={t({
              id: "settings.models.provider.language_title",
              message: "Language provider",
            })}
            choices={choices}
            initial={{
              provider: usesService ? llmProvider : null,
              endpoint: usesService ? llmEndpoint : "",
              apiKey: llmApiKey,
              model: usesService ? llmModel : "",
            }}
            automaticModel={null}
            isValid={(draft) => {
              const id = draft.provider as LlmProvider | null;
              const choice = id ? getProviderPreset(id) : undefined;
              return Boolean(
                id &&
                choice &&
                resolvedLlmEndpoint(id, draft.endpoint) &&
                (!choice.apiKeyRequired || draft.apiKey.trim()) &&
                draft.model.trim(),
              );
            }}
            fetchModels={(endpoint, apiKey) =>
              fetchLlmModels({ endpoint, apiKey })
            }
            onCancel={() => setSheetOpen(false)}
            onDone={done}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LanguageModelList;
