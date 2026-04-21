import { type QueryClient, useQuery } from "@tanstack/react-query";
import * as dictionaryApi from "./api";
import { settingsKeys } from "../settings/queries";
import type { Replacement, StoredSettings } from "../../types";

export const dictionaryKeys = {
  all: ["dictionary"] as const,
  replacements: () => [...dictionaryKeys.all, "replacements"] as const,
};

export function useReplacements(enabled: boolean = true) {
  return useQuery({
    queryKey: dictionaryKeys.replacements(),
    queryFn: dictionaryApi.getReplacements,
    enabled,
  });
}

export function setDictionaryEntriesCache(
  queryClient: QueryClient,
  entries: string[],
) {
  queryClient.setQueryData<StoredSettings | undefined>(
    settingsKeys.detail(),
    (current) =>
      current
        ? {
            ...current,
            dictionary: entries,
          }
        : current,
  );
}

export function setDictionaryReplacementsCache(
  queryClient: QueryClient,
  replacements: Replacement[],
) {
  queryClient.setQueryData(dictionaryKeys.replacements(), replacements);
  queryClient.setQueryData<StoredSettings | undefined>(
    settingsKeys.detail(),
    (current) =>
      current
        ? {
            ...current,
            replacements,
          }
        : current,
  );
}
