import { invoke } from "@tauri-apps/api/core";
import type { Replacement } from "../../types";

export async function setDictionary(entries: string[]): Promise<string[]> {
  return invoke<string[]>("set_dictionary", { entries });
}

export async function setReplacements(
  replacements: Replacement[],
): Promise<Replacement[]> {
  return invoke<Replacement[]>("set_replacements", { replacements });
}
