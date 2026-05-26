import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import MemberCard from "../../license/components/MemberCard";
import type { LicenseState } from "../../license/api";
import type { PurchaseTier } from "../../../shared/lib/purchaseConfig";
import type { StepMotionProps } from "./shared";

interface LicenseStepProps {
  stepMotionProps: StepMotionProps;
  licenseState: LicenseState | null;
  licenseLoading: boolean;
  activating: boolean;
  openingTarget: PurchaseTier | null;
  openError: string | null;
  activationError: string | null;
  isCompleting: boolean;
  completionError: string | null;
  onOpenCheckout: (tier: PurchaseTier) => void;
  onActivateLicense: (key: string) => void;
  onComplete: () => void;
}

export function LicenseStep({
  stepMotionProps,
  licenseState,
  licenseLoading,
  activating,
  openingTarget,
  openError,
  activationError,
  isCompleting,
  completionError,
  onOpenCheckout,
  onActivateLicense,
  onComplete,
}: LicenseStepProps) {
  const { t } = useLingui();
  const [licenseKey, setLicenseKey] = useState("");
  const [activationAttempt, setActivationAttempt] = useState(0);
  const isActive = licenseState?.status === "active";

  useEffect(() => {
    if (isActive) {
      setLicenseKey("");
    }
  }, [isActive]);

  const submitActivation = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedKey = licenseKey.trim();
    if (trimmedKey.length === 0) return;
    setActivationAttempt((attempt) => attempt + 1);
    onActivateLicense(trimmedKey);
  };

  return (
    <motion.div
      key="license"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-[460px] flex-col items-center text-center"
    >
      <div className="mb-5 max-w-[360px]">
        <h2 className="mb-2 ui-text-title-lg font-semibold text-content-primary text-balance">
          {t({
            id: "onboarding.license.title",
            message: "Connect your license",
          })}
        </h2>
        <p className="ui-text-body-lg text-content-muted leading-relaxed text-pretty">
          {isActive
            ? t({
                id: "onboarding.license.active_subtitle",
                message: "This Mac is licensed and ready.",
              })
            : t({
                id: "onboarding.license.subtitle",
                message:
                  "Buy once, or activate the code from your receipt. You can skip this and keep using the trial.",
              })}
        </p>
      </div>

      <MemberCard
        active={isActive}
        activating={activating}
        activationAttempt={activationAttempt}
        licenseLoading={licenseLoading}
        licenseState={licenseState}
        openingTarget={openingTarget}
        checkoutDisabled={openingTarget !== null}
        onOpenCheckout={onOpenCheckout}
      />

      {!isActive && (
        <form
          onSubmit={submitActivation}
          className="mt-5 flex w-full max-w-[400px] items-center gap-2 border-b border-border-secondary transition-colors focus-within:border-content-primary"
        >
          <input
            value={licenseKey}
            onChange={(event) => setLicenseKey(event.target.value)}
            placeholder={t({
              id: "onboarding.license.activate.placeholder",
              message: "GLIMPSE_...",
            })}
            aria-label={t({
              id: "onboarding.license.activate.input_aria",
              message: "Activation code",
            })}
            className="min-w-0 flex-1 bg-transparent px-0.5 py-2 font-mono ui-text-body-sm ui-color-primary placeholder-content-disabled outline-none"
          />
          <button
            type="submit"
            disabled={activating || licenseKey.trim().length === 0}
            className="inline-flex h-7 items-center gap-1 px-1 ui-text-button-sm ui-color-secondary transition-colors hover:text-content-primary disabled:opacity-40"
          >
            {activating ? <Loader2 size={12} className="animate-spin" /> : null}
            {t({
              id: "onboarding.license.activate.submit",
              message: "Activate",
            })}
            {!activating && <ArrowRight size={12} aria-hidden="true" />}
          </button>
        </form>
      )}

      {(activationError || openError || completionError) && (
        <p className="mt-3 w-full max-w-[400px] text-left ui-text-meta text-error">
          {activationError ?? openError ?? completionError}
        </p>
      )}

      <button
        type="button"
        onClick={onComplete}
        disabled={isCompleting}
        aria-busy={isCompleting}
        className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 py-2.5 ui-text-body-lg font-semibold ui-color-on-warning transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isCompleting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t({
              id: "onboarding.license.saving",
              message: "Saving...",
            })}
          </>
        ) : isActive ? (
          t({
            id: "onboarding.license.continue_active",
            message: "Get Started",
          })
        ) : (
          t({
            id: "onboarding.license.continue_trial",
            message: "Continue with trial",
          })
        )}
      </button>
    </motion.div>
  );
}
