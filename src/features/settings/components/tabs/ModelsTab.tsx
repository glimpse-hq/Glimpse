import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Download,
  Square,
  Trash2,
} from "lucide-react";
import DotMatrix from "../../../../shared/ui/DotMatrix";
import { i18n } from "../../../../i18n";
import LanguageModelPanel from "../LanguageModelPanel";
import type {
  DownloadEvent,
  LlmProvider,
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
  if (engineId === "parakeet_v3") {
    return i18n._(
      msg({
        id: "settings.models.engine.parakeet.description",
        message:
          "Fast, multilingual and accurate. Based on ONNX for everyday local transcription.",
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

const enginePriority = (engineId: string): number => {
  if (engineId === "whisper") return 0;
  if (engineId === "parakeet_v3") return 1;
  return 2;
};

const getSizeColor = (sizeMb: number): string => {
  if (sizeMb < 500) return "ui-color-success-strong";
  if (sizeMb < 1500) return "ui-color-warning-strong";
  return "ui-color-error-strong";
};

type ModelsTabProps = {
  variants: Variants;
  llmEnabled: boolean;
  setLlmEnabled: (value: boolean) => void;
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
  modelCatalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  downloadState: Record<string, DownloadEvent>;
  localModel: string;
  setLocalModel: (value: string) => void;
  handleDownload: (modelKey: string) => void;
  handleDelete: (modelKey: string) => void;
  handleCancelDownload: (modelKey: string) => void;
  formatBytes: (bytes: number) => string;
};

const ModelsTab = ({
  variants,
  llmEnabled,
  setLlmEnabled,
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  availableModels,
  fetchAvailableModels,
  modelCatalog,
  modelStatus,
  downloadState,
  localModel,
  setLocalModel,
  handleDownload,
  handleDelete,
  handleCancelDownload,
  formatBytes,
}: ModelsTabProps) => {
  const { t } = useLingui();
  const [expandedEngine, setExpandedEngine] = useState<string | null>(null);

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

  const toggleEngine = (engineId: string) => {
    setExpandedEngine((prev) => (prev === engineId ? null : engineId));
  };

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
            message: "Manage transcription engines and AI provider settings.",
          })}
        </p>
      </header>

      <LanguageModelPanel
        llmEnabled={llmEnabled}
        setLlmEnabled={setLlmEnabled}
        llmProvider={llmProvider}
        setLlmProvider={setLlmProvider}
        llmEndpoint={llmEndpoint}
        setLlmEndpoint={setLlmEndpoint}
        llmApiKey={llmApiKey}
        setLlmApiKey={setLlmApiKey}
        llmModel={llmModel}
        setLlmModel={setLlmModel}
        availableModels={availableModels}
        fetchAvailableModels={fetchAvailableModels}
      />

      {/* Transcription Engines */}
      <div>
        <h3 className="ui-text-section-label-sm ui-color-disabled mb-3">
          {t({
            id: "settings.models.transcription_engines",
            message: "Transcription Engines",
          })}
        </h3>
        <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden divide-y divide-border-primary shadow-[0_3px_0_-1px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          {groupedModels.map((group, groupIndex) => {
            const isExpanded = expandedEngine === group.id;
            const installedCount = group.models.filter(
              (m) => modelStatus[m.key]?.installed,
            ).length;
            const hasActiveModel = group.models.some(
              (m) => localModel === m.key && modelStatus[m.key]?.installed,
            );
            const activeModel = group.models.find(
              (m) => localModel === m.key && modelStatus[m.key]?.installed,
            );

            return (
              <div key={group.id || `model-group-${groupIndex}`}>
                <button
                  onClick={() => toggleEngine(group.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated/50 transition-colors"
                  aria-expanded={isExpanded}
                >
                  <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="text-content-disabled"
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </motion.div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="ui-text-body-strong ui-color-primary">
                        {group.label}
                      </span>
                      {group.recommended && (
                        <span className="ui-text-meta ui-color-local">
                          {t({
                            id: "settings.models.recommended",
                            message: "Recommended",
                          })}
                        </span>
                      )}
                      {hasActiveModel && activeModel && (
                        <span className="ui-text-meta ui-color-cloud">
                          {activeModel.label}
                        </span>
                      )}
                    </div>
                    <p className="ui-text-label ui-color-disabled">
                      {group.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasActiveModel && (
                      <Check
                        size={12}
                        aria-hidden="true"
                        className="ui-color-cloud"
                      />
                    )}
                    {!hasActiveModel && installedCount > 0 && (
                      <span className="ui-text-meta ui-color-disabled">
                        {t({
                          id: "settings.models.installed_count",
                          message: `${installedCount} installed`,
                        })}
                      </span>
                    )}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden bg-surface-elevated/30"
                    >
                      <div className="px-4 py-2 space-y-1">
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
                    </motion.div>
                  )}
                </AnimatePresence>
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
    <div
      className="rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-elevated/50"
    >
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
            {isActive && (
              <span className="ui-text-meta ui-color-cloud">
                {t({
                  id: "settings.models.active",
                  message: "Active",
                })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`ui-text-meta ${getSizeColor(model.size_mb)}`}>
              {formatBytes(model.size_mb * 1024 * 1024)}
            </span>
            {visibleTags.length > 0 && (
              <>
                <span className="ui-text-meta ui-color-disabled">·</span>
                <span className="ui-text-meta ui-color-disabled">
                  {visibleTags.join(", ")}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {installed && !isActive && (
            <button
              onClick={onUse}
              className="px-2.5 py-1 rounded-md border border-border-primary bg-surface-surface ui-text-button-sm ui-color-secondary shadow-[0_2px_0_-1px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-local-30 hover:bg-local-5 hover:text-local hover:shadow-[0_1px_0_-1px_rgba(165,179,254,0.4),inset_0_1px_0_0_rgba(165,179,254,0.1)] hover:translate-y-[1px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
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

      {(isDownloading || showError || isCancelled) && (
        <div className="mt-2">
          <ModelProgress
            percent={percent}
            status={progress?.status ?? "idle"}
          />
          <div className="h-3 flex items-center mt-1">
            {isDownloading && (
              <p className="ui-text-micro ui-color-disabled tabular-nums truncate">
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
              <p className="ui-text-micro ui-color-error flex items-center gap-1">
                <AlertCircle size={9} />
                {
                  (progress as Extract<DownloadEvent, { status: "error" }>)
                    .message
                }
              </p>
            )}
            {isCancelled && (
              <p className="ui-text-micro ui-color-disabled">
                {t({
                  id: "settings.models.cancelled",
                  message: "Cancelled",
                })}
              </p>
            )}
          </div>
        </div>
      )}
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
      className="opacity-60"
    />
  );
};

export default ModelsTab;
