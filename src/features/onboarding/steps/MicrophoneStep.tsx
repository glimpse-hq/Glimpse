import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { Mic, ChevronRight } from "lucide-react";
import { StatusBadge, type StepMotionProps } from "./shared";

interface MicrophoneStepProps {
  stepMotionProps: StepMotionProps;
  micPermission: boolean;
  isChecking: boolean;
  onRequestAccess: () => void;
  onNext: () => void;
}

export function MicrophoneStep({
  stepMotionProps,
  micPermission,
  isChecking,
  onRequestAccess,
  onNext,
}: MicrophoneStepProps) {
  const { t } = useLingui();

  return (
    <motion.div
      key="microphone"
      {...stepMotionProps}
      initial="enter"
      className="flex flex-col items-center text-center max-w-sm"
    >
      <div className="mb-5">
        <Mic size={32} className="ui-color-warning-strong" />
      </div>

      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
        {t({
          id: "onboarding.microphone.title",
          message: "Microphone Access",
        })}
      </h2>

      <div className="mb-3">
        <StatusBadge granted={micPermission} checking={isChecking} />
      </div>

      <p className="ui-text-body-lg text-content-muted mb-6">
        {t({
          id: "onboarding.microphone.subtitle",
          message: "Required to capture your voice for transcription.",
        })}
      </p>

      {!micPermission ? (
        <button
          onClick={onRequestAccess}
          disabled={isChecking}
          className="flex items-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-warning hover:bg-amber-300 transition-colors disabled:opacity-50"
        >
          <Mic size={15} />
          {t({
            id: "onboarding.microphone.grant",
            message: "Grant Access",
          })}
        </button>
      ) : (
        <button
          onClick={onNext}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-emerald-400 transition-colors"
        >
          {t({
            id: "onboarding.microphone.continue",
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
          id: "onboarding.microphone.skip",
          message: "Skip",
        })}
      </button>
    </motion.div>
  );
}
