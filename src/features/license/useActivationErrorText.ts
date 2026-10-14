import { useLingui } from "@lingui/react/macro";
import type { ActivationError } from "./api";
import { classifyActivationInput } from "./licenseKeyShape";

// Explains a failed activation from the server's reason and the shape of what
// was pasted. Unknown reasons fall back to the server's own message.
export function useActivationErrorText(
  error: ActivationError | null,
  attemptedKey: string,
): string | null {
  const { t } = useLingui();
  if (!error) return null;

  const shape = classifyActivationInput(attemptedKey);
  if (shape === "discount_code") {
    return t({
      id: "license.activate.error.discount_code",
      message: "That looks like a discount code. Use it at checkout instead.",
    });
  }

  switch (error.reason) {
    case "not_found":
      if (shape === "order_id") {
        return t({
          id: "settings.account.activate.order_id_error_generic",
          message:
            "That is your order number. Paste the license key from the same email.",
        });
      }
      if (shape === "masked_key") {
        return t({
          id: "settings.account.activate.masked_key_error_generic",
          message:
            "That is the shortened key. Copy the full one from your receipt email.",
        });
      }
      if (shape === "key") {
        return t({
          id: "license.activate.error.not_found_key",
          message:
            "That license key wasn't found. Check it against your receipt email.",
        });
      }
      return t({
        id: "license.activate.error.not_a_key",
        message:
          "That doesn't look like a license key. Copy the key from your receipt email, or paste the whole email.",
      });
    case "network":
    case "bad_response":
      return t({
        id: "license.activate.error.network",
        message:
          "Glimpse couldn't reach the license server. Check your connection or VPN, then try again.",
      });
    case "device_limit":
      return t({
        id: "license.activate.error.device_limit",
        message:
          "This key is active on as many devices as it allows. Deactivate it on another device first.",
      });
    case "revoked":
    case "expired":
      return t({
        id: "license.activate.error.inactive",
        message: "This license is no longer active.",
      });
    default:
      return error.message;
  }
}
