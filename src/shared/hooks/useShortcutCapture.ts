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

    const handleCapturePayload = (payload: ShortcutCapturePayload) => {
      if (disposed) return;

      if (payload.kind === "preview") {
        onCaptureInput?.();
        onPreviewChange(formatShortcutForDisplay(payload.shortcut));
        return;
      }

      if (payload.kind === "captured") {
        onCaptureInput?.();
        onShortcutCaptured(payload.shortcut);
        onCancel();
        resetCaptureState();
        return;
      }

      onError?.(payload.message);
      onCancel();
      resetCaptureState();
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
        onCancel();
        resetCaptureState();
      });

    const swallowKeyboardEvent = (event: KeyboardEvent) => {
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;

      if (event.key === "Escape" && !hasModifier) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        resetCaptureState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", swallowKeyboardEvent, true);
    window.addEventListener("keyup", swallowKeyboardEvent, true);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", swallowKeyboardEvent, true);
      window.removeEventListener("keyup", swallowKeyboardEvent, true);
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
