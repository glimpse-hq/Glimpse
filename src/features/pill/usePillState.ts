import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioSpectrumPayload,
  PillHoverPayload,
  PillModePayload,
  PillStatePayload,
  PillStatus,
  PillTone,
} from "../../types";

const EMPTY_SPECTRUM = new Uint8Array(256);
const ERROR_FLASH_MS = 1200;

export function usePillState() {
  const [pillStatus, setPillStatus] = useState<PillStatus>("idle");
  const [isErrorFlashing, setIsErrorFlashing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedText, setExpandedText] = useState("");
  const [pillTone, setPillTone] = useState<PillTone>("default");
  const [isHovered, setIsHovered] = useState(false);

  const statusRef = useRef<PillStatus>("idle");
  const spectrumBinsRef = useRef<Uint8Array>(EMPTY_SPECTRUM);
  const lastSpectrumAtRef = useRef(0);
  const errorFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearErrorFlashTimer = useCallback(() => {
    if (errorFlashTimeoutRef.current === null) return;
    clearTimeout(errorFlashTimeoutRef.current);
    errorFlashTimeoutRef.current = null;
  }, []);

  const resetAudioState = useCallback(() => {
    spectrumBinsRef.current = EMPTY_SPECTRUM;
    lastSpectrumAtRef.current = 0;
  }, []);

  const triggerErrorFlash = useCallback(() => {
    clearErrorFlashTimer();
    setIsErrorFlashing(true);
    errorFlashTimeoutRef.current = setTimeout(() => {
      errorFlashTimeoutRef.current = null;
      setIsErrorFlashing(false);
    }, ERROR_FLASH_MS);
  }, [clearErrorFlashTimer]);

  const applyStatus = useCallback(
    (next: PillStatus) => {
      if (statusRef.current === next) {
        if (next === "error") {
          triggerErrorFlash();
        }
        return;
      }

      statusRef.current = next;
      setPillStatus(next);

      if (next === "idle") {
        clearErrorFlashTimer();
        setIsErrorFlashing(false);
        setIsExpanded(false);
        setExpandedText("");
        setPillTone("default");
        return;
      }

      if (next === "listening") {
        resetAudioState();
        setPillTone("default");
        return;
      }

      if (next === "error") {
        triggerErrorFlash();
      }
    },
    [clearErrorFlashTimer, resetAudioState, triggerErrorFlash],
  );

  const dismiss = useCallback(() => {
    applyStatus("idle");
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = <TPayload,>(
      event: string,
      handler: (payload: TPayload) => void,
    ) => {
      listen<TPayload>(event, ({ payload }) => {
        if (!cancelled) {
          handler(payload);
        }
      })
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((error) => {
          console.error(`Failed to listen for ${event}`, error);
        });
    };

    register<PillStatePayload>("pill:state", ({ status }) => {
      applyStatus(status);
    });

    register<AudioSpectrumPayload>("audio:spectrum", ({ bins }) => {
      if (statusRef.current !== "listening") return;
      spectrumBinsRef.current = new Uint8Array(bins);
      lastSpectrumAtRef.current = performance.now();
    });

    register<PillModePayload>("pill:mode", ({ expanded, text, tone }) => {
      if (statusRef.current === "idle") return;
      setIsExpanded(expanded);
      setExpandedText(expanded ? (text ?? "") : "");
      setPillTone(tone ?? "default");
    });

    register<PillHoverPayload>("pill:hover", ({ hovering }) => {
      setIsHovered(hovering);
    });

    return () => {
      cancelled = true;
      clearErrorFlashTimer();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [applyStatus, clearErrorFlashTimer]);

  return {
    pillStatus,
    spectrumBinsRef,
    lastSpectrumAtRef,
    isErrorFlashing,
    isExpanded,
    expandedText,
    pillTone,
    isHovered,
    dismiss,
  };
}
