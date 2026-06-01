import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import DotMatrix from "../../../shared/ui/DotMatrix";
import type { StepMotionProps } from "./shared";
import type { TranscriptionMode } from "../../../types";

interface WelcomeStepProps {
  stepMotionProps: StepMotionProps;
  hasStepTransitioned: boolean;
  selectedMode: TranscriptionMode;
  onSelectMode: (mode: TranscriptionMode) => void;
  onNext: () => void;
  continueDisabled?: boolean;
}

export function WelcomeStep({
  stepMotionProps,
  hasStepTransitioned,
  selectedMode,
  onSelectMode,
  onNext,
  continueDisabled = false,
}: WelcomeStepProps) {
  const { t } = useLingui();

  return (
    <motion.div
      key="welcome"
      {...stepMotionProps}
      initial={hasStepTransitioned ? "enter" : false}
      className="flex flex-col items-center text-center w-full max-w-2xl"
    >
      <h1 className="ui-text-display font-semibold text-content-primary mb-2">
        {t({
          id: "onboarding.welcome.title",
          message: "Welcome",
        })}
      </h1>

      <p className="ui-text-body-lg text-content-muted mb-8">
        {t({
          id: "onboarding.welcome.subtitle",
          message: "Choose how you want to transcribe.",
        })}
      </p>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Cloud card: in progress, not selectable */}
        <div
          className="relative w-full rounded-2xl border border-border-primary bg-surface-tertiary overflow-hidden opacity-45 cursor-not-allowed"
          aria-disabled="true"
        >
          <div className="absolute inset-0 pointer-events-none opacity-[0.05]">
            <DotMatrix
              rows={10}
              cols={22}
              activeDots={[1, 4, 7, 10, 13, 23, 26, 29, 32, 35, 45, 48, 51, 54, 57, 67, 70, 73, 76, 79, 89, 92, 95, 98, 101, 111, 114, 117, 120, 123, 133, 136, 139, 142, 145, 155, 158, 161, 164, 167]}
              dotSize={2}
              gap={4}
              color="var(--color-cloud)"
            />
          </div>

          <div className="relative flex flex-col items-center justify-center py-12 px-5">
            <DotMatrix rows={2} cols={2} activeDots={[0, 3]} dotSize={5} gap={3} color="var(--color-cloud-30)" />
            <span className="mt-4 ui-text-body-lg font-semibold text-content-disabled">
              {t({
                id: "onboarding.welcome.cloud.title",
                message: "Cloud",
              })}
            </span>
            <span className="mt-2.5 rounded-md bg-surface-elevated px-2.5 py-1 ui-text-micro font-medium text-content-disabled">
              {t({
                id: "onboarding.welcome.cloud.badge",
                message: "In progress",
              })}
            </span>
          </div>
        </div>

        {/* Local card: selectable, the main path */}
        <button
          type="button"
          onClick={() => onSelectMode("local")}
          className={`group relative w-full rounded-2xl border text-left overflow-hidden transition-all duration-200 ${
            selectedMode === "local"
              ? "border-local-40 bg-surface-tertiary ring-1 ring-local-20 ui-shadow-onboarding-local"
              : "border-border-primary bg-surface-tertiary hover:border-local-30"
          }`}
          aria-pressed={selectedMode === "local"}
          aria-label={t({
            id: "onboarding.welcome.local.aria",
            message: "Select Local mode: privacy-first, on-device transcription",
          })}
        >
          {/* Animated dot field: shifts on hover */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.12]">
            <DotMatrix
              rows={10}
              cols={22}
              activeDots={[0, 5, 10, 15, 20, 22, 27, 32, 37, 42, 44, 49, 54, 59, 64, 66, 71, 76, 81, 86, 88, 93, 98, 103, 108, 110, 115, 120, 125, 130, 132, 137, 142, 147, 152, 154, 159, 164, 169, 174, 176, 181, 186, 191, 196, 198, 203, 208, 213, 218]}
              dotSize={2}
              gap={4}
              color="var(--color-local)"
            />
          </div>

          {/* Glow edge on selection */}
          {selectedMode === "local" && (
            <motion.div
              className="absolute inset-0 pointer-events-none rounded-2xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              style={{
                background: "radial-gradient(ellipse at 30% 20%, var(--color-local-10) 0%, transparent 70%)",
              }}
            />
          )}

          <div className="relative flex flex-col gap-5 p-5">
            {/* Header with logo-style dot matrix */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <DotMatrix rows={2} cols={2} activeDots={[1, 2]} dotSize={5} gap={3} color="var(--color-local)" />
                <span className="ui-text-body-lg font-semibold text-local">
                  {t({
                    id: "onboarding.welcome.local.title",
                    message: "Local",
                  })}
                </span>
              </div>
            </div>

            {/* Features: dot-matrix bullets, mode-specific only */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <DotMatrix rows={1} cols={3} activeDots={[0, 1, 2]} dotSize={3} gap={2} color="var(--color-local-80)" />
                <span className="ui-text-label text-content-secondary font-medium">
                  {t({ id: "onboarding.welcome.local.feature.models", message: "On-device transcription models" })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <DotMatrix rows={1} cols={3} activeDots={[0, 2]} dotSize={3} gap={2} color="var(--color-local-80)" />
                <span className="ui-text-label text-content-secondary font-medium">
                  {t({ id: "onboarding.welcome.local.feature.byok", message: "Bring your own API key for AI features" })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <DotMatrix rows={1} cols={3} activeDots={[1]} dotSize={3} gap={2} color="var(--color-local-80)" />
                <span className="ui-text-label text-content-secondary font-medium">
                  {t({ id: "onboarding.welcome.local.feature.free", message: "Free, no account required" })}
                </span>
              </div>
            </div>
          </div>
        </button>
      </div>

      <button
        onClick={onNext}
        disabled={continueDisabled}
        className="flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight disabled:opacity-40 disabled:hover:bg-content-primary"
      >
        {t({
          id: "onboarding.welcome.cta",
          message: "Continue",
        })}
      </button>
    </motion.div>
  );
}
