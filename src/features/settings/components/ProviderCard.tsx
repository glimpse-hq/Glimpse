import { useMemo } from "react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import ModelRow, { type ModelRowProps } from "./ModelRow";

const WAVE_ROWS = 5;
const WAVE_COLS = 5;
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
  cloud: "var(--model-wave-cloud)",
  server: "var(--model-wave-whisper)",
  none: "var(--color-border-secondary)",
};

type ProviderCardProps = Omit<ModelRowProps, "leading" | "surfaceClassName"> & {
  kind: keyof typeof TONES;
  seed: string;
};

// The server or cloud provider of a section, above its on-device list: a
// normal row in a hairline border, marked with a small model wave.
const ProviderCard = ({ kind, seed, ...row }: ProviderCardProps) => {
  const dots = useMemo(() => waveDots(seed), [seed]);

  return (
    <div className="rounded-lg border border-border-primary">
      <ModelRow
        {...row}
        leading={
          <DotMatrix
            aria-hidden="true"
            rows={WAVE_ROWS}
            cols={WAVE_COLS}
            activeDots={dots}
            dotSize={2}
            gap={2}
            color={TONES[kind]}
            className="shrink-0"
          />
        }
      />
    </div>
  );
};

export default ProviderCard;
