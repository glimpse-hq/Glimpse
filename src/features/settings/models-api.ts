import { invoke } from "@tauri-apps/api/core";
import type { CliInstallStatus, LocalApiStatus, ModelInfo, ModelStatus } from "../../types";

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

export async function checkModelStatus(model: string): Promise<ModelStatus> {
  return invoke<ModelStatus>("check_model_status", { model });
}

export async function getLocalApiStatus(): Promise<LocalApiStatus> {
  return invoke<LocalApiStatus>("get_local_api_status");
}

export async function startLocalApi(args: {
  host: string;
  port: number;
  model: string;
  apiKey: string;
  cors: boolean;
}): Promise<LocalApiStatus> {
  return invoke<LocalApiStatus>("start_local_api", { args });
}

export async function stopLocalApi(): Promise<LocalApiStatus> {
  return invoke<LocalApiStatus>("stop_local_api");
}

export async function clearLocalApiLogs(): Promise<LocalApiStatus> {
  return invoke<LocalApiStatus>("clear_local_api_logs");
}

export async function getCliInstallStatus(): Promise<CliInstallStatus> {
  return invoke<CliInstallStatus>("get_cli_install_status");
}

export async function installCli(): Promise<CliInstallStatus> {
  return invoke<CliInstallStatus>("install_cli");
}

export async function removeCli(): Promise<CliInstallStatus> {
  return invoke<CliInstallStatus>("remove_cli");
}
