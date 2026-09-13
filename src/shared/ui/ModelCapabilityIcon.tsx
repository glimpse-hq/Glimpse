import { msg } from "@lingui/core/macro";
import { i18n } from "../../i18n";
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

const CAPABILITY_COPY = {
  [MODEL_CAPABILITY_DICTIONARY]: {
    label: msg({ id: "model_capability.dictionary", message: "Custom words" }),
    detail: msg({
      id: "model_capability.dictionary_detail",
      message: "Recognizes words from your dictionary.",
    }),
  },
  [MODEL_CAPABILITY_STREAMING]: {
    label: msg({ id: "model_capability.live_text", message: "Live text" }),
    detail: msg({
      id: "model_capability.live_text_detail",
      message: "Text appears in the pill as you speak.",
    }),
  },
  [MODEL_CAPABILITY_TIMESTAMPS]: {
    label: msg({ id: "model_capability.timestamps", message: "Timestamps" }),
    detail: msg({
      id: "model_capability.timestamps_detail",
      message: "Segment times and subtitle export in Library.",
    }),
  },
} as const;

export const capabilityCopy = (capability: ModelCapability) => ({
  label: i18n._(CAPABILITY_COPY[capability].label),
  detail: i18n._(CAPABILITY_COPY[capability].detail),
});

const ModelCapabilityIcon = ({
  capability,
}: {
  capability: ModelCapability;
}) => {
  const copy = capabilityCopy(capability);
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
