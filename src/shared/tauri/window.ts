import {
  getCurrentWindow as tauriGetCurrentWindow,
  type Window,
} from "@tauri-apps/api/window";

export function getCurrentWindow(): Window {
  return tauriGetCurrentWindow();
}
