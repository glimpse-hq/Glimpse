import { invoke } from "@tauri-apps/api/core";
import type { Personality } from "../../types";
import type {
  InstalledApp,
  WebsiteIcon,
} from "./components/personalization-utils";

export function getPersonalities() {
  return invoke<Personality[]>("get_personalities");
}

export function setPersonalities(personalities: Personality[]) {
  return invoke<Personality[]>("set_personalities", { personalities });
}

export function listInstalledApps() {
  return invoke<InstalledApp[]>("list_installed_apps");
}

export function listWebsiteIcons(sites: string[]) {
  return invoke<WebsiteIcon[]>("list_website_icons", { sites });
}
