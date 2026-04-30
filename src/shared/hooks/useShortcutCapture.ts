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
const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
  "Fn",
  "OS",
]);

const CODE_TO_KEY_TOKEN: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  NumpadEnter: "Return",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Delete",
  Delete: "ForwardDelete",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

function modifierTokensFromEvent(event: KeyboardEvent): string[] {
  const tokens: string[] = [];
  if (event.metaKey) tokens.push("Cmd");
  if (event.ctrlKey) tokens.push("Ctrl");
  if (event.altKey) tokens.push("Opt");
  if (event.shiftKey) tokens.push("Shift");
  return tokens;
}

function keyTokenFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (CODE_TO_KEY_TOKEN[event.code]) return CODE_TO_KEY_TOKEN[event.code];

  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code;
  if (/^Numpad\d$/.test(event.code)) return `Keypad${event.code.slice(6)}`;

  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^\d$/.test(event.key)) return event.key;
  if (/^F\d{1,2}$/i.test(event.key)) return event.key.toUpperCase();

  return null;
}

function shortcutFromEvent(event: KeyboardEvent): string | null {
  const tokens = modifierTokensFromEvent(event);
  const keyToken = keyTokenFromEvent(event);
  if (keyToken) tokens.push(keyToken);
  if (tokens.length === 0) return null;
  return tokens.join("+");
}

function hasNonModifierKey(event: KeyboardEvent): boolean {
  return keyTokenFromEvent(event) !== null;
}

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

      if (event.key === "Escape" && !hasModifier) {
        event.preventDefault();
        event.stopPropagation();
        cancelCapture();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const shortcut = shortcutFromEvent(event);
      if (!shortcut) {
        onCaptureInput?.();
        onPreviewChange("");
        return;
      }

      onCaptureInput?.();

      onPreviewChange(formatShortcutForDisplay(shortcut));

      if (event.type === "keydown" && hasNonModifierKey(event)) {
        finishCapture(shortcut);
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
