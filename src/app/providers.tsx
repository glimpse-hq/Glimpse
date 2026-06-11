import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activateLocale, i18n } from "../i18n";
import { settingsKeys, useSettings } from "../features/settings/queries";
import { modelKeys } from "../features/settings/models-queries";
import { transcriptionKeys } from "../features/transcriptions/queries";
import { updateKeys } from "../features/updates/queries";
import type { StoredSettings, TranscriptionRecord } from "../types";

const queryClient = new QueryClient({
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
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = <TPayload,>(
      event: string,
      handler: (payload: TPayload) => void,
    ) => {
      listen<TPayload>(event, (eventPayload) => {
        if (!cancelled) {
          handler(eventPayload.payload);
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
      queryClient.invalidateQueries({ queryKey: modelKeys.speech() });
    });

    if (isSettingsWindow) {
      register("update:available", () => {
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      });
      register("update:cleared", () => {
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      });
      register<{ record: TranscriptionRecord | null }>(
        "transcription:complete",
        ({ record }) => {
          const listKey = transcriptionKeys.list();
          const listState = queryClient.getQueryState(listKey);

          if (
            !record ||
            !listState?.data ||
            listState.fetchStatus === "fetching"
          ) {
            void queryClient
              .cancelQueries({ queryKey: transcriptionKeys.all })
              .then(() =>
                queryClient.invalidateQueries({
                  queryKey: transcriptionKeys.all,
                }),
              );
            return;
          }
          queryClient.setQueryData<TranscriptionRecord[]>(listKey, (old) => {
            if (!old) return old;
            if (old.some((r) => r.id === record.id)) {
              return old.map((r) => (r.id === record.id ? record : r));
            }
            const ts = new Date(record.timestamp).getTime();
            const index = old.findIndex(
              (r) => ts >= new Date(r.timestamp).getTime(),
            );
            const next = [...old];
            next.splice(index === -1 ? next.length : index, 0, record);
            return next;
          });
        },
      );
      register("transcription:error", () => {
        queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
      });
      register("audio:input-devices-changed", () => {
        queryClient.invalidateQueries({ queryKey: settingsKeys.devices() });
      });
    }

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [isSettingsWindow]);

  return null;
}

function LocaleSyncBridge() {
  const { data: settings } = useSettings(undefined, true);

  useEffect(() => {
    activateLocale(settings?.app_locale);
  }, [settings?.app_locale]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <LocaleSyncBridge />
        <QuerySyncBridge />
        {children}
      </QueryClientProvider>
    </I18nProvider>
  );
}
