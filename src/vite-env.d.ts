/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLIMPSE_CUSTOMER_PORTAL?: string;
}

declare module "*.po" {
  import type { Messages } from "@lingui/core";

  export const messages: Messages;
}
