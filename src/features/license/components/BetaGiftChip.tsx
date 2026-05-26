// TODO: REMOVE after next update — entire file is temporary beta gift promo chip.
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { founderCheckoutUrlFor } from "../../../shared/lib/purchaseConfig"; // TODO: REMOVE after next update — beta gift founder checkout.
import { useLicenseState } from "../queries";
import { BETA_DISCOUNT_CODE, shouldShowBetaGiftPromo } from "./betaGiftPromo"; // TODO: REMOVE after next update — beta gift promo helpers.

const BetaGiftChip = () => {
  const { data: licenseState } = useLicenseState();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (dismissed || !shouldShowBetaGiftPromo(licenseState?.status)) {
    return null;
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(BETA_DISCOUNT_CODE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("Failed to copy beta code:", err);
    }
  };

  const openCheckout = async () => {
    // TODO: REMOVE after next update — beta gift founder checkout link.
    const checkoutUrl = founderCheckoutUrlFor("beta_gift");
    if (!checkoutUrl) return;
    try {
      await openUrl(checkoutUrl);
    } catch (err) {
      console.error("Failed to open checkout:", err);
    }
  };

  return (
    <div className="pointer-events-auto absolute right-8 top-9 z-20 flex items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--color-cloud-30)] bg-surface-overlay px-2.5 py-1.5 shadow-sm">
      <p className="shrink-0 ui-text-meta ui-color-secondary">
        Thanks for being an early believer. Use code for a free lifetime license
      </p>
      <button
        type="button"
        onClick={() => {
          void copyCode();
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-primary bg-surface-elevated px-1.5 py-0.5 font-mono ui-text-micro ui-color-primary transition-colors hover:bg-surface-elevated-hover"
      >
        {BETA_DISCOUNT_CODE}
        {copied ? (
          <Check size={11} aria-hidden="true" className="ui-color-secondary" />
        ) : (
          <Copy size={11} aria-hidden="true" className="ui-color-muted" />
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          void openCheckout();
        }}
        className="inline-flex shrink-0 items-center gap-0.5 ui-text-micro ui-color-secondary transition-colors hover:text-content-primary"
      >
        Get license
        <ExternalLink size={11} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ui-color-muted transition-colors hover:bg-surface-elevated hover:text-content-secondary"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
};

// TODO: REMOVE after next update — beta gift promo chip export.
export default BetaGiftChip;
