import { useEffect, useRef } from "react";
import type { PurchaseSource } from "../../../license/purchaseConfig";
import {
  useActivateLicense,
  useDeactivateLicense,
  useLicenseState,
  useRefreshLicense,
} from "../../../license/queries";
import AccountView from "../AccountView";
import DictationStatsPanel from "../../../license/components/DictationStatsPanel";

type AccountTabProps = {
  source?: PurchaseSource;
  focusLicenseKey?: boolean;
  onLicenseKeyFocused?: () => void;
};

const noop = () => {};

const AccountTab = ({
  source = "settings_account",
  focusLicenseKey = false,
  onLicenseKeyFocused = noop,
}: AccountTabProps) => {
  const licenseQuery = useLicenseState();
  const activateLicense = useActivateLicense();
  const { mutate: refreshLicense, isPending: refreshLicensePending } =
    useRefreshLicense();
  const deactivateLicense = useDeactivateLicense();
  const refreshedIdentityForKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const licenseState = licenseQuery.data;
    if (!licenseState) return;
    // A lapsed Business customer may have just paid, so check on opening.
    if (!licenseState.businessLapsed) {
      if (licenseState.status !== "active") return;
      if (licenseState.customerName?.trim()) return;
    }

    const identityKey =
      licenseState.displayKey ?? licenseState.customerEmail ?? "active-license";
    if (refreshedIdentityForKeyRef.current === identityKey) return;
    if (refreshLicensePending) return;

    refreshedIdentityForKeyRef.current = identityKey;
    refreshLicense();
  }, [licenseQuery.data, refreshLicense, refreshLicensePending]);

  return (
    <div className="space-y-6">
      <AccountView
        licenseState={licenseQuery.data ?? null}
        licenseLoading={licenseQuery.isLoading && !licenseQuery.data}
        activating={activateLicense.isPending}
        deactivating={deactivateLicense.isPending}
        activationError={activateLicense.error}
        deactivationError={
          deactivateLicense.error instanceof Error
            ? deactivateLicense.error.message
            : deactivateLicense.error
              ? String(deactivateLicense.error)
              : null
        }
        checkoutReturned={source === "checkout_return"}
        focusLicenseKey={focusLicenseKey}
        onLicenseKeyFocused={onLicenseKeyFocused}
        onActivateLicense={(key) => activateLicense.mutate(key)}
        onDeactivateLicense={() => deactivateLicense.mutate()}
      />
      <DictationStatsPanel />
    </div>
  );
};

export default AccountTab;
