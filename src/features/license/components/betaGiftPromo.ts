// TODO: REMOVE after next update — entire file is temporary beta gift promo (toast + chip).
import { invoke } from "@tauri-apps/api/core";
import { getLicenseState, type LicenseStatus } from "../api";

// TODO: REMOVE after next update — hardcoded beta thank-you discount code.
export const BETA_DISCOUNT_CODE = "THANKYOU";

// TODO: REMOVE after next update — beta gift startup toast copy.
export const BETA_GIFT_TOAST_MESSAGE = `Thanks for being an early user. Use code ${BETA_DISCOUNT_CODE} for a free lifetime license.`;

let toastScheduled = false;

// TODO: REMOVE after next update — beta gift visibility gate (unlicensed users only).
export function shouldShowBetaGiftPromo(status: LicenseStatus | undefined): boolean {
  return status !== undefined && status !== "active";
}

// TODO: REMOVE after next update — beta gift startup toast trigger.
export async function showBetaGiftToastOnAppStart(): Promise<void> {
  if (toastScheduled) return;
  toastScheduled = true;

  try {
    const license = await getLicenseState();
    if (!shouldShowBetaGiftPromo(license.status)) return;

    await invoke("debug_show_toast", {
      toastType: "celebration",
      message: BETA_GIFT_TOAST_MESSAGE,
      action: "open_beta_gift_checkout", // TODO: REMOVE after next update — beta gift toast action id.
      actionLabel: "Get license",
    });
  } catch (err) {
    toastScheduled = false;
    console.error("Failed to show beta gift toast:", err);
  }
}
