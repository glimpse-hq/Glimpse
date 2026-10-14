import { invoke } from "@tauri-apps/api/core";

import type { LicenseState } from "../../shared/types/license";

export type { LicenseState } from "../../shared/types/license";

export async function getLicenseState(): Promise<LicenseState> {
  return invoke<LicenseState>("get_license_state");
}

export async function activateLicense(key: string): Promise<LicenseState> {
  return invoke<LicenseState>("activate_license", { args: { key } });
}

export async function refreshLicense(): Promise<LicenseState> {
  return invoke<LicenseState>("refresh_license");
}

export async function deactivateLicense(): Promise<LicenseState> {
  return invoke<LicenseState>("deactivate_license");
}

export type DictationStats = {
  totalWords: number;
  totalDurationMs: number;
  totalDictations: number;
};

export async function getDictationStats(): Promise<DictationStats> {
  return invoke<DictationStats>("get_dictation_stats");
}

export type PurchasePlan = {
  id: "solo" | "plus";
  priceCents: number;
  currency: string;
  devices: number;
  billing: "once" | "year";
};

export async function getPurchasePlans(): Promise<PurchasePlan[]> {
  return invoke<PurchasePlan[]>("get_purchase_plans");
}

export type CheckoutSource =
  "account" | "locked_view" | "trial_ended" | "activation";

export async function openCheckout(args: {
  tier: PurchasePlan["id"];
  source: CheckoutSource;
  feature?: string;
  code?: string;
}): Promise<void> {
  return invoke("open_checkout", args);
}

// Rejection payload of `activate_license`.
export type ActivationError = {
  reason: string;
  message: string;
};

export type TrialEndedScreen = {
  libraryItems: number;
};

export async function getTrialEndedScreen(): Promise<TrialEndedScreen | null> {
  return invoke<TrialEndedScreen | null>("get_trial_ended_screen");
}

export async function dismissTrialEndedScreen(): Promise<void> {
  return invoke("dismiss_trial_ended_screen");
}
