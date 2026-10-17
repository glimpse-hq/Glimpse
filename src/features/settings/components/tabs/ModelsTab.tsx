import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Check,
  Trash as Trash2,
} from "@phosphor-icons/react";
import ModelCapabilityIcon from "../../../../shared/ui/ModelCapabilityIcon";
import SpeechModelPanel, { type SpeechSource } from "../SpeechModelPanel";
import LanguageModelPanel from "../LanguageModelPanel";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
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
  variants: Variants;
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
  availableSpeechModels: string[];
  fetchAvailableSpeechModels: () => void;
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
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string, ane?: boolean) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
};

const InstalledModelRow = ({
  model,
  active,
  activeLabel,
  aneInstalled,
  shiftHeld,
  onUse,
  onDelete,
}: {
  model: ModelInfo;
  active: boolean;
  activeLabel: string;
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

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-elevated/40">
      <button
        type="button"
        onClick={onUse}
        disabled={active}
        className="min-w-0 text-left disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-1.5 ui-text-body-sm-strong text-content-primary">
          <span className="truncate">{model.label}</span>
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
        </span>
        <span className="mt-0.5 block ui-text-meta tabular-nums text-content-muted">
          {facts.join("  ·  ")}
        </span>
      </button>

      <div className="flex items-center justify-end gap-2">
        {active ? (
          <span className="flex items-center gap-1 ui-text-meta font-medium text-local">
            <Check size={12} aria-hidden="true" />
            {activeLabel}
          </span>
        ) : (
          <button
            type="button"
            onClick={onUse}
            className="ui-text-meta font-medium text-content-secondary transition-colors hover:text-content-primary"
          >
            {t({ id: "settings.models.installed.use", message: "Use" })}
          </button>
        )}
        {builtIn ? (
          <span className="h-6 w-6 shrink-0" aria-hidden="true" />
        ) : (
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
        )}
      </div>
    </div>
  );
};

const AutomaticModelRow = ({
  modelLabel,
  progress,
  enabled,
  onToggle,
}: {
  modelLabel: string | null;
  progress: DownloadEvent | undefined;
  enabled: boolean;
  onToggle: () => void;
}) => {
  const { t } = useLingui();
  const title = t({ id: "settings.models.automatic", message: "Automatic" });
  const percent = Math.round(progress?.percent ?? 0);
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border-secondary px-2.5 pb-3">
      <div className="min-w-0 flex-1">
        <span className="block truncate ui-text-body-sm-strong text-content-primary">
          {title}
        </span>
        <span className="mt-0.5 block truncate ui-text-meta tabular-nums text-content-muted">
          {enabled && modelLabel && progress?.status === "downloading"
            ? t({
                id: "settings.models.automatic.downloading",
                message: `Downloading ${modelLabel} ${percent}%`,
              })
            : modelLabel
              ? t({
                  id: "settings.models.automatic.uses",
                  message: `Uses ${modelLabel} for your language`,
                })
              : t({
                  id: "settings.models.automatic.description",
                  message: "Uses the model for your language",
                })}
        </span>
      </div>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} ariaLabel={title} />
    </div>
  );
};

const ModelsTab = ({
  variants,
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
  availableSpeechModels,
  fetchAvailableSpeechModels,
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

  // A cloud provider is only switched on once it's set up; until then the
  // picker keeps showing it so its fields stay visible.
  const [cloudPending, setCloudPending] = useState(false);
  const speechSource: SpeechSource =
    remoteSpeechEnabled || cloudPending ? remoteSpeechProvider : "on_device";

  useEffect(() => {
    if (!cloudPending || !remoteSpeechConfigReady) return;
    setCloudPending(false);
    setRemoteSpeechEnabled(true);
  }, [cloudPending, remoteSpeechConfigReady, setRemoteSpeechEnabled]);

  const changeSpeechSource = (next: SpeechSource) => {
    setCloudPending(next !== "on_device");
    if (next !== "on_device") setRemoteSpeechProvider(next);
    if (remoteSpeechEnabled) setRemoteSpeechEnabled(false);
  };

  const installedModels = sortInstalledModels(
    modelCatalog.filter((m) => modelStatus[m.key]?.installed),
  );

  const localRoleLabel = remoteSpeechEnabled
    ? t({ id: "settings.models.card.fallback", message: "Fallback" })
    : t({ id: "settings.models.card.active", message: "Active" });

  return (
    <motion.div
      key="models"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex min-h-0 flex-1 flex-col"
    >
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
        <div className="flex h-full min-h-0 flex-col gap-5">
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <div className="space-y-2">
              <SectionLabel>
                {t({ id: "settings.models.speech", message: "Speech" })}
              </SectionLabel>
              <SpeechModelPanel
                source={speechSource}
                onSourceChange={changeSpeechSource}
                localModelLabel={installedModel?.label ?? null}
                endpoint={remoteSpeechEndpoint}
                setEndpoint={setRemoteSpeechEndpoint}
                apiKey={remoteSpeechApiKey}
                setApiKey={setRemoteSpeechApiKey}
                model={remoteSpeechModel}
                setModel={setRemoteSpeechModel}
                availableModels={availableSpeechModels}
                fetchAvailableModels={fetchAvailableSpeechModels}
              />
            </div>
            <div className="space-y-2">
              <SectionLabel>
                {t({ id: "settings.models.language", message: "Language" })}
              </SectionLabel>
              <LanguageModelPanel
                llmProvider={llmProvider}
                setLlmProvider={setLlmProvider}
                llmEndpoint={llmEndpoint}
                setLlmEndpoint={setLlmEndpoint}
                llmApiKey={llmApiKey}
                setLlmApiKey={setLlmApiKey}
                llmModel={llmModel}
                setLlmModel={setLlmModel}
                llmConfigReady={llmConfigReady}
                availableModels={availableModels}
                fetchAvailableModels={fetchAvailableModels}
                activeLicense={activeLicense}
                cleanupShortcutsOn={cleanupShortcutsOn}
              />
            </div>
          </div>

          <AutomaticModelRow
            modelLabel={recommendedLabel}
            progress={
              recommendedKey ? downloadState[recommendedKey] : undefined
            }
            enabled={automatic}
            onToggle={() =>
              void setLocalModelAuto(!automatic).catch((err) =>
                showErrorToast(String(err)),
              )
            }
          />

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 items-center gap-3">
              <SectionLabel className="flex-1">
                {t({
                  id: "settings.models.installed",
                  message: "Installed",
                })}
              </SectionLabel>

              <button
                type="button"
                onClick={() => setBrowsing(true)}
                className="group inline-flex shrink-0 items-center gap-1 ui-text-body-sm-strong ui-color-secondary transition-colors hover:text-content-primary"
              >
                {t({
                  id: "settings.models.browse_all",
                  message: "Browse all models",
                })}
                <ChevronRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </div>

            <div className="-mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
              {installedModels.map((model) => (
                <InstalledModelRow
                  key={model.key}
                  model={model}
                  active={model.key === localModel}
                  activeLabel={localRoleLabel}
                  aneInstalled={Boolean(modelStatus[model.key]?.ane_installed)}
                  shiftHeld={shiftHeld}
                  onUse={() => setLocalModel(model.key)}
                  onDelete={() => handleDelete(model.key)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ModelsTab;
