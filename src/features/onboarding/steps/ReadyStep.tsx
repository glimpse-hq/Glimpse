import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import { useShortcutCapture } from "../../../shared/hooks/useShortcutCapture";
import type { StepMotionProps } from "./shared";

interface ReadyStepProps {
  stepMotionProps: StepMotionProps;
  smartShortcut: string;
  captureActive: boolean;
  capturePreview: string;
  isCompleting: boolean;
  completionError: string | null;
  onStartCapture: () => void;
  onEndCapture: (shortcut?: string) => void;
  onSetPreview: (preview: string) => void;
  onSetShortcut: (shortcut: string) => void;
  onComplete: () => void;
}

export function ReadyStep({
  stepMotionProps,
  smartShortcut,
  captureActive,
  capturePreview,
  isCompleting,
  completionError,
  onStartCapture,
  onEndCapture,
  onSetPreview,
  onSetShortcut,
  onComplete,
}: ReadyStepProps) {
  const { t } = useLingui();

  const finalizeCapture = useCallback(() => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
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

  return (
    <motion.div
      key="ready"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-sm flex-col items-center text-center"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
        {t({
          id: "onboarding.ready.title",
          message: "You're ready!",
        })}
      </h2>

      <p className="ui-text-body-lg text-content-muted mb-6">
        {t({
          id: "onboarding.ready.subtitle",
          message: "Smart is on by default, others available in settings.",
        })}
      </p>

      <div className="w-full rounded-lg bg-surface-surface p-2.5 text-left">
        <div className="space-y-1.5 px-2 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "onboarding.ready.smart.label",
                  message: "Smart",
                })}
              </span>
              <span className="truncate ui-text-meta ui-color-disabled">
                {t({
                  id: "onboarding.ready.smart.description",
                  message: "tap to toggle, hold to talk",
                })}
              </span>
            </div>
            <span className="shrink-0 rounded-md bg-amber-400/20 px-1.5 py-0.5 ui-text-micro font-medium ui-color-warning-strong">
              {t({
                id: "onboarding.ready.smart.badge",
                message: "Default",
              })}
            </span>
          </div>

          <motion.button
            type="button"
            onClick={() => {
              if (!captureActive) startCapture();
            }}
            aria-label={t({
              id: "onboarding.ready.smart.capture_aria",
              message: `Record new shortcut for Smart, currently ${formatShortcutForDisplay(smartShortcut)}`,
            })}
            className={`w-full border-b pb-1 pt-1 text-left ui-text-kbd transition-colors flex items-center ${
              captureActive
                ? "ui-color-primary border-border-hover"
                : "ui-color-secondary border-border-primary hover:border-border-secondary hover:text-content-primary"
            }`}
          >
            <div className="flex min-w-0 items-center gap-1.5 h-5">
              {captureActive ? (
                <>
                  <motion.span
                    className="h-1 w-1 rounded-full bg-cloud"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  <span
                    className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
                  >
                    {capturePreview ||
                      t({
                        id: "onboarding.ready.smart.capture_prompt",
                        message: "Press new shortcut...",
                      })}
                  </span>
                </>
              ) : (
                <span className="block truncate">
                  {formatShortcutForDisplay(smartShortcut)}
                </span>
              )}
            </div>
          </motion.button>

          <p className="ui-text-meta text-content-muted">
            {captureActive
              ? t({
                  id: "onboarding.ready.smart.capture_help_active",
                  message: "Press your new shortcut, or hit Esc to cancel.",
                })
              : t({
                  id: "onboarding.ready.smart.capture_help_idle",
                  message: "Click the shortcut to change it.",
                })}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onComplete}
        disabled={captureActive || isCompleting}
        aria-busy={isCompleting}
        className="mt-6 flex items-center gap-2 rounded-lg bg-amber-400 px-6 py-2.5 ui-text-body-lg font-semibold ui-color-on-warning hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isCompleting
          ? t({
              id: "onboarding.ready.saving",
              message: "Saving...",
            })
          : t({
              id: "onboarding.ready.get_started",
              message: "Get Started",
            })}
      </button>

      <p className="mt-3 ui-text-micro ui-color-disabled text-center">
        {t({
          id: "onboarding.ready.analytics_notice",
          message:
            "Glimpse sends anonymous usage analytics to help improve the app. You can disable this anytime in Settings -> App.",
        })}
      </p>

      {completionError && (
        <p className="mt-3 ui-text-label text-error text-center">
          {completionError}
        </p>
      )}
    </motion.div>
  );
}
