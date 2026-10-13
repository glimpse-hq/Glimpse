import { useLingui } from "@lingui/react/macro";
import {
  Books,
  Brain,
  Broom,
  Record,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useCallback, useEffect } from "react";
import {
  dismissTrialEndedScreen,
  type TrialEndedScreen as Summary,
} from "../api";
import { licenseKeys } from "../queries";
import PlanPicker from "./PlanPicker";

type TrialEndedScreenProps = {
  summary: Summary;
  onEnterKey: () => void;
};

// Shown once over the main window after the trial runs out, so the change
// is explained in one place instead of discovered lock by lock.
const TrialEndedScreen = ({ summary, onEnterKey }: TrialEndedScreenProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  useEffect(() => {
    void invoke("track_paywall_shown", { source: "trial_ended" }).catch(
      () => {},
    );
  }, []);

  const dismiss = useCallback(() => {
    queryClient.setQueryData(licenseKeys.trialEndedScreen(), null);
    void dismissTrialEndedScreen().catch(() => {});
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen("license:checkout-returned", () => dismiss()).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [dismiss]);

  const libraryItems = summary.libraryItems;
  const rows: { icon: PhosphorIcon; name: string; detail: string }[] = [
    {
      icon: Books,
      name: t({ id: "trial_ended.library.name", message: "Library" }),
      detail:
        libraryItems > 0
          ? t({
              id: "trial_ended.library.kept",
              message: `Your ${libraryItems} items are kept. Glimpse Plus opens them again.`,
            })
          : t({
              id: "trial_ended.library.detail",
              message: "Transcribe audio and video files.",
            }),
    },
    {
      icon: Record,
      name: t({ id: "trial_ended.record.name", message: "Record" }),
      detail: t({
        id: "trial_ended.record.detail",
        message: "Record meetings from your microphone and computer audio.",
      }),
    },
    {
      icon: Brain,
      name: t({
        id: "trial_ended.personalization.name",
        message: "Personalization",
      }),
      detail: t({
        id: "trial_ended.personalization.detail",
        message: "Writing styles for each app and website.",
      }),
    },
    {
      icon: Broom,
      name: t({ id: "trial_ended.cleanup.name", message: "Cleanup" }),
      detail: t({
        id: "trial_ended.cleanup.detail",
        message: "Cleanup and your writing model are turned off.",
      }),
    },
  ];

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
      <div className="w-full max-w-[420px] px-6">
        <h1
          id="trial-ended-title"
          className="font-satoshi ui-text-display tracking-tight ui-color-primary"
        >
          {t({
            id: "trial_ended.title",
            message: "Your trial has ended",
          })}
        </h1>
        <p className="mt-2 ui-text-body ui-color-muted text-pretty">
          {t({
            id: "trial_ended.line",
            message:
              "Dictation stays free with every model. These now need Glimpse Plus:",
          })}
        </p>

        <ul className="mt-6 divide-y divide-border-primary border-y border-border-primary">
          {rows.map(({ icon: Icon, name, detail }) => (
            <li key={name} className="flex items-center gap-3 py-2.5">
              <Icon
                size={16}
                className="shrink-0 ui-color-muted"
                aria-hidden="true"
              />
              <span className="w-[120px] shrink-0 ui-text-body-sm-strong ui-color-primary">
                {name}
              </span>
              <span className="min-w-0 ui-text-meta ui-color-muted text-pretty">
                {detail}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <PlanPicker source="trial_ended" />
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mx-auto mt-1 flex h-8 items-center ui-text-body-sm ui-color-secondary transition-colors hover:text-content-primary"
        >
          {t({
            id: "trial_ended.continue_free",
            message: "Keep using Glimpse for free",
          })}
        </button>

        <button
          type="button"
          onClick={() => {
            dismiss();
            onEnterKey();
          }}
          className="mx-auto flex h-8 items-center ui-text-meta ui-color-secondary transition-colors hover:text-content-primary"
        >
          {t({
            id: "locked.enter_key",
            message: "Already bought? Enter your license key",
          })}
        </button>
      </div>
    </motion.div>
  );
};

export default TrialEndedScreen;
