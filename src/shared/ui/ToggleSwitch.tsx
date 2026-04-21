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
    track: "w-7 h-4",
    thumb: "left-[2px] top-[2px] w-3 h-3",
    travelX: 12,
  },
  md: {
    track: "w-10 h-5",
    thumb: "left-[2px] top-0.5 w-4 h-4",
    travelX: 20,
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

  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${config.track} rounded-full transition-colors relative overflow-hidden ${
        enabled ? "bg-[var(--color-toggle-on)]" : "bg-[var(--color-border-secondary)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <motion.div
        className={`absolute ${config.thumb} rounded-full bg-white shadow-xs`}
        initial={false}
        animate={{ x: enabled ? config.travelX : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
};

export default ToggleSwitch;
