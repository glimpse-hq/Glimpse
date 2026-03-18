import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ZodType } from "zod";

export async function typedInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  schema?: ZodType<T>,
): Promise<T> {
  const result = await tauriInvoke<T>(cmd, args);
  if (schema) {
    return schema.parse(result);
  }
  return result;
}
