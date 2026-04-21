import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { ExternalLink, ChevronRight } from "lucide-react";
import { AppleAccessibilityIcon, StatusBadge, type StepMotionProps } from "./shared";

interface AccessibilityStepProps {
  stepMotionProps: StepMotionProps;
  accessibilityPermission: boolean;
  isChecking: boolean;
  onRequestAccess: () => void;
  onNext: () => void;
}

export function AccessibilityStep({
  stepMotionProps,
  accessibilityPermission,
  isChecking,
  onRequestAccess,
  onNext,
}: AccessibilityStepProps) {
  const { t } = useLingui();
  const appName = t({
    id: "onboarding.accessibility.app_name",
    message: "Glimpse",
  });

  return (
    <motion.div
      key="accessibility"
      {...stepMotionProps}
      initial="enter"
      className="flex flex-col items-center text-center max-w-sm"
    >
      <div className="mb-5">
        <AppleAccessibilityIcon size={32} className="ui-color-accent" />
      </div>

      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
        {t({
          id: "onboarding.accessibility.title",
          message: "Accessibility",
        })}
      </h2>

      <div className="mb-3">
        <StatusBadge granted={accessibilityPermission} checking={isChecking} />
      </div>

      <p className="ui-text-body-lg text-content-muted mb-5">
        {t({
          id: "onboarding.accessibility.subtitle",
          message: "Enables auto-paste into any application.",
        })}
      </p>

      {!accessibilityPermission && (
        <p className="ui-text-body-sm text-content-disabled mb-5">
          {t({
            id: "onboarding.accessibility.instructions",
            message: `Click below to open System Settings, then toggle on ${appName}`,
          })}
        </p>
      )}

      {!accessibilityPermission ? (
        <button
          onClick={onRequestAccess}
          className="flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-violet-400 transition-colors"
        >
          <ExternalLink size={15} />
          {t({
            id: "onboarding.accessibility.enable",
            message: "Enable in Settings",
          })}
        </button>
      ) : (
        <button
          onClick={onNext}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-emerald-400 transition-colors"
        >
          {t({
            id: "onboarding.accessibility.continue",
            message: "Continue",
          })}
          <ChevronRight size={15} />
        </button>
      )}

      <button
        onClick={onNext}
        className="mt-3 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
      >
        {t({
          id: "onboarding.accessibility.skip",
          message: "Skip",
        })}
      </button>
    </motion.div>
  );
}
