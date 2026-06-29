export type LicenseStatus = "trial" | "active" | "expired" | "invalid";

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
  validations?: number | null;
  usage?: number | null;
  limitUsage?: number | null;
  activationsLimit: number;
  activationsCount?: number | null;
};
