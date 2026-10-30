import { useLingui } from "@lingui/react/macro";
import {
  ArrowUpRight,
  Books,
  Brain,
  Broom,
  CircleNotch,
  PencilLine,
  Record,
  Users,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";
import { useTauriEvent } from "../../../shared/hooks/useTauriEvent";
import {
  dismissTrialEndedScreen,
  trackTrialEndedChoice,
  type TrialEndedChoice,
  type TrialEndedScreen as Summary,
} from "../api";
import { pricingUrlFor } from "../purchaseConfig";
import { licenseKeys, usePlanPrice } from "../queries";

type TrialEndedScreenProps = {
  summary: Summary;
  onEnterKey: () => void;
};

// Shown once over the main window after the trial runs out, so the change
// is explained in one place instead of discovered lock by lock.
const TrialEndedScreen = ({ summary, onEnterKey }: TrialEndedScreenProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  // The pricing page offers every plan, so the button shows the lowest price.
  const startingPrice = usePlanPrice("solo");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingFree, setConfirmingFree] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmRef, confirmingFree, () => setConfirmingFree(false));

  useEffect(() => {
    void invoke("track_paywall_shown", { source: "trial_ended" }).catch(
      () => {},
    );
  }, []);

  const chosenRef = useRef(new Set<TrialEndedChoice>());
  const choose = useCallback((choice: TrialEndedChoice) => {
    if (chosenRef.current.has(choice)) return;
    chosenRef.current.add(choice);
    void trackTrialEndedChoice(choice).catch(() => {});
  }, []);

  // Closing the window leaves the screen unanswered; it shows again next time.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen("tauri://close-requested", () => {
        if (chosenRef.current.size === 0) choose("closed");
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [choose]);

  // Continuing for free also removes the models only paid features use.
  const dismiss = useCallback(
    (keepFree: boolean) => {
      queryClient.setQueryData(licenseKeys.trialEndedScreen(), null);
      dismissTrialEndedScreen(keepFree).catch((err) => {
        console.error("Failed to dismiss the trial-ended screen:", err);
        void queryClient.invalidateQueries({
          queryKey: licenseKeys.trialEndedScreen(),
        });
      });
    },
    [queryClient],
  );

  useTauriEvent("license:checkout-returned", () => dismiss(false));

  const buy = async () => {
    choose("buy");
    setError(null);
    setOpening(true);
    try {
      await openUrl(pricingUrlFor("trial_ended"));
    } catch (err) {
      setError(String(err));
    } finally {
      setOpening(false);
    }
  };

  const speakerDetection = t({
    id: "trial_ended.speakers.name",
    message: "Speaker detection",
  });
  const features: { icon: PhosphorIcon; name: string }[] = [
    {
      icon: Broom,
      name: t({ id: "trial_ended.cleanup.name", message: "Cleanup" }),
    },
    {
      icon: PencilLine,
      name: t({ id: "trial_ended.edit.name", message: "Edit with your voice" }),
    },
    {
      icon: Brain,
      name: t({
        id: "trial_ended.personalization.name",
        message: "Personalization",
      }),
    },
    {
      icon: Books,
      name: t({ id: "trial_ended.library.name", message: "Library" }),
    },
    {
      icon: Record,
      name: t({ id: "trial_ended.record.name", message: "Record" }),
    },
    { icon: Users, name: speakerDetection },
  ];

  const modelNames = {
    speakers: speakerDetection,
    language: t({
      id: "trial_ended.model.cleanup",
      message: "Cleanup model",
    }),
  };
  const installedModels = summary.installedModels;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-ended-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--color-bg-primary)]"
    >
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-8" />
      <div className="-mt-3 flex w-full max-w-[480px] flex-col items-center px-6">
        <h1
          id="trial-ended-title"
          className="text-center ui-text-title-lg font-semibold text-content-primary text-balance"
        >
          {t({
            id: "trial_ended.title",
            message: "Your trial has ended",
          })}
        </h1>

        <p className="mt-8 ui-text-meta ui-color-muted">
          {t({ id: "trial_ended.now_locked", message: "Now locked" })}
        </p>
        <ul className="mt-5 grid w-full grid-cols-3 gap-x-4 gap-y-6">
          {features.map(({ icon: Icon, name }) => (
            <li key={name} className="flex flex-col items-center gap-2">
              <Icon size={22} className="ui-color-muted" aria-hidden="true" />
              <span className="text-center ui-text-body-sm ui-color-secondary text-balance">
                {name}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex w-full max-w-[320px] flex-col gap-2.5">
          <button
            type="button"
            onClick={() => void buy()}
            disabled={opening}
            className="ui-button-primary flex h-10 w-full items-center justify-center gap-2 rounded-lg ui-text-body-sm"
          >
            {t({
              id: "trial_ended.unlock.v4",
              message: "Unlock everything",
            })}
            <span className="flex items-center gap-2 ui-text-meta tabular-nums opacity-70">
              {startingPrice}
              {opening ? (
                <CircleNotch
                  size={13}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ArrowUpRight size={13} aria-hidden="true" />
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (installedModels.length > 0) {
                setConfirmingFree(true);
                return;
              }
              choose("continue_free");
              dismiss(true);
            }}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-[var(--surface-interactive)] ui-text-body-sm ui-color-primary transition-colors hover:bg-[var(--surface-interactive-strong)]"
          >
            {t({
              id: "trial_ended.continue_for_free",
              message: "Continue for free",
            })}
          </button>
          <button
            type="button"
            onClick={() => {
              choose("enter_key");
              dismiss(false);
              onEnterKey();
            }}
            className="mx-auto mt-1 h-8 ui-text-body-sm ui-color-cloud underline-offset-4 hover:underline"
          >
            {t({ id: "trial_ended.enter_key", message: "Enter license key" })}
          </button>
          <p
            aria-live="polite"
            className="min-h-5 text-center ui-text-meta text-error"
          >
            {error}
          </p>
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {confirmingFree && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-6 backdrop-blur-xs"
              onClick={() => setConfirmingFree(false)}
            >
              <motion.div
                ref={confirmRef}
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-[280px] rounded-3xl border border-border-primary bg-surface-tertiary px-4 pt-5 pb-4 text-center ui-shadow-modal-deep"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="trial-free-title"
              >
                <p
                  id="trial-free-title"
                  className="ui-text-body-strong text-content-primary text-balance"
                >
                  {t({
                    id: "trial_ended.free_confirm.title",
                    message: "Continue for free?",
                  })}
                </p>
                <p className="mt-1.5 ui-text-body-sm text-content-muted">
                  {t({
                    id: "trial_ended.free_confirm.removed",
                    message: "These models will be removed:",
                  })}
                </p>
                <ul className="mt-0.5 ui-text-body-sm text-content-secondary">
                  {installedModels.map((kind) => (
                    <li key={kind}>{modelNames[kind]}</li>
                  ))}
                </ul>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingFree(false)}
                    autoFocus
                    className="ui-button-primary h-9 rounded-lg ui-text-body-sm"
                  >
                    {t({
                      id: "trial_ended.free_confirm.cancel",
                      message: "Cancel",
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingFree(false);
                      choose("continue_free");
                      dismiss(true);
                    }}
                    className="h-9 rounded-lg bg-[var(--surface-interactive)] ui-text-body-sm font-medium text-error transition-colors hover:bg-[var(--surface-interactive-strong)]"
                  >
                    {t({
                      id: "trial_ended.free_confirm.continue",
                      message: "Continue",
                    })}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </motion.div>
  );
};

export default TrialEndedScreen;
