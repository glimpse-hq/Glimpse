import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { GlimpseLogo, type StepMotionProps } from "./shared";
import type { TranscriptionMode } from "../../../types";

interface WelcomeStepProps {
  stepMotionProps: StepMotionProps;
  hasStepTransitioned: boolean;
  selectedMode: TranscriptionMode;
  onSelectMode: (mode: TranscriptionMode) => void;
  onNext: () => void;
}

export function WelcomeStep({
  stepMotionProps,
  hasStepTransitioned,
  selectedMode,
  onSelectMode,
  onNext,
}: WelcomeStepProps) {
  const { t } = useLingui();

  return (
    <motion.div
      key="welcome"
      {...stepMotionProps}
      initial={hasStepTransitioned ? "enter" : false}
      className="flex flex-col items-center text-center w-full max-w-5xl"
    >
      <div className="mb-6">
        <GlimpseLogo size="lg" />
      </div>

      <h1 className="ui-text-screen-title font-semibold text-content-primary mb-2">
        {t({
          id: "onboarding.welcome.title",
          message: "Welcome to Glimpse",
        })}
      </h1>

      <p className="ui-text-body-lg text-content-muted mb-8">
        {t({
          id: "onboarding.welcome.subtitle",
          message: "Build at the speed of speech.",
        })}
      </p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <button
          type="button"
          disabled
          className={`group relative w-full rounded-2xl border p-4 text-left space-y-3 ui-shadow-onboarding-cloud overflow-hidden transition-colors ${
            selectedMode === "cloud"
              ? "border-cloud-50 bg-surface-tertiary ring-1 ring-cloud-30"
              : "border-border-primary bg-surface-tertiary opacity-70 cursor-not-allowed"
          }`}
          aria-pressed={selectedMode === "cloud"}
          aria-disabled="true"
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 opacity-18">
              <DotMatrix
                rows={6}
                cols={18}
                activeDots={[1, 4, 7, 10, 12, 15, 18, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68]}
                dotSize={2}
                gap={4}
                color="var(--color-border-secondary)"
              />
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <DotMatrix rows={2} cols={2} activeDots={[0, 3]} dotSize={3} gap={2} color="var(--color-cloud)" />
            <span className="ui-text-meta font-semibold ui-color-warning-strong">
              {t({
                id: "onboarding.welcome.cloud.title",
                message: "Glimpse Cloud",
              })}
            </span>
            <span className="ml-2 rounded-lg bg-surface-elevated px-2 py-0.5 ui-text-micro font-medium text-content-muted">
              {t({
                id: "onboarding.welcome.cloud.badge",
                message: "In development",
              })}
            </span>
          </div>
          <div className="relative flex flex-col gap-1.5 ui-text-label text-content-secondary font-medium">
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-amber-400/80" /><span>{t({ id: "onboarding.welcome.cloud.feature.sync", message: "Cross-device sync" })}</span></div>
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-amber-400/80" /><span>{t({ id: "onboarding.welcome.cloud.feature.models", message: "Bigger & better models" })}</span></div>
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-amber-400/80" /><span>{t({ id: "onboarding.welcome.cloud.feature.tools", message: "Smarter writing tools & delivery" })}</span></div>
          </div>
          <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 ui-text-meta text-content-secondary leading-relaxed">
            <DotMatrix rows={3} cols={5} activeDots={[0, 2, 4, 6, 8, 10, 12, 14]} dotSize={2} gap={2} color="var(--color-border-secondary)" />
            <p className="flex-1">
              {t({
                id: "onboarding.welcome.cloud.description",
                message:
                  "Get better models and smarter writing tools ($5.99/mo) with cloud.",
              })}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSelectMode("local")}
          className={`group relative w-full rounded-2xl border p-4 text-left space-y-3 ui-shadow-onboarding-local overflow-hidden transition-colors ${
            selectedMode === "local"
              ? "border-local-50 bg-surface-tertiary ring-1 ring-local-30"
              : "border-border-primary bg-surface-tertiary"
          }`}
          aria-pressed={selectedMode === "local"}
          aria-label={t({
            id: "onboarding.welcome.local.aria",
            message: "Select Local mode (Privacy-first, on-device)",
          })}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 opacity-14">
              <DotMatrix
                rows={6}
                cols={18}
                activeDots={[0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68]}
                dotSize={2}
                gap={4}
                color="var(--color-border-primary)"
              />
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <DotMatrix rows={2} cols={2} activeDots={[1, 2]} dotSize={3} gap={2} color="var(--color-local)" />
            <span className="ui-text-meta font-semibold text-local">
              {t({
                id: "onboarding.welcome.local.title",
                message: "Glimpse Local",
              })}
            </span>
          </div>
          <div className="relative flex flex-col gap-1.5 ui-text-label text-content-secondary font-medium">
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-local-80" /><span>{t({ id: "onboarding.welcome.local.feature.privacy", message: "Everything stays on-device for privacy" })}</span></div>
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-local-80" /><span>{t({ id: "onboarding.welcome.local.feature.models", message: "Local models" })}</span></div>
            <div className="flex items-center gap-2"><div className="h-1 w-3 rounded-full bg-local-80" /><span>{t({ id: "onboarding.welcome.local.feature.sync", message: "Free optional Cloud transcription sync" })}</span></div>
          </div>
          <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 ui-text-meta text-content-muted leading-relaxed">
            <DotMatrix rows={3} cols={5} activeDots={[1, 4, 6, 9, 12, 15, 18, 21]} dotSize={2} gap={2} color="var(--color-local)" />
            <p className="flex-1">
              {t({
                id: "onboarding.welcome.local.description",
                message:
                  "Best for privacy-first or offline sessions. Cloud remains optional if you want sync and faster responses.",
              })}
            </p>
          </div>
        </button>
      </div>

      <button
        onClick={onNext}
        className="flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight"
      >
        {selectedMode === "cloud"
          ? t({
              id: "onboarding.welcome.cta.cloud",
              message: "> Cloud",
            })
          : t({
              id: "onboarding.welcome.cta.local",
              message: "> Local",
            })}
      </button>
    </motion.div>
  );
}
