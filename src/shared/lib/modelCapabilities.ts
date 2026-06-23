import type { ModelInfo } from "../../types";

export const MODEL_CAPABILITY_DICTIONARY = "dictionary";
export const MODEL_CAPABILITY_TIMESTAMPS = "timestamps";
export const MODEL_CAPABILITY_STREAMING = "streaming";
export const MODEL_CAPABILITY_DIARIZATION = "diarization";

export const hasModelCapability = (
  model: Pick<ModelInfo, "capabilities"> | null | undefined,
  capability: string,
) =>
  model?.capabilities?.some(
    (entry) => entry.toLowerCase() === capability.toLowerCase(),
  ) ?? false;
