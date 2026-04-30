import {
  detectAppPlatform,
  getPlatformCapabilities,
} from "../../platform/service";
import type { AppPlatformId } from "../../shared/lib/platform";

export type OnboardingPlatformId = AppPlatformId;

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

export const getOnboardingPlatform = (): OnboardingPlatform => {
  const id = detectAppPlatform();
  const capabilities = getPlatformCapabilities();

  return {
    id,
    requiresMicrophonePermission: capabilities.requiresNativeMicrophonePermission,
    requiresAccessibilityPermission: capabilities.requiresAccessibilityPermission,
  };
};
