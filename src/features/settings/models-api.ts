import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo, ModelStatus } from "../../types";

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

export async function checkModelStatus(model: string): Promise<ModelStatus> {
  return invoke<ModelStatus>("check_model_status", { model });
}
