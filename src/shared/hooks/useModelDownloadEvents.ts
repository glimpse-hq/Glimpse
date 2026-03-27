import { useEffect, useEffectEvent } from "react";
import { typedListen, type UnlistenFn } from "../tauri";
import type { DownloadProgressPayload } from "../../types";

type UseModelDownloadEventsOptions = {
  enabled?: boolean;
  onProgress?: (payload: DownloadProgressPayload) => void;
  onComplete?: (payload: { model: string }) => void;
  onError?: (payload: { model: string; error: string }) => void;
};

export function useModelDownloadEvents({
  enabled = true,
  onProgress,
  onComplete,
  onError,
}: UseModelDownloadEventsOptions) {
  const handleProgress = useEffectEvent((payload: DownloadProgressPayload) => {
    onProgress?.(payload);
  });
  const handleComplete = useEffectEvent((payload: { model: string }) => {
    onComplete?.(payload);
  });
  const handleError = useEffectEvent((payload: { model: string; error: string }) => {
    onError?.(payload);
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = <TPayload,>(
      event: string,
      handler: (payload: TPayload) => void,
    ) => {
      typedListen<TPayload>(event, (payload) => {
        if (!cancelled) {
          handler(payload);
        }
      }).then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      });
    };

    if (onProgress) {
      register<DownloadProgressPayload>("download:progress", handleProgress);
    }
    if (onComplete) {
      register<{ model: string }>("download:complete", handleComplete);
    }
    if (onError) {
      register<{ model: string; error: string }>("download:error", handleError);
    }

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [enabled]);
}
