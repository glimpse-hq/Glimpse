import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch as Loader2 } from "@phosphor-icons/react";

// Press and hold with the pointer, Space, or Enter; it confirms on release
// once the fill completes, and releasing early cancels.
const HoldButton = ({
  onConfirm,
  disabled = false,
  busy = false,
  label,
  busyLabel,
  ariaLabel,
  holdMs,
  className,
  fillClassName,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  busyLabel?: string;
  ariaLabel: string;
  holdMs: number;
  className: string;
  fillClassName: string;
}) => {
  const [progress, setProgress] = useState(0);
  const holdingRef = useRef(false);
  const readyRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancelHold = useCallback(() => {
    holdingRef.current = false;
    readyRef.current = false;
    startTimeRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setProgress(0);
  }, []);

  const stepHold = useCallback(
    (timestamp: number) => {
      if (!holdingRef.current || startTimeRef.current === null) return;

      const elapsed = timestamp - startTimeRef.current;
      const nextProgress = Math.min(1, elapsed / holdMs);
      setProgress(nextProgress);

      if (nextProgress >= 1) {
        readyRef.current = true;
        frameRef.current = null;
        return;
      }

      frameRef.current = requestAnimationFrame(stepHold);
    },
    [holdMs],
  );

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const startHold = () => {
    holdingRef.current = true;
    readyRef.current = false;
    startTimeRef.current = performance.now();
    setProgress(0);
    frameRef.current = requestAnimationFrame(stepHold);
  };

  const finishHold = () => {
    if (!holdingRef.current) return;
    if (readyRef.current) {
      onConfirm();
    }
    cancelHold();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        startHold();
      }}
      onPointerUp={finishHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
        if (holdingRef.current) return;
        event.preventDefault();
        startHold();
      }}
      onKeyUp={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        finishHold();
      }}
      onBlur={cancelHold}
      className={`relative touch-none select-none overflow-hidden ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 origin-left rtl:origin-right ${fillClassName}`}
        style={{ transform: `scaleX(${progress})` }}
      />
      <span className="relative inline-flex items-center gap-1">
        {busy && <Loader2 size={10} className="animate-spin" />}
        <span>{busy && busyLabel ? busyLabel : label}</span>
      </span>
    </button>
  );
};

export default HoldButton;
