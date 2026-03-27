import { motion, AnimatePresence } from "framer-motion";
import { Download, Trash2, Square, AlertTriangle } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { ModelProgress, type StepMotionProps } from "./shared";
import type { ModelInfo, ModelStatus } from "../../../types";
import type { LocalDownloadStatus } from "../machine";

interface ModelSelectionStepProps {
  stepMotionProps: StepMotionProps;
  modelCatalog: ModelInfo[];
  isLoading: boolean;
  unavailable: boolean;
  selectedModel: string;
  onSelectModel: (key: string) => void;
  displayStateByModel: Record<string, LocalDownloadStatus>;
  modelStatus: Record<string, ModelStatus>;
  selectedModelReady: boolean;
  showLocalConfirm: boolean;
  onShowConfirm: (show: boolean) => void;
  onDownload: (key: string) => void;
  onDelete: (key: string) => void;
  onCancelDownload: (key: string) => void;
  onNext: () => void;
}

export function ModelSelectionStep({
  stepMotionProps,
  modelCatalog,
  isLoading,
  unavailable,
  selectedModel,
  onSelectModel,
  displayStateByModel,
  modelStatus: _modelStatus,
  selectedModelReady,
  showLocalConfirm,
  onShowConfirm,
  onDownload,
  onDelete,
  onCancelDownload,
  onNext,
}: ModelSelectionStepProps) {
  const handleContinue = () => {
    if (!selectedModelReady) {
      onShowConfirm(true);
      return;
    }
    onNext();
  };

  return (
    <motion.div
      key="local-model"
      {...stepMotionProps}
      initial="enter"
      className="flex flex-col items-center text-center w-full max-w-2xl"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
        Choose your local model
      </h2>
      <div className="mb-6 flex flex-col gap-1 ui-text-body-lg text-content-muted">
        <p>More models and language model setup available in Settings after setup.</p>
      </div>

      {isLoading ? (
        <div className="w-full rounded-2xl border border-border-primary bg-surface-tertiary px-5 py-6 text-left">
          <p className="ui-text-body-lg font-semibold text-content-primary">Loading local models</p>
          <p className="mt-2 ui-text-body text-content-muted">Fetching the available local transcription engines for this build.</p>
        </div>
      ) : modelCatalog.length === 0 ? (
        <div className="w-full rounded-2xl border border-border-primary bg-surface-tertiary px-5 py-6 text-left">
          <p className="ui-text-body-lg font-semibold text-content-primary">
            {unavailable ? "Model list unavailable" : "No local models found"}
          </p>
          <p className="mt-2 ui-text-body text-content-muted">
            {unavailable
              ? "Glimpse couldn't load the local model list. Setup can continue with the default local engine, and you can manage downloads later in Settings."
              : "This build did not return any local models. You can continue setup and manage models later in Settings."}
          </p>
        </div>
      ) : (
        <div className={`grid w-full items-start gap-4 ${modelCatalog.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
          {modelCatalog.map((model) => {
            const displayState = displayStateByModel[model.key] ?? { status: "idle", percent: 0 };
            const installed = displayState.status === "complete";
            const isSelected = selectedModel === model.key;
            const isActive = isSelected && installed;
            const isWhisper = model.engine_id === "whisper";
            const accentTextClass = isWhisper ? "text-cloud" : "text-local";
            const accentFillClass = "bg-cloud/15 text-cloud border-cloud/40";
            const accentDotColor = isWhisper ? "var(--color-cloud)" : "var(--color-local)";
            const borderClass = isActive
              ? "border-cloud-50 bg-surface-tertiary"
              : isSelected
                ? "border-border-primary bg-surface-tertiary ring-1 ring-amber-400/30"
                : "border-border-primary bg-surface-tertiary hover:border-border-hover";
            const heroDots = isWhisper
              ? [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65]
              : [0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68];
            const headerDots = isWhisper ? [1, 2] : [0];

            return (
              <div
                key={model.key}
                role="button"
                tabIndex={0}
                onClick={() => onSelectModel(model.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectModel(model.key);
                  }
                }}
                aria-label={`Select ${model.label}`}
                aria-pressed={isSelected}
                className={`relative flex w-full self-start cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-colors ${
                  isWhisper ? "ui-shadow-onboarding-model" : "ui-shadow-onboarding-model-alt"
                } ${borderClass}`}
                style={isActive ? { outline: "1px solid var(--color-cloud-50)", outlineOffset: "-1px" } : undefined}
              >
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 opacity-10">
                    <DotMatrix rows={6} cols={18} activeDots={heroDots} dotSize={2} gap={4} color="var(--color-border-primary)" />
                  </div>
                </div>
                <div className="relative flex flex-col gap-3 p-4 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <DotMatrix rows={2} cols={2} activeDots={headerDots} dotSize={3} gap={2} color={accentDotColor} />
                      <span className="ui-text-body-lg font-semibold leading-tight text-content-primary text-balance">{model.label}</span>
                    </div>
                    <span className="shrink-0 pt-0.5 ui-text-micro text-content-muted tabular-nums">
                      {model.size_mb >= 1000 ? `${(model.size_mb / 1000).toFixed(1)} GB` : `${Math.round(model.size_mb)} MB`}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5">
                    {model.tags.map((tag, index) => (
                      <span
                        key={`model-tag-${index}-${tag || "empty"}`}
                        className={`px-1.5 py-0.5 rounded-sm ui-text-nano font-semibold uppercase tracking-wider border ${
                          tag.toLowerCase() === "recommended"
                            ? "bg-emerald-500/15 ui-color-success-subtle border-emerald-500/30"
                            : accentFillClass
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="h-16 ui-text-label leading-relaxed text-content-muted text-pretty">{model.description}</p>
                </div>

                <div className="relative border-t border-border-primary bg-surface-surface/40 px-4 pt-2 pb-1 ui-text-meta text-content-tertiary leading-relaxed space-y-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      aria-label={
                        displayState.status === "downloading"
                          ? `Stop downloading ${model.label}`
                          : displayState.status === "complete"
                            ? `Delete ${model.label}`
                            : `Download ${model.label}`
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        if (displayState.status === "downloading") {
                          onCancelDownload(model.key);
                        } else if (displayState.status === "complete") {
                          onDelete(model.key);
                        } else if (displayState.status !== "cancelled") {
                          onDownload(model.key);
                        }
                      }}
                      disabled={displayState.status === "cancelled"}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary transition-colors ${
                        displayState.status === "downloading" || displayState.status === "complete"
                          ? "text-error hover:bg-surface-elevated"
                          : displayState.status === "cancelled"
                            ? "text-content-disabled cursor-default"
                            : "text-content-primary hover:bg-surface-elevated"
                      }`}
                    >
                      {displayState.status === "downloading" ? (
                        <Square size={10} className="fill-current" />
                      ) : displayState.status === "complete" ? (
                        <Trash2 size={14} />
                      ) : (
                        <Download size={14} className={displayState.status === "cancelled" ? "" : accentTextClass} />
                      )}
                    </button>
                    <span className="ui-text-label-strong text-content-secondary">
                      {displayState.status === "complete" ? "Downloaded" : "Download"}
                    </span>
                  </div>
                  <ModelProgress percent={displayState.percent} status={displayState.status} />
                  <div className="h-4 flex items-center">
                    {displayState.status === "downloading" && (
                      <p className="ui-text-meta leading-none text-content-muted tabular-nums truncate w-full">
                        {displayState.percent.toFixed(0)}% · {displayState.file ?? ""}
                      </p>
                    )}
                    {displayState.status === "error" && (
                      <p className="ui-text-meta leading-none text-error truncate w-full">{displayState.message ?? "Download failed"}</p>
                    )}
                    {displayState.status === "cancelled" && (
                      <p className="ui-text-meta leading-none text-content-muted">Cancelled</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={isLoading}
        className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Loading..." : "Continue"}
      </button>

      <AnimatePresence>
        {showLocalConfirm && (
          <motion.div
            key="local-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
            onClick={() => onShowConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle size={20} className="ui-color-warning-strong shrink-0" />
                <div>
                  <p className="ui-text-body-lg font-semibold text-content-primary">Continue without a model?</p>
                  <p className="ui-text-label text-content-disabled">
                    You haven't downloaded a local model yet. Transcription will not run offline until you add one in Settings.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => onShowConfirm(false)}
                  className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary hover:border-border-hover transition-colors"
                >
                  Stay here
                </button>
                <button
                  onClick={() => {
                    onShowConfirm(false);
                    onNext();
                  }}
                  className="rounded-lg bg-amber-400 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-warning hover:bg-amber-300 transition-colors"
                >
                  Continue anyway
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
