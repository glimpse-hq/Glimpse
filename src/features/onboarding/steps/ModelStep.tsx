import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DIARIZATION,
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
  MODEL_CAPABILITY_TIMESTAMPS,
} from "../../../shared/lib/modelCapabilities";
import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import ModelPickerModal from "../../../shared/ui/ModelPickerModal";
import {
  deriveModelStats,
  formatModelSize,
  isBuiltInModel,
  modelSizeMb,
} from "../../../shared/lib/modelStats";
import type { DownloadEvent, ModelInfo, ModelStatus } from "../../../types";
import {
  OnboardingHeader,
  OnboardingStep,
  PRIMARY_BUTTON_CLASS,
  type StepMotionProps,
} from "./shared";

interface ModelStepProps {
  stepMotionProps: StepMotionProps;
  options: ModelInfo[];
  selectedModel: ModelInfo | null;
  catalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  displayStateByModel: Record<string, DownloadEvent>;
  activeModelKey: string;
  onUse: (key: string) => void;
  isLoading: boolean;
  unavailable: boolean;
  displayState: DownloadEvent;
  selectedModelReady: boolean;
  onDownload: (key: string, ane?: boolean) => void;
  onDelete: (key: string) => void;
  onCancelDownload: (key: string) => void;
  onNext: () => void;
}

export function ModelStep({
  stepMotionProps,
  options,
  selectedModel,
  catalog,
  modelStatus: modelStatusByKey,
  displayStateByModel,
  activeModelKey,
  onUse,
  isLoading,
  unavailable,
  displayState,
  selectedModelReady,
  onDownload,
  onDelete,
  onCancelDownload,
  onNext,
}: ModelStepProps) {
  const { t } = useLingui();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const realStatus = selectedModel
    ? modelStatusByKey[selectedModel.key]
    : undefined;
  const status: ModelStatus | undefined = selectedModel
    ? {
        key: selectedModel.key,
        installed:
          Boolean(realStatus?.installed) || displayState.status === "complete",
        ane_installed: Boolean(realStatus?.ane_installed),
        bytes_on_disk: realStatus?.bytes_on_disk ?? 0,
        missing_files: realStatus?.missing_files ?? [],
        directory: realStatus?.directory ?? "",
      }
    : undefined;
  const progress =
    displayState.status !== "idle" && displayState.status !== "complete"
      ? displayState
      : undefined;

  const optionTier = (option: ModelInfo) => {
    if (isBuiltInModel(option)) {
      return t({ id: "onboarding.model.tier.built_in", message: "Built in" });
    }
    if (option.key.startsWith("whisper_large")) {
      return t({ id: "onboarding.model.tier.accurate", message: "Accurate" });
    }
    if (option.key.startsWith("parakeet")) {
      return t({ id: "onboarding.model.tier.fast", message: "Fast" });
    }
    if (option.key === "whisper_small_q8") {
      return t({ id: "onboarding.model.tier.small", message: "Small" });
    }
    return null;
  };

  const handleContinue = () => {
    if (isLoading) return;
    if (
      !selectedModelReady &&
      selectedModel &&
      displayState.status !== "downloading"
    ) {
      onDownload(selectedModel.key);
    }
    onNext();
  };

  return (
    <OnboardingStep
      stepKey="model"
      motionProps={stepMotionProps}
      widthClass="max-w-2xl"
      align="center"
      footer={
        <>
          <button
            type="button"
            onClick={handleContinue}
            disabled={isLoading}
            className={PRIMARY_BUTTON_CLASS}
          >
            {t({ id: "onboarding.model.continue", message: "Continue" })}
          </button>
          <div className="flex h-5 items-center justify-center">
            {catalog.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="ui-text-body-sm text-content-muted underline-offset-4 transition-colors hover:text-content-primary hover:underline"
              >
                {t({
                  id: "onboarding.model.browse",
                  message: "Browse all models",
                })}
              </button>
            )}
          </div>
        </>
      }
    >
      <OnboardingHeader
        title={t({ id: "onboarding.model.title", message: "Choose a model" })}
      />

      <div className="flex w-full items-stretch justify-center">
        <div className="flex w-[240px] shrink-0 flex-col gap-2 pr-8">
          {options.map((option) => {
            const selected = selectedModel?.key === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onUse(option.key)}
                aria-pressed={selected}
                className={`group flex h-[52px] w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
                  selected
                    ? "border-cloud bg-cloud-10"
                    : "border-border-primary hover:border-cloud-50 hover:bg-[var(--surface-interactive)] active:bg-[var(--surface-interactive-pressed)]"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                    selected
                      ? "border-cloud bg-cloud"
                      : "border-border-secondary group-hover:border-cloud-50"
                  }`}
                >
                  {selected ? (
                    <Check
                      size={10}
                      weight="bold"
                      className="text-surface-secondary"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate ui-text-body-lg-strong leading-tight text-content-primary">
                    {optionTier(option) ?? friendlyModelName(option.label)}
                  </span>
                  <span className="block truncate ui-text-meta text-content-muted">
                    {isBuiltInModel(option)
                      ? t({
                          id: "onboarding.model.option.no_download",
                          message: "No download",
                        })
                      : formatModelSize(modelSizeMb(option, true))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-h-[236px] w-[240px] shrink-0 border-l border-border-primary pl-8 pt-1 text-left">
          {isLoading ? (
            <p className="ui-text-body-sm text-content-muted">
              {t({
                id: "onboarding.model.loading",
                message: "Finding a model for your device",
              })}
            </p>
          ) : !selectedModel ? (
            <p className="ui-text-body-sm text-content-muted">
              {unavailable
                ? t({
                    id: "onboarding.model.unavailable",
                    message:
                      "Model list unavailable. You can add one later in Settings.",
                  })
                : t({
                    id: "onboarding.model.empty",
                    message:
                      "No models found. You can add one later in Settings.",
                  })}
            </p>
          ) : (
            <ModelDetails
              model={selectedModel}
              installed={Boolean(status?.installed)}
              progress={progress}
              onCancel={() => onCancelDownload(selectedModel.key)}
            />
          )}
        </div>
      </div>

      <ModelPickerModal
        open={showAdvanced}
        onClose={() => setShowAdvanced(false)}
        catalog={catalog}
        activeKey={activeModelKey}
        isInstalled={(key) =>
          Boolean(modelStatusByKey[key]?.installed) ||
          displayStateByModel[key]?.status === "complete"
        }
        isAneInstalled={(key) => Boolean(modelStatusByKey[key]?.ane_installed)}
        progressFor={(key) => displayStateByModel[key]}
        onUse={onUse}
        onDownload={onDownload}
        onDelete={onDelete}
        onCancel={onCancelDownload}
      />
    </OnboardingStep>
  );
}

function friendlyModelName(label: string): string {
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\bTDT\b/g, "")
    .replace(/\b\d+(\.\d+)?B\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ModelDetails({
  model,
  installed,
  progress,
  onCancel,
}: {
  model: ModelInfo;
  installed: boolean;
  progress: DownloadEvent | undefined;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const stats = deriveModelStats(model);
  const builtIn = isBuiltInModel(model);
  const downloading = progress?.status === "downloading";
  const percent = Math.round(progress?.percent ?? 0);
  const fileIndex =
    progress && "fileIndex" in progress ? progress.fileIndex : undefined;
  const fileCount =
    progress && "fileCount" in progress ? progress.fileCount : undefined;

  const supports = [
    stats.englishOnly
      ? t({ id: "onboarding.model.supports.english", message: "English" })
      : t({
          id: "onboarding.model.supports.languages",
          message: plural(stats.langCount, {
            one: "# language",
            other: "# languages",
          }),
        }),
    hasModelCapability(model, MODEL_CAPABILITY_STREAMING) &&
      t({
        id: "onboarding.model.supports.live",
        message: "Live text while you speak",
      }),
    hasModelCapability(model, MODEL_CAPABILITY_DICTIONARY) &&
      t({ id: "onboarding.model.supports.words", message: "Custom words" }),
    hasModelCapability(model, MODEL_CAPABILITY_TIMESTAMPS) &&
      t({ id: "onboarding.model.supports.timestamps", message: "Timestamps" }),
    hasModelCapability(model, MODEL_CAPABILITY_DIARIZATION) &&
      t({
        id: "onboarding.model.supports.speakers",
        message: "Speaker detection",
      }),
  ].filter((item): item is string => Boolean(item));

  return (
    <div>
      <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-content-primary">
        {friendlyModelName(model.label)}
      </h3>
      <div className="mt-1 flex h-5 items-center gap-2 ui-text-body-sm text-content-muted">
        {downloading ? (
          <>
            {/* Fixed width so Cancel doesn't move as the percent grows. */}
            <span className="min-w-[9rem] tabular-nums">
              {fileIndex && fileCount && fileCount > 1
                ? t({
                    id: "onboarding.model.status.downloading_files",
                    message: `Downloading ${percent}% (${fileIndex}/${fileCount})`,
                  })
                : t({
                    id: "onboarding.model.status.downloading",
                    message: `Downloading ${percent}%`,
                  })}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="text-content-secondary underline-offset-4 hover:underline"
            >
              {t({ id: "onboarding.model.status.cancel", message: "Cancel" })}
            </button>
          </>
        ) : builtIn ? (
          t({
            id: "onboarding.model.status.built_in",
            message: "Built into your Mac",
          })
        ) : installed ? (
          t({ id: "onboarding.model.status.ready", message: "Downloaded" })
        ) : (
          t({
            id: "onboarding.model.status.download",
            message: `${formatModelSize(modelSizeMb(model, true))} download`,
          })
        )}
      </div>

      <p className="mt-6 ui-text-meta font-medium text-content-disabled">
        {t({ id: "onboarding.model.supports", message: "Supports" })}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {supports.map((item) => (
          <li
            key={item}
            className="flex items-center gap-2 ui-text-body-sm text-content-primary"
          >
            <Check size={12} weight="bold" className="text-cloud" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
