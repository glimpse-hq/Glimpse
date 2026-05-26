import { openUrl } from "@tauri-apps/plugin-opener";
import { motion, type Variants } from "framer-motion";
import { useState } from "react";
import {
  checkoutUrlFor,
  type PurchaseTier,
} from "../../../../shared/lib/purchaseConfig";
import {
  useActivateLicense,
  useDeactivateLicense,
  useLicenseState,
  useRefreshLicense,
} from "../../../license/queries";
import AccountView from "../AccountView";

type AccountTabProps = {
  variants: Variants;
};

const AccountTab = ({ variants }: AccountTabProps) => {
  const licenseQuery = useLicenseState();
  const activateLicense = useActivateLicense();
  const refreshLicense = useRefreshLicense();
  const deactivateLicense = useDeactivateLicense();
  const [openingTarget, setOpeningTarget] = useState<PurchaseTier | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const openCheckout = async (tier: PurchaseTier) => {
    setOpenError(null);
    setOpeningTarget(tier);
    try {
      const checkoutUrl = checkoutUrlFor(tier, "settings_account");
      if (!checkoutUrl) {
        throw new Error(
          `${tier === "commercial" ? "Commercial" : "Personal"} checkout link is not configured for this build.`,
        );
      }
      await openUrl(checkoutUrl);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningTarget(null);
    }
  };

  return (
    <motion.div
      key="account"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <AccountView
        licenseState={licenseQuery.data ?? null}
        licenseLoading={licenseQuery.isLoading && !licenseQuery.data}
        activating={activateLicense.isPending}
        refreshing={refreshLicense.isPending}
        deactivating={deactivateLicense.isPending}
        openingTarget={openingTarget}
        openError={openError}
        activationError={
          activateLicense.error instanceof Error
            ? activateLicense.error.message
            : activateLicense.error
              ? String(activateLicense.error)
              : null
        }
        deactivationError={
          deactivateLicense.error instanceof Error
            ? deactivateLicense.error.message
            : deactivateLicense.error
              ? String(deactivateLicense.error)
              : null
        }
        onOpenCheckout={openCheckout}
        onActivateLicense={(key) => activateLicense.mutate(key)}
        onRefreshLicense={() => refreshLicense.mutate()}
        onDeactivateLicense={() => deactivateLicense.mutate()}
      />
    </motion.div>
  );
};

export default AccountTab;
