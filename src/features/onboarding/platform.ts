import type { TranscriptionMode } from "../../types";

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

export const getOnboardingSteps = (
  mode: TranscriptionMode,
  platform: OnboardingPlatform,
): OnboardingStep[] => {
  const steps: OnboardingStep[] =
    mode === "cloud"
      ? ["welcome", "localSignin", "localModel"]
      : ["welcome", "localModel"];

  if (platform.requiresMicrophonePermission) {
    steps.push("microphone");
  }

  if (platform.requiresAccessibilityPermission) {
    steps.push("accessibility");
  }

  steps.push("ready");
  return steps;
};
