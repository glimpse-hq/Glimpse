export type PurchaseTier = "personal" | "commercial";
export type PurchaseSource = "onboarding" | "settings_account" | "beta_gift"; // TODO: REMOVE after next update: beta gift promo checkout source.

export type TierInfo = {
  id: PurchaseTier;
  label: string;
  price: string;
  pickerPrice?: string;
  blurb: string;
};

export function tierInfo(tier: PurchaseTier): TierInfo {
  if (tier === "commercial") {
    return {
      id: "commercial",
      label: "Commercial",
      price: "From $19.99/seat",
      pickerPrice: "per seat",
      blurb: "For work. One seat per person. Volume discounts.",
    };
  }
  return {
    id: "personal",
    label: "Personal",
    price: "$24.99",
    pickerPrice: "$24.99",
    blurb: "For you. Up to 5 devices.",
  };
}
