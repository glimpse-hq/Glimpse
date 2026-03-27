import { invoke } from "@tauri-apps/api/core";

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
