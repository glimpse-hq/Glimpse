import { useLingui } from "@lingui/react/macro";
import { BookOpenText, Clock, Waveform } from "@phosphor-icons/react";
import HoverTip from "./HoverTip";
import {
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
  MODEL_CAPABILITY_TIMESTAMPS,
} from "../lib/modelCapabilities";

export type ModelCapability =
  | typeof MODEL_CAPABILITY_DICTIONARY
  | typeof MODEL_CAPABILITY_STREAMING
  | typeof MODEL_CAPABILITY_TIMESTAMPS;

export const MODEL_CAPABILITY_ORDER: ModelCapability[] = [
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
  MODEL_CAPABILITY_TIMESTAMPS,
];

export const CAPABILITY_ICONS = {
  [MODEL_CAPABILITY_DICTIONARY]: BookOpenText,
  [MODEL_CAPABILITY_STREAMING]: Waveform,
  [MODEL_CAPABILITY_TIMESTAMPS]: Clock,
} as const;

export const capabilityCopy = (
  t: ReturnType<typeof useLingui>["t"],
  capability: ModelCapability,
) => {
  switch (capability) {
    case MODEL_CAPABILITY_DICTIONARY:
      return {
        label: t({
          id: "model_capability.dictionary",
          message: "Custom words",
        }),
        detail: t({
          id: "model_capability.dictionary_detail",
          message: "Recognizes words from your dictionary.",
        }),
      };
    case MODEL_CAPABILITY_STREAMING:
      return {
        label: t({
          id: "model_capability.live_text",
          message: "Live text",
        }),
        detail: t({
          id: "model_capability.live_text_detail",
          message: "Text appears in the pill as you speak.",
        }),
      };
    case MODEL_CAPABILITY_TIMESTAMPS:
      return {
        label: t({
          id: "model_capability.timestamps",
          message: "Timestamps",
        }),
        detail: t({
          id: "model_capability.timestamps_detail",
          message: "Segment times and subtitle export in Library.",
        }),
      };
  }
};

const ModelCapabilityIcon = ({
  capability,
}: {
  capability: ModelCapability;
}) => {
  const { t } = useLingui();
  const copy = capabilityCopy(t, capability);
  const Icon = CAPABILITY_ICONS[capability];

  return (
    <HoverTip
      label={copy.label}
      detail={copy.detail}
      className="-m-1 inline-flex shrink-0 p-1 text-content-muted"
    >
      <Icon size={13} aria-label={copy.label} />
    </HoverTip>
  );
};

export default ModelCapabilityIcon;
