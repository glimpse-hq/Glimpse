export type OnboardingPlatformId = "macos" | "windows" | "unsupported";

export type OnboardingStep =
  | "welcome"
  | "localModel"
  | "localSignin"
  | "microphone"
  | "accessibility"
  | "ready";

export type OnboardingPlatform = {
  id: OnboardingPlatformId;
  requiresMicrophonePermission: boolean;
  requiresAccessibilityPermission: boolean;
};

const detectPlatformId = (): OnboardingPlatformId => {
  if (typeof navigator === "undefined") return "unsupported";

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = `${userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  return "unsupported";
};

export const getOnboardingPlatform = (): OnboardingPlatform => {
  const id = detectPlatformId();

  return {
    id,
    requiresMicrophonePermission: id === "macos" || id === "windows",
    requiresAccessibilityPermission: id === "macos",
  };
};
