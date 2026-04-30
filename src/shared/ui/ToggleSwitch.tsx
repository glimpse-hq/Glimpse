import { motion } from "framer-motion";

type ToggleSwitchSize = "sm" | "md";

type ToggleSwitchProps = {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
  size?: ToggleSwitchSize;
};

const sizeConfig = {
  sm: {
    trackWidth: 28,
    trackHeight: 16,
    thumbSize: 12,
    padding: 2,
  },
  md: {
    trackWidth: 40,
    trackHeight: 20,
    thumbSize: 16,
    padding: 2,
  },
} as const;

const ToggleSwitch = ({
  enabled,
  onToggle,
  ariaLabel,
  disabled = false,
  size = "sm",
}: ToggleSwitchProps) => {
  const config = sizeConfig[size];

  const thumbOffset = enabled
    ? config.trackWidth - config.thumbSize - config.padding * 2
    : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`
        relative inline-block shrink-0 align-middle
        rounded-full border-0 p-0
        appearance-none leading-none
        transition-colors duration-150
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        ${enabled ? "bg-[var(--color-toggle-on)]" : "bg-[var(--color-border-secondary)]"}
        ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      `}
      style={{
        width: config.trackWidth,
        minWidth: config.trackWidth,
        height: config.trackHeight,
        minHeight: config.trackHeight,
        boxSizing: "border-box",
      }}
    >
      <motion.span
        className="absolute block rounded-full bg-white shadow-sm"
        initial={false}
        animate={{
          x: thumbOffset,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 35,
          mass: 0.7,
        }}
        style={{
          top: config.padding,
          left: config.padding,
          width: config.thumbSize,
          height: config.thumbSize,
          borderRadius: "9999px",
          backfaceVisibility: "hidden",
        }}
      />
    </button>
  );
};

export default ToggleSwitch;