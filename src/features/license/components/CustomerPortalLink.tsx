import { useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOut as ExternalLink } from "@phosphor-icons/react";
import { customerPortalUrlFor } from "../../license/purchaseConfig";
import type { LicenseProvider } from "../../../shared/types/license";

type CustomerPortalLinkProps = {
  provider: LicenseProvider | null | undefined;
  className?: string;
};

const defaultClassName =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 ui-text-button-sm ui-color-muted transition-colors hover:bg-surface-elevated hover:text-content-primary";

const CustomerPortalLink = ({
  provider,
  className = defaultClassName,
}: CustomerPortalLinkProps) => {
  const { t } = useLingui();
  const url = customerPortalUrlFor(provider);

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
      <ExternalLink size={11} aria-hidden="true" />
    </button>
  );
};

export default CustomerPortalLink;
