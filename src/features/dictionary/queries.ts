import type { QueryClient } from "@tanstack/react-query";
import { settingsKeys } from "../settings/queries";
import type { Replacement, StoredSettings } from "../../types";

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
