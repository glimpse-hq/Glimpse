import { invoke } from "@tauri-apps/api/core";
import type { Personality } from "../../types";

export async function getPersonalities(): Promise<Personality[]> {
  return invoke<Personality[]>("get_personalities");
}

export async function setPersonalities(
  personalities: Personality[],
): Promise<void> {
  await invoke("set_personalities", { personalities });
}

export async function getInstalledApps(): Promise<
  { name: string; bundle_id: string; icon_base64?: string }[]
> {
  return invoke("get_installed_apps");
}

export async function getWebsiteIcon(
  domain: string,
): Promise<string | null> {
  return invoke<string | null>("get_website_icon", { domain });
}
