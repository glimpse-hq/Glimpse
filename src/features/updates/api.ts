import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type UpdateStatus = {
  available: boolean;
  version: string | null;
};

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("get_update_status");
}

export async function checkForUpdates(): Promise<void> {
  await invoke("check_for_updates");
}

export async function downloadAndInstallUpdate(): Promise<void> {
  await invoke("download_and_install_update");
}

export async function triggerUpdateCheck(): Promise<void> {
  await invoke("trigger_update_check");
}

export async function clearUpdateState(): Promise<void> {
  await invoke("clear_update_state");
}

export function onUpdateAvailable(
  handler: (version: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("update:available", (e) => handler(e.payload));
}

export function onUpdateCleared(handler: () => void): Promise<UnlistenFn> {
  return listen("update:cleared", () => handler());
}

export function onDownloadProgress(
  handler: (payload: { percent: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ percent: number }>("update:download-progress", (e) =>
    handler(e.payload),
  );
}
