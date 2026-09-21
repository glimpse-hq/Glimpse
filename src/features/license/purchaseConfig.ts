import type { PurchaseSource } from "../../shared/lib/purchaseConfig";
import type { LicenseProvider } from "../../shared/types/license";

export type { PurchaseSource };

// Plans and prices live on the site, so they change without an app update.
// The site passes `source` on to checkout, which records it with the sale.
export function pricingUrlFor(source: PurchaseSource): string {
  return `https://tryglimpse.cc/?source=${source}#pricing`;
}

// The Worker picks the provider's portal, so it changes without an app update.
export function customerPortalUrlFor(
  provider: LicenseProvider | null | undefined,
): string {
  return `https://api.tryglimpse.cc/v1/portal?provider=${provider ?? "creem"}`;
}
