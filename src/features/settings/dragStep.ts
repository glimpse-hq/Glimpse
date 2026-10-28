import type React from "react";

const PIXELS_PER_STEP = 15;

// Steps through `count` options while the pointer drags sideways.
export function startDragStep(
  event: React.MouseEvent | React.TouchEvent,
  startIndex: number,
  count: number,
  onStep: (index: number) => void,
) {
  event.preventDefault();
  const startX = "touches" in event ? event.touches[0].clientX : event.clientX;
  let lastIndex = startIndex;
  const handleMove = (e: MouseEvent | TouchEvent) => {
    const currentX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const steps = Math.round((currentX - startX) / PIXELS_PER_STEP);
    const nextIndex = Math.min(count - 1, Math.max(0, startIndex + steps));
    if (nextIndex !== lastIndex) {
      lastIndex = nextIndex;
      onStep(nextIndex);
    }
  };
  const handleEnd = () => {
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleEnd);
    window.removeEventListener("touchmove", handleMove);
    window.removeEventListener("touchend", handleEnd);
  };
  window.addEventListener("mousemove", handleMove);
  window.addEventListener("mouseup", handleEnd);
  window.addEventListener("touchmove", handleMove, { passive: false });
  window.addEventListener("touchend", handleEnd);
}
