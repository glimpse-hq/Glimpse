import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ToastPayload } from "../../types";

export async function toastDismissed(): Promise<void> {
  await invoke("toast_dismissed");
}

export async function debugShowToast(args: {
  toastType: string;
  message: string;
  action?: string;
  actionLabel?: string;
}): Promise<void> {
  await invoke("debug_show_toast", args);
}

export function onToastShow(
  handler: (payload: ToastPayload) => void,
): Promise<UnlistenFn> {
  return listen<ToastPayload>("toast:show", (e) => handler(e.payload));
}

export function onToastHide(handler: () => void): Promise<UnlistenFn> {
  return listen("toast:hide", () => handler());
}
