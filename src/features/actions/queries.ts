import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import * as actionsApi from "./api";
import { showErrorToast } from "../../shared/lib/errorToast";
import type { ActionBehavior, ActionInfo, ActionsList } from "../../types";

export const actionKeys = {
  list: () => ["actions", "list"] as const,
};

// Scripts change outside the app, so every new view of the list rereads the folder.
// The Actions screen also rereads the shell environment scripts run with.
export function useActions(enabled: boolean, refresh = false) {
  return useQuery({
    queryKey: actionKeys.list(),
    queryFn: () => actionsApi.listActions(refresh),
    enabled,
    staleTime: 0,
  });
}

async function patchAction(
  queryClient: QueryClient,
  file: string,
  patch: (action: ActionInfo) => ActionInfo,
) {
  await queryClient.cancelQueries({ queryKey: actionKeys.list() });
  queryClient.setQueryData<ActionsList>(actionKeys.list(), (current) =>
    current
      ? {
          ...current,
          actions: current.actions.map((action) =>
            action.file === file ? patch(action) : action,
          ),
        }
      : current,
  );
}

export function useSetActionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, enabled }: { file: string; enabled: boolean }) =>
      actionsApi.setActionEnabled(file, enabled),
    onMutate: ({ file, enabled }) =>
      patchAction(queryClient, file, (action) => ({ ...action, enabled })),
    onError: (error) => showErrorToast(String(error)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: actionKeys.list() }),
  });
}

export function useSetActionShortcut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      index,
      shortcut,
      behavior,
    }: {
      file: string;
      index: number;
      shortcut: string;
      behavior: ActionBehavior;
    }) => actionsApi.setActionShortcut(file, index, shortcut, behavior),
    onMutate: ({ file, index, shortcut, behavior }) =>
      patchAction(queryClient, file, (action) => ({
        ...action,
        shortcuts: action.shortcuts.map((entry, entryIndex) =>
          entryIndex === index ? { shortcut, behavior, problem: null } : entry,
        ),
      })),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: actionKeys.list() }),
  });
}
