import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Check,
  Trash as Trash2,
} from "@phosphor-icons/react";
import ModelStatCard from "../ModelStatCard";
import ModelCapabilityIcon from "../../../../shared/ui/ModelCapabilityIcon";
import CloudModelCard from "../CloudModelCard";
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
import {
  getSpeechProviderPreset,
  isRemoteSpeechConfigured,
  resolvedSpeechModel,
} from "../../../../shared/lib/speechProviders";
import { useShiftHeld } from "../../../../shared/hooks/useShiftHeld";
import { resolveLocalFallbackModel } from "../../models-queries";
import type {
  DownloadEvent,
  ModelInfo,
  ModelStatus,
  RemoteSpeechProvider,
} from "../../../../types";

const SIDE_BY_SIDE_WIDTH = 280;
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
  remoteSpeechEndpoint: string;
  remoteSpeechModel: string;
  remoteSpeechApiKey: string;
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string, ane?: boolean) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
  onOpenProvidersTab: () => void;
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
    facts.push(t({ id: "settings.models.installed.ane", message: "ANE" }));

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

type CloudMode = "on" | "off" | "unconfigured";

const CloudHeroCard = ({
  mode,
  providerLabel,
  modelLabel,
  width,
  onToggle,
  onOpenProvidersTab,
}: {
  mode: CloudMode;
  providerLabel: string;
  modelLabel: string | null;
  width?: number;
  onToggle: () => void;
  onOpenProvidersTab: () => void;
}) => {
  const { t } = useLingui();
  const status =
    mode === "on"
      ? t({ id: "settings.models.card.active", message: "Active" })
      : mode === "off"
        ? t({ id: "settings.models.card.off", message: "Off" })
        : t({ id: "settings.models.card.not_set_up", message: "Not set up" });

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <div
          className={`transition-opacity duration-200 ${
            mode === "on" ? "" : "opacity-45"
          }`}
        >
          <CloudModelCard
            width={width}
            providerLabel={providerLabel}
            modelLabel={modelLabel}
          />
        </div>
        <div className="absolute bottom-4 right-5 flex h-7 items-center">
          {mode === "unconfigured" ? (
            <button
              type="button"
              onClick={onOpenProvidersTab}
              className="inline-flex h-7 items-center rounded-md px-2.5 ui-text-button-sm ui-color-secondary transition-colors hover:bg-surface-elevated hover:text-content-primary"
            >
              {t({ id: "settings.models.cloud.set_up", message: "Set up" })}
            </button>
          ) : (
            <ToggleSwitch
              size="md"
              enabled={mode === "on"}
              onToggle={onToggle}
              ariaLabel={t({
                id: "settings.models.cloud.toggle",
                message: "Use cloud transcription",
              })}
            />
          )}
        </div>
      </div>
      <span className="flex h-7 items-center ui-text-meta ui-color-muted">
        {status}
      </span>
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
  remoteSpeechEndpoint,
  remoteSpeechModel,
  remoteSpeechApiKey,
  setLocalModel,
  handleDownload,
  handleDelete,
  handleCancelDownload,
  onOpenProvidersTab,
}: ModelsTabProps) => {
  const { t } = useLingui();
  const [browsing, setBrowsing] = useState(false);
  const shiftHeld = useShiftHeld();

  const installedModel = resolveLocalFallbackModel(
    modelCatalog,
    modelStatus,
    localModel,
  );

  const providerLabel =
    getSpeechProviderPreset(remoteSpeechProvider)?.label ??
    t({
      id: "settings.models.cloud_active.provider_fallback",
      message: "your speech provider",
    });
  const activeModel = resolvedSpeechModel(
    remoteSpeechProvider,
    remoteSpeechModel,
  );

  const installedModels = sortInstalledModels(
    modelCatalog.filter((m) => modelStatus[m.key]?.installed),
  );

  const cloudConfigured = isRemoteSpeechConfigured({
    enabled: true,
    provider: remoteSpeechProvider,
    endpoint: remoteSpeechEndpoint,
    model: remoteSpeechModel,
    apiKey: remoteSpeechApiKey,
  });
  const cloudMode: CloudMode = remoteSpeechEnabled
    ? "on"
    : cloudConfigured
      ? "off"
      : "unconfigured";
  const localRoleLabel =
    cloudMode === "on"
      ? t({ id: "settings.models.card.fallback", message: "Fallback" })
      : t({ id: "settings.models.card.active", message: "Active" });

  const renderLocalCard = (width?: number, compact?: boolean) =>
    installedModel ? (
      <ModelStatCard
        model={installedModel}
        status={modelStatus[installedModel.key]}
        progress={downloadState[installedModel.key]}
        width={width}
        compact={compact}
        onDownload={() => handleDownload(installedModel.key)}
        onDelete={() => handleDelete(installedModel.key)}
        onCancel={() => handleCancelDownload(installedModel.key)}
      />
    ) : null;

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
          {installedModel ? (
            <div className="flex shrink-0 items-start justify-center gap-4">
              <CloudHeroCard
                mode={cloudMode}
                width={SIDE_BY_SIDE_WIDTH}
                providerLabel={providerLabel}
                modelLabel={activeModel ?? null}
                onToggle={() => setRemoteSpeechEnabled(!remoteSpeechEnabled)}
                onOpenProvidersTab={onOpenProvidersTab}
              />
              <div className="flex flex-col items-center gap-2">
                {renderLocalCard(SIDE_BY_SIDE_WIDTH, true)}
                <span className="flex h-7 items-center ui-text-meta ui-color-muted">
                  {localRoleLabel}
                </span>
              </div>
            </div>
          ) : (
            cloudMode !== "unconfigured" && (
              <div className="flex shrink-0 justify-center">
                <CloudHeroCard
                  mode={cloudMode}
                  providerLabel={providerLabel}
                  modelLabel={activeModel ?? null}
                  onToggle={() => setRemoteSpeechEnabled(!remoteSpeechEnabled)}
                  onOpenProvidersTab={onOpenProvidersTab}
                />
              </div>
            )
          )}

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
