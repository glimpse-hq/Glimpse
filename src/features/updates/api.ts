import { invoke } from "@tauri-apps/api/core";

export type UpdateStatus = {
  available: boolean;
  version: string | null;
};

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("get_update_status");
}
