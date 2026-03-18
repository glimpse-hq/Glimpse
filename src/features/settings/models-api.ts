import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ModelInfo, ModelStatus } from "../../types";

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

export async function checkModelStatus(model: string): Promise<ModelStatus> {
  return invoke<ModelStatus>("check_model_status", { model });
}

export async function downloadModel(model: string): Promise<void> {
  await invoke("download_model", { model });
}

export async function deleteModel(model: string): Promise<void> {
  await invoke("delete_model", { model });
}

export async function cancelDownload(model: string): Promise<void> {
  await invoke("cancel_download", { model });
}

export async function fetchLlmModels(
  endpoint: string,
  apiKey: string,
): Promise<string[]> {
  return invoke<string[]>("fetch_llm_models", { endpoint, apiKey });
}

export function onDownloadProgress(
  handler: (payload: {
    model: string;
    percent: number;
    downloaded: number;
    total: number;
    file: string;
  }) => void,
): Promise<UnlistenFn> {
  return listen<{
    model: string;
    percent: number;
    downloaded: number;
    total: number;
    file: string;
  }>("download:progress", (e) => handler(e.payload));
}

export function onDownloadComplete(
  handler: (payload: { model: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ model: string }>("download:complete", (e) =>
    handler(e.payload),
  );
}

export function onDownloadError(
  handler: (payload: { model: string; error: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ model: string; error: string }>("download:error", (e) =>
    handler(e.payload),
  );
}
