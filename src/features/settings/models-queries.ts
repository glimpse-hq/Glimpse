import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import * as modelsApi from "./models-api";
import { formatTranscriptionSpeechModel } from "../../shared/lib/speechProviders";
import type { ModelStatus, SpeechModel } from "../../types";

export const modelKeys = {
  all: ["models"] as const,
  catalog: () => [...modelKeys.all, "catalog"] as const,
  status: (model: string) => [...modelKeys.all, "status", model] as const,
  speech: () => [...modelKeys.all, "speech"] as const,
};

export function useModelCatalog(enabled: boolean = true) {
  return useQuery({
    queryKey: modelKeys.catalog(),
    queryFn: modelsApi.listModels,
    enabled,
  });
}

export function useSpeechModels(enabled: boolean = true) {
  return useQuery({
    queryKey: modelKeys.speech(),
    queryFn: modelsApi.listSpeechModels,
    enabled,
  });
}

export function resolveSpeechModelLabel(
  models: SpeechModel[] | undefined,
  modelId: string | null | undefined,
): string | null {
  const normalized = modelId?.trim();
  if (!normalized) return null;

  const fromList = models?.find(
    (model) => model.id === normalized || model.key === normalized,
  )?.label;
  if (fromList) return fromList;

  return formatTranscriptionSpeechModel(normalized) ?? normalized;
}

export function useModelStatuses(models: readonly string[], enabled: boolean = true) {
  const uniqueModels = useMemo(
    () => Array.from(new Set(models.filter(Boolean))),
    [models],
  );

  const queries = useQueries({
    queries: uniqueModels.map((model) => ({
      queryKey: modelKeys.status(model),
      queryFn: () => modelsApi.checkModelStatus(model),
      enabled,
      staleTime: 1_000,
    })),
  });

  const statusByModel = queries.reduce<Record<string, ModelStatus>>(
    (acc, query, index) => {
      const model = uniqueModels[index];
      if (model && query.data) {
        acc[model] = query.data;
      }
      return acc;
    },
    {},
  );

  return {
    statusByModel,
    isLoading: queries.some((query) => query.isLoading),
    isFetching: queries.some((query) => query.isFetching),
  };
}
