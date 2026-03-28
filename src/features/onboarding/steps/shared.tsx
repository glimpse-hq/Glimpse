import { useLingui } from "@lingui/react/macro";
import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";

export const GlimpseLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const [pattern, setPattern] = useState(0);
  const intervalRef = useRef<number | null>(null);

  const sizes = {
    sm: { dot: 5, gap: 4 },
    md: { dot: 10, gap: 7 },
    lg: { dot: 14, gap: 10 },
  }[size];

  const patterns = [
    [true, false, false, true],
    [false, true, true, false],
    [true, true, true, true],
  ];

  const dotColors = [
    "var(--color-cloud)",
    "var(--color-local)",
    "var(--color-local)",
    "var(--color-cloud)",
  ];

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setPattern((p) => (p + 1) % patterns.length);
    }, 700);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const currentPattern = patterns[pattern];
  const gridSize = sizes.dot * 2 + sizes.gap;

  return (
    <div className="relative" style={{ width: gridSize, height: gridSize }}>
      {[0, 1, 2, 3].map((i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const isActive = currentPattern[i];

        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: sizes.dot,
              height: sizes.dot,
              left: col * (sizes.dot + sizes.gap),
              top: row * (sizes.dot + sizes.gap),
              backgroundColor: dotColors[i],
            }}
            animate={{
              opacity: isActive ? 1 : 0.15,
              scale: isActive ? 1 : 0.85,
            }}
            transition={{
              duration: 0.3,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
};

export const StepIndicator = ({
  currentStep,
  total,
}: {
  currentStep: number;
  total: number;
}) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: total }).map((_, i) => (
      <motion.div
        key={i}
        className="h-1.5 rounded-full bg-amber-400"
        animate={{
          width: i === currentStep ? 20 : 6,
          opacity: i <= currentStep ? 1 : 0.25,
        }}
        transition={{ duration: 0.25 }}
      />
    ))}
  </div>
);

export const StatusBadge = ({
  granted,
  checking,
}: {
  granted: boolean;
  checking?: boolean;
}) => {
  const { t } = useLingui();

  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 ui-text-label text-content-muted">
        <Loader2 size={11} className="animate-spin" />
        {t({
          id: "onboarding.status.checking",
          message: "Checking...",
        })}
      </span>
    );
  }

  if (granted) {
    return (
      <motion.span
        className="inline-flex items-center gap-1 ui-text-label font-medium ui-color-success-strong"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <Check size={12} />
        {t({
          id: "onboarding.status.enabled",
          message: "Enabled",
        })}
      </motion.span>
    );
  }

  return (
    <span className="ui-text-label text-content-muted">
      {t({
        id: "onboarding.status.not_enabled",
        message: "Not enabled",
      })}
    </span>
  );
};

export const ModelProgress = ({
  percent,
  status,
}: {
  percent: number;
  status: string;
}) => {
  const cols = 50;
  const rows = 3;
  const totalDots = cols * rows;
  const activeCount = Math.round((percent / 100) * totalDots);

  const activeDots = useMemo(() => {
    const dots: number[] = [];
    for (let i = 0; i < activeCount && i < totalDots; i++) {
      dots.push(i);
    }
    return dots;
  }, [activeCount, totalDots]);

  const color =
    status === "error"
      ? "var(--color-error)"
      : status === "complete"
        ? "var(--color-success)"
        : "var(--color-cloud)";

  return (
    <DotMatrix
      rows={rows}
      cols={cols}
      activeDots={activeDots}
      dotSize={3}
      gap={2}
      color={color}
      className="opacity-70"
    />
  );
};

import type { Variants, Easing } from "framer-motion";

export type StepMotionProps = {
  custom: 1 | -1;
  variants: Variants;
  animate: string;
  exit: string;
  transition: { duration: number; ease: Easing };
};
