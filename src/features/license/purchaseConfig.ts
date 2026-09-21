import type { PurchaseSource } from "../../shared/lib/purchaseConfig";

export type { PurchaseSource };

// Plans and prices live on the site, so they change without an app update.
const PRICING_URL = "https://tryglimpse.cc/#pricing";

export function pricingUrlFor(source: PurchaseSource): string {
  return withCheckoutTracking(PRICING_URL, "pricing", source) ?? PRICING_URL;
}

export function customerPortalUrl(): string | null {
  const url = import.meta.env.VITE_GLIMPSE_CUSTOMER_PORTAL?.trim();
  return url || null;
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
    // The site forwards this to the checkout link.
    url.searchParams.set("source", source);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
