import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Check,
  Cloud,
  Trash as Trash2,
} from "@phosphor-icons/react";
import ModelStatCard from "../ModelStatCard";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import { ModelPickerPanel } from "../../../../shared/ui/ModelPickerModal";
import { deriveModelStats, formatModelSize } from "../../../../shared/lib/modelStats";
import { getSpeechProviderPreset } from "../../../../shared/lib/speechProviders";
import { useShiftHeld } from "../../../../shared/hooks/useShiftHeld";
import type {
  DownloadEvent,
  ModelInfo,
  ModelStatus,
  RemoteSpeechProvider,
} from "../../../../types";

type ModelsTabProps = {
  variants: Variants;
  modelCatalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  downloadState: Record<string, DownloadEvent>;
  localModel: string;
  remoteSpeechEnabled: boolean;
  remoteSpeechProvider: RemoteSpeechProvider;
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
};

const pickInstalledModel = (
  catalog: ModelInfo[],
  localModel: string,
  modelStatus: Record<string, ModelStatus>,
): ModelInfo | null => {
  const active = catalog.find((m) => m.key === localModel);
  if (active) return active;
  const installed = catalog.find((m) => modelStatus[m.key]?.installed);
  if (installed) return installed;
  const recommended = catalog.find((m) =>
    m.tags.some((tag) => tag.toLowerCase() === "recommended"),
  );
  if (recommended) return recommended;
  return [...catalog].sort((a, b) => a.size_mb - b.size_mb)[0] ?? null;
};

const InstalledModelRow = ({
  model,
  active,
  shiftHeld,
  onUse,
  onDelete,
}: {
  model: ModelInfo;
  active: boolean;
  shiftHeld: boolean;
  onUse: () => void;
  onDelete: () => void;
}) => {
  const { t } = useLingui();
  const stats = deriveModelStats(model);

  const facts = [
    stats.englishOnly
      ? t({ id: "settings.models.installed.english", message: "English" })
      : t({
          id: "settings.models.installed.multilingual",
          message: "Multilingual",
        }),
  ];
  facts.push(formatModelSize(model.size_mb));

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-elevated/40">
      <button
        type="button"
        onClick={onUse}
        disabled={active}
        className="min-w-0 text-left disabled:cursor-default"
      >
        <span className="block truncate ui-text-body-sm-strong text-content-primary">
          {model.label}
        </span>
        <span className="mt-0.5 block ui-text-meta tabular-nums text-content-muted">
          {facts.join("  ·  ")}
        </span>
      </button>

      <div className="flex items-center justify-end gap-2">
        {active ? (
          <span className="flex items-center gap-1 ui-text-meta font-medium text-local">
            <Check size={12} aria-hidden="true" />
            {t({ id: "settings.models.installed.active", message: "Active" })}
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
        <button
          type="button"
          onClick={onDelete}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-all hover:bg-error/10 hover:text-error ${
            shiftHeld
              ? "text-error opacity-100"
              : "text-content-disabled opacity-0 group-hover:opacity-100"
          }`}
          title={t({ id: "settings.models.installed.delete", message: "Delete" })}
          aria-label={t({
            id: "settings.models.installed.delete_model",
            message: "Delete model",
          })}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

const ModelsTab = ({
  variants,
  modelCatalog,
  modelStatus,
  downloadState,
  localModel,
  remoteSpeechEnabled,
  remoteSpeechProvider,
  setLocalModel,
  handleDownload,
  handleDelete,
  handleCancelDownload,
}: ModelsTabProps) => {
  const { t } = useLingui();
  const [browsing, setBrowsing] = useState(false);
  const shiftHeld = useShiftHeld();

  const installedModel = pickInstalledModel(
    modelCatalog,
    localModel,
    modelStatus,
  );

  const providerName =
    getSpeechProviderPreset(remoteSpeechProvider)?.label ??
    t({
      id: "settings.models.cloud_active.provider_fallback",
      message: "your speech provider",
    });

  const installedModels = modelCatalog.filter(
    (m) => modelStatus[m.key]?.installed,
  );

  return (
    <motion.div
      key="models"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex h-full flex-col"
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
            fadeColor="var(--color-bg-overlay)"
            catalog={modelCatalog}
            activeKey={localModel}
            isInstalled={(key) => Boolean(modelStatus[key]?.installed)}
            progressFor={(key) => downloadState[key]}
            onUse={setLocalModel}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onCancel={handleCancelDownload}
          />
        </>
      ) : (
        <div className="flex flex-col gap-5">
          {/* reserved slot so toggling the provider never shifts the layout */}
          <div className="min-h-[1.875rem]">
            {remoteSpeechEnabled && (
              <div className="flex items-center gap-2 rounded-lg border border-cloud-20 bg-cloud-5 px-3 py-1.5">
                <Cloud
                  size={14}
                  weight="fill"
                  className="shrink-0 ui-color-cloud opacity-80"
                  aria-hidden="true"
                />
                <p className="ui-text-label ui-color-warning-subtle">
                  {t({
                    id: "settings.models.cloud_active",
                    message: `Glimpse is using ${{ provider: providerName }} to transcribe. Your active local model will be used as a fallback.`,
                  })}
                </p>
              </div>
            )}
          </div>

          {installedModel && (
            <div className="flex justify-center pt-1">
              <ModelStatCard
                model={installedModel}
                status={modelStatus[installedModel.key]}
                progress={downloadState[installedModel.key]}
                onDownload={() => handleDownload(installedModel.key)}
                onDelete={() => handleDelete(installedModel.key)}
                onCancel={() => handleCancelDownload(installedModel.key)}
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-3">
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

            <div className="flex min-h-[280px] flex-col">
              {installedModels.map((model) => (
                <InstalledModelRow
                  key={model.key}
                  model={model}
                  active={model.key === localModel}
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
