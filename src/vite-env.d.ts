/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLIMPSE_PERSONAL_CHECKOUT_URL?: string;
  readonly VITE_GLIMPSE_COMMERCIAL_CHECKOUT_URL?: string;
}

declare module "*.po" {
    import type { Messages } from "@lingui/core";

    export const messages: Messages;
}
