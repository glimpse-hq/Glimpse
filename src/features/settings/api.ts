import { invoke } from "@tauri-apps/api/core";
import {
  checkMacInputMonitoringPermission,
  requestMacAccessibilityPermission,
  requestMacInputMonitoringPermission,
} from "../../shared/lib/macosPermissions";
import type {
  StoredSettings,
  AppInfo,
  DeviceInfo,
  UpdateSettingsResult,
} from "../../types";

// Mirrors `UpdateSettingsArgs` in src-tauri/src/core/settings.rs.
export type UpdateSettingsArgs = {
  smartShortcut: string;
  smartEnabled: boolean;
  holdShortcut: string;
  holdEnabled: boolean;
  toggleShortcut: string;
  toggleEnabled: boolean;
  shortcutBindings: StoredSettings["shortcut_bindings"];
  transcriptionMode: StoredSettings["transcription_mode"];
  localModel: string;
  remoteSpeechEnabled: boolean;
  remoteSpeechProvider: StoredSettings["remote_speech_provider"];
  remoteSpeechEndpoint: string;
  remoteSpeechApiKey: string;
  remoteSpeechModel: string;
  microphoneDevice: string | null;
  language: string;
  appLocale: StoredSettings["app_locale"];
  themeMode: StoredSettings["theme_mode"];
  llmEnabled: boolean;
  cleanupEnabled: boolean;
  llmProvider: StoredSettings["llm_provider"];
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  llmServiceProvider: string;
  llmAuto: boolean;
  autoDictionaryEnabled: boolean;
  mediaAction: StoredSettings["media_action"];
  autoUpdateEnabled: boolean;
  autoLaunchEnabled: boolean;
  startInBackground: boolean;
  autoDeleteTarget: StoredSettings["auto_delete_target"];
  autoDeleteDuration: StoredSettings["auto_delete_duration"];
  analyticsEnabled: boolean;
  localApiKey: string;
  localApiPort: number;
  localApiModel: string;
  localApiHost: string;
  localApiStartOnLaunch: boolean;
  localApiCors: boolean;
};

export function buildUpdateSettingsArgs(
  settings: StoredSettings,
  overrides: Partial<UpdateSettingsArgs> = {},
): UpdateSettingsArgs {
  return {
    smartShortcut: settings.smart_shortcut,
    smartEnabled: settings.smart_enabled,
    holdShortcut: settings.hold_shortcut,
    holdEnabled: settings.hold_enabled,
    toggleShortcut: settings.toggle_shortcut,
    toggleEnabled: settings.toggle_enabled,
    shortcutBindings: settings.shortcut_bindings,
    transcriptionMode: settings.transcription_mode,
    localModel: settings.local_model,
    remoteSpeechEnabled: settings.remote_speech_enabled,
    remoteSpeechProvider: settings.remote_speech_provider,
    remoteSpeechEndpoint: settings.remote_speech_endpoint,
    remoteSpeechApiKey: settings.remote_speech_api_key,
    remoteSpeechModel: settings.remote_speech_model,
    microphoneDevice: settings.microphone_device,
    language: settings.language,
    appLocale: settings.app_locale,
    themeMode: settings.theme_mode,
    llmEnabled: settings.llm_enabled,
    cleanupEnabled: settings.cleanup_enabled,
    llmProvider: settings.llm_provider,
    llmEndpoint: settings.llm_endpoint,
    llmApiKey: settings.llm_api_key,
    llmModel: settings.llm_model,
    llmServiceProvider: settings.llm_service_provider,
    llmAuto: settings.llm_auto,
    autoDictionaryEnabled: settings.auto_dictionary_enabled,
    mediaAction: settings.media_action,
    autoUpdateEnabled: settings.auto_update_enabled,
    autoLaunchEnabled: settings.auto_launch_enabled,
    startInBackground: settings.start_in_background,
    autoDeleteTarget: settings.auto_delete_target,
    autoDeleteDuration: settings.auto_delete_duration,
    analyticsEnabled: settings.analytics_enabled,
    localApiKey: settings.local_api_key,
    localApiPort: settings.local_api_port,
    localApiModel: settings.local_api_model,
    localApiHost: settings.local_api_host,
    localApiStartOnLaunch: settings.local_api_start_on_launch,
    localApiCors: settings.local_api_cors,
    ...overrides,
  };
}

export async function updateSettings(
  args: UpdateSettingsArgs,
): Promise<UpdateSettingsResult> {
  return invoke<UpdateSettingsResult>("update_settings", { args });
}

export async function getSettings(): Promise<StoredSettings> {
  return invoke<StoredSettings>("get_settings");
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function listInputDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("list_input_devices");
}

export async function checkAccessibilityPermission(): Promise<boolean> {
  return invoke<boolean>("check_accessibility_permission");
}

export async function checkMicrophonePermission(): Promise<boolean> {
  return invoke<boolean>("check_microphone_permission");
}

// The request functions below ask for a permission and open its System
// Settings pane when it isn't granted. They never throw.

export async function requestMicrophonePermission(): Promise<boolean> {
  await invoke("request_microphone_permission").catch(() => {});
  const granted = await checkMicrophonePermission().catch(() => false);
  if (!granted) await invoke("open_microphone_settings").catch(() => {});
  return granted;
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  await requestMacAccessibilityPermission().catch(() => {});
  const granted = await checkAccessibilityPermission().catch(() => false);
  if (!granted) await invoke("open_accessibility_settings").catch(() => {});
  return granted;
}

export async function requestInputMonitoringPermission(): Promise<boolean> {
  await requestMacInputMonitoringPermission().catch(() => {});
  const granted = await checkMacInputMonitoringPermission().catch(() => false);
  if (!granted) await invoke("open_input_monitoring_settings").catch(() => {});
  return granted;
}
