import { motion } from "framer-motion";

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  activeButtonClassName?: string;
  inactiveButtonClassName?: string;
  activeIndicatorClassName?: string;
  activeIndicatorLayoutId?: string;
};

const DEFAULT_GROUP_CLASS_NAME =
  "flex items-center bg-[var(--color-bg-secondary)] p-1 rounded-lg border border-[var(--color-border-primary)] relative";
const DEFAULT_BUTTON_CLASS_NAME =
  "relative px-3 py-1 rounded-md ui-text-body-sm-strong capitalize transition-colors duration-200 z-10";
const DEFAULT_ACTIVE_BUTTON_CLASS_NAME = "ui-color-primary";
const DEFAULT_INACTIVE_BUTTON_CLASS_NAME =
  "ui-color-secondary hover:text-[var(--color-text-primary)]";
const DEFAULT_ACTIVE_INDICATOR_CLASS_NAME =
  "absolute inset-0 bg-[var(--color-bg-elevated)] shadow-sm border border-[var(--color-border-primary)] rounded-md z-[-1]";

const SegmentedControl = <T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  buttonClassName,
  activeButtonClassName,
  inactiveButtonClassName,
  activeIndicatorClassName,
  activeIndicatorLayoutId = "segmented-control-active",
}: SegmentedControlProps<T>) => {
  return (
    <div
      className={className ?? DEFAULT_GROUP_CLASS_NAME}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={isActive}
            className={[
              buttonClassName ?? DEFAULT_BUTTON_CLASS_NAME,
              isActive
                ? activeButtonClassName ?? DEFAULT_ACTIVE_BUTTON_CLASS_NAME
                : inactiveButtonClassName ?? DEFAULT_INACTIVE_BUTTON_CLASS_NAME,
            ].join(" ")}
          >
            {isActive && (
              <motion.div
                layoutId={activeIndicatorLayoutId}
                className={
                  activeIndicatorClassName ?? DEFAULT_ACTIVE_INDICATOR_CLASS_NAME
                }
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
