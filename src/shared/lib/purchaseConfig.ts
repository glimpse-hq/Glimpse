export type PurchaseTier = "personal" | "commercial";
export type PurchaseSource =
  | "onboarding"
  | "settings_account"
  | "beta_gift"; // TODO: REMOVE after next update: beta gift promo checkout source.

export type TierInfo = {
  id: PurchaseTier;
  label: string;
  price: string;
  blurb: string;
};

export function tierInfo(tier: PurchaseTier): TierInfo {
  if (tier === "commercial") {
    return {
      id: "commercial",
      label: "Commercial",
      price: "$24.99",
      blurb: "For work. Use it at your job, on up to 5 seats.",
    };
  }
  return {
    id: "personal",
    label: "Personal",
    price: "$12.99",
    blurb: "For you. Up to 5 personal devices.",
  };
}
