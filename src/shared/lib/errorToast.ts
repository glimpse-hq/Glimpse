import { invoke } from "@tauri-apps/api/core";

// Toasts render in their own window, so other windows go through the backend.
function showToast(toastType: "error" | "warning", message: string) {
  invoke("debug_show_toast", { toastType, message }).catch(() => {});
}

export function showErrorToast(message: string) {
  showToast("error", message);
}

export function showWarningToast(message: string) {
  showToast("warning", message);
}
