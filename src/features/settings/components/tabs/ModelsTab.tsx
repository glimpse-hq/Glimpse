import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Trash as Trash2,
} from "@phosphor-icons/react";
import ModelCapabilityIcon from "../../../../shared/ui/ModelCapabilityIcon";
import ModelRow from "../ModelRow";
import SpeechProviderRow from "../SpeechProviderRow";
import LanguageModelList from "../LanguageModelList";
import {
  ModelSectionHeading,
  OnThisComputerHeading,
} from "../ModelSectionParts";
import { ModelPickerPanel } from "../../../../shared/ui/ModelPickerModal";
import {
  deriveModelStats,
  formatModelSize,
  isBuiltInModel,
  formatQuantLabel,
  modelSizeMb,
  sortInstalledModels,
} from "../../../../shared/lib/modelStats";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
  MODEL_CAPABILITY_TIMESTAMPS,
} from "../../../../shared/lib/modelCapabilities";
import { useShiftHeld } from "../../../../shared/hooks/useShiftHeld";
import {
  resolveLocalFallbackModel,
  useModelRecommendation,
} from "../../models-queries";
import { setLocalModelAuto } from "../../models-api";
import { showErrorToast } from "../../../../shared/lib/errorToast";
import { useSettings } from "../../queries";
import type {
  DownloadEvent,
  LlmProvider,
  ModelInfo,
  ModelStatus,
  RemoteSpeechProvider,
} from "../../../../types";

type ModelsTabProps = {
  modelCatalog: ModelInfo[];
  diarizerModel: ModelInfo | null;
  modelStatus: Record<string, ModelStatus>;
  downloadState: Record<string, DownloadEvent>;
  localModel: string;
  remoteSpeechEnabled: boolean;
  setRemoteSpeechEnabled: (value: boolean) => void;
  remoteSpeechProvider: RemoteSpeechProvider;
  setRemoteSpeechProvider: (value: RemoteSpeechProvider) => void;
  remoteSpeechEndpoint: string;
  setRemoteSpeechEndpoint: (value: string) => void;
  remoteSpeechApiKey: string;
  setRemoteSpeechApiKey: (value: string) => void;
  remoteSpeechModel: string;
  setRemoteSpeechModel: (value: string) => void;
  remoteSpeechConfigReady: boolean;
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
  cleanupOffEverywhere: boolean;
  onOpenShortcuts: () => void;
  licenseGateActive: boolean;
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string, ane?: boolean) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
};

const InstalledModelRow = ({
  model,
  active,
  fallback,
  automatic,
  aneInstalled,
  shiftHeld,
  onUse,
  onDelete,
}: {
  model: ModelInfo;
  active: boolean;
  fallback: boolean;
  automatic: boolean;
  aneInstalled: boolean;
  shiftHeld: boolean;
  onUse: () => void;
  onDelete: () => void;
}) => {
  const { t } = useLingui();
  const stats = deriveModelStats(model);

  const hasDictionary = hasModelCapability(model, MODEL_CAPABILITY_DICTIONARY);
  const isStreaming = hasModelCapability(model, MODEL_CAPABILITY_STREAMING);
  const hasTimestamps = hasModelCapability(model, MODEL_CAPABILITY_TIMESTAMPS);

  const builtIn = isBuiltInModel(model);
  const facts = [
    stats.englishOnly
      ? t({ id: "settings.models.installed.english", message: "English" })
      : t({
          id: "settings.models.installed.multilingual",
          message: "Multilingual",
        }),
  ];
  facts.push(
    builtIn
      ? t({ id: "settings.models.installed.built_in", message: "Built in" })
      : formatModelSize(modelSizeMb(model, aneInstalled)),
  );
  const quant = formatQuantLabel(model.variant);
  if (quant) facts.push(quant);
  if (aneInstalled)
    facts.push(
      t({ id: "settings.models.installed.ane.v2", message: "Neural Engine" }),
    );
  if (active && automatic)
    facts.push(
      t({
        id: "settings.models.chosen_automatically",
        message: "Chosen automatically",
      }),
    );

  return (
    <ModelRow
      title={model.label}
      titleAdornment={
        <>
          {/* Cloud speech runs first; this model takes over when it fails. */}
          {active && fallback && (
            <span className="shrink-0 ui-text-meta font-medium text-content-secondary">
              {t({ id: "settings.models.card.fallback", message: "Fallback" })}
            </span>
          )}
          {!model.downloadable && (
            <span className="shrink-0 font-normal text-content-muted">
              {t({ id: "settings.models.installed.legacy", message: "Legacy" })}
            </span>
          )}
          {hasDictionary && (
            <ModelCapabilityIcon capability={MODEL_CAPABILITY_DICTIONARY} />
          )}
          {isStreaming && (
            <ModelCapabilityIcon capability={MODEL_CAPABILITY_STREAMING} />
          )}
          {hasTimestamps && (
            <ModelCapabilityIcon capability={MODEL_CAPABILITY_TIMESTAMPS} />
          )}
        </>
      }
      facts={facts.join("  ·  ")}
      state={
        active && !fallback
          ? {
              kind: "active",
              label: t({
                id: "settings.models.card.active",
                message: "Active",
              }),
            }
          : { kind: "use", onUse }
      }
      trailing={
        builtIn ? undefined : (
          <button
            type="button"
            onClick={onDelete}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-all hover:bg-error/10 hover:text-error ${
              shiftHeld
                ? "text-error opacity-100"
                : "text-content-disabled opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:text-error"
            }`}
            title={t({
              id: "settings.models.installed.delete",
              message: "Delete",
            })}
            aria-label={t({
              id: "settings.models.installed.delete_model",
              message: "Delete model",
            })}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        )
      }
    />
  );
};

const ModelsTab = ({
  modelCatalog,
  diarizerModel,
  modelStatus,
  downloadState,
  localModel,
  remoteSpeechEnabled,
  setRemoteSpeechEnabled,
  remoteSpeechProvider,
  setRemoteSpeechProvider,
  remoteSpeechEndpoint,
  setRemoteSpeechEndpoint,
  remoteSpeechApiKey,
  setRemoteSpeechApiKey,
  remoteSpeechModel,
  setRemoteSpeechModel,
  remoteSpeechConfigReady,
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
  cleanupOffEverywhere,
  onOpenShortcuts,
  licenseGateActive,
  setLocalModel,
  handleDownload,
  handleDelete,
  handleCancelDownload,
}: ModelsTabProps) => {
  const { t } = useLingui();
  const [browsing, setBrowsing] = useState(false);
  const shiftHeld = useShiftHeld();
  const automatic = useSettings().data?.local_model_auto ?? false;
  const recommendedKey = useModelRecommendation().data?.key;
  const recommendedLabel =
    modelCatalog.find((model) => model.key === recommendedKey)?.label ?? null;

  const installedModel = resolveLocalFallbackModel(
    modelCatalog,
    modelStatus,
    localModel,
  );

  const recommendedProgress = recommendedKey
    ? downloadState[recommendedKey]
    : undefined;
  const modelLabel = recommendedLabel;
  const percent = Math.round(recommendedProgress?.percent ?? 0);
  const setAutomatic = (on: boolean) =>
    void setLocalModelAuto(on).catch((err) => showErrorToast(String(err)));
  // Choosing a model by hand turns Automatic off.
  const chooseModel = async (key: string) => {
    if (automatic) {
      try {
        await setLocalModelAuto(false);
      } catch (err) {
        showErrorToast(String(err));
        return;
      }
    }
    setLocalModel(key);
  };

  const installedModels = sortInstalledModels(
    modelCatalog.filter((m) => modelStatus[m.key]?.installed),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {browsing ? (
        <>
          <button
            type="button"
            onClick={() => setBrowsing(false)}
            className="mb-3 inline-flex items-center gap-1 self-start ui-text-body-sm ui-color-muted transition-colors hover:text-content-primary"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {t({ id: "settings.models.back", message: "Back" })}
          </button>
          <ModelPickerPanel
            className="w-full min-h-0 flex-1"
            catalog={modelCatalog}
            diarizer={diarizerModel}
            activeKey={localModel}
            isInstalled={(key) => Boolean(modelStatus[key]?.installed)}
            isAneInstalled={(key) => Boolean(modelStatus[key]?.ane_installed)}
            progressFor={(key) => downloadState[key]}
            onUse={setLocalModel}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onCancel={handleCancelDownload}
          />
        </>
      ) : (
        // One grid for both sections, so the action columns line up.
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2">
          <ModelSectionHeading
            title={t({ id: "settings.models.speech", message: "Speech" })}
            automatic={automatic}
            onAutomaticChange={setAutomatic}
            automaticNote={
              automatic &&
              modelLabel &&
              recommendedProgress?.status === "downloading"
                ? t({
                    id: "settings.models.automatic.downloading",
                    message: `Downloading ${modelLabel} ${percent}%`,
                  })
                : null
            }
          />
          <SpeechProviderRow
            enabled={remoteSpeechEnabled}
            setEnabled={setRemoteSpeechEnabled}
            configReady={remoteSpeechConfigReady}
            provider={remoteSpeechProvider}
            setProvider={setRemoteSpeechProvider}
            endpoint={remoteSpeechEndpoint}
            setEndpoint={setRemoteSpeechEndpoint}
            apiKey={remoteSpeechApiKey}
            setApiKey={setRemoteSpeechApiKey}
            model={remoteSpeechModel}
            setModel={setRemoteSpeechModel}
          />
          <OnThisComputerHeading
            trailing={
              <button
                type="button"
                onClick={() => setBrowsing(true)}
                className="group inline-flex shrink-0 items-center gap-1 whitespace-nowrap ui-text-meta ui-color-secondary transition-colors hover:text-content-primary"
              >
                {t({
                  id: "settings.models.browse_all",
                  message: "Browse all models",
                })}
                <ChevronRight
                  size={12}
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            }
          />
          {installedModels.map((model) => (
            <InstalledModelRow
              key={model.key}
              model={model}
              active={model.key === installedModel?.key}
              automatic={automatic}
              fallback={remoteSpeechEnabled}
              aneInstalled={Boolean(modelStatus[model.key]?.ane_installed)}
              shiftHeld={shiftHeld}
              onUse={() => void chooseModel(model.key)}
              onDelete={() => handleDelete(model.key)}
            />
          ))}

          <div className="col-span-3 h-5" aria-hidden="true" />
          <LanguageModelList
            llmProvider={llmProvider}
            setLlmProvider={setLlmProvider}
            llmEndpoint={llmEndpoint}
            setLlmEndpoint={setLlmEndpoint}
            llmApiKey={llmApiKey}
            setLlmApiKey={setLlmApiKey}
            llmModel={llmModel}
            setLlmModel={setLlmModel}
            llmServiceProvider={llmServiceProvider}
            setLlmServiceProvider={setLlmServiceProvider}
            llmAuto={llmAuto}
            setLlmAuto={setLlmAuto}
            cleanupOffEverywhere={cleanupOffEverywhere}
            onOpenShortcuts={onOpenShortcuts}
            licenseGateActive={licenseGateActive}
            downloadState={downloadState}
            onDownload={handleDownload}
          />
        </div>
      )}
    </div>
  );
};

export default ModelsTab;
