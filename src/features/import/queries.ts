import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as importApi from "./api";

export const importKeys = {
  all: ["import"] as const,
  detected: () => [...importKeys.all, "detected"] as const,
  preview: (id: string) => [...importKeys.all, "preview", id] as const,
};

export function useImportableApps(enabled: boolean = true) {
  return useQuery({
    queryKey: importKeys.detected(),
    queryFn: importApi.detectImportableApps,
    enabled,
    staleTime: Infinity,
  });
}

export function useImportPreview(id: string | null) {
  return useQuery({
    queryKey: importKeys.preview(id ?? ""),
    queryFn: () => importApi.previewImport(id as string),
    enabled: Boolean(id),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}
