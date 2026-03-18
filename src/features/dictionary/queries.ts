import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as dictionaryApi from "./api";
import { settingsKeys } from "../settings/queries";

export function useSetDictionary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: dictionaryApi.setDictionary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

export function useSetReplacements() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: dictionaryApi.setReplacements,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}
