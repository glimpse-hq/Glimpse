import type { TextSizeMode } from "../../types";
import type { AppPlatformId } from "./platform";

const isTextSizeMode = (value: string | null): value is TextSizeMode =>
  value === "small" || value === "default" || value === "large";

export const parseTextSizeMode = (value: string | null): TextSizeMode =>
  isTextSizeMode(value) ? value : "default";

export const resolveTextScale = (
  mode: TextSizeMode,
  platform: AppPlatformId = "unsupported",
): string => {
  if (platform === "windows") {
    switch (mode) {
      case "small":
        return "1";
      case "large":
        return "1.125";
      default:
        return "1.0625";
    }
  }

  switch (mode) {
    case "small":
      return "0.94";
    case "large":
      return "1.08";
    default:
      return "1";
  }
};
