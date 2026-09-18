import { useLingui } from "@lingui/react/macro";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GlimpseLogo, OnboardingStep, type StepMotionProps } from "./shared";

const INTRO_MS = 1600;

interface WelcomeStepProps {
  stepMotionProps: StepMotionProps;
  hasStepTransitioned: boolean;
  onStart: () => void;
  startDisabled?: boolean;
}

const LOGO_TILE_STYLE = {
  "--color-cloud": "#fbbf24",
  "--color-local": "#a5b3fe",
  boxShadow:
    "0 18px 40px -16px rgba(0, 0, 0, 0.55), 0 0 48px -8px rgba(165, 179, 254, 0.18)",
} as CSSProperties;

export function WelcomeStep({
  stepMotionProps,
  hasStepTransitioned,
  onStart,
  startDisabled = false,
}: WelcomeStepProps) {
  const { t } = useLingui();
  const reduceMotion = useReducedMotion();
  const [introDone, setIntroDone] = useState(Boolean(reduceMotion));
  const startedRef = useRef(false);
  const leaving = introDone && !startDisabled;

  useEffect(() => {
    if (introDone) return;
    const skip = () => setIntroDone(true);
    const timer = window.setTimeout(skip, INTRO_MS);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [introDone]);

  const start = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStart();
  };

  useEffect(() => {
    if (leaving && reduceMotion) start();
  });

  return (
    <OnboardingStep
      stepKey="welcome"
      motionProps={stepMotionProps}
      initial={hasStepTransitioned ? "enter" : false}
      align="center"
    >
      <motion.div
        className="flex flex-col items-center will-change-transform"
        animate={
          leaving && !reduceMotion
            ? { scale: 1.2, opacity: 0, filter: "blur(10px)" }
            : { scale: 1, opacity: 1, filter: "blur(0px)" }
        }
        transition={{ duration: 0.45, ease: [0.4, 0, 1, 1] }}
        onAnimationComplete={() => {
          if (leaving) start();
        }}
      >
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="mb-7 flex h-[100px] w-[100px] items-center justify-center rounded-[28px] bg-[#1b1b20] ring-1 ring-white/10"
          style={LOGO_TILE_STYLE}
        >
          <GlimpseLogo size="xl" />
        </motion.div>

        <h1 className="relative inline-block text-[3.5rem] font-bold leading-none tracking-[-0.035em] text-content-primary">
          Glimpse
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute left-[1%] w-[97%]"
            style={{ bottom: "-0.18em", height: "0.25em" }}
            initial={reduceMotion ? false : { clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ delay: 0.5, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <svg
              viewBox="0 0 300 20"
              preserveAspectRatio="none"
              className="block h-full w-full"
              style={{ overflow: "visible" }}
            >
              <path
                d="M 2 14 Q 150 8, 298 10"
                fill="none"
                stroke="var(--color-local)"
                strokeWidth={5.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </motion.span>
        </h1>

        <p className="mt-8 text-[1.2rem] text-content-muted text-pretty">
          {t({
            id: "onboarding.welcome.title",
            message: "Free dictation anywhere",
          })}
        </p>
      </motion.div>
    </OnboardingStep>
  );
}
