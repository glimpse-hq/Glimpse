import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo } from "../../types";

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}
