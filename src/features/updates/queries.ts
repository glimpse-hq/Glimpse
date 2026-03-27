import { useQuery } from "@tanstack/react-query";
import * as updatesApi from "./api";

export const updateKeys = {
  status: () => ["updates", "status"] as const,
};

export function useUpdateStatus() {
  return useQuery({
    queryKey: updateKeys.status(),
    queryFn: updatesApi.getUpdateStatus,
  });
}
