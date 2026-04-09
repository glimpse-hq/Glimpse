import { useQuery } from "@tanstack/react-query";
import * as modelsApi from "./models-api";

const modelKeys = {
  all: ["models"] as const,
  catalog: () => [...modelKeys.all, "catalog"] as const,
};

export function useModelCatalog(enabled: boolean = true) {
  return useQuery({
    queryKey: modelKeys.catalog(),
    queryFn: modelsApi.listModels,
    enabled,
  });
}
