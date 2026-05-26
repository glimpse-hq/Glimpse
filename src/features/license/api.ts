import { invoke } from "@tauri-apps/api/core";

import type { LicenseState } from "../../shared/types/license";

export type { LicenseEdition, LicenseState, LicenseStatus } from "../../shared/types/license";

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

export async function revealLicenseKey(): Promise<string> {
  return invoke<string>("reveal_license_key");
}

export type DictationStats = {
  totalWords: number;
};

export async function getDictationStats(): Promise<DictationStats> {
  return invoke<DictationStats>("get_dictation_stats");
}
