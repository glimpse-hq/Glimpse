import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as licenseApi from "./api";

export const licenseKeys = {
  state: () => ["license", "state"] as const,
  dictationStats: () => ["license", "dictationStats"] as const,
  purchasePlans: () => ["license", "purchasePlans"] as const,
  trialEndedScreen: () => ["license", "trialEndedScreen"] as const,
};

export function usePurchasePlans() {
  return useQuery({
    queryKey: licenseKeys.purchasePlans(),
    queryFn: licenseApi.getPurchasePlans,
    staleTime: Infinity,
  });
}

export function useTrialEndedScreen(enabled: boolean) {
  return useQuery({
    queryKey: licenseKeys.trialEndedScreen(),
    queryFn: licenseApi.getTrialEndedScreen,
    enabled,
  });
}

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

// UI gate for paid or trial features; false while loading. Rust enforces with `require_license_gate`.
export function useLicenseGate(): boolean {
  return useLicenseState().data?.licenseGateActive ?? false;
}

export function useActivateLicense() {
  const queryClient = useQueryClient();

  return useMutation<
    licenseApi.LicenseState,
    licenseApi.ActivationError,
    string
  >({
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
