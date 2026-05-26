import type { LicenseEdition, LicenseState } from "../../features/license/api";

export type { LicenseEdition };

export type EditionInfo = {
  id: LicenseEdition;
  label: string;
  blurb: string;
};

export const EDITION_COLORS: Record<
  LicenseEdition,
  { fg: string; bg: string }
> = {
  personal: { fg: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)" },
  commercial: { fg: "#b45309", bg: "rgba(180, 83, 9, 0.10)" },
  founder: { fg: "#0d9488", bg: "rgba(13, 148, 136, 0.12)" },
  contributor: { fg: "#1d4ed8", bg: "rgba(29, 78, 216, 0.10)" },
};

const EDITION_INFO: Record<LicenseEdition, EditionInfo> = {
  personal: {
    id: "personal",
    label: "Personal",
    blurb: "For you. Up to 5 personal devices.",
  },
  commercial: {
    id: "commercial",
    label: "Commercial",
    blurb: "For work. Use it at your job, on up to 5 seats.",
  },
  founder: {
    id: "founder",
    label: "Founder",
    blurb: "Launch founder. Up to 5 personal devices.",
  },
  contributor: {
    id: "contributor",
    label: "Contributor",
    blurb: "Thank you for contributing. Up to 5 personal devices.",
  },
};

export function editionInfo(edition: LicenseEdition): EditionInfo {
  return EDITION_INFO[edition];
}

export function editionFromLicenseState(
  licenseState: LicenseState | null,
  active: boolean,
): LicenseEdition {
  if (!active) return "personal";
  return licenseState?.edition ?? "personal";
}
