import { useLingui } from "@lingui/react/macro";
import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties } from "react";
import {
  GlimpseLogo,
  OnboardingStep,
  PRIMARY_BUTTON_CLASS,
  type StepMotionProps,
} from "./shared";

interface WelcomeStepProps {
  stepMotionProps: StepMotionProps;
  hasStepTransitioned: boolean;
  onStart: () => void;
  startDisabled?: boolean;
}

const LOGO_COLORS = {
  "--color-cloud": "#fbbf24",
  "--color-local": "#a5b3fe",
} as CSSProperties;

export function WelcomeStep({
  stepMotionProps,
  hasStepTransitioned,
  onStart,
  startDisabled = false,
}: WelcomeStepProps) {
  const { t } = useLingui();
  const reduceMotion = useReducedMotion();

  return (
    <OnboardingStep
      stepKey="welcome"
      motionProps={stepMotionProps}
      initial={hasStepTransitioned ? "enter" : false}
      align="center"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="mb-7 flex h-[100px] w-[100px] items-center justify-center rounded-[28px] bg-[#1b1b20] shadow-xl ring-1 ring-white/10"
        style={LOGO_COLORS}
      >
        <GlimpseLogo size="xl" />
      </motion.div>

      <span className="relative inline-block">
        <h1
          className="text-[3.5rem] font-bold leading-none tracking-[-0.03em] text-content-primary"
          style={{ fontFamily: '"Satoshi", "Inter", system-ui, sans-serif' }}
        >
          Glimpse
        </h1>
        <motion.svg
          aria-hidden="true"
          viewBox="0 0 300 16"
          preserveAspectRatio="none"
          className="absolute inset-x-0 w-full"
          style={{ bottom: "-0.80em", height: "0.32em", overflow: "visible" }}
        >
          <motion.path
            d="M 4 11 Q 150 5, 296 6"
            fill="none"
            stroke="var(--color-local)"
            strokeWidth={4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.45, ease: [0.4, 0, 0.1, 1] }}
          />
        </motion.svg>
      </span>

      <p className="mt-8 text-[1.2rem] text-content-muted text-pretty">
        {t({
          id: "onboarding.welcome.title",
          message: "Free dictation anywhere",
        })}
      </p>

      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled}
        className={`mt-[13vh] ${PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
      >
        {t({ id: "onboarding.welcome.cta", message: "Get started" })}
      </button>
    </OnboardingStep>
  );
}
