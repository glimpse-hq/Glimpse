import { Check } from "@phosphor-icons/react";

type CheckboxTone = "cloud" | "local";

const CHECKED_CLASS: Record<CheckboxTone, string> = {
  cloud: "border-cloud bg-cloud-10 ui-color-cloud",
  local: "border-local bg-local-15 text-local",
};

export const CheckboxMark = ({
  checked,
  tone = "local",
}: {
  checked: boolean;
  tone?: CheckboxTone;
}) => (
  <span
    aria-hidden="true"
    className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors ${
      checked ? CHECKED_CLASS[tone] : "border-border-secondary text-transparent"
    }`}
  >
    {checked && <Check size={9} weight="bold" />}
  </span>
);

const Checkbox = ({
  checked,
  onChange,
  ariaLabel,
  tone = "local",
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  tone?: CheckboxTone;
  disabled?: boolean;
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onChange}
    className="ui-button-ghost h-6 w-6 disabled:pointer-events-none disabled:opacity-40"
  >
    <CheckboxMark checked={checked} tone={tone} />
  </button>
);

export default Checkbox;
