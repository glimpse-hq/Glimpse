import { invoke } from "@tauri-apps/api/core";

const isMac = /Mac|iPhone|iPad|iPod/i.test(
  typeof navigator !== "undefined" ? navigator.platform || "" : "",
);

// On macOS these call through to tauri-plugin-macos-permissions.
// On other platforms, accessibility is ungated and mic is assumed available.

export async function checkAccessibilityPermission(): Promise<boolean> {
  if (!isMac) return true;
  const { checkAccessibilityPermission: check } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  return check();
}

export async function requestAccessibilityPermission(): Promise<void> {
  if (!isMac) return;
  const { requestAccessibilityPermission: request } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  await request();
}

export async function checkMicrophonePermission(): Promise<boolean> {
  if (!isMac) return true;
  const { checkMicrophonePermission: check } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  return check();
}

export async function openMicrophoneSettings(): Promise<void> {
  await invoke("open_microphone_settings");
}

export async function openAccessibilitySettings(): Promise<void> {
  await invoke("open_accessibility_settings");
}
