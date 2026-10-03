import { invoke } from "@tauri-apps/api/core";

// Toasts render in their own window, so other windows go through the backend.
export function showErrorToast(message: string) {
  invoke("debug_show_toast", { toastType: "error", message }).catch(() => {});
}
