import { invoke } from "@tauri-apps/api/core";

const isMac = navigator.platform?.startsWith("Mac") ?? false;

// On macOS these call through to tauri-plugin-macos-permissions.
/**
 * Check whether the application has accessibility permission on macOS.
 *
 * On non-macOS platforms this always resolves to `true`.
 *
 * @returns `true` if the application has accessibility permission, `false` otherwise.
 */

export async function checkAccessibilityPermission(): Promise<boolean> {
  if (!isMac) return true;
  const { checkAccessibilityPermission: check } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  return check();
}

/**
 * Requests the macOS accessibility permission when running on macOS.
 *
 * On non-macOS platforms this is a no-op.
 */
export async function requestAccessibilityPermission(): Promise<void> {
  if (!isMac) return;
  const { requestAccessibilityPermission: request } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  await request();
}

/**
 * Determines whether the app currently has permission to use the microphone.
 *
 * On macOS this delegates to the macOS permissions plugin; on other platforms it attempts to obtain an audio MediaStream to detect access.
 *
 * @returns `true` if microphone access is available, `false` otherwise.
 */
export async function checkMicrophonePermission(): Promise<boolean> {
  if (!isMac) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  }
  const { checkMicrophonePermission: check } = await import(
    "tauri-plugin-macos-permissions-api"
  );
  return check();
}

/**
 * Opens the system microphone settings UI.
 */
export async function openMicrophoneSettings(): Promise<void> {
  await invoke("open_microphone_settings");
}

/**
 * Open the operating system's Accessibility settings.
 *
 * Attempts to open the system Accessibility (or equivalent) settings pane.
 */
export async function openAccessibilitySettings(): Promise<void> {
  await invoke("open_accessibility_settings");
}
