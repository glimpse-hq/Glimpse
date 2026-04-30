export type AppPlatformId = "macos" | "windows" | "unsupported";

export type PlatformCapabilities = {
  id: AppPlatformId;
  requiresNativeMicrophonePermission: boolean;
  requiresAccessibilityPermission: boolean;
  requiresInputMonitoringPermission: boolean;
  supportsAutoPauseMedia: boolean;
  usesCustomWindowControls: boolean;
};
