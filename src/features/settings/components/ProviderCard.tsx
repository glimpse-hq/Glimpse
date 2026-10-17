import { useMemo } from "react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import ModelRow, { type ModelRowProps } from "./ModelRow";

const WAVE_ROWS = 7;
const WAVE_COLS = 12;
const WAVE_CENTER = (WAVE_ROWS - 1) / 2;

// A wave seeded by the provider and model, as on the old model cards, so each
// setup keeps its own shape.
const waveDots = (seed: string): number[] => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
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

const TONES = {
  cloud: {
    dots: "var(--model-wave-cloud)",
    glow: "var(--model-wave-glow-soft-cloud)",
  },
  server: {
    dots: "var(--model-wave-whisper)",
    glow: "var(--model-wave-glow-soft-whisper)",
  },
  none: { dots: "var(--color-border-secondary)", glow: "transparent" },
};

type ProviderCardProps = Omit<ModelRowProps, "leading" | "surfaceClassName"> & {
  kind: keyof typeof TONES;
  seed: string;
};

// The server or cloud provider of a section, above its on-device list.
const ProviderCard = ({ kind, seed, ...row }: ProviderCardProps) => {
  const dots = useMemo(() => waveDots(seed), [seed]);
  const tone = TONES[kind];

  return (
    <div
      className="overflow-hidden rounded-xl border border-border-secondary"
      style={{
        background: `radial-gradient(70% 160% at 0% 50%, ${tone.glow}, transparent 70%)`,
      }}
    >
      <ModelRow
        {...row}
        surfaceClassName="py-1"
        leading={
          <DotMatrix
            aria-hidden="true"
            rows={WAVE_ROWS}
            cols={WAVE_COLS}
            activeDots={dots}
            dotSize={2}
            gap={3}
            color={tone.dots}
            className="shrink-0"
          />
        }
      />
    </div>
  );
};

export default ProviderCard;
