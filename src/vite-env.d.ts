/// <reference types="vite/client" />

declare module "*.po" {
  import type { Messages } from "@lingui/core";

  export const messages: Messages;
}

interface Window {
  // First-paint values injected by Rust (tray.rs boot_script); settings and live only.
  __GLIMPSE_BOOT__?: {
    theme: import("./types").ThemeMode;
    locale: import("./types").AppLocaleSetting;
    version: string;
    // 0 on Windows.
    osMajor: number;
  };
}
