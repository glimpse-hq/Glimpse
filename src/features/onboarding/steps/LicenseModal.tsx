import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleNotch as Loader2, ArrowRight, X } from "@phosphor-icons/react";
import MemberCard from "../../license/components/MemberCard";
import CustomerPortalLink from "../../license/components/CustomerPortalLink";
import type { LicenseState } from "../../license/api";
import type { PurchaseTier } from "../../license/purchaseConfig";

const PERSONAL_INFO_URL = "https://tryglimpse.cc/personal";

interface LicenseModalProps {
  licenseState: LicenseState | null;
  licenseLoading: boolean;
  activating: boolean;
  openingTarget: PurchaseTier | null;
  openError: string | null;
  activationError: string | null;
  onOpenCheckout: (tier: PurchaseTier) => void;
  onActivateLicense: (key: string) => void;
  onClose: () => void;
}

export function LicenseModal({
  licenseState,
  licenseLoading,
  activating,
  openingTarget,
  openError,
  activationError,
  onOpenCheckout,
  onActivateLicense,
  onClose,
}: LicenseModalProps) {
  const { t } = useLingui();
  const [licenseKey, setLicenseKey] = useState("");
  const [activationAttempt, setActivationAttempt] = useState(0);
  const isActive = licenseState?.status === "active";

  const submitActivation = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = licenseKey.trim();
    if (trimmed.length === 0) return;
    setActivationAttempt((attempt) => attempt + 1);
    onActivateLicense(trimmed);
  };

  return createPortal(
    <motion.div
      key="license-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 px-6 backdrop-blur-2xl"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative flex w-full max-w-[400px] flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t({ id: "onboarding.license.close", message: "Close" })}
          className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full text-white/65 transition-colors hover:text-white"
        >
          <X size={14} />
        </button>

        {!isActive ? (
          <div className="max-w-[340px] text-center">
            <p className="ui-text-body-lg-strong text-white">
              {t({
                id: "onboarding.license.free_title",
                message: "Dictation is free forever",
              })}
            </p>
            <p className="mt-1 ui-text-body-sm text-white/70 text-pretty">
              {t({
                id: "onboarding.license.free_body",
                message:
                  "Unlock AI cleanup, voice editing, per-app personalities, audio and video transcription, and more.",
              })}
            </p>
            <button
              type="button"
              onClick={() => void openUrl(PERSONAL_INFO_URL).catch(() => {})}
              className="mt-2 ui-text-meta text-[#fbbf24] underline-offset-4 transition-opacity hover:underline"
            >
              {t({
                id: "onboarding.license.why_paid",
                message: "Why is there paid stuff?",
              })}
            </button>
          </div>
        ) : null}

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

        {!isActive ? (
          <form
            onSubmit={submitActivation}
            className="flex w-full max-w-[340px] items-center gap-2 border-b border-white/15 transition-colors focus-within:border-white/40"
          >
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder={t({
                id: "onboarding.license.placeholder",
                message: "Already bought? Paste your key",
              })}
              aria-label={t({
                id: "onboarding.license.input_aria",
                message: "License key",
              })}
              className="min-w-0 flex-1 bg-transparent px-0.5 py-2 font-mono ui-text-body-sm text-white placeholder-white/35 outline-none"
            />
            <button
              type="submit"
              disabled={activating || licenseKey.trim().length === 0}
              className="inline-flex h-7 items-center gap-1 px-1 ui-text-button-sm text-white/65 transition-colors hover:text-white disabled:opacity-40"
            >
              {activating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {t({ id: "onboarding.license.activate", message: "Activate" })}
              {!activating && <ArrowRight size={12} aria-hidden="true" />}
            </button>
          </form>
        ) : null}

        {activationError || openError ? (
          <p className="w-full max-w-[340px] ui-text-meta text-red-400">
            {activationError ?? openError}
          </p>
        ) : null}

        <CustomerPortalLink
          source="onboarding"
          className="inline-flex items-center gap-1.5 ui-text-meta text-white/65 transition-colors hover:text-white"
        />
      </motion.div>
    </motion.div>,
    document.body,
  );
}
