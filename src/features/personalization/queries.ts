import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as personalizationApi from "./api";
import { settingsKeys } from "../settings/queries";

export function useSetPersonalities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: personalizationApi.setPersonalities,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}
