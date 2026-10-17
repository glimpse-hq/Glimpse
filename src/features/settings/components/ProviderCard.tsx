import ModelRow, { type ModelRowProps } from "./ModelRow";

// Soft enough that the Active marker stays the only selection signal.
const TINTS = {
  cloud: "var(--color-cloud-10)",
  server: "var(--model-wave-glow-soft-whisper)",
  none: "var(--surface-interactive)",
};

type ProviderCardProps = Omit<ModelRowProps, "leading" | "surfaceClassName"> & {
  kind: keyof typeof TINTS;
};

// The server or cloud provider of a section, above its on-device list: a
// normal row on a soft tint of its kind, without a border.
const ProviderCard = ({ kind, ...row }: ProviderCardProps) => (
  <div className="rounded-lg" style={{ background: TINTS[kind] }}>
    <ModelRow {...row} />
  </div>
);

export default ProviderCard;
