import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { StoredSettings, AppInfo, DeviceInfo } from "../../types";

export async function getSettings(): Promise<StoredSettings> {
  return invoke<StoredSettings>("get_settings");
}

export async function updateSettings(
  args: Record<string, unknown>,
): Promise<void> {
  await invoke("update_settings", { args });
}

export async function setUserName(name: string): Promise<void> {
  await invoke("set_user_name", { name });
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function listInputDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("list_input_devices");
}

export async function openDataDir(): Promise<void> {
  await invoke("open_data_dir");
}

export async function openAccessibilitySettings(): Promise<void> {
  await invoke("open_accessibility_settings");
}

export async function openMicrophoneSettings(): Promise<void> {
  await invoke("open_microphone_settings");
}

export async function setShortcutCaptureActive(active: boolean): Promise<void> {
  await invoke("set_shortcut_capture_active", { active });
}

export async function openLlmCleanupSettings(): Promise<void> {
  await invoke("open_llm_cleanup_settings");
}

export async function openFfmpegInstall(): Promise<void> {
  await invoke("open_ffmpeg_install");
}

export function onSettingsChanged(
  handler: (settings: StoredSettings) => void,
): Promise<UnlistenFn> {
  return listen<StoredSettings>("settings:changed", (e) =>
    handler(e.payload),
  );
}

export function onTextSizeChanged(
  handler: (payload: { mode?: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ mode?: string }>("ui:text_size_changed", (e) =>
    handler(e.payload),
  );
}
