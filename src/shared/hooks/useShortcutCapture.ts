import { useCallback, useEffect, useRef } from "react";
import {
  buildShortcutPreviewString,
  buildShortcutString,
  formatShortcutForDisplay,
  normalizeShortcutModifier,
} from "../lib/shortcuts";

type UseShortcutCaptureOptions = {
  active: boolean;
  onCancel: () => void;
  onPreviewChange: (preview: string) => void;
  onShortcutCaptured: (shortcut: string) => void;
  onInvalidShortcut?: () => void;
  onCaptureInput?: () => void;
};

export function useShortcutCapture({
  active,
  onCancel,
  onPreviewChange,
  onShortcutCaptured,
  onInvalidShortcut,
  onCaptureInput,
}: UseShortcutCaptureOptions) {
  const pressedModifiers = useRef<Set<string>>(new Set());
  const primaryKey = useRef<string | null>(null);

  const resetCaptureState = useCallback(() => {
    pressedModifiers.current.clear();
    primaryKey.current = null;
    onPreviewChange("");
  }, [onPreviewChange]);

  const updatePreview = useCallback(() => {
    const preview = buildShortcutPreviewString(
      pressedModifiers.current,
      primaryKey.current,
    );
    onPreviewChange(preview ? formatShortcutForDisplay(preview) : "");
  }, [onPreviewChange]);

  const captureCurrentCombo = useCallback(() => {
    const combo = buildShortcutString(
      pressedModifiers.current,
      primaryKey.current,
    );
    if (!combo) {
      onInvalidShortcut?.();
      resetCaptureState();
      return;
    }

    onShortcutCaptured(combo);
    onCancel();
    resetCaptureState();
  }, [
    onCancel,
    onInvalidShortcut,
    onShortcutCaptured,
    resetCaptureState,
  ]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        resetCaptureState();
        return;
      }

      event.preventDefault();
      onCaptureInput?.();

      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.add(modifier);
        updatePreview();
        return;
      }

      if (!event.code) return;

      primaryKey.current = event.code;
      updatePreview();
      captureCurrentCombo();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        resetCaptureState();
        return;
      }

      event.preventDefault();
      onCaptureInput?.();

      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.delete(modifier);
        updatePreview();
        return;
      }

      if (!event.code || primaryKey.current) return;

      primaryKey.current = event.code;
      updatePreview();
      captureCurrentCombo();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCancel();
      resetCaptureState();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("keydown", handleEscape, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [
    active,
    captureCurrentCombo,
    onCancel,
    onCaptureInput,
    resetCaptureState,
    updatePreview,
  ]);

  return { resetCaptureState };
}
