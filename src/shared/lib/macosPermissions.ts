import { detectAppPlatform } from "../../platform/service";

const isMacRuntime = () => detectAppPlatform() === "macos";

const loadMacosPermissions = () => import("tauri-plugin-macos-permissions-api");

export const checkMacAccessibilityPermission = async () => {
  if (!isMacRuntime()) return true;
  const permissions = await loadMacosPermissions();
  return permissions.checkAccessibilityPermission();
};

export const requestMacAccessibilityPermission = async () => {
  if (!isMacRuntime()) return true;
  const permissions = await loadMacosPermissions();
  return permissions.requestAccessibilityPermission();
};

export const checkMacInputMonitoringPermission = async () => {
  if (!isMacRuntime()) return true;
  const permissions = await loadMacosPermissions();
  return permissions.checkInputMonitoringPermission();
};

export const requestMacInputMonitoringPermission = async () => {
  if (!isMacRuntime()) return true;
  const permissions = await loadMacosPermissions();
  return permissions.requestInputMonitoringPermission();
};
