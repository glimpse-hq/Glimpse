import { i18n } from "../../i18n";
import { detectAppPlatform } from "../../platform/service";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

// Counts like the system file manager: Finder uses 1000, Explorer 1024.
const BYTES_PER_UNIT = detectAppPlatform() === "macos" ? 1000 : 1024;

// Uses the active locale's decimal separator: "1,5 MB" in de, "1.5 MB" in en.
export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = BYTES_PER_UNIT;
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / Math.pow(k, index);
  return `${i18n.number(value, { maximumFractionDigits: 1 })} ${BYTE_UNITS[index]}`;
};
