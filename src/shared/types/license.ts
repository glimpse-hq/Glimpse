export type LicenseStatus =
  "trial" | "active" | "expired" | "invalid" | "unverified";

export type LicenseProvider = "creem" | "legacy";

export type LicenseEdition =
  "personal" | "commercial" | "founder" | "contributor";

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
  activationsLimit: number;
  activationsCount?: number | null;
  provider?: LicenseProvider | null;
};
