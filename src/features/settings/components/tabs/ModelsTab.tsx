import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Download,
  Mic,
  Settings2,
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

type ModelCategory = "speech" | "system";

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
  const [activeCategory, setActiveCategory] = useState<ModelCategory>("speech");
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

  const categories: { id: ModelCategory; label: string; icon: typeof Mic }[] = [
    {
      id: "speech",
      label: t({ id: "settings.models.category.speech", message: "Speech" }),
      icon: Mic,
    },
    {
      id: "system",
      label: t({ id: "settings.models.category.system", message: "System" }),
      icon: Settings2,
    },
  ];

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
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="ui-text-body-sm ui-color-muted">
            {t({
              id: "settings.models.description",
              message: "Manage transcription engines and AI provider settings.",
            })}
          </p>
          <div className="flex gap-0.5 p-0.5 rounded-md bg-[var(--color-bg-primary)] border border-border-primary shrink-0">
            {categories.map((cat) => {
              const isActive = activeCategory === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`relative flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-[5px] ui-text-meta transition-colors ${
                    isActive
                      ? "ui-color-primary"
                      : "ui-color-muted hover:text-content-primary"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="models-category-pill"
                      className="absolute inset-0 rounded-[5px] bg-surface-surface border border-border-secondary shadow-[var(--shadow-sm)]"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <Icon size={12} aria-hidden="true" />
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {activeCategory === "speech" && (
          <motion.div
            key="speech"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
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

            <div>
              <h3 className="ui-text-section-label-sm ui-color-disabled mb-3">
                {t({
                  id: "settings.models.transcription_engines",
                  message: "Transcription Engines",
                })}
              </h3>
              <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden divide-y divide-border-primary shadow-[var(--shadow-sm)]">
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
                              <span className="ui-text-meta ui-color-muted">
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
                            <span className="flex items-center gap-1 ui-text-meta ui-color-local">
                              <Check size={12} aria-hidden="true" />
                              {t({
                                id: "settings.models.active",
                                message: "Active",
                              })}
                            </span>
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
        )}

        {activeCategory === "system" && (
          <motion.div
            key="system"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
            <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden shadow-[var(--shadow-sm)]">
              <div className="px-5 py-8 flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated border border-border-primary mb-3">
                  <Settings2 size={18} className="ui-color-disabled" aria-hidden="true" />
                </div>
                <p className="ui-text-body-strong ui-color-primary">
                  {t({
                    id: "settings.models.system.empty_title",
                    message: "No system models yet",
                  })}
                </p>
                <p className="mt-1 ui-text-body-sm ui-color-disabled max-w-[280px]">
                  {t({
                    id: "settings.models.system.empty_description",
                    message: "Background processing models like speaker diarization will appear here as they become available.",
                  })}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="group rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-elevated/50">
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
              <span className="flex items-center gap-1 ui-text-meta ui-color-local">
                <Check size={10} aria-hidden="true" />
                {t({
                  id: "settings.models.active",
                  message: "Active",
                })}
              </span>
            )}
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
          {installed && !isActive && (
            <button
              onClick={onUse}
              className="px-2.5 py-1 rounded-md border border-border-primary bg-surface-surface ui-text-button-sm ui-color-secondary hover:border-local-30 hover:bg-local-5 hover:text-local transition-colors"
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
