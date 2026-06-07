import { useEffect, useState } from "react";
import DotMatrix from "./DotMatrix";

const ACTIVITY_PATTERNS = [
  [0, 3],
  [1, 2],
  [0, 1, 2, 3],
  [0, 1],
  [2, 3],
];

const ActivityDots = ({
  color = "var(--color-text-muted)",
  dotSize = 3,
  gap = 2,
  intervalMs = 640,
}: {
  color?: string;
  dotSize?: number;
  gap?: number;
  intervalMs?: number;
}) => {
  const [patternIndex, setPatternIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPatternIndex((current) => (current + 1) % ACTIVITY_PATTERNS.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return (
    <DotMatrix
      rows={2}
      cols={2}
      activeDots={ACTIVITY_PATTERNS[patternIndex]}
      dotSize={dotSize}
      gap={gap}
      color={color}
      snapDots
      aria-hidden="true"
    />
  );
};

export default ActivityDots;
