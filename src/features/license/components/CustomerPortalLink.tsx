import { useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOut as ExternalLink } from "@phosphor-icons/react";
import {
  customerPortalUrlFor,
  type PurchaseSource,
} from "../../license/purchaseConfig";

type CustomerPortalLinkProps = {
  source: PurchaseSource;
  className?: string;
};

const defaultClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 ui-text-button-sm ui-color-muted transition-colors hover:bg-surface-elevated hover:text-content-primary";

const CustomerPortalLink = ({
  source,
  className = defaultClassName,
}: CustomerPortalLinkProps) => {
  const { t } = useLingui();
  const url = customerPortalUrlFor(source);
  if (!url) return null;

  const openPortal = async () => {
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open customer portal:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void openPortal()}
      className={className}
    >
      {t({
        id: "license.customer_portal",
        message: "Customer portal",
      })}
      <ExternalLink size={12} aria-hidden="true" />
    </button>
  );
};

export default CustomerPortalLink;
