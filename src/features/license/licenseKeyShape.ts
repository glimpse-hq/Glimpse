// Polar keys are a brand prefix plus a UUID: GLIMPSE_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LICENSE_KEY = new RegExp(`[a-z]+_${UUID}`, "i");
const BARE_UUID = new RegExp(`^${UUID}$`, "i");

export type ActivationInputShape =
  | "key"
  | "order_id"
  | "masked_key"
  | "discount_code"
  | "unknown";

// The backend pulls the key out of whatever was pasted, so this only has to
// explain a failure in terms of what the text looks like.
export function classifyActivationInput(value: string): ActivationInputShape {
  const trimmed = value.trim();
  if (LICENSE_KEY.test(trimmed)) return "key";
  if (BARE_UUID.test(trimmed)) return "order_id";
  if (trimmed.includes("*")) return "masked_key";
  if (looksLikeDiscountCode(trimmed)) return "discount_code";
  return "unknown";
}

// One short uppercase token like LAUNCH20 or SAVE-10, never a sentence.
export function looksLikeDiscountCode(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[A-Z0-9_-]{3,24}$/.test(trimmed)) return false;
  return trimmed.split("-").length - 1 < 2;
}
