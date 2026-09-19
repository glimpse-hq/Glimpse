import { useRef, useState, type PointerEvent } from "react";
import { formatTimestamp } from "./library-utils";
import type { Bookmark } from "../../../types";

// Keeps the thumb inside the row at both ends.
const EDGE_INSET = 7;
const KEY_STEP_SECONDS = 5;

type AudioScrubberProps = {
  duration: number;
  currentTime: number;
  bookmarks: Bookmark[];
  disabled: boolean;
  ariaLabel: string;
  onScrubStart: () => void;
  onScrub: (time: number) => void;
  onScrubEnd: () => void;
  onSeek: (timeMs: number) => void;
};

const AudioScrubber = ({
  duration,
  currentTime,
  bookmarks,
  disabled,
  ariaLabel,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onSeek,
}: AudioScrubberProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const max = duration > 0 ? duration : 1;
  const ratio = Math.min(1, Math.max(0, currentTime / max));

  const ratioAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onScrubStart();
    onScrub(ratioAt(event.clientX) * max);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) onScrub(ratioAt(event.clientX) * max);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    onScrubEnd();
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={formatTimestamp(currentTime * 1000)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (disabled) return;
        const direction =
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        onSeek(
          Math.min(
            max,
            Math.max(0, currentTime + direction * KEY_STEP_SECONDS),
          ) * 1000,
        );
      }}
      className={`group/scrub relative flex h-8 w-full touch-none items-center outline-none ${
        disabled ? "opacity-50" : "cursor-pointer"
      }`}
      style={{ paddingLeft: EDGE_INSET, paddingRight: EDGE_INSET }}
    >
      <div ref={trackRef} className="relative h-full w-full">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-border-secondary)]">
          <div
            className="h-full rounded-full bg-[var(--color-toggle-on)]"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>

        {bookmarks.map((bookmark) => (
          <span
            key={bookmark.id}
            className="pointer-events-none absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-cloud)] ring-1 ring-[var(--color-bg-tertiary)]"
            style={{
              left: `${Math.min(100, (bookmark.at_ms / 1000 / max) * 100)}%`,
            }}
            aria-hidden="true"
          />
        ))}

        <span
          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-toggle-on)] ring-2 ring-[var(--color-bg-tertiary)] transition-[width,height] duration-150 group-focus-visible/scrub:ring-[var(--color-toggle-on-30)] ${
            dragging
              ? "h-3 w-3"
              : "h-2.5 w-2.5 group-hover/scrub:h-3 group-hover/scrub:w-3"
          }`}
          style={{ left: `${ratio * 100}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};

export default AudioScrubber;
