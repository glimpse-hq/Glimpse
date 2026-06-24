import type { KeyboardEvent, ReactNode } from "react";
import DotMatrix from "../../../shared/ui/DotMatrix";

export const CARD_WIDTH = 300;
const WAVE_ROWS = 13;
export const WAVE_COLS = 44;
const WAVE_CENTER = (WAVE_ROWS - 1) / 2;

const FEATHER_MASK =
  "radial-gradient(closest-side, #000 0%, #000 52%, transparent 100%)";

const BLUR_LAYERS = [
  { blur: 1, mask: "radial-gradient(closest-side, transparent 50%, #000 92%)" },
  {
    blur: 2.5,
    mask: "radial-gradient(closest-side, transparent 68%, #000 100%)",
  },
  {
    blur: 5,
    mask: "radial-gradient(closest-side, transparent 84%, #000 108%)",
  },
];

export const waveDots = (seedSource: string): number[] => {
  let h = 2166136261;
  for (let i = 0; i < seedSource.length; i++) {
    h ^= seedSource.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const active: number[] = [];
  for (let col = 0; col < WAVE_COLS; col++) {
    h = Math.imul(h ^ (col + 1), 16777619);
    const amp = (h >>> 8) % (WAVE_CENTER + 1);
    for (let d = -amp; d <= amp; d++) {
      active.push((WAVE_CENTER + d) * WAVE_COLS + col);
    }
  }
  return active;
};

type ModelCardShellProps = {
  accent: string;
  glowStrong: string;
  glowSoft: string;
  dots: number[];
  animated?: boolean;
  ariaLabel: string;
  width?: number;
  onClick?: () => void;
  children: ReactNode;
};

const ModelCardShell = ({
  accent,
  glowStrong,
  glowSoft,
  dots,
  animated = false,
  ariaLabel,
  width = CARD_WIDTH,
  onClick,
  children,
}: ModelCardShellProps) => (
  <article
    className={`group relative overflow-hidden bg-surface-surface text-left ${
      onClick
        ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-cloud)]"
        : ""
    }`}
    style={{
      width: `${width}px`,
      borderRadius: "18px",
      border: "1px solid var(--color-border-secondary, rgba(0,0,0,0.08))",
      boxShadow:
        "0 1px 2px rgba(0,0,0,0.05), 0 16px 40px -20px rgba(0,0,0,0.45)",
    }}
    aria-label={ariaLabel}
    {...(onClick
      ? {
          role: "button",
          tabIndex: 0,
          onClick,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          },
        }
      : {})}
  >
    <div
      className="relative flex items-center justify-center overflow-hidden"
      style={{
        height: "92px",
        background: `radial-gradient(120% 140% at 50% -20%, ${glowStrong}, transparent 70%), linear-gradient(180deg, ${glowSoft}, transparent)`,
      }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          WebkitMaskImage: FEATHER_MASK,
          maskImage: FEATHER_MASK,
        }}
      >
        <DotMatrix
          rows={WAVE_ROWS}
          cols={WAVE_COLS}
          activeDots={dots}
          dotSize={3}
          gap={5}
          color={accent}
          animated={animated}
        />
      </div>

      {BLUR_LAYERS.map((layer) => (
        <div
          key={layer.blur}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backdropFilter: `blur(${layer.blur}px)`,
            WebkitBackdropFilter: `blur(${layer.blur}px)`,
            WebkitMaskImage: layer.mask,
            maskImage: layer.mask,
          }}
        />
      ))}
    </div>

    {children}
  </article>
);

export default ModelCardShell;
