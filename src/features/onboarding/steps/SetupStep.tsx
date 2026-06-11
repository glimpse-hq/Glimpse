import { useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Warning as AlertTriangle } from "@phosphor-icons/react";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import { useShortcutCapture } from "../../../shared/hooks/useShortcutCapture";
import ModelPickerModal from "../../../shared/ui/ModelPickerModal";
import type { StepMotionProps } from "./shared";
import ModelStatCard from "../../settings/components/ModelStatCard";
import type { DownloadEvent, ModelInfo, ModelStatus } from "../../../types";
import type { OnboardingModelPriority } from "../machine";

interface SetupStepProps {
  stepMotionProps: StepMotionProps;
  modelPriority: OnboardingModelPriority | null;
  customModel: boolean;
  smartShortcut: string;
  captureActive: boolean;
  capturePreview: string;
  recommendedModel: ModelInfo | null;
  catalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  displayStateByModel: Record<string, DownloadEvent>;
  activeModelKey: string;
  onUse: (key: string) => void;
  isLoading: boolean;
  unavailable: boolean;
  displayState: DownloadEvent;
  selectedModelReady: boolean;
  showLocalConfirm: boolean;
  onSelectPriority: (priority: OnboardingModelPriority) => void;
  onStartCapture: () => void;
  onEndCapture: (shortcut?: string) => void;
  onSetPreview: (preview: string) => void;
  onSetShortcut: (shortcut: string) => void;
  onShowConfirm: (show: boolean) => void;
  onDownload: (key: string, ane?: boolean) => void;
  onDelete: (key: string) => void;
  onCancelDownload: (key: string) => void;
  onNext: () => void;
}

export function SetupStep({
  stepMotionProps,
  modelPriority,
  customModel,
  smartShortcut,
  captureActive,
  capturePreview,
  recommendedModel,
  catalog,
  modelStatus: modelStatusByKey,
  displayStateByModel,
  activeModelKey,
  onUse,
  isLoading,
  unavailable,
  displayState,
  selectedModelReady,
  showLocalConfirm,
  onSelectPriority,
  onStartCapture,
  onEndCapture,
  onSetPreview,
  onSetShortcut,
  onShowConfirm,
  onDownload,
  onDelete,
  onCancelDownload,
  onNext,
}: SetupStepProps) {
  const { t } = useLingui();
  const [step, setStep] = useState<"priority" | "review">(
    modelPriority ? "review" : "priority",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmDismissed, setConfirmDismissed] = useState(false);

  const priorityOptions: Array<{
    value: OnboardingModelPriority;
    label: string;
    helper: string;
  }> = [
    {
      value: "quality",
      label: t({
        id: "onboarding.setup.priority.quality",
        message: "Best quality",
      }),
      helper: t({
        id: "onboarding.setup.priority.quality.helper",
        message: "Most accurate",
      }),
    },
    {
      value: "balanced",
      label: t({
        id: "onboarding.setup.priority.balanced",
        message: "Balanced",
      }),
      helper: t({
        id: "onboarding.setup.priority.balanced.helper",
        message: "Accuracy & size",
      }),
    },
    {
      value: "compact",
      label: t({
        id: "onboarding.setup.priority.compact",
        message: "Smallest",
      }),
      helper: t({
        id: "onboarding.setup.priority.compact.helper",
        message: "Less storage",
      }),
    },
  ];

  const finalizeCapture = useCallback(async () => {
    await invoke("set_shortcut_capture_active", { active: false }).catch(
      () => {},
    );
    onEndCapture();
  }, [onEndCapture]);

  const { resetCaptureState } = useShortcutCapture({
    active: captureActive,
    onCancel: finalizeCapture,
    onPreviewChange: onSetPreview,
    onShortcutCaptured: onSetShortcut,
  });

  const startCapture = () => {
    resetCaptureState();
    onStartCapture();
    invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
      console.error("Failed to disable shortcuts for capture", err);
      onEndCapture();
      resetCaptureState();
    });
  };

  const hasPriority = Boolean(modelPriority);
  const canContinue = hasPriority && !captureActive && !isLoading;
  const modelStatus: ModelStatus | undefined = recommendedModel
    ? {
        key: recommendedModel.key,
        installed: displayState.status === "complete",
        ane_installed: false,
        bytes_on_disk: 0,
        missing_files: [],
        directory: "",
      }
    : undefined;
  const progress =
    displayState.status === "downloading" ? displayState : undefined;
  // The Neural Engine encoder is bundled into onboarding downloads, so show its size too.
  const alreadyInstalled = Boolean(
    recommendedModel && modelStatusByKey[recommendedModel.key]?.installed,
  );
  const displayModel =
    recommendedModel?.ane_size_mb != null && !alreadyInstalled
      ? {
          ...recommendedModel,
          size_mb: recommendedModel.size_mb + recommendedModel.ane_size_mb,
        }
      : recommendedModel;

  const handleContinue = () => {
    if (!canContinue) return;
    if (!selectedModelReady) {
      onShowConfirm(true);
      return;
    }
    onNext();
  };

  return (
    <motion.div
      key="setup"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-7">
        {t({
          id: "onboarding.setup.title",
          message: "Set up Glimpse",
        })}
      </h2>

      <div className="relative min-h-[17rem] w-full">
        <AnimatePresence mode="wait" initial={false}>
          {step === "priority" && (
            <StepPanel
              key="priority"
              question={t({
                id: "onboarding.setup.priority.question",
                message: "What should your model prioritize?",
              })}
            >
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {priorityOptions.map((option) => (
                  <ChoicePill
                    key={option.value}
                    selected={modelPriority === option.value}
                    helper={option.helper}
                    onClick={() => {
                      onSelectPriority(option.value);
                      setStep("review");
                    }}
                  >
                    {option.label}
                  </ChoicePill>
                ))}
              </div>
            </StepPanel>
          )}

          {step === "review" && (
            <StepPanel key="review">
              <div className="flex w-full flex-col items-center gap-4">
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 ui-text-meta text-content-muted">
                  <EditLink onClick={() => setStep("priority")}>
                    {customModel
                      ? t({
                          id: "onboarding.setup.priority.custom",
                          message: "Custom",
                        })
                      : (priorityOptions.find(
                          (option) => option.value === modelPriority,
                        )?.label ??
                        t({
                          id: "onboarding.setup.priority.placeholder",
                          message: "choose a priority",
                        }))}
                  </EditLink>
                </div>

                {isLoading ? (
                  <div className="w-full overflow-hidden rounded-xl border border-border-secondary bg-surface-surface text-left">
                    <p className="p-4 ui-text-body-sm text-content-muted">
                      {t({
                        id: "onboarding.setup.model.loading_title",
                        message: "Finding your local model",
                      })}
                    </p>
                  </div>
                ) : !recommendedModel ? (
                  <div className="w-full overflow-hidden rounded-xl border border-border-secondary bg-surface-surface text-left">
                    <p className="p-4 ui-text-body-sm text-content-muted">
                      {unavailable
                        ? t({
                            id: "onboarding.setup.model.unavailable_body",
                            message:
                              "Model list unavailable. You can manage local models later in Settings.",
                          })
                        : t({
                            id: "onboarding.setup.model.empty_body",
                            message:
                              "No local models found. You can manage them later in Settings.",
                          })}
                    </p>
                  </div>
                ) : (
                  <ModelStatCard
                    model={displayModel ?? recommendedModel}
                    status={modelStatus}
                    progress={progress}
                    onDownload={() => onDownload(recommendedModel.key)}
                    onDelete={() => onDelete(recommendedModel.key)}
                    onCancel={() => onCancelDownload(recommendedModel.key)}
                  />
                )}

                <div className="flex flex-col items-center gap-1.5 ui-text-body-sm text-content-muted">
                  <span className="flex items-center gap-1.5">
                    {t({
                      id: "onboarding.setup.shortcut.label",
                      message: "Dictate with",
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        if (!captureActive) startCapture();
                      }}
                      className={`inline-flex items-center gap-1.5 ui-text-body-sm-strong underline-offset-4 transition-colors ${
                        captureActive
                          ? "text-cloud underline"
                          : "text-cloud hover:underline"
                      }`}
                      aria-label={t({
                        id: "onboarding.setup.shortcut.aria",
                        message: `Record new shortcut, currently ${formatShortcutForDisplay(smartShortcut)}`,
                      })}
                    >
                      {captureActive && (
                        <motion.span
                          className="h-1.5 w-1.5 rounded-full bg-cloud"
                          animate={{ opacity: [0.35, 1, 0.35] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        />
                      )}
                      <span>
                        {captureActive
                          ? capturePreview ||
                            t({
                              id: "onboarding.setup.shortcut.prompt",
                              message: "press a shortcut",
                            })
                          : formatShortcutForDisplay(smartShortcut)}
                      </span>
                    </button>
                  </span>
                  {captureActive && (
                    <span className="ui-text-meta text-content-disabled">
                      {t({
                        id: "onboarding.setup.shortcut.active_help",
                        message: "Press the keys you want, or Esc to cancel.",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </StepPanel>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-7 flex w-full flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 ui-text-body-lg font-semibold ui-color-on-warning transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px"
        >
          {t({
            id: "onboarding.setup.continue",
            message: "Continue",
          })}
        </button>
        <div className="flex h-5 items-center justify-center">
          {step === "review" && catalog.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="ui-text-body-sm text-content-muted underline-offset-4 transition-colors hover:text-content-primary hover:underline"
            >
              {t({
                id: "onboarding.setup.pick_specific",
                message: "Browse all models",
              })}
            </button>
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

      {createPortal(
        <AnimatePresence>
          {showLocalConfirm && !confirmDismissed && (
            <motion.div
              key="setup-local-confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-xs"
              onClick={() => onShowConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-6 text-center ui-shadow-modal-deep"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="setup-local-confirm-title"
                aria-describedby="setup-local-confirm-body"
              >
                <AlertTriangle
                  size={22}
                  className="ui-color-warning-strong mx-auto mb-3"
                />
                <p id="setup-local-confirm-title" className="ui-text-body-lg font-semibold text-content-primary">
                  {t({
                    id: "onboarding.setup.confirm_without_model.title",
                    message: "Continue without a model?",
                  })}
                </p>
                <p id="setup-local-confirm-body" className="mt-1 ui-text-label text-content-disabled">
                  {t({
                    id: "onboarding.setup.confirm_without_model.body",
                    message:
                      "Transcription will not run offline until you download a local model.",
                  })}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onShowConfirm(false)}
                    className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary transition-colors hover:border-border-hover"
                  >
                    {t({
                      id: "onboarding.setup.confirm_without_model.stay",
                      message: "Stay here",
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDismissed(true);
                      onShowConfirm(false);
                      onNext();
                    }}
                    className="rounded-lg bg-amber-400 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-warning transition-colors hover:bg-amber-300"
                  >
                    {t({
                      id: "onboarding.setup.confirm_without_model.continue",
                      message: "Continue anyway",
                    })}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </motion.div>
  );
}

function StepPanel({
  question,
  onBack,
  children,
}: {
  question?: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-0 flex flex-col items-center"
    >
      {question && (
        <h3 className="mb-6 ui-text-body-lg font-medium text-content-primary">
          {question}
        </h3>
      )}
      {children}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-6 ui-text-meta text-content-muted underline-offset-2 transition-colors hover:text-content-primary hover:underline"
        >
          {t({ id: "onboarding.setup.back", message: "Back" })}
        </button>
      )}
    </motion.div>
  );
}

function ChoicePill({
  selected,
  helper,
  onClick,
  children,
}: {
  selected: boolean;
  helper?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-5 py-2 transition-colors ${
        selected
          ? "text-cloud"
          : "text-content-muted hover:text-content-primary"
      }`}
    >
      <span className="ui-text-body-lg font-medium">{children}</span>
      {helper && (
        <span
          className={`ui-text-meta ${
            selected ? "text-cloud/70" : "text-content-disabled"
          }`}
        >
          {helper}
        </span>
      )}
    </button>
  );
}

function EditLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline-offset-2 transition-colors hover:text-content-primary hover:underline"
    >
      {children}
    </button>
  );
}
