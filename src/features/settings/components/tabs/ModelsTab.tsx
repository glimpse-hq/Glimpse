import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import {
  AlertCircle,
  Check,
  Download,
  Square,
  Trash2,
} from "lucide-react";
import DotMatrix from "../../../../shared/ui/DotMatrix";
import { i18n } from "../../../../i18n";
import type {
  DownloadEvent,
  ModelInfo,
  ModelStatus,
} from "../../../../types";

type EngineGroup = {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
  models: ModelInfo[];
};

const engineDescription = (engineId: string, engineLabel: string) => {
  if (engineId === "whisper") {
    return i18n._(
      msg({
        id: "settings.models.engine.whisper.description",
        message: "OpenAI's speech recognition with custom vocabulary support.",
      }),
    );
  }
  if (engineId === "nvidia") {
    return i18n._(
      msg({
        id: "settings.models.engine.nvidia.description",
        message:
          "NVIDIA local speech models, including Parakeet for transcription and Nemotron for live streaming.",
      }),
    );
  }
  return i18n._(
    msg({
      id: "settings.models.engine.generic.description",
      message: `${engineLabel} transcription engine.`,
    }),
  );
};

const getSizeColorVar = (sizeMb: number): string => {
  if (sizeMb < 200) return "var(--color-size-small)";
  if (sizeMb < 1000) return "var(--color-size-medium)";
  return "var(--color-size-large)";
};

const enginePriority = (engineId: string): number => {
  if (engineId === "whisper") return 0;
  if (engineId === "nvidia") return 1;
  return 2;
};


type ModelsTabProps = {
  variants: Variants;
  modelCatalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  downloadState: Record<string, DownloadEvent>;
  localModel: string;
  remoteSpeechEnabled: boolean;
  remoteSpeechModel: string;
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
  formatBytes: (bytes: number) => string;
};

const ModelsTab = ({
  variants,
  modelCatalog,
  modelStatus,
  downloadState,
  localModel,
  remoteSpeechEnabled,
  remoteSpeechModel,
  setLocalModel,
  handleDownload,
  handleDelete,
  handleCancelDownload,
  formatBytes,
}: ModelsTabProps) => {
  const { t } = useLingui();

  const groupedMap = new Map<string, ModelInfo[]>();
  for (const model of modelCatalog) {
    const existing = groupedMap.get(model.engine_id);
    if (existing) {
      existing.push(model);
    } else {
      groupedMap.set(model.engine_id, [model]);
    }
  }

  const groupedModels: EngineGroup[] = Array.from(groupedMap.entries())
    .map(([id, models]) => {
      const label = models[0]?.engine ?? id;
      const recommended = models.some((model) =>
        model.tags.some((tag) => tag.toLowerCase() === "recommended"),
      );
      return {
        id,
        label,
        description: engineDescription(id, label),
        recommended,
        models,
      };
    })
    .sort((a, b) => {
      const priorityDelta = enginePriority(a.id) - enginePriority(b.id);
      if (priorityDelta !== 0) return priorityDelta;
      return a.label.localeCompare(b.label);
    });

  return (
    <motion.div
      key="models"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-5"
    >
      <header>
        <h1 className="ui-text-title-lg font-medium ui-color-primary">
          {t({
            id: "settings.models.title",
            message: "Models",
          })}
        </h1>
        <p className="mt-1 ui-text-body-sm ui-color-muted">
          {t({
            id: "settings.models.description",
            message: "Manage local transcription engines and downloaded speech models.",
          })}
        </p>
      </header>

      {remoteSpeechEnabled && (
        <div className="rounded-lg border border-cloud-30 bg-cloud-5 px-3 py-2">
          <p className="ui-text-body-sm ui-color-primary">
            {t({
              id: "settings.models.remote_speech_active",
              message: `Currently using your Speech Provider${remoteSpeechModel && remoteSpeechModel !== "auto" ? ` (${remoteSpeechModel})` : ""}. Local models remain available as fallback.`,
            })}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="ui-text-section-label-sm ui-color-muted">
          {t({
            id: "settings.models.transcription_engines",
            message: "Transcription Engines",
          })}
        </h3>
        <div className="space-y-4">
          {groupedModels.map((group, groupIndex) => {
            const installedCount = group.models.filter(
              (m) => modelStatus[m.key]?.installed,
            ).length;
            const hasActiveModel = group.models.some(
              (m) => localModel === m.key && modelStatus[m.key]?.installed,
            );
            return (
              <div
                key={group.id || `model-group-${groupIndex}`}
                className="rounded-lg bg-surface-surface p-2.5"
              >
                <div className="flex items-start justify-between gap-3 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 ui-text-body-strong ui-color-primary">
                        {group.label}
                      </span>
                      {group.recommended && (
                        <span className="shrink-0 ui-text-meta ui-color-local">
                          {t({
                            id: "settings.models.recommended",
                            message: "Recommended",
                          })}
                        </span>
                      )}
                    </div>
                    <p className="ui-text-label ui-color-disabled">
                      {group.description}
                    </p>
                  </div>
                  <span
                    className={`flex min-w-[4.75rem] shrink-0 items-center justify-end gap-1 ui-text-meta ${
                      hasActiveModel ? "ui-color-local" : "ui-color-disabled"
                    } ${!hasActiveModel && installedCount === 0 ? "invisible" : ""}`}
                  >
                    {hasActiveModel && <Check size={12} aria-hidden="true" />}
                    {hasActiveModel
                      ? t({
                          id: "settings.models.active",
                          message: "Active",
                        })
                      : t({
                          id: "settings.models.installed_count",
                          message: `${installedCount} installed`,
                        })}
                  </span>
                </div>

                <div className="mt-1 space-y-1 px-2 pb-1">
                  {group.models.map((model, modelIndex) => (
                    <ModelRow
                      key={model.key || `group-model-${groupIndex}-${modelIndex}`}
                      model={model}
                      modelStatus={modelStatus[model.key]}
                      downloadState={downloadState[model.key]}
                      isActive={
                        localModel === model.key &&
                        modelStatus[model.key]?.installed
                      }
                      onUse={() => setLocalModel(model.key)}
                      onDownload={() => handleDownload(model.key)}
                      onDelete={() => handleDelete(model.key)}
                      onCancel={() => handleCancelDownload(model.key)}
                      formatBytes={formatBytes}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

type ModelRowProps = {
  model: ModelInfo;
  modelStatus?: ModelStatus;
  downloadState?: DownloadEvent;
  isActive: boolean;
  onUse: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
  formatBytes: (bytes: number) => string;
};

const ModelRow = ({
  model,
  modelStatus: status,
  downloadState: progress,
  isActive,
  onUse,
  onDownload,
  onDelete,
  onCancel,
  formatBytes,
}: ModelRowProps) => {
  const { t } = useLingui();
  const installed = status?.installed;
  const isDownloading = progress?.status === "downloading";
  const isCancelled = progress?.status === "cancelled";
  const showError = progress?.status === "error";
  const percent = progress?.percent ?? (installed ? 100 : 0);
  const isRecommended = model.tags.some(
    (t) => t.toLowerCase() === "recommended",
  );
  const visibleTags = model.tags.filter(
    (tag) => tag.toLowerCase() !== "recommended",
  );
  return (
    <div className="group rounded-md px-2 py-2 transition-colors hover:bg-surface-elevated/40">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="ui-text-body-sm-strong ui-color-primary">
              {model.label}
            </span>
            {isRecommended && (
              <span className="ui-text-meta ui-color-local">
                {t({
                  id: "settings.models.recommended",
                  message: "Recommended",
                })}
              </span>
            )}
            <span
              className={`flex w-12 shrink-0 items-center gap-1 ui-text-meta ui-color-local ${
                isActive ? "" : "invisible"
              }`}
            >
              <Check size={10} aria-hidden="true" />
              {t({
                id: "settings.models.active",
                message: "Active",
              })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="ui-text-meta whitespace-nowrap tabular-nums"
              style={{ color: getSizeColorVar(model.size_mb) }}
            >
              {formatBytes(model.size_mb * 1024 * 1024)}
            </span>
            {visibleTags.length > 0 && (
              <>
                <span className="ui-text-meta ui-color-disabled shrink-0">·</span>
                <span className="ui-text-meta ui-color-muted truncate">
                  {visibleTags.join(", ")}
                </span>
              </>
            )}
          </div>
        </div>

        {(isDownloading || showError || isCancelled) && (
          <div className="flex flex-col items-end justify-center mr-2 min-w-[160px]">
            <ModelProgress
              percent={percent}
              status={progress?.status ?? "idle"}
            />
            <div className="mt-1 flex h-3 w-full items-center justify-end">
              {isDownloading && (
                <p className="ui-text-micro ui-color-disabled tabular-nums truncate max-w-[150px] text-right">
                  {progress?.percent?.toFixed(0)}% ·{" "}
                  {
                    (
                      progress as Extract<
                        DownloadEvent,
                        { status: "downloading" }
                      >
                    ).file
                  }
                </p>
              )}
              {showError && (
                <p className="ui-text-micro ui-color-error flex items-center justify-end gap-1 w-full">
                  <AlertCircle size={9} className="shrink-0" />
                  <span className="truncate">
                    {
                      (progress as Extract<DownloadEvent, { status: "error" }>)
                        .message
                    }
                  </span>
                </p>
              )}
              {isCancelled && (
                <p className="ui-text-micro ui-color-disabled text-right w-full">
                  {t({
                    id: "settings.models.cancelled",
                    message: "Cancelled",
                  })}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {installed && (
            <button
              onClick={onUse}
              disabled={isActive}
              className={`min-w-7 px-0.5 py-1 ui-text-button-sm transition-colors ${
                isActive
                  ? "invisible pointer-events-none"
                  : "ui-color-secondary hover:text-local"
              }`}
            >
              {t({
                id: "settings.models.use",
                message: "Use",
              })}
            </button>
          )}
          {isDownloading ? (
            <button
              onClick={onCancel}
              className="flex h-6 w-6 items-center justify-center rounded-md text-error hover:bg-error/10 transition-colors"
              title={t({
                id: "settings.models.cancel",
                message: "Cancel",
              })}
              aria-label={t({
                id: "settings.models.cancel_download",
                message: "Cancel download",
              })}
            >
              <Square size={10} fill="currentColor" aria-hidden="true" />
            </button>
          ) : installed ? (
            <button
              onClick={onDelete}
              className="flex h-6 w-6 items-center justify-center rounded-md text-content-disabled hover:text-error hover:bg-error/10 transition-colors"
              title={t({
                id: "settings.models.delete",
                message: "Delete",
              })}
              aria-label={t({
                id: "settings.models.delete_model",
                message: "Delete model",
              })}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          ) : (
            <button
              onClick={onDownload}
              disabled={isCancelled}
              className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                isCancelled
                  ? "text-content-disabled cursor-default"
                  : "text-content-muted hover:text-content-primary hover:bg-surface-elevated"
              }`}
              title={t({
                id: "settings.models.download",
                message: "Download",
              })}
              aria-label={t({
                id: "settings.models.download_model",
                message: "Download model",
              })}
            >
              <Download size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

type ModelProgressProps = {
  percent: number;
  status: string;
};

const ModelProgress = ({ percent, status }: ModelProgressProps) => {
  const cols = 40;
  const rows = 2;
  const totalDots = cols * rows;
  const activeCount = Math.round((percent / 100) * totalDots);

  const activeDots = Array.from(
    { length: Math.min(activeCount, totalDots) },
    (_, i) => i,
  );

  const color =
    status === "error"
      ? "var(--color-error)"
      : status === "complete"
        ? "var(--color-success)"
        : "var(--color-cloud)";

  return (
    <DotMatrix
      rows={rows}
      cols={cols}
      activeDots={activeDots}
      dotSize={2}
      gap={2}
      color={color}
      className={status === "downloading" ? "opacity-80" : "opacity-60"}
      morphOnActive={true}
      activeScale={1.0}
    />
  );
};

export default ModelsTab;
