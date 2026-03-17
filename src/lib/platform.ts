function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform ?? navigator.platform ?? "";
}

const platform = detectPlatform();

export const isMacPlatform = platform.startsWith("Mac") || platform === "macOS";
export const isWindowsPlatform = platform.startsWith("Win") || platform === "Windows";
