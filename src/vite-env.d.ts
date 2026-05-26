/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLIMPSE_PERSONAL_CHECKOUT_URL?: string;
  readonly VITE_GLIMPSE_COMMERCIAL_CHECKOUT_URL?: string;
  // TODO: REMOVE after next update — beta gift founder checkout env var.
  readonly VITE_GLIMPSE_FOUNDER_CHECKOUT_URL?: string;
  readonly VITE_GLIMPSE_CUSTOMER_PORTAL?: string;
}

declare module "*.po" {
    import type { Messages } from "@lingui/core";

    export const messages: Messages;
}
