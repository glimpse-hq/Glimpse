export type PurchaseTier = "personal" | "commercial";
export type PurchaseSource = "onboarding" | "settings_account";

export type TierInfo = {
  id: PurchaseTier;
  label: string;
  price: string;
  blurb: string;
  checkoutUrl: string | null;
};

export function personalCheckoutUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_PERSONAL_CHECKOUT_URL?.trim();
  return url || null;
}

export function commercialCheckoutUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_COMMERCIAL_CHECKOUT_URL?.trim();
  return url || null;
}

export function tierInfo(tier: PurchaseTier): TierInfo {
  if (tier === "commercial") {
    return {
      id: "commercial",
      label: "Commercial",
      price: "$24.99",
      blurb: "For work. Use it at your job, on up to 5 seats.",
      checkoutUrl: commercialCheckoutUrl(),
    };
  }
  return {
    id: "personal",
    label: "Personal",
    price: "$12.99",
    blurb: "For you. Up to 5 personal devices.",
    checkoutUrl: personalCheckoutUrl(),
  };
}

export function checkoutUrlFor(
  tier: PurchaseTier,
  source: PurchaseSource,
): string | null {
  const rawUrl = tierInfo(tier).checkoutUrl;
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", "glimpse_app");
    url.searchParams.set("utm_medium", "desktop");
    url.searchParams.set("utm_campaign", `${tier}_license`);
    url.searchParams.set("utm_content", source);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
