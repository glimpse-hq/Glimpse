import { invoke } from "@tauri-apps/api/core";
import type {
  DetectedApp,
  ImportPreview,
  ImportResult,
  ImportSelections,
} from "../../types";

export function detectImportableApps() {
  return invoke<DetectedApp[]>("detect_importable_apps");
}

export function previewImport(id: string) {
  return invoke<ImportPreview>("preview_import", { id });
}

export function applyImport(id: string, selections: ImportSelections) {
  return invoke<ImportResult>("apply_import", { id, selections });
}
