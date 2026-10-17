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
  activeLicense: boolean;
};

// The G1 download size, until G1 joins the model catalog.
const G1_SIZE_MB = 580;

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
  activeLicense,
}: LanguageModelListProps) => {
  const { t } = useLingui();
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
    g1Installed,
    showG1,
  } = useLanguageModelStatus({
    llmProvider,
    llmAuto,
    llmServiceProvider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    activeLicense,
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
  const g1Facts = [
    t({
      id: "settings.models.language.g1_description",
      message: "Glimpse's cleanup model",
    }),
    formatModelSize(G1_SIZE_MB),
    t({ id: "settings.models.language.plus", message: "Plus" }),
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
      {showG1 && (
        <ModelRow
          title="G1"
          facts={
            chosenButBlocked("bonsai") && g1Blocker
              ? g1Blocker
              : withNote("bonsai", g1Facts)
          }
          factsWarning={chosenButBlocked("bonsai") && Boolean(g1Blocker)}
          state={
            isActive("bonsai")
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
