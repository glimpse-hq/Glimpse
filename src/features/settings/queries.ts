import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as settingsApi from "./api";
import type { StoredSettings } from "../../types";

export const settingsKeys = {
  all: ["settings"] as const,
  detail: () => [...settingsKeys.all, "detail"] as const,
  appInfo: () => ["appInfo"] as const,
  devices: () => ["inputDevices"] as const,
};

export function useSettings<TSelect = StoredSettings>(
  select?: (data: StoredSettings) => TSelect,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<StoredSettings>("settings:changed", (e) => {
      queryClient.setQueryData(settingsKeys.detail(), e.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: settingsKeys.detail(),
    queryFn: settingsApi.getSettings,
    select,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: Record<string, unknown>) =>
      settingsApi.updateSettings(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

export function useAppInfo() {
  return useQuery({
    queryKey: settingsKeys.appInfo(),
    queryFn: settingsApi.getAppInfo,
    staleTime: Infinity,
  });
}

export function useInputDevices() {
  return useQuery({
    queryKey: settingsKeys.devices(),
    queryFn: settingsApi.listInputDevices,
  });
}
