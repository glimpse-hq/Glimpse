import type { PurchaseSource } from "../../shared/lib/purchaseConfig";
import type { LicenseProvider } from "../../shared/types/license";
import type { PurchasePlan } from "./api";

export type { PurchaseSource };

// Plans and prices live on the site, so they change without an app update.
// The site passes `source` on to checkout, which records it with the sale.
export function pricingUrlFor(source: PurchaseSource): string {
  return `https://tryglimpse.cc/?source=${source}#pricing`;
}

// Shown until the API's plans load, so prices and device counts never pop in.
export const FALLBACK_PLANS: Record<PurchasePlan["id"], PurchasePlan> = {
  solo: {
    id: "solo",
    priceCents: 2500,
    currency: "USD",
    devices: 1,
    billing: "once",
  },
  plus: {
    id: "plus",
    priceCents: 3900,
    currency: "USD",
    devices: 3,
    billing: "once",
  },
};

export function formatPlanPrice(plan: PurchasePlan): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: plan.currency,
    minimumFractionDigits: plan.priceCents % 100 === 0 ? 0 : 2,
  }).format(plan.priceCents / 100);
}

// The Worker picks the provider's portal, so it changes without an app update.
export function customerPortalUrlFor(
  provider: LicenseProvider | null | undefined,
): string {
  return `https://api.tryglimpse.cc/v1/portal?provider=${provider ?? "creem"}`;
}
