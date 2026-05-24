import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const HOLD_DURATION_MS = 2000;

type ActionCardAccent = {
  borderColor: string;
  backgroundColor: string;
};

const ACTION_CARD_BUTTON_ACCENTS = {
  interactive: {
    borderColor: "var(--color-interactive-30)",
    backgroundColor: "var(--color-interactive-10)",
  },
  cloud: {
    borderColor: "var(--color-cloud-30)",
    backgroundColor: "var(--color-cloud-10)",
  },
  local: {
    borderColor: "var(--color-local-30)",
    backgroundColor: "var(--color-local-10)",
  },
  accent: {
    borderColor: "var(--color-accent-30)",
    backgroundColor: "var(--color-accent-10)",
  },
  error: {
    borderColor: "rgba(239, 68, 68, 0.3)",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
} satisfies Record<string, ActionCardAccent>;

type ActionCardAccentPreset = keyof typeof ACTION_CARD_BUTTON_ACCENTS;

type HoldActionCardButtonProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  accentPreset?: ActionCardAccentPreset;
};

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const HoldActionCardButton = ({
  title,
  description,
  icon,
  onConfirm,
  disabled = false,
  accentPreset = "accent",
}: HoldActionCardButtonProps) => {
  const [progress, setProgress] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const holdingRef = useRef(false);
  const readyRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const presetAccent = ACTION_CARD_BUTTON_ACCENTS[accentPreset];
  const actionStyle = {
    "--action-card-border": presetAccent.borderColor,
    "--action-card-background": presetAccent.backgroundColor,
    "--action-card-hover-shadow": "var(--ui-action-card-hover-shadow)",
    "--action-card-rest-shadow": "var(--ui-action-card-rest-shadow)",
  } as CSSProperties;

  const resetVisuals = useCallback(() => {
    const button = buttonRef.current;
    if (button) {
      delete button.dataset.holding;
      delete button.dataset.ready;
    }
    setProgress(0);
  }, []);

  const cancelHold = useCallback(() => {
    holdingRef.current = false;
    readyRef.current = false;
    startTimeRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    resetVisuals();
  }, [resetVisuals]);

  const stepHold = useCallback((timestamp: number) => {
    if (!holdingRef.current || startTimeRef.current === null) return;

    const elapsed = timestamp - startTimeRef.current;
    const nextProgress = Math.min(1, elapsed / HOLD_DURATION_MS);
    setProgress(nextProgress);

    if (nextProgress >= 1) {
      readyRef.current = true;
      if (buttonRef.current) {
        buttonRef.current.dataset.ready = "true";
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    frameRef.current = requestAnimationFrame(stepHold);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.dataset.holding = "true";
    delete event.currentTarget.dataset.ready;
    holdingRef.current = true;
    readyRef.current = false;
    startTimeRef.current = performance.now();
    setProgress(0);
    frameRef.current = requestAnimationFrame(stepHold);
  };

  const handlePointerUp = () => {
    if (!holdingRef.current) return;

    if (readyRef.current) {
      onConfirm();
    }

    cancelHold();
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdingRef.current) return;

    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;

    cancelHold();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={cancelHold}
      style={actionStyle}
      className={joinClasses(
        "group relative w-full overflow-hidden rounded-lg border border-border-primary bg-surface-surface px-3 py-2.5 text-left outline-hidden select-none touch-none [box-shadow:var(--action-card-rest-shadow)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-border-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-primary disabled:hover:bg-surface-surface disabled:hover:[box-shadow:var(--action-card-rest-shadow)]",
        "hover:border-[var(--action-card-border)] hover:bg-[var(--action-card-background)] hover:[box-shadow:var(--action-card-hover-shadow)]",
        "data-[holding=true]:translate-y-[2px] data-[holding=true]:border-[var(--action-card-border)] data-[holding=true]:bg-[var(--action-card-background)] data-[holding=true]:[box-shadow:none]",
        "data-[ready=true]:border-[var(--color-accent-50)]",
      )}
    >
      <span className="relative z-[1] flex items-center gap-2.5">
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center ui-color-primary"
          >
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="ui-text-label-strong ui-color-primary block">
            {title}
          </span>
          {description ? (
            <span className="ui-text-micro ui-color-disabled block">
              {description}
            </span>
          ) : null}
        </span>
      </span>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-4 overflow-hidden opacity-0 transition-opacity duration-200 group-data-[holding=true]:opacity-100"
      >
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--color-accent-20)]" />

        {progress > 0 ? (
          <>
            <span
              className="absolute bottom-[2px] left-0 h-2 bg-gradient-to-t from-[var(--color-accent)]/16 to-transparent"
              style={{
                width: `${progress * 100}%`,
                WebkitMaskImage:
                  "linear-gradient(to right, black 0%, black calc(100% - 8px), transparent 100%)",
                maskImage:
                  "linear-gradient(to right, black 0%, black calc(100% - 8px), transparent 100%)",
              }}
            />
            <span
              className="absolute bottom-0 left-0 h-[2px]"
              style={{
                width: `${progress * 100}%`,
                background:
                  "linear-gradient(to right, var(--color-accent-dark), var(--color-accent))",
                WebkitMaskImage:
                  "linear-gradient(to right, black 0%, black calc(100% - 8px), transparent 100%)",
                maskImage:
                  "linear-gradient(to right, black 0%, black calc(100% - 8px), transparent 100%)",
              }}
            />
          </>
        ) : null}
      </span>
    </button>
  );
};

export default HoldActionCardButton;
