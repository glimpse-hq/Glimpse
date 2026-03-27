import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ZodType } from "zod";

export type { UnlistenFn };

export async function typedListen<T>(
  event: string,
  handler: (payload: T) => void,
  schema?: ZodType<T>,
): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => {
    if (schema) {
      handler(schema.parse(e.payload));
    } else {
      handler(e.payload);
    }
  });
}
