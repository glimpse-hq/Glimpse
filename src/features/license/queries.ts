import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as licenseApi from "./api";

export const licenseKeys = {
  state: () => ["license", "state"] as const,
  dictationStats: () => ["license", "dictationStats"] as const,
};

export function useDictationStats() {
  return useQuery({
    queryKey: licenseKeys.dictationStats(),
    queryFn: licenseApi.getDictationStats,
  });
}

export function useLicenseState() {
  return useQuery({
    queryKey: licenseKeys.state(),
    queryFn: licenseApi.getLicenseState,
  });
}

/**
 * Returns whether the user can currently use license-gated features (paid or
 * trial). The single primitive to consult when gating UI; defaults to `false`
 * while the query is loading so we err on the locked side.
 *
 * To gate a new feature in UI:
 *
 *   const licensed = useLicenseGate();
 *   <MyFeatureButton disabled={!licensed} />
 *
 * For the backend equivalent, see `crate::license::require_license_gate`.
 */
export function useLicenseGate(): boolean {
  return useLicenseState().data?.licenseGateActive ?? false;
}

export function useActivateLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: licenseApi.activateLicense,
    onSuccess: (state) => {
      queryClient.setQueryData(licenseKeys.state(), state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useRefreshLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: licenseApi.refreshLicense,
    onSuccess: (state) => {
      queryClient.setQueryData(licenseKeys.state(), state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useDeactivateLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: licenseApi.deactivateLicense,
    onSuccess: (state) => {
      queryClient.setQueryData(licenseKeys.state(), state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
