import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  buildShortcutPreviewString,
  buildShortcutString,
  formatShortcutForDisplay,
  normalizeShortcutModifier,
} from "../../../shared/lib/shortcuts";
import type { StepMotionProps } from "./shared";
import type { OnboardingEvent } from "../machine";

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
  send: (event: OnboardingEvent) => void;
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
  const pressedModifiers = useRef<Set<string>>(new Set());
  const primaryKey = useRef<string | null>(null);

  const finalizeCapture = () => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    onEndCapture();
    pressedModifiers.current.clear();
    primaryKey.current = null;
  };

  const buildShortcut = () => {
    return buildShortcutString(pressedModifiers.current, primaryKey.current);
  };

  const startCapture = () => {
    pressedModifiers.current.clear();
    primaryKey.current = null;
    onStartCapture();
    invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
      console.error("Failed to disable shortcuts for capture", err);
    });
  };

  useEffect(() => {
    if (!captureActive) return;

    const updatePreview = () => {
      const preview = buildShortcutPreviewString(
        pressedModifiers.current,
        primaryKey.current,
      );
      onSetPreview(preview ? formatShortcutForDisplay(preview) : "");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeCapture();
        return;
      }
      event.preventDefault();
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.add(modifier);
        updatePreview();
        return;
      }
      if (event.code) {
        primaryKey.current = event.code;
        updatePreview();
        const combo = buildShortcut();
        if (combo) {
          onSetShortcut(combo);
          finalizeCapture();
        } else {
          pressedModifiers.current.clear();
          primaryKey.current = null;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeCapture();
        return;
      }
      event.preventDefault();
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.delete(modifier);
        updatePreview();
        return;
      }
      if (event.code && !primaryKey.current) {
        primaryKey.current = event.code;
        updatePreview();
        const combo = buildShortcut();
        if (combo) {
          onSetShortcut(combo);
          finalizeCapture();
        } else {
          pressedModifiers.current.clear();
          primaryKey.current = null;
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        finalizeCapture();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("keydown", handleEscape, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [captureActive]);

  return (
    <motion.div
      key="ready"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-sm flex-col items-center text-center"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
        You're ready!
      </h2>

      <p className="ui-text-body-lg text-content-muted mb-6">
        Smart is on by default, others available in settings.
      </p>

      <div className="w-full rounded-lg bg-surface-surface p-2.5 text-left">
        <div className="space-y-1.5 px-2 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="ui-text-label-strong ui-color-primary">
                Smart
              </span>
              <span className="truncate ui-text-meta ui-color-disabled">
                tap to toggle, hold to talk
              </span>
            </div>
            <span className="shrink-0 rounded-md bg-amber-400/20 px-1.5 py-0.5 ui-text-micro font-medium ui-color-warning-strong">
              Default
            </span>
          </div>

          <motion.button
            type="button"
            onClick={() => {
              if (!captureActive) startCapture();
            }}
            aria-label={`Record new shortcut for Smart, currently ${formatShortcutForDisplay(smartShortcut)}`}
            className={`w-full border-b pb-1 pt-1 text-left ui-text-kbd transition-colors ${
              captureActive
                ? "ui-color-primary border-border-hover"
                : "ui-color-secondary border-border-primary hover:border-border-secondary hover:text-content-primary"
            }`}
          >
            {captureActive ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <motion.span
                  className="h-1 w-1 rounded-full bg-cloud"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                <span
                  className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
                >
                  {capturePreview || "Press new shortcut..."}
                </span>
              </span>
            ) : (
              <span className="block truncate">
                {formatShortcutForDisplay(smartShortcut)}
              </span>
            )}
          </motion.button>

          <p className="ui-text-meta text-content-muted">
            {captureActive
              ? "Press your new shortcut, or hit Esc to cancel."
              : "Click the shortcut to change it."}
          </p>
        </div>
      </div>

      <button
        onClick={onComplete}
        disabled={captureActive || isCompleting}
        className="mt-6 flex items-center gap-2 rounded-lg bg-amber-400 px-6 py-2.5 ui-text-body-lg font-semibold ui-color-on-warning hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isCompleting ? "Saving..." : "Get Started"}
      </button>

      <p className="mt-3 ui-text-micro ui-color-disabled text-center">
        Glimpse sends anonymous usage analytics to help improve the app. You can
        disable this anytime in Settings &rarr; App.
      </p>

      {completionError && (
        <p className="mt-3 ui-text-label text-error text-center">
          {completionError}
        </p>
      )}
    </motion.div>
  );
}
