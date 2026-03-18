import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as updatesApi from "./api";

export const updateKeys = {
  status: () => ["updates", "status"] as const,
};

export function useUpdateStatus() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    listen("update:available", () => {
      if (!cancelled)
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("update:cleared", () => {
      if (!cancelled)
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [queryClient]);

  return useQuery({
    queryKey: updateKeys.status(),
    queryFn: updatesApi.getUpdateStatus,
  });
}
