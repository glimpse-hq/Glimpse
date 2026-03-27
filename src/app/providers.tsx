import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { authKeys } from "../features/auth/queries";
import { settingsKeys } from "../features/settings/queries";
import { transcriptionKeys } from "../features/transcriptions/queries";
import { updateKeys } from "../features/updates/queries";
import { getCurrentWindow, typedListen, type UnlistenFn } from "../shared/tauri";
import type { StoredSettings } from "../types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function QuerySyncBridge() {
  const isSettingsWindow = getCurrentWindow().label === "settings";

  useEffect(() => {
    if (!isSettingsWindow) return;

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
      }).then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisteners.push(fn);
        }
      });
    };

    register<StoredSettings>("settings:changed", (settings) => {
      queryClient.setQueryData(settingsKeys.detail(), settings);
    });
    register("auth:changed", () => {
      queryClient.invalidateQueries({ queryKey: authKeys.user() });
    });
    register("update:available", () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    });
    register("update:cleared", () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    });
    register("transcription:complete", () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    });
    register("transcription:error", () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [isSettingsWindow]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <QuerySyncBridge />
      {children}
    </QueryClientProvider>
  );
}
