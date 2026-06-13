import { motion, type Variants, type Easing } from "framer-motion";

export { GlimpseLogo } from "../../../shared/ui/GlimpseLogo";

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
