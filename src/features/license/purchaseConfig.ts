import type { PurchaseSource, PurchaseTier } from "../../shared/lib/purchaseConfig";

export type { PurchaseSource, PurchaseTier };
export { tierInfo } from "../../shared/lib/purchaseConfig";

export function personalCheckoutUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_PERSONAL_CHECKOUT_URL?.trim();
  return url || null;
}

export function commercialCheckoutUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_COMMERCIAL_CHECKOUT_URL?.trim();
  return url || null;
}

export function customerPortalUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_CUSTOMER_PORTAL?.trim();
  return url || null;
}

export function checkoutUrlFor(
  tier: PurchaseTier,
  source: PurchaseSource,
): string | null {
  const rawUrl =
    tier === "commercial" ? commercialCheckoutUrl() : personalCheckoutUrl();
  return withCheckoutTracking(rawUrl, `${tier}_license`, source);
}

export function customerPortalUrlFor(source: PurchaseSource): string | null {
  return withCheckoutTracking(customerPortalUrl(), "customer_portal", source);
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
