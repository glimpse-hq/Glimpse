import { invoke } from "@tauri-apps/api/core";
import type { ActionBehavior, ActionsList } from "../../types";

export async function listActions(refresh: boolean): Promise<ActionsList> {
  return invoke<ActionsList>("list_actions", { refresh });
}

export async function setActionEnabled(
  file: string,
  enabled: boolean,
): Promise<void> {
  await invoke("set_action_enabled", { file, enabled });
}

export async function setActionShortcut(
  file: string,
  index: number,
  shortcut: string,
  behavior: ActionBehavior,
): Promise<void> {
  await invoke("set_action_shortcut", { file, index, shortcut, behavior });
}

export async function openActionsFolder(): Promise<void> {
  await invoke("open_actions_folder");
}

export async function createActionFile(name: string): Promise<void> {
  await invoke("create_action_file", { name });
}

export async function revealActionFile(file: string): Promise<void> {
  await invoke("reveal_action_file", { file });
}

export async function trashActionFile(file: string): Promise<void> {
  await invoke("trash_action_file", { file });
}
