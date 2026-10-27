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
import type { DownloadEvent, LlmProvider } from "../../../types";
import { useCleanupModel, useFetchLlmModels } from "../models-queries";
import ModelRow, { type ModelRowState } from "./ModelRow";
import ProviderCard from "./ProviderCard";
import ProviderSheet, {
  ProviderSheetButton,
  type ProviderChoice,
  type ProviderDraft,
} from "./ProviderSheet";
import { useLanguageModelStatus } from "../useLanguageModelStatus";
import {
  ModelSectionHeading,
  OnThisComputerHeading,
} from "./ModelSectionParts";
import { formatModelSize } from "../../../shared/lib/modelStats";

type LanguageModelListProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmServiceProvider: string;
  setLlmServiceProvider: (value: string) => void;
  llmAuto: boolean;
  setLlmAuto: (value: boolean) => void;
  licenseGateActive: boolean;
  downloadState: Record<string, DownloadEvent>;
  onDownload: (modelKey: string, ane?: boolean) => void;
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
  llmServiceProvider,
  setLlmServiceProvider,
  llmAuto,
  setLlmAuto,
  licenseGateActive,
  downloadState,
  onDownload,
}: LanguageModelListProps) => {
  const { t } = useLingui();
  const cleanupModel = useCleanupModel().data;
  const cleanupDownload = cleanupModel
    ? downloadState[cleanupModel.key]
    : undefined;
  const [sheetOpen, setSheetOpen] = useState(false);
  const { mutateAsync: fetchLlmModels } = useFetchLlmModels();
  const service = getProviderPreset(llmServiceProvider as LlmProvider);
  const isServer =
    service !== undefined && LOCAL_PROVIDERS.some((p) => p.id === service.id);
  const {
    activeProvider,
    serviceReady,
    ready,
    appleAvailability,
    cleanupModelInstalled,
    showCleanupModel,
  } = useLanguageModelStatus({
    llmProvider,
    llmAuto,
    llmServiceProvider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    licenseGateActive,
  });
  const active: ModelRowState = {
    kind: "active",
    label: t({ id: "settings.models.card.active", message: "Active" }),
  };
  const chosenAutomatically = t({
    id: "settings.models.chosen_automatically",
    message: "Chosen automatically",
  });
  const isActive = (id: string) => ready === true && activeProvider === id;
  // A model chosen by hand that can't run says why; Automatic skips it.
  const chosenButBlocked = (id: string) => !llmAuto && llmProvider === id;
  const withNote = (id: string, facts: string) =>
    llmAuto && isActive(id) ? `${facts}  ·  ${chosenAutomatically}` : facts;

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
    setLlmServiceProvider(draft.provider);
    setLlmEndpoint(draft.endpoint);
    setLlmApiKey(draft.apiKey);
    setLlmModel(draft.model);
    if (!llmAuto) setLlmProvider(draft.provider as LlmProvider);
  };

  // Choosing a model by hand turns Automatic off and keeps the server or
  // cloud setup, so switching back is one click.
  const select = (value: LlmProvider) => {
    setLlmAuto(false);
    if (value !== llmProvider) setLlmProvider(value);
  };

  const cleanupModelBlocker = !licenseGateActive
    ? t({ id: "settings.models.status.locked", message: "Locked" })
    : cleanupModelInstalled === false
      ? cleanupDownload?.status === "downloading"
        ? `${Math.round(cleanupDownload.percent)}%`
        : t({
            id: "settings.models.status.not_installed",
            message: "Not installed",
          })
      : null;
  const cleanupModelDownloadKey =
    licenseGateActive &&
    cleanupModelInstalled === false &&
    cleanupModel &&
    cleanupDownload?.status !== "downloading"
      ? cleanupModel.key
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
  const cleanupModelFacts = [
    t({
      id: "settings.models.language.g1_description",
      message: "Glimpse's cleanup model",
    }),
    ...(cleanupModel ? [formatModelSize(cleanupModel.size_mb)] : []),
  ].join("  ·  ");
  const appleFacts = t({
    id: "settings.models.language.apple_description",
    message: "Built into macOS",
  });
  const serviceId = service && !service.onDevice ? service.id : null;

  return (
    <>
      <ModelSectionHeading
        title={t({ id: "settings.models.language", message: "Language" })}
        automatic={llmAuto}
        onAutomaticChange={setLlmAuto}
      />
      <ProviderCard
        kind={serviceReady ? (isServer ? "server" : "cloud") : "none"}
        title={
          serviceId && service
            ? service.label
            : t({
                id: "settings.models.provider.title",
                message: "Server or cloud",
              })
        }
        facts={
          serviceReady && service
            ? withNote(
                service.id,
                `${
                  isServer
                    ? t({
                        id: "settings.models.group.server",
                        message: "Local server",
                      })
                    : t({
                        id: "settings.models.location.cloud",
                        message: "Cloud",
                      })
                }  ·  ${llmModel}`,
              )
            : t({
                id: "settings.models.status.not_set_up",
                message: "Not set up",
              })
        }
        factsWarning={
          serviceId !== null && chosenButBlocked(serviceId) && !serviceReady
        }
        state={
          serviceId && isActive(serviceId)
            ? active
            : serviceReady && serviceId
              ? { kind: "use", onUse: () => select(serviceId as LlmProvider) }
              : { kind: "status", text: "" }
        }
        trailing={
          <ProviderSheetButton
            configured={serviceReady}
            onClick={() => setSheetOpen(true)}
          />
        }
      />
      <OnThisComputerHeading />
      {showCleanupModel && (
        <ModelRow
          title="Glimpse"
          facts={
            chosenButBlocked("bonsai") && cleanupModelBlocker
              ? cleanupModelBlocker
              : withNote("bonsai", cleanupModelFacts)
          }
          factsWarning={
            chosenButBlocked("bonsai") && Boolean(cleanupModelBlocker)
          }
          state={
            isActive("bonsai")
              ? active
              : cleanupModelDownloadKey
                ? {
                    kind: "use",
                    label: t({
                      id: "model_picker.download",
                      message: "Download",
                    }),
                    onUse: () => onDownload(cleanupModelDownloadKey, false),
                  }
                : cleanupModelBlocker
                  ? { kind: "status", text: cleanupModelBlocker }
                  : cleanupModelInstalled === null
                    ? { kind: "status", text: "" }
                    : { kind: "use", onUse: () => select("bonsai") }
          }
        />
      )}
      {appleAvailability !== null && (
        <ModelRow
          title="Apple Intelligence"
          facts={
            chosenButBlocked("apple") && appleAvailability === "not_enabled"
              ? t({
                  id: "settings.language_model.apple.not_enabled",
                  message:
                    "Turn on Apple Intelligence in System Settings to use this.",
                })
              : chosenButBlocked("apple") && appleBlocker
                ? `${appleFacts}  ·  ${appleBlocker}`
                : withNote("apple", appleFacts)
          }
          factsWarning={chosenButBlocked("apple") && Boolean(appleBlocker)}
          state={
            isActive("apple")
              ? active
              : appleBlocker
                ? { kind: "status", text: appleBlocker }
                : { kind: "use", onUse: () => select("apple") }
          }
        />
      )}
      <AnimatePresence>
        {sheetOpen && (
          <ProviderSheet
            title={t({
              id: "settings.models.provider.language_title",
              message: "Language provider",
            })}
            choices={choices}
            initial={{
              provider: service && !service.onDevice ? service.id : null,
              endpoint: llmEndpoint,
              apiKey: llmApiKey,
              model: llmModel,
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
    </>
  );
};

export default LanguageModelList;
