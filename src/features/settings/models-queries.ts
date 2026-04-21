import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import * as modelsApi from "./models-api";
import type { ModelStatus } from "../../types";

export const modelKeys = {
  all: ["models"] as const,
  catalog: () => [...modelKeys.all, "catalog"] as const,
  status: (model: string) => [...modelKeys.all, "status", model] as const,
};

export function useModelCatalog(enabled: boolean = true) {
  return useQuery({
    queryKey: modelKeys.catalog(),
    queryFn: modelsApi.listModels,
    enabled,
  });
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
