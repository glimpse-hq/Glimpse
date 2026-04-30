import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect } from "react";
import { formatShortcutForDisplay } from "../lib/shortcuts";

type ShortcutCapturePayload =
  | { kind: "preview"; shortcut: string }
  | { kind: "captured"; shortcut: string }
  | { kind: "error"; message: string };

type UseShortcutCaptureOptions = {
  active: boolean;
  onCancel: () => void;
  onPreviewChange: (preview: string) => void;
  onShortcutCaptured: (shortcut: string) => void;
  onError?: (message: string) => void;
  onCaptureInput?: () => void;
};

const SHORTCUT_CAPTURE_EVENT = "shortcut:capture";

export function useShortcutCapture({
  active,
  onCancel,
  onPreviewChange,
  onShortcutCaptured,
  onError,
  onCaptureInput,
}: UseShortcutCaptureOptions) {
  const resetCaptureState = useCallback(() => {
    onPreviewChange("");
  }, [onPreviewChange]);

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    const finishCapture = (shortcut: string) => {
      if (disposed) return;
      disposed = true;
      unlisten?.();
      unlisten = null;
      onShortcutCaptured(shortcut);
      onCancel();
      resetCaptureState();
    };

    const cancelCapture = () => {
      if (disposed) return;
      disposed = true;
      unlisten?.();
      unlisten = null;
      onCancel();
      resetCaptureState();
    };

    const handleCapturePayload = (payload: ShortcutCapturePayload) => {
      if (disposed) return;

      if (payload.kind === "preview") {
        onCaptureInput?.();
        onPreviewChange(formatShortcutForDisplay(payload.shortcut));
        return;
      }

      if (payload.kind === "captured") {
        onCaptureInput?.();
        finishCapture(payload.shortcut);
        return;
      }

      onError?.(payload.message);
      cancelCapture();
    };

    listen<ShortcutCapturePayload>(SHORTCUT_CAPTURE_EVENT, (event) => {
      handleCapturePayload(event.payload);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((error) => {
        if (disposed) return;
        onError?.(String(error));
        cancelCapture();
      });

    const handleKeyboardEvent = (event: KeyboardEvent) => {
      if (disposed) return;

      const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
      const shouldCancel = event.type === "keydown" && event.key === "Escape" && !hasModifier;

      event.preventDefault();
      event.stopPropagation();
      if (shouldCancel) {
        cancelCapture();
      }
    };

    window.addEventListener("keydown", handleKeyboardEvent, true);
    window.addEventListener("keyup", handleKeyboardEvent, true);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", handleKeyboardEvent, true);
      window.removeEventListener("keyup", handleKeyboardEvent, true);
    };
  }, [
    active,
    onCancel,
    onCaptureInput,
    onError,
    onPreviewChange,
    onShortcutCaptured,
    resetCaptureState,
  ]);

  return { resetCaptureState };
}
