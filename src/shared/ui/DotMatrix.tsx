import React, { useMemo } from "react";
import { motion } from "framer-motion";

interface DotMatrixProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
  cols?: number;
  activeDots?: number[];
  className?: string;
  dotSize?: number;
  gap?: number;
  color?: string;
  animated?: boolean;
  morphOnActive?: boolean;
  activeScale?: number;
  snapDots?: boolean;
}

const DotMatrix: React.FC<DotMatrixProps> = ({
  rows = 5,
  cols = 20,
  activeDots = [],
  className = "",
  dotSize = 2,
  gap = 4,
  color = "currentColor",
  animated = false,
  morphOnActive = false,
  activeScale = 1,
  snapDots = false,
  ...rest
}) => {
  const dots = useMemo(() => {
    const total = rows * cols;
    const dotTransition = snapDots
      ? "none"
      : "border-radius 0.4s ease-out, opacity 0.3s ease-out, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    return Array.from({ length: total }).map((_, i) => {
      const isActive = activeDots.includes(i);
      const DotComponent = animated ? motion.div : "div";

      const isMorphed = isActive && morphOnActive;
      const borderRadius = isMorphed ? `${dotSize * 0.25}px` : "50%";
      const scale = isActive ? activeScale : 1;

      return (
        <DotComponent
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            backgroundColor: color,
            opacity: isActive ? 1 : 0.15,
            borderRadius: borderRadius,
            transform: `scale(${scale})`,
            transition: dotTransition,
          }}
          {...(animated && isActive && !morphOnActive
            ? {
                initial: { scale: 0.8, opacity: 0 },
                animate: { scale: 1, opacity: 1 },
                transition: { delay: i * 0.002, duration: 0.2 },
              }
            : {})}
        />
      );
    });
  }, [
    rows,
    cols,
    activeDots,
    dotSize,
    color,
    animated,
    morphOnActive,
    activeScale,
    snapDots,
  ]);

  return (
    <div
      className={`grid place-items-center ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
        gap: gap,
        width: "fit-content",
      }}
      {...rest}
    >
      {dots}
    </div>
  );
};

export default React.memo(DotMatrix);
