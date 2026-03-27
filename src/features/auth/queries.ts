import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "./api";
import type { User } from "./api";

export const authKeys = {
  user: () => ["auth", "user"] as const,
};

export function useCurrentUser() {
  const queryClient = useQueryClient();

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
