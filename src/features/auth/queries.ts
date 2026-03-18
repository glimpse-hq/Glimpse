import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as authApi from "./api";
import type { User } from "./api";

export const authKeys = {
  user: () => ["auth", "user"] as const,
};

export function useCurrentUser() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen("auth:changed", () => {
      queryClient.invalidateQueries({ queryKey: authKeys.user() });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: authKeys.user(),
    queryFn: authApi.getCurrentUser,
  });

  const user = query.data ?? null;

  return {
    ...query,
    user,
    isAuthenticated: user !== null,
    isSubscriber: user?.labels?.includes("cloud") ?? false,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: authKeys.user() }),
  };
}

export type { User };
