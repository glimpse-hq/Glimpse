import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { motion, type Variants, type Easing } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";

export const GlimpseLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const sizes = {
    sm: { dot: 5, gap: 4 },
    md: { dot: 10, gap: 7 },
    lg: { dot: 14, gap: 10 },
  }[size];

  const dotColors = [
    "var(--color-cloud)",
    "var(--color-local)",
    "var(--color-local)",
    "var(--color-cloud)",
  ];

  const gridSize = sizes.dot * 2 + sizes.gap;
  const dotAnimations = [
    { opacity: [1, 0.15, 1], scale: [1, 0.85, 1] },
    { opacity: [0.15, 1, 1], scale: [0.85, 1, 1] },
    { opacity: [0.15, 1, 1], scale: [0.85, 1, 1] },
    { opacity: [1, 0.15, 1], scale: [1, 0.85, 1] },
  ];

  return (
    <div className="relative" style={{ width: gridSize, height: gridSize }}>
      {[0, 1, 2, 3].map((i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;

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
            animate={dotAnimations[i]}
            transition={{
              duration: 2.1,
              ease: "easeOut",
              repeat: Infinity,
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
      className={status === "downloading" ? "opacity-90" : "opacity-70"}
      morphOnActive={true}
      activeScale={1.0}
    />
  );
};

type ApplePermissionIconProps = {
  size?: number;
  className?: string;
};

export const AppleAccessibilityIcon = ({
  size = 32,
  className,
}: ApplePermissionIconProps) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    fill="none"
  >
    <path
      d="M12 5.6a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z"
      fill="currentColor"
    />
    <path
      d="M4.35 7.2a.9.9 0 0 1 1.02-.75 42.5 42.5 0 0 0 13.26 0 .9.9 0 1 1 .27 1.78c-1.9.29-3.9.47-5.9.52v3.12l3.1 7.52a.9.9 0 1 1-1.67.68L12 14.16l-2.43 5.91a.9.9 0 0 1-1.67-.68l3.1-7.52V8.75a44.34 44.34 0 0 1-5.9-.52.9.9 0 0 1-.75-1.03Z"
      fill="currentColor"
    />
  </svg>
);

export type StepMotionProps = {
  custom: 1 | -1;
  variants: Variants;
  animate: string;
  exit: string;
  transition: { duration: number; ease: Easing };
};
