/**
 * Determine the platform identifier string reported by the browser.
 *
 * Uses `navigator.userAgentData.platform` when available, falls back to `navigator.platform`,
 * and yields an empty string if `navigator` is undefined or no platform information is present.
 *
 * @returns The platform string reported by the browser, or an empty string if unavailable.
 */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform ?? navigator.platform ?? "";
}

const platform = detectPlatform();

export const isMacPlatform = platform.startsWith("Mac") || platform === "macOS";
export const isWindowsPlatform = platform.startsWith("Win") || platform === "Windows";
