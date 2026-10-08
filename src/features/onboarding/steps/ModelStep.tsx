import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
} from "../../../shared/lib/modelCapabilities";
import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import ModelPickerModal from "../../../shared/ui/ModelPickerModal";
import {
  downloadFailureLabel,
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

type OptionCard = {
  id: string;
  opensList?: boolean;
  title: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
};

interface ModelStepProps {
  stepMotionProps: StepMotionProps;
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
  recommendedKey: string;
  userLanguages: string[];
  onNext: () => void;
}

export function ModelStep({
  stepMotionProps,
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
  recommendedKey,
  userLanguages,
  onNext,
}: ModelStepProps) {
  const { t } = useLingui();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const title = t({ id: "onboarding.model.title", message: "Choose a model" });

  const installed = (key: string) =>
    Boolean(modelStatusByKey[key]?.installed) ||
    displayStateByModel[key]?.status === "complete";
  const progress =
    displayState.status !== "idle" && displayState.status !== "complete"
      ? displayState
      : undefined;

  // Only offered when it covers every language the user speaks.
  const builtIn = catalog.find(
    (model) =>
      isBuiltInModel(model) &&
      model.key !== recommendedKey &&
      userLanguages.every((language) =>
        model.supported_languages.some(
          (supported) => supported.code.split(/[-_]/)[0] === language,
        ),
      ),
  );
  const isListed = (key: string) =>
    key !== "" && key !== recommendedKey && key !== builtIn?.key;
  // The last model picked from the full list, shown on the third card.
  const [listedKey, setListedKey] = useState(activeModelKey);
  const listed = isListed(listedKey)
    ? catalog.find((model) => model.key === listedKey)
    : undefined;

  const cards = [
    recommendedKey && {
      id: "auto",
      title: t({
        id: "onboarding.model.option.automatic",
        message: "Automatic",
      }),
      detail: t({
        id: "onboarding.model.option.recommended",
        message: "Recommended",
      }),
      selected: activeModelKey === recommendedKey,
      onClick: () => onUse(recommendedKey),
    },
    builtIn && {
      id: "built_in",
      title: t({ id: "onboarding.model.tier.built_in", message: "Built in" }),
      detail: friendlyModelName(builtIn.label),
      selected: activeModelKey === builtIn.key,
      onClick: () => onUse(builtIn.key),
    },
    {
      id: "listed",
      title: listed
        ? friendlyModelName(listed.label)
        : t({
            id: "onboarding.model.option.other",
            message: "Other models",
          }),
      detail: t({ id: "onboarding.model.option.see_all", message: "See all" }),
      selected: Boolean(listed) && activeModelKey === listedKey,
      opensList: true,
      onClick: () =>
        listed && activeModelKey !== listedKey
          ? onUse(listedKey)
          : setShowAdvanced(true),
    },
  ].filter((card): card is OptionCard => Boolean(card));

  const pickFromList = (key: string) => {
    onUse(key);
    setListedKey(key);
    setShowAdvanced(false);
  };

  const capabilities = (model: ModelInfo) =>
    [
      t({
        id: "onboarding.model.supports.languages",
        message: plural(model.supported_languages.length, {
          one: "# language",
          other: "# languages",
        }),
      }),
      model.ane_size_mb != null &&
        (!installed(model.key) || modelStatusByKey[model.key]?.ane_installed) &&
        t({
          id: "onboarding.model.capability.neural_engine",
          message: "Apple Neural Engine",
        }),
      hasModelCapability(model, MODEL_CAPABILITY_DICTIONARY) &&
        t({
          id: "onboarding.model.supports.words",
          message: "Custom words",
        }),
      hasModelCapability(model, MODEL_CAPABILITY_STREAMING) &&
        t({
          id: "onboarding.model.supports.live",
          message: "Live text while you speak",
        }),
    ].filter((point): point is string => Boolean(point));

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
        </>
      }
    >
      <OnboardingHeader title={title} />

      <div className="flex w-full items-stretch justify-center">
        <div
          role="group"
          aria-label={title}
          className="grid w-[240px] shrink-0 auto-rows-fr gap-2 self-start pr-8"
        >
          {!isLoading &&
            cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={card.onClick}
                aria-pressed={card.selected}
                aria-haspopup={card.opensList ? "dialog" : undefined}
                className={`group flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
                  card.selected
                    ? "border-cloud bg-cloud-10"
                    : "border-border-primary hover:border-cloud-50 hover:bg-[var(--surface-interactive)] active:bg-[var(--surface-interactive-pressed)]"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                    card.selected
                      ? "border-cloud bg-cloud"
                      : "border-border-secondary group-hover:border-cloud-50"
                  }`}
                >
                  {card.selected ? (
                    <Check
                      size={10}
                      weight="bold"
                      className="text-surface-secondary"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block ui-text-body-lg-strong leading-tight text-content-primary text-balance">
                    {card.title}
                  </span>
                  <span className="block ui-text-meta text-content-muted text-balance">
                    {card.detail}
                  </span>
                </span>
              </button>
            ))}
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
              capabilities={capabilities(selectedModel)}
              caveat={
                selectedModel.key === builtIn?.key
                  ? t({
                      id: "onboarding.model.caveat.less_accurate",
                      message: "Less accurate than Automatic.",
                    })
                  : null
              }
              installed={installed(selectedModel.key)}
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
        onUse={pickFromList}
        onDownload={(key, ane) => {
          pickFromList(key);
          onDownload(key, ane);
        }}
        onDelete={onDelete}
        onCancel={onCancelDownload}
      />
    </OnboardingStep>
  );
}

// "Whisper Large V3 Turbo" becomes "Whisper": the family without size,
// version or variant.
function friendlyModelName(label: string): string {
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b(TDT|Large|Medium|Small|Base|Tiny|Turbo)\b/gi, "")
    .replace(/\bV\d+(\.\d+)?\b/gi, "")
    .replace(/\b\d+(\.\d+)?B\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ModelDetails({
  model,
  capabilities,
  caveat,
  installed,
  progress,
  onCancel,
}: {
  model: ModelInfo;
  capabilities: string[];
  caveat: string | null;
  installed: boolean;
  progress: DownloadEvent | undefined;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const builtIn = isBuiltInModel(model);
  const downloading = progress?.status === "downloading";
  const percent = Math.round(progress?.percent ?? 0);
  const fileIndex =
    progress && "fileIndex" in progress ? progress.fileIndex : undefined;
  const fileCount =
    progress && "fileCount" in progress ? progress.fileCount : undefined;

  return (
    <div>
      <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-content-primary">
        {friendlyModelName(model.label)}
      </h3>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 ui-text-body-sm text-content-muted">
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
        ) : progress?.status === "error" && progress.reason ? (
          <span className="text-error text-pretty" title={progress.message}>
            {downloadFailureLabel(progress.reason)}
          </span>
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
      <ul className="mt-5 flex flex-col gap-2">
        {capabilities.map((capability) => (
          <li
            key={capability}
            className="flex items-center gap-2 ui-text-body-sm text-content-primary"
          >
            <Check
              size={12}
              weight="bold"
              className="shrink-0 ui-color-cloud"
            />
            {capability}
          </li>
        ))}
      </ul>
      {caveat && (
        <p className="mt-4 ui-text-body-sm text-content-muted text-pretty">
          {caveat}
        </p>
      )}
    </div>
  );
}
