import { invoke } from "@tauri-apps/api/core";

export type LicenseStatus = "trial" | "active" | "expired" | "invalid";

export type LicenseEdition =
  | "personal"
  | "commercial"
  | "founder"
  | "contributor";

export type LicenseState = {
  status: LicenseStatus;
  licenseGateActive: boolean;
  trialActive: boolean;
  trialStartedAt: string;
  trialEndsAt: string;
  trialDaysRemaining: number;
  edition?: LicenseEdition | null;
  displayKey?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  lastValidatedAt?: string | null;
  activatedAt?: string | null;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  validations?: number | null;
  usage?: number | null;
  limitUsage?: number | null;
  activationsLimit: number;
  activationsCount?: number | null;
};

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
