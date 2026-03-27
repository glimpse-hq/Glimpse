import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as modelsApi from "./models-api";

export const modelKeys = {
  all: ["models"] as const,
  catalog: () => [...modelKeys.all, "catalog"] as const,
  status: (key: string) => [...modelKeys.all, "status", key] as const,
  llmModels: (endpoint: string, provider: string, apiKey: string) =>
    [...modelKeys.all, "llm", endpoint, provider, apiKey] as const,
};

export function useModelCatalog(enabled: boolean = true) {
  return useQuery({
    queryKey: modelKeys.catalog(),
    queryFn: modelsApi.listModels,
    enabled,
  });
}

export function useModelStatus(key: string) {
  return useQuery({
    queryKey: modelKeys.status(key),
    queryFn: () => modelsApi.checkModelStatus(key),
    enabled: !!key,
  });
}

export function useDownloadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: modelsApi.downloadModel,
    onSuccess: (_data, model) => {
      queryClient.invalidateQueries({
        queryKey: modelKeys.status(model),
      });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: modelsApi.deleteModel,
    onSuccess: (_data, model) => {
      queryClient.invalidateQueries({
        queryKey: modelKeys.status(model),
      });
    },
  });
}

export function useFetchLlmModels(endpoint: string, provider: string, apiKey: string) {
  return useQuery({
    queryKey: modelKeys.llmModels(endpoint, provider, apiKey),
    queryFn: () => modelsApi.fetchLlmModels(endpoint, provider, apiKey),
    enabled: false,
  });
}
