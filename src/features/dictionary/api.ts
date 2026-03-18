import { invoke } from "@tauri-apps/api/core";
import type { Replacement } from "../../types";

export async function setDictionary(dictionary: string[]): Promise<void> {
  await invoke("set_dictionary", { dictionary });
}

export async function getReplacements(): Promise<Replacement[]> {
  return invoke<Replacement[]>("get_replacements");
}

export async function setReplacements(
  replacements: Replacement[],
): Promise<void> {
  await invoke("set_replacements", { replacements });
}
