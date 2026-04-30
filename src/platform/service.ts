import type {
  AppPlatformId,
  PlatformCapabilities,
} from "../shared/lib/platform";

export const detectAppPlatform = (): AppPlatformId => {
  if (typeof navigator === "undefined") return "unsupported";

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform =
    `${userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;

  if (/mac/i.test(platform)) return "macos";
  if (/^win/i.test(platform)) return "windows";
  return "unsupported";
};

export const getPlatformCapabilities = (): PlatformCapabilities => {
  const id = detectAppPlatform();

  return {
    id,
    requiresNativeMicrophonePermission: id === "macos",
    requiresAccessibilityPermission: id === "macos",
    requiresInputMonitoringPermission: id === "macos",
    supportsAutoPauseMedia: id === "macos" || id === "windows",
    usesCustomWindowControls: id === "windows",
  };
};
