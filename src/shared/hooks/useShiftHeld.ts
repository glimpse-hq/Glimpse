import { useEffect, useState } from "react";
import { getCurrentWindow, type UnlistenFn } from "../tauri";

export function useShiftHeld(enabled: boolean = true) {
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setShiftHeld(false);
      return;
    }

    let cancelled = false;
    let unlistenFocus: UnlistenFn | null = null;

    const handleKeyChange = (event: KeyboardEvent) => {
      setShiftHeld(event.shiftKey);
    };
    const handlePointerDown = (event: PointerEvent) => {
      setShiftHeld(event.shiftKey);
    };
    const resetShift = () => setShiftHeld(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        setShiftHeld(false);
      }
    };

    getCurrentWindow()
      .onFocusChanged(() => {
        setShiftHeld(false);
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenFocus = unlisten;
        }
      })
      .catch(() => {});

    document.addEventListener("keydown", handleKeyChange);
    document.addEventListener("keyup", handleKeyChange);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", resetShift);
    window.addEventListener("focus", resetShift);

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyChange);
      document.removeEventListener("keyup", handleKeyChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", resetShift);
      window.removeEventListener("focus", resetShift);
      unlistenFocus?.();
    };
  }, [enabled]);

  return shiftHeld;
}
