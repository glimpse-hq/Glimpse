import { useLingui } from "@lingui/react/macro";
import {
  CircleNotch as Loader2,
  SignOut as LogOut,
  ArrowRight,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import CustomerPortalLink from "../../license/components/CustomerPortalLink";
import MemberCard from "../../license/components/MemberCard";
import PlanPicker from "../../license/components/PlanPicker";
import {
  classifyActivationInput,
  LICENSE_KEY_PLACEHOLDER,
} from "../../license/licenseKeyShape";
import { useActivationErrorText } from "../../license/useActivationErrorText";
import {
  openCheckout,
  type ActivationError,
  type LicenseState,
} from "../../license/api";
import { SUPPORT_EMAIL } from "../../../shared/lib/links";
type AccountViewProps = {
  licenseState: LicenseState | null;
  licenseLoading: boolean;
  activating: boolean;
  deactivating: boolean;
  activationError: ActivationError | null;
  deactivationError: string | null;
  checkoutReturned: boolean;
  focusLicenseKey: boolean;
  onLicenseKeyFocused: () => void;
  onActivateLicense: (key: string) => void;
  onDeactivateLicense: () => void;
};

const TRIAL_TOTAL_DAYS = 14;

const portalLinkClassName =
  "inline-flex shrink-0 items-center gap-1 ui-text-meta ui-color-muted transition-colors hover:ui-color-secondary";

const AccountView = ({
  licenseState,
  licenseLoading,
  activating,
  deactivating,
  activationError,
  deactivationError,
  checkoutReturned,
  focusLicenseKey,
  onLicenseKeyFocused,
  onActivateLicense,
  onDeactivateLicense,
}: AccountViewProps) => {
  const { t } = useLingui();
  const [licenseKey, setLicenseKey] = useState("");
  const [attemptedKey, setAttemptedKey] = useState("");
  const [activationAttempt, setActivationAttempt] = useState(0);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const confirmTimeoutRef = useRef<number | null>(null);
  const licenseKeyInputRef = useRef<HTMLInputElement>(null);

  const isActive = licenseState?.status === "active";
  const isUnverified = licenseState?.status === "unverified";
  const isTrialing = !isActive && (licenseState?.trialActive ?? false);
  const renewsAt =
    isActive && licenseState?.expiresAt
      ? formatDate(licenseState.expiresAt)
      : null;
  const renewsText = renewsAt ? t`Renews ${renewsAt}` : null;

  useEffect(() => {
    if (!focusLicenseKey || isActive) return;
    const frame = window.requestAnimationFrame(() => {
      const input = licenseKeyInputRef.current;
      if (!input) return;
      input.scrollIntoView({ block: "nearest" });
      input.focus({ preventScroll: true });
      input.select();
      onLicenseKeyFocused();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusLicenseKey, isActive, onLicenseKeyFocused]);

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current !== null) {
        window.clearTimeout(confirmTimeoutRef.current);
      }
    };
  }, []);

  const submitActivation = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedKey = licenseKey.trim();
    if (trimmedKey.length === 0) return;
    setAttemptedKey(trimmedKey);
    setActivationAttempt((attempt) => attempt + 1);
    onActivateLicense(trimmedKey);
  };

  const activationErrorText = useActivationErrorText(
    activationError,
    attemptedKey,
  );
  const failedOnDiscountCode =
    activationError !== null &&
    classifyActivationInput(attemptedKey) === "discount_code";
  const showSupport = activationErrorText !== null && activationAttempt >= 2;

  const activationHintText = checkoutReturned
    ? t({
        id: "settings.account.activate.checkout_return_hint_generic",
        message:
          "Your license key is in your receipt email. Paste it here, or paste the whole email.",
      })
    : null;

  const handleDeactivateClick = () => {
    if (confirmDeactivate) {
      if (confirmTimeoutRef.current !== null) {
        window.clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
      setConfirmDeactivate(false);
      onDeactivateLicense();
      return;
    }
    setConfirmDeactivate(true);
    confirmTimeoutRef.current = window.setTimeout(() => {
      setConfirmDeactivate(false);
      confirmTimeoutRef.current = null;
    }, 3000);
  };

  const handleCancelDeactivate = () => {
    if (confirmTimeoutRef.current !== null) {
      window.clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    setConfirmDeactivate(false);
  };

  const trialDaysRemaining = licenseState?.trialDaysRemaining ?? 0;
  const trialEndsAt = licenseState?.trialEndsAt ?? null;
  const trialStatusText = (() => {
    if (licenseLoading) return "\u00a0";

    if (isUnverified) {
      return t({
        id: "settings.account.license.unverified",
        message: "Reconnect to the internet to verify your license.",
      });
    }

    if (isTrialing) {
      if (trialDaysRemaining === 1) {
        return t({
          id: "settings.account.trial.text_one",
          message: "Trial · 1 day left",
        });
      }
      return t`Trial · ${trialDaysRemaining} of ${TRIAL_TOTAL_DAYS} days left`;
    }

    if (trialEndsAt) {
      const formattedDate = formatDate(trialEndsAt) ?? "-";
      const prefix = t({
        id: "settings.account.trial.text_ended_on",
        message: "Your trial ended on",
      });
      return `${prefix} ${formattedDate}`;
    }

    return t({
      id: "settings.account.trial.text_ended",
      message: "Your trial has ended",
    });
  })();

  return (
    <div className="mx-auto w-full max-w-[460px] space-y-6">
      <div className="flex flex-col items-center gap-3">
        <MemberCard
          active={isActive}
          activating={activating}
          activationAttempt={activationAttempt}
          licenseLoading={licenseLoading}
          licenseState={licenseState}
        />

        <div className="flex w-full max-w-[400px] items-center justify-between gap-3">
          {isActive ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              {renewsText ? (
                <p className="truncate ui-text-meta ui-color-muted">
                  {renewsText}
                </p>
              ) : null}
              <CustomerPortalLink
                provider={licenseState?.provider}
                className={portalLinkClassName}
              />
            </div>
          ) : (
            <p
              className="min-w-0 truncate ui-text-meta"
              style={{
                color: isTrialing
                  ? "var(--color-cloud)"
                  : "var(--color-text-muted)",
              }}
            >
              {trialStatusText}
            </p>
          )}

          {isActive ? (
            confirmDeactivate ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCancelDeactivate}
                  disabled={deactivating}
                  className="inline-flex h-7 min-w-[52px] items-center justify-center rounded-md px-2 ui-text-button-sm ui-color-muted transition-colors hover:bg-surface-elevated hover:text-content-primary disabled:opacity-50"
                >
                  {t({
                    id: "settings.account.action.deactivate_cancel",
                    message: "Cancel",
                  })}
                </button>
                <button
                  type="button"
                  onClick={handleDeactivateClick}
                  disabled={deactivating}
                  className="inline-flex h-7 min-w-[72px] items-center justify-center gap-1 rounded-md px-2 ui-text-button-sm ui-color-error transition-colors hover:bg-surface-elevated disabled:opacity-50"
                >
                  {deactivating ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <LogOut size={11} />
                  )}
                  {t({
                    id: "settings.account.action.deactivate_confirm_short",
                    message: "Deactivate",
                  })}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeactivateClick}
                disabled={deactivating}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 ui-text-button-sm ui-color-muted transition-colors hover:bg-surface-elevated hover:text-content-primary disabled:opacity-50"
              >
                {deactivating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <LogOut size={12} />
                )}
                {t({
                  id: "settings.account.action.deactivate",
                  message: "Deactivate this device",
                })}
              </button>
            )
          ) : null}
        </div>

        {deactivationError ? (
          <p className="w-full max-w-[400px] ui-text-meta text-error">
            {deactivationError}
          </p>
        ) : null}
      </div>

      {!isActive && !licenseLoading && (
        <section className="mx-auto max-w-[400px]">
          <PlanPicker source="account" />
        </section>
      )}

      {!isActive && (
        <section className="mx-auto max-w-[400px] border-t border-border-primary pt-5">
          <h2 className="ui-text-label-strong ui-color-primary">
            {t({
              id: "settings.account.section.activate",
              message: "Already bought?",
            })}
          </h2>
          <form
            onSubmit={submitActivation}
            className="mt-3 flex items-center gap-2 border-b border-border-secondary transition-colors focus-within:border-content-primary"
          >
            <input
              ref={licenseKeyInputRef}
              autoFocus={checkoutReturned}
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder={LICENSE_KEY_PLACEHOLDER}
              aria-label={t({
                id: "settings.account.activate.input_aria",
                message: "Activation code",
              })}
              aria-invalid={activationErrorText ? true : undefined}
              className="min-w-0 flex-1 bg-transparent px-0.5 py-1.5 font-mono ui-text-body-sm leading-normal ui-color-primary placeholder-content-disabled outline-none"
            />
            <button
              type="submit"
              disabled={activating || licenseKey.trim().length === 0}
              className="inline-flex h-7 items-center gap-1 px-1 ui-text-button-sm ui-color-secondary transition-colors hover:text-content-primary disabled:opacity-40"
            >
              {activating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {t({
                id: "settings.account.activate.submit",
                message: "Activate",
              })}
              {!activating && <ArrowRight size={12} aria-hidden="true" />}
            </button>
          </form>
          <p
            aria-live="polite"
            className={`mt-2 min-h-10 ui-text-meta text-pretty ${activationErrorText ? "text-error" : "ui-color-muted"}`}
          >
            {activationErrorText ?? activationHintText}
            {failedOnDiscountCode && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() =>
                    void openCheckout({
                      tier: "plus",
                      source: "activation",
                      code: attemptedKey,
                    }).catch(() => {})
                  }
                  className="ui-color-primary underline underline-offset-2"
                >
                  {t({
                    id: "license.activate.buy_with_code",
                    message: "Get Glimpse Plus with this code",
                  })}
                </button>
              </>
            )}
            {showSupport && !failedOnDiscountCode && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() =>
                    void openUrl(`mailto:${SUPPORT_EMAIL}`).catch(() => {})
                  }
                  className="ui-color-primary underline underline-offset-2"
                >
                  {t({
                    id: "license.activate.email_support",
                    message: `Still stuck? Email ${SUPPORT_EMAIL}`,
                  })}
                </button>
              </>
            )}
          </p>
        </section>
      )}
    </div>
  );
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default AccountView;
