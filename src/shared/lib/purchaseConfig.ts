export type PurchaseTier = "personal" | "commercial";
export type PurchaseSource =
  | "onboarding"
  | "settings_account"
  | "beta_gift"; // TODO: REMOVE after next update — beta gift promo checkout source.

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

// TODO: REMOVE after next update — beta gift founder checkout env (VITE_GLIMPSE_FOUNDER_CHECKOUT_URL).
export function founderCheckoutUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_FOUNDER_CHECKOUT_URL?.trim();
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
  return withCheckoutTracking(rawUrl, `${tier}_license`, source);
}

// TODO: REMOVE after next update — beta gift founder checkout link builder.
export function founderCheckoutUrlFor(source: PurchaseSource): string | null {
  return withCheckoutTracking(founderCheckoutUrl(), "founder_license", source);
}

function withCheckoutTracking(
  rawUrl: string | null,
  campaign: string,
  source: PurchaseSource,
): string | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", "glimpse_app");
    url.searchParams.set("utm_medium", "desktop");
    url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", source);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
