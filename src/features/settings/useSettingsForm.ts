import { msg } from "@lingui/core/macro";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkMacAccessibilityPermission,
  checkMacInputMonitoringPermission,
} from "../../shared/lib/macosPermissions";
import { getPlatformCapabilities } from "../../platform/service";
import { getProviderPreset } from "../../shared/lib/llmProviders";
import {
  parseTextSizeMode,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "../../shared/lib/textSize";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
} from "../../shared/lib/modelCapabilities";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import { useLicenseGate } from "../license/queries";
import {
  buildTranscriptionLanguageView,
  getActiveTranscriptionEngine,
  getCatalogTranscriptionEngines,
  getInstalledTranscriptionEngines,
  type TranscriptionEngineId,
} from "../../shared/lib/transcriptionLanguages";
import { useShortcutCapture } from "../../shared/hooks/useShortcutCapture";
import { i18n } from "../../i18n";
import { useAppInfo, useInputDevices, useSettings } from "./queries";
import * as modelsApi from "./models-api";
import { modelKeys, useModelCatalog, useModelStatuses } from "./models-queries";
import type {
  TranscriptionMode,
  TextSizeMode,
  ThemeMode,
  StoredSettings,
  ShortcutBinding,
  ShortcutBindings,
  DownloadEvent,
  LlmProvider,
  RecordingPrunePolicy,
  AutoDeleteTarget,
  AppLocaleSetting,
  CliInstallStatus,
  LocalApiLogEntry,
  LocalApiStatus,
} from "../../types";

type ActiveTab =
  | "general"
  | "models"
  | "providers"
  | "local-api"
  | "about"
  | "account"
  | "app";
type ShortcutMode = "smart" | "hold" | "toggle";
type CaptureTarget = { mode: ShortcutMode; index: number } | null;
type ShortcutTarget = { mode: ShortcutMode; index: number };
type ShortcutOverrides = Partial<
  Record<"smartShortcut" | "holdShortcut" | "toggleShortcut", string>
>;
type SettingsErrorSourceTab = Exclude<ActiveTab, "account">;
type InvalidShortcutDrafts = Partial<Record<ShortcutMode, Record<number, string>>>;
type InvalidShortcutDraft = { target: ShortcutTarget; message: string } | null;

type SaveSettingsOverrides = ShortcutOverrides & {
  localModel?: string;
  shortcutBindings?: ShortcutBindings;
  shortcutDraftTarget?: ShortcutTarget;
};

async function waitForLocalApiStopped(timeoutMs = 2500): Promise<LocalApiStatus> {
  const started = Date.now();
  let latest = await modelsApi.getLocalApiStatus();
  while (latest.running && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    latest = await modelsApi.getLocalApiStatus();
  }
  return latest;
}

const defaultShortcutBindings = (): ShortcutBindings => ({
  smart: [{ shortcut: "Control+Space", temporary: false, cleanup_enabled: false }],
  hold: [{ shortcut: "Control+Shift+Space", temporary: false, cleanup_enabled: false }],
  toggle: [{ shortcut: "Control+Alt+Space", temporary: false, cleanup_enabled: false }],
});

const bindingsFromSettings = (settings: StoredSettings): ShortcutBindings => ({
  smart:
    settings.shortcut_bindings?.smart?.length > 0
      ? settings.shortcut_bindings.smart
      : [
          {
            shortcut: settings.smart_shortcut,
            temporary: false,
            cleanup_enabled: settings.cleanup_enabled ?? false,
          },
        ],
  hold:
    settings.shortcut_bindings?.hold?.length > 0
      ? settings.shortcut_bindings.hold
      : [
          {
            shortcut: settings.hold_shortcut,
            temporary: false,
            cleanup_enabled: settings.cleanup_enabled ?? false,
          },
        ],
  toggle:
    settings.shortcut_bindings?.toggle?.length > 0
      ? settings.shortcut_bindings.toggle
      : [
          {
            shortcut: settings.toggle_shortcut,
            temporary: false,
            cleanup_enabled: settings.cleanup_enabled ?? false,
          },
        ],
});

const withoutShortcutCleanup = (bindings: ShortcutBindings): ShortcutBindings => ({
  smart: bindings.smart.map((binding) => ({ ...binding, cleanup_enabled: false })),
  hold: bindings.hold.map((binding) => ({ ...binding, cleanup_enabled: false })),
  toggle: bindings.toggle.map((binding) => ({ ...binding, cleanup_enabled: false })),
});

const primaryShortcut = (
  bindings: ShortcutBindings,
  mode: ShortcutMode,
  fallback: string,
) => bindings[mode][0]?.shortcut ?? fallback;

const sanitizeInvalidShortcutDraft = (
  bindings: ShortcutBindings,
  invalidDraft: InvalidShortcutDraft,
  persistedBindings: ShortcutBindings,
): ShortcutBindings => {
  if (!invalidDraft) return bindings;

  const { mode, index } = invalidDraft.target;
  const modeBindings = bindings[mode];
  if (!modeBindings[index]) return bindings;

  const persistedBinding = persistedBindings[mode][index];
  if (!persistedBinding && index > 0) {
    return {
      ...bindings,
      [mode]: modeBindings.filter((_, bindingIndex) => bindingIndex !== index),
    };
  }
  if (!persistedBinding) return bindings;

  return {
    ...bindings,
    [mode]: modeBindings.map((binding, bindingIndex) =>
      bindingIndex === index ? persistedBinding : binding,
    ),
  };
};

interface UseSettingsFormOptions {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ActiveTab;
  transcriptionMode: TranscriptionMode;
}

export function useSettingsForm({
  isOpen,
  onClose,
  initialTab = "general",
  transcriptionMode: initialTranscriptionMode,
}: UseSettingsFormOptions) {
  const [smartShortcut, setSmartShortcut] = useState("Control+Space");
  const [smartEnabled, setSmartEnabled] = useState(true);
  const [holdShortcut, setHoldShortcut] = useState("Control+Shift+Space");
  const [holdEnabled, setHoldEnabled] = useState(false);
  const [toggleShortcut, setToggleShortcut] = useState("Control+Alt+Space");
  const [toggleEnabled, setToggleEnabled] = useState(false);
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(
    defaultShortcutBindings,
  );
  const shortcutBindingsRef = useRef<ShortcutBindings>(defaultShortcutBindings());
  const persistedShortcutBindingsRef = useRef<ShortcutBindings>(defaultShortcutBindings());
  const [invalidShortcutDraft, setInvalidShortcutDraftState] =
    useState<InvalidShortcutDraft>(null);
  const invalidShortcutDraftRef = useRef<InvalidShortcutDraft>(null);
  const [transcriptionMode, setTranscriptionModeRaw] =
    useState<TranscriptionMode>(initialTranscriptionMode);
  const [localModel, setLocalModel] = useState("");
  const [microphoneDevice, setMicrophoneDevice] = useState<string | null>(null);
  const [language, setLanguage] = useState("en");
  const [appLocale, setAppLocale] = useState<AppLocaleSetting>("system");
  const [downloadState, setDownloadState] = useState<
    Record<string, DownloadEvent>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [errorSourceTab, setErrorSourceTab] =
    useState<SettingsErrorSourceTab | null>(null);
  const [captureActive, setCaptureActive] = useState<CaptureTarget>(null);
  const [capturePreview, setCapturePreview] = useState<string>("");
  const captureActiveRef = useRef<CaptureTarget>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("general");
  const [llmEnabled, setLlmEnabledRaw] = useState(false);
  const [llmProvider, setLlmProviderRaw] = useState<LlmProvider>("none");
  const [llmEndpoint, setLlmEndpointRaw] = useState("");
  const [llmApiKey, setLlmApiKeyRaw] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [autoDictionaryEnabled, setAutoDictionaryEnabled] = useState(false);
  const [mediaControlEnabled, setMediaControlEnabled] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoDeleteTarget, setAutoDeleteTarget] =
    useState<AutoDeleteTarget>("transcripts");
  const [autoDeleteDuration, setAutoDeleteDuration] =
    useState<RecordingPrunePolicy>("never");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [localApiKey, setLocalApiKey] = useState("");
  const [localApiPort, setLocalApiPort] = useState(11435);
  const [localApiModel, setLocalApiModel] = useState("auto");
  const [localApiHost, setLocalApiHost] = useState("127.0.0.1");
  const [localApiStartOnLaunch, setLocalApiStartOnLaunch] = useState(false);
  const [localApiCors, setLocalApiCors] = useState(false);
  const [localApiStatus, setLocalApiStatus] = useState<LocalApiStatus | null>(null);
  const [localApiBusy, setLocalApiBusy] = useState(false);
  const [cliInstallStatus, setCliInstallStatus] =
    useState<CliInstallStatus | null>(null);
  const [cliInstallBusy, setCliInstallBusy] = useState(false);
  const [textSizeMode, setTextSizeModeRaw] = useState<TextSizeMode>(() =>
    parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
  );
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>("system");
  const [showFAQModal, setShowFAQModal] = useState(false);
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [accessibilityPermission, setAccessibilityPermission] = useState<
    boolean | null
  >(null);
  const [inputMonitoringPermission, setInputMonitoringPermission] = useState<
    boolean | null
  >(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const didHydrateRef = useRef(false);
  const isSavingRef = useRef(false);
  const settingsSaveRef = useRef(Promise.resolve(true));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadResetTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const queryClient = useQueryClient();
  const settingsQuery = useSettings(undefined, isOpen);
  const licenseGateActive = useLicenseGate();
  const appInfoQuery = useAppInfo(isOpen);
  const inputDevicesQuery = useInputDevices(isOpen);
  const modelCatalogQuery = useModelCatalog(isOpen);
  const inputDevices = inputDevicesQuery.data ?? [];
  const modelCatalog = modelCatalogQuery.data ?? [];
  const modelKeysForStatus = useMemo(
    () => modelCatalog.map((model) => model.key),
    [modelCatalog],
  );
  const modelStatusesQuery = useModelStatuses(
    modelKeysForStatus,
    isOpen && modelKeysForStatus.length > 0,
  );
  const modelStatus = modelStatusesQuery.statusByModel;
  const appInfo = appInfoQuery.data ?? null;
  const platformCapabilities = useMemo(() => getPlatformCapabilities(), []);
  const loading =
    isOpen &&
    (settingsQuery.isLoading ||
      modelCatalogQuery.isLoading ||
      inputDevicesQuery.isLoading ||
      appInfoQuery.isLoading);

  const clearSettingsError = useCallback(() => {
    setError(null);
    setErrorSourceTab(null);
  }, []);

  const clearSettingsErrorIfNoInvalidDrafts = useCallback(() => {
    if (!invalidShortcutDraftRef.current) {
      clearSettingsError();
    }
  }, [clearSettingsError]);

  const showSettingsError = useCallback(
    (
      message: string,
      sourceTab: SettingsErrorSourceTab =
        activeTab === "account" ? "general" : activeTab,
    ) => {
      setError(message);
      setErrorSourceTab(sourceTab);
    },
    [activeTab],
  );

  const setInvalidShortcutDraft = useCallback(
    (target: ShortcutTarget, message: string) => {
      const next = { target, message };
      invalidShortcutDraftRef.current = next;
      setInvalidShortcutDraftState(next);
    },
    [],
  );

  const clearInvalidShortcutDraft = useCallback(() => {
    invalidShortcutDraftRef.current = null;
    setInvalidShortcutDraftState(null);
  }, []);

  const invalidShortcutDrafts = useMemo<InvalidShortcutDrafts>(() => {
    if (!invalidShortcutDraft) return {};
    return {
      [invalidShortcutDraft.target.mode]: {
        [invalidShortcutDraft.target.index]: invalidShortcutDraft.message,
      },
    };
  }, [invalidShortcutDraft]);

  const discardInvalidShortcutDraft = useCallback(() => {
    const current = invalidShortcutDraftRef.current;
    if (!current) return;

    const next = sanitizeInvalidShortcutDraft(
      shortcutBindingsRef.current,
      current,
      persistedShortcutBindingsRef.current,
    );

    shortcutBindingsRef.current = next;
    setShortcutBindings(next);
    setSmartShortcut(primaryShortcut(next, "smart", smartShortcut));
    setHoldShortcut(primaryShortcut(next, "hold", holdShortcut));
    setToggleShortcut(primaryShortcut(next, "toggle", toggleShortcut));
    clearInvalidShortcutDraft();
  }, [clearInvalidShortcutDraft, holdShortcut, smartShortcut, toggleShortcut]);

  const setLlmEnabled = useCallback((value: boolean) => {
    setLlmEnabledRaw(value);
    if (!value) {
      setEditModeEnabled(false);
      clearSettingsErrorIfNoInvalidDrafts();
    }
  }, [clearSettingsErrorIfNoInvalidDrafts]);

  const setTranscriptionMode = useCallback(
    (mode: TranscriptionMode) => {
      setTranscriptionModeRaw(mode);
      if (mode === "cloud" && (activeTab === "models" || activeTab === "providers")) {
        setActiveTab("general");
      }
    },
    [activeTab],
  );

  const setTextSizeMode = useCallback((mode: TextSizeMode) => {
    setTextSizeModeRaw(mode);
    localStorage.setItem(TEXT_SIZE_MODE_STORAGE_KEY, mode);
    emit("ui:text_size_changed", { mode }).catch(() => {});
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeRaw(mode);
    emit("ui:theme_changed", { mode }).catch(() => {});
  }, []);

  const setLlmProvider = useCallback((value: LlmProvider) => {
    setLlmProviderRaw(value);
    setAvailableModels([]);
  }, []);
  const setLlmEndpoint = useCallback((value: string) => {
    setLlmEndpointRaw(value);
    setAvailableModels([]);
  }, []);
  const setLlmApiKey = useCallback((value: string) => {
    setLlmApiKeyRaw(value);
    setAvailableModels([]);
  }, []);

  const hydrateFromSettings = useCallback((s: StoredSettings) => {
    const hydratedBindings = bindingsFromSettings(s);
    persistedShortcutBindingsRef.current = hydratedBindings;
    clearInvalidShortcutDraft();
    setSmartShortcut(s.smart_shortcut);
    setSmartEnabled(s.smart_enabled);
    setHoldShortcut(s.hold_shortcut);
    setHoldEnabled(s.hold_enabled);
    setToggleShortcut(s.toggle_shortcut);
    setToggleEnabled(s.toggle_enabled);
    shortcutBindingsRef.current = hydratedBindings;
    setShortcutBindings(hydratedBindings);
    setTranscriptionModeRaw(s.transcription_mode);
    setLocalModel(s.local_model);
    setMicrophoneDevice(s.microphone_device);
    setLanguage(s.language);
    setAppLocale(s.app_locale ?? "system");

    setLlmEnabledRaw(s.llm_enabled ?? false);
    setLlmProviderRaw(s.llm_provider ?? "none");
    setLlmEndpointRaw(s.llm_endpoint ?? "");
    setLlmApiKeyRaw(s.llm_api_key ?? "");
    setLlmModel(s.llm_model ?? "");
    setEditModeEnabled(s.edit_mode_enabled ?? false);
    setAutoDictionaryEnabled(s.auto_dictionary_enabled ?? false);
    setMediaControlEnabled(s.media_control_enabled ?? false);
    setAutoUpdateEnabled(s.auto_update_enabled ?? false);
    setAutoLaunchEnabled(s.auto_launch_enabled ?? false);
    setAutoDeleteTarget(s.auto_delete_target ?? "transcripts");
    setAutoDeleteDuration(s.auto_delete_duration ?? "never");
    setAnalyticsEnabled(s.analytics_enabled ?? true);
    setLocalApiKey(s.local_api_key ?? "");
    setLocalApiPort(s.local_api_port ?? 11435);
    setLocalApiModel(s.local_api_model ?? "auto");
    setLocalApiHost(s.local_api_host ?? "127.0.0.1");
    setLocalApiStartOnLaunch(s.local_api_start_on_launch ?? false);
    setLocalApiCors(s.local_api_cors ?? false);
    setThemeModeRaw(s.theme_mode ?? "system");
  }, [clearInvalidShortcutDraft]);

  const activeTranscriptionEngine = useMemo(
    () => getActiveTranscriptionEngine(modelCatalog, localModel),
    [modelCatalog, localModel],
  );
  const installedTranscriptionEngines = useMemo(
    () => getInstalledTranscriptionEngines(modelCatalog, modelStatus),
    [modelCatalog, modelStatus],
  );
  const catalogTranscriptionEngines = useMemo(
    () => getCatalogTranscriptionEngines(modelCatalog),
    [modelCatalog],
  );
  const visibleTranscriptionEngines: TranscriptionEngineId[] = useMemo(() => {
    if (installedTranscriptionEngines.length > 0)
      return installedTranscriptionEngines;
    if (activeTranscriptionEngine) return [activeTranscriptionEngine];
    if (catalogTranscriptionEngines.length > 0)
      return [catalogTranscriptionEngines[0]];
    return [];
  }, [
    installedTranscriptionEngines,
    activeTranscriptionEngine,
    catalogTranscriptionEngines,
  ]);
  const showLanguageSupportBadges = installedTranscriptionEngines.length > 1;
  const activeLocalModel = useMemo(
    () => modelCatalog.find((model) => model.key === localModel),
    [modelCatalog, localModel],
  );
  const autoDictionarySupported = hasModelCapability(
    activeLocalModel,
    MODEL_CAPABILITY_DICTIONARY,
  );
  const autoTranscriptionLanguageLabel = i18n._(
    msg({
      id: "transcription.language.auto",
      message: "Auto",
    }),
  );
  const languageView = useMemo(
    () =>
      buildTranscriptionLanguageView(
        modelCatalog,
        activeTranscriptionEngine,
        visibleTranscriptionEngines,
        autoTranscriptionLanguageLabel,
      ),
    [
      modelCatalog,
      activeTranscriptionEngine,
      visibleTranscriptionEngines,
      autoTranscriptionLanguageLabel,
    ],
  );
  const displayedLanguage = language;
  const displayedLanguageOptions = languageView.options;

  const llmProviderPreset = useMemo(
    () => getProviderPreset(llmProvider),
    [llmProvider],
  );
  const llmConfigReady = Boolean(
    llmProviderPreset &&
      (llmProvider !== "custom" || llmEndpoint.trim()) &&
      (!llmProviderPreset.apiKeyRequired || llmApiKey.trim()) &&
      llmModel.trim(),
  );
  const aiFeaturesReady = licenseGateActive && llmEnabled && llmConfigReady;

  const buildSettingsArgs = useCallback(
    (overrides: SaveSettingsOverrides = {}) => {
      const rawShortcutBindings = overrides.shortcutBindings ?? shortcutBindings;
      const shouldTryDraftShortcut =
        overrides.shortcutBindings !== undefined &&
        overrides.shortcutDraftTarget !== undefined;
      const bindingsForSave = shouldTryDraftShortcut
        ? rawShortcutBindings
        : sanitizeInvalidShortcutDraft(
            rawShortcutBindings,
            invalidShortcutDraftRef.current,
            persistedShortcutBindingsRef.current,
          );
      const savedShortcutBindings = aiFeaturesReady
        ? bindingsForSave
        : withoutShortcutCleanup(bindingsForSave);

      return {
        smartShortcut:
          overrides.smartShortcut ??
          primaryShortcut(savedShortcutBindings, "smart", smartShortcut),
        smartEnabled,
        holdShortcut:
          overrides.holdShortcut ??
          primaryShortcut(savedShortcutBindings, "hold", holdShortcut),
        holdEnabled,
        toggleShortcut:
          overrides.toggleShortcut ??
          primaryShortcut(savedShortcutBindings, "toggle", toggleShortcut),
        toggleEnabled,
        shortcutBindings: savedShortcutBindings,
        transcriptionMode,
        localModel: overrides.localModel ?? localModel,
        microphoneDevice,
        language,
        appLocale,
        themeMode,

        llmEnabled: licenseGateActive && llmEnabled && llmConfigReady,
        cleanupEnabled: false,
        llmProvider,
        llmEndpoint,
        llmApiKey,
        llmModel,
        editModeEnabled: aiFeaturesReady ? editModeEnabled : false,
        autoDictionaryEnabled: autoDictionarySupported ? autoDictionaryEnabled : false,
        mediaControlEnabled,
        autoUpdateEnabled,
        autoLaunchEnabled,
        autoDeleteTarget,
        autoDeleteDuration,
        analyticsEnabled,
        localApiKey,
        localApiPort,
        localApiModel,
        localApiHost,
        localApiStartOnLaunch: licenseGateActive ? localApiStartOnLaunch : false,
        localApiCors,
      };
    },
    [
      smartShortcut,
      shortcutBindings,
      smartEnabled,
      holdShortcut,
      holdEnabled,
      toggleShortcut,
      toggleEnabled,
      transcriptionMode,
      localModel,
      microphoneDevice,
      language,
      appLocale,
      themeMode,
      aiFeaturesReady,
      licenseGateActive,
      llmEnabled,
      llmProvider,
      llmEndpoint,
      llmApiKey,
      llmModel,
      editModeEnabled,
      autoDictionarySupported,
      autoDictionaryEnabled,
      mediaControlEnabled,
      autoUpdateEnabled,
      autoLaunchEnabled,
      autoDeleteTarget,
      autoDeleteDuration,
      analyticsEnabled,
      localApiKey,
      localApiPort,
      localApiModel,
      localApiHost,
      localApiStartOnLaunch,
      localApiCors,
    ],
  );

  const saveSettingsNow = useCallback(
    (overrides?: SaveSettingsOverrides) => {
      const args = buildSettingsArgs(overrides);
      if (overrides?.localModel !== undefined && !args.localModel) {
        return Promise.resolve(false);
      }
      const save = settingsSaveRef.current
        .catch(() => false)
        .then(async () => {
          isSavingRef.current = true;
          try {
            await invoke("update_settings", { args });
            persistedShortcutBindingsRef.current = args.shortcutBindings;
            if (overrides?.shortcutDraftTarget) {
              clearInvalidShortcutDraft();
            }
            clearSettingsErrorIfNoInvalidDrafts();
            return true;
          } catch (err) {
            console.error(err);
            const message = String(err);
            if (overrides?.shortcutDraftTarget) {
              setInvalidShortcutDraft(overrides.shortcutDraftTarget, message);
            }
            showSettingsError(message);
            return false;
          } finally {
            isSavingRef.current = false;
          }
        });

      settingsSaveRef.current = save;
      return save;
    },
    [
      buildSettingsArgs,
      clearInvalidShortcutDraft,
      clearSettingsErrorIfNoInvalidDrafts,
      setInvalidShortcutDraft,
      showSettingsError,
    ],
  );

  const saveSettingsNowRef = useRef(saveSettingsNow);
  saveSettingsNowRef.current = saveSettingsNow;

  const clearPendingSettingsSave = useCallback(() => {
    if (saveTimeoutRef.current === null) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }, []);

  const flushPendingSettingsSave = useCallback(() => {
    if (saveTimeoutRef.current === null) return;
    clearPendingSettingsSave();
    void saveSettingsNowRef.current();
  }, [clearPendingSettingsSave]);

  const discardEmptyCaptureDraft = useCallback(() => {
    const target = captureActiveRef.current;
    if (target) {
      const current = shortcutBindingsRef.current;
      const binding = current[target.mode][target.index];
      if (binding && binding.shortcut.trim() === "" && current[target.mode].length > 1) {
        const next = {
          ...current,
          [target.mode]: current[target.mode].filter(
            (_, bindingIndex) => bindingIndex !== target.index,
          ),
        };
        shortcutBindingsRef.current = next;
        setShortcutBindings(next);
      }
    }
    captureActiveRef.current = null;
  }, []);

  const finalizeCapture = useCallback(async () => {
    flushPendingSettingsSave();
    setCaptureActive(null);
    await invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
  }, [flushPendingSettingsSave]);

  const { resetCaptureState } = useShortcutCapture({
    active: captureActive !== null,
    onCancel: finalizeCapture,
    onCaptureCancelled: discardEmptyCaptureDraft,
    onPreviewChange: setCapturePreview,
    onShortcutCaptured: (combo) => {
      clearPendingSettingsSave();
      const target = captureActiveRef.current;
      if (target) {
        setShortcutBindings((current) => {
          const next = {
            ...current,
            [target.mode]: current[target.mode].map((binding, index) =>
              index === target.index ? { ...binding, shortcut: combo } : binding,
            ),
          };
          shortcutBindingsRef.current = next;
          const primary = primaryShortcut(next, target.mode, combo);
          if (target.mode === "smart") setSmartShortcut(primary);
          if (target.mode === "hold") setHoldShortcut(primary);
          if (target.mode === "toggle") setToggleShortcut(primary);
          void saveSettingsNow({
            shortcutBindings: next,
            shortcutDraftTarget: target,
            smartShortcut: primaryShortcut(next, "smart", smartShortcut),
            holdShortcut: primaryShortcut(next, "hold", holdShortcut),
            toggleShortcut: primaryShortcut(next, "toggle", toggleShortcut),
          });
          return next;
        });
        captureActiveRef.current = null;
      }
      clearSettingsErrorIfNoInvalidDrafts();
    },
    onError: (message) => showSettingsError(message, "general"),
    onCaptureInput: clearSettingsErrorIfNoInvalidDrafts,
  });

  useEffect(() => {
    if (aiFeaturesReady) return;
    setEditModeEnabled(false);
    setShortcutBindings((current) => {
      const next = withoutShortcutCleanup(current);
      shortcutBindingsRef.current = next;
      return next;
    });
  }, [aiFeaturesReady]);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen) return;
    flushPendingSettingsSave();
    didHydrateRef.current = false;
    if (captureActive) {
      finalizeCapture();
      resetCaptureState();
    }
  }, [
    captureActive,
    finalizeCapture,
    flushPendingSettingsSave,
    isOpen,
    resetCaptureState,
  ]);

  useEffect(() => {
    return () => {
      flushPendingSettingsSave();
      invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
      for (const timeout of downloadResetTimeoutsRef.current) {
        clearTimeout(timeout);
      }
      downloadResetTimeoutsRef.current.clear();
    };
  }, [flushPendingSettingsSave]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("open_whats_new", () => {
      setWhatsNewOpen(true);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const refreshPermissionState = useCallback(async () => {
    const [nativeMic, acc, inputMonitoring] = await Promise.allSettled([
      platformCapabilities.requiresNativeMicrophonePermission
        ? invoke<boolean>("check_microphone_permission")
        : Promise.resolve<boolean | null>(null),
      platformCapabilities.requiresAccessibilityPermission
        ? checkMacAccessibilityPermission()
        : Promise.resolve<boolean | null>(null),
      platformCapabilities.requiresInputMonitoringPermission
        ? checkMacInputMonitoringPermission()
        : Promise.resolve<boolean | null>(null),
    ]);

    setMicPermission(nativeMic.status === "fulfilled" ? nativeMic.value : false);
    setAccessibilityPermission(acc.status === "fulfilled" ? acc.value : false);
    setInputMonitoringPermission(
      inputMonitoring.status === "fulfilled" ? inputMonitoring.value : false,
    );
  }, [platformCapabilities]);

  useEffect(() => {
    if (activeTab !== "app" || !isOpen) return;

    let cancelled = false;
    let unlistenFocus: UnlistenFn | null = null;

    const refreshPermissions = () => {
      if (!cancelled) {
        void refreshPermissionState();
      }
    };

    refreshPermissions();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshPermissions();
      }
    };

    window.addEventListener("focus", refreshPermissions);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          refreshPermissions();
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenFocus = fn;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshPermissions);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenFocus?.();
    };
  }, [activeTab, isOpen, refreshPermissionState]);

  const handleRequestMicrophonePermission = useCallback(async () => {
    try {
      await invoke("request_microphone_permission");
    } catch {
      // Fall through to the settings fallback below.
    }

    try {
      const granted = await invoke<boolean>("check_microphone_permission");
      setMicPermission(granted);
      if (!granted) {
        await invoke("open_microphone_settings");
      }
    } catch {
      setMicPermission(false);
      try {
        await invoke("open_microphone_settings");
      } catch {
        // ignore
      }
    } finally {
      void refreshPermissionState();
    }
  }, [refreshPermissionState]);

  useEffect(() => {
    if (!isOpen) return;

    if (settingsQuery.error) {
      console.error("Failed to load settings:", settingsQuery.error);
      showSettingsError("Failed to load settings", "general");
      return;
    }

    if (!settingsQuery.data || isSavingRef.current) return;

    hydrateFromSettings(settingsQuery.data);
  }, [hydrateFromSettings, isOpen, settingsQuery.data, settingsQuery.error, showSettingsError]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let unlistenLog: UnlistenFn | null = null;
    let unlistenStatus: UnlistenFn | null = null;

    modelsApi
      .getLocalApiStatus()
      .then((status) => {
        if (!cancelled) setLocalApiStatus(status);
      })
      .catch((err) => console.error("Failed to load local API status:", err));
    modelsApi
      .getCliInstallStatus()
      .then((status) => {
        if (!cancelled) setCliInstallStatus(status);
      })
      .catch((err) => console.error("Failed to load CLI install status:", err));

    listen<LocalApiLogEntry>("local-api:log", (event) => {
      if (cancelled) return;
      setLocalApiStatus((current) => {
        if (!current) return current;
        const previousLogs = current.logs ?? [];
        return {
          running: current.running,
          host: current.host,
          port: current.port,
          model: current.model,
          loaded_model: current.loaded_model,
          api_key_required: current.api_key_required,
          config_id: current.config_id,
          cors: current.cors,
          logs: [...previousLogs, event.payload].slice(-200),
        };
      });
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenLog = fn;
    });

    listen<LocalApiStatus>("local-api:status", (event) => {
      if (!cancelled) setLocalApiStatus(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStatus = fn;
    });

    return () => {
      cancelled = true;
      unlistenLog?.();
      unlistenStatus?.();
    };
  }, [isOpen]);

  const invalidateModelStatus = useCallback(
    (modelKey: string) => {
      void queryClient.invalidateQueries({
        queryKey: modelKeys.status(modelKey),
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!isOpen || modelCatalog.length === 0) return;

    setLocalModel((current) =>
      modelCatalog.some((model) => model.key === current)
        ? current
        : (modelCatalog[0]?.key ?? ""),
    );
  }, [isOpen, modelCatalog]);

  useModelDownloadEvents({
    enabled: isOpen,
    onProgress: (payload) => {
      setDownloadState((prev) => ({
        ...prev,
        [payload.model]: {
          status: "downloading",
          percent: Math.min(100, payload.percent),
          downloaded: payload.downloaded,
          total: payload.total,
          file: payload.file,
        },
      }));
    },
    onComplete: ({ model }) => {
      setDownloadState((prev) => ({
        ...prev,
        [model]: {
          status: "complete",
          percent: 100,
          downloaded: prev[model]?.downloaded ?? 0,
          total: prev[model]?.total ?? 0,
        },
      }));
      invalidateModelStatus(model);
    },
    onError: ({ model, error }) => {
      if (error.toLowerCase().includes("cancelled")) return;
      setDownloadState((prev) => ({
        ...prev,
        [model]: {
          status: "error",
          message: error,
          percent: prev[model]?.percent ?? 0,
          downloaded: prev[model]?.downloaded ?? 0,
          total: prev[model]?.total ?? 0,
        },
      }));
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (captureActiveRef.current) {
        e.preventDefault();
        finalizeCapture();
        discardEmptyCaptureDraft();
        resetCaptureState();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    discardEmptyCaptureDraft,
    finalizeCapture,
    isOpen,
    onClose,
    resetCaptureState,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (loading) return;
    if (captureActiveRef.current) return;
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }

    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      void saveSettingsNow();
    }, 500);
  }, [isOpen, loading, saveSettingsNow]);

  const handleOpenDataDir = useCallback(async () => {
    if (!appInfo?.data_dir_path) return;
    try {
      await invoke("open_data_dir", { path: appInfo.data_dir_path });
    } catch (err) {
      console.error("Failed to open data directory:", err);
    }
  }, [appInfo?.data_dir_path]);

  const handleStartCapture = useCallback(
    (mode: ShortcutMode, index = 0) => {
      discardInvalidShortcutDraft();
      if (captureActive?.mode === mode && captureActive.index === index) {
        captureActiveRef.current = null;
        setCaptureActive(null);
        finalizeCapture();
        resetCaptureState();
        clearSettingsErrorIfNoInvalidDrafts();
        return;
      }
      resetCaptureState();
      const target = { mode, index };
      captureActiveRef.current = target;
      setCaptureActive(target);
      clearSettingsErrorIfNoInvalidDrafts();
      invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
        console.error("Failed to disable shortcuts for capture", err);
        captureActiveRef.current = null;
        setCaptureActive(null);
        resetCaptureState();
        showSettingsError(String(err), "general");
      });
    },
    [
      captureActive,
      clearSettingsErrorIfNoInvalidDrafts,
      discardInvalidShortcutDraft,
      finalizeCapture,
      resetCaptureState,
      showSettingsError,
    ],
  );

  const updateShortcutBindings = useCallback(
    (updater: (current: ShortcutBindings) => ShortcutBindings) => {
      clearPendingSettingsSave();
      const next = updater(shortcutBindingsRef.current);
      shortcutBindingsRef.current = next;
      setShortcutBindings(next);
      setSmartShortcut(primaryShortcut(next, "smart", smartShortcut));
      setHoldShortcut(primaryShortcut(next, "hold", holdShortcut));
      setToggleShortcut(primaryShortcut(next, "toggle", toggleShortcut));
      void saveSettingsNow({
        shortcutBindings: next,
        smartShortcut: primaryShortcut(next, "smart", smartShortcut),
        holdShortcut: primaryShortcut(next, "hold", holdShortcut),
        toggleShortcut: primaryShortcut(next, "toggle", toggleShortcut),
      });
    },
    [
      clearPendingSettingsSave,
      holdShortcut,
      saveSettingsNow,
      smartShortcut,
      toggleShortcut,
    ],
  );

  const updateShortcutBinding = useCallback(
    (mode: ShortcutMode, index: number, patch: Partial<ShortcutBinding>) => {
      if (patch.shortcut !== undefined) {
        discardInvalidShortcutDraft();
      }
      updateShortcutBindings((current) => ({
        ...current,
        [mode]: current[mode].map((binding, bindingIndex) =>
          bindingIndex === index ? { ...binding, ...patch } : binding,
        ),
      }));
    },
    [discardInvalidShortcutDraft, updateShortcutBindings],
  );

  const addShortcutBinding = useCallback(
    (mode: ShortcutMode) => {
      clearPendingSettingsSave();
      discardInvalidShortcutDraft();
      const current = shortcutBindingsRef.current;
      if (current[mode].length >= 3) return;
      const nextIndex = current[mode].length;
      const next = {
        ...current,
        [mode]: [
          ...current[mode],
          { shortcut: "", temporary: false, cleanup_enabled: false },
        ],
      };
      shortcutBindingsRef.current = next;
      setShortcutBindings(next);
      handleStartCapture(mode, nextIndex);
    },
    [clearPendingSettingsSave, discardInvalidShortcutDraft, handleStartCapture],
  );

  const removeShortcutBinding = useCallback(
    (mode: ShortcutMode, index: number) => {
      if (shortcutBindingsRef.current[mode].length <= 1) return;
      discardInvalidShortcutDraft();
      const activeTarget = captureActiveRef.current;
      if (activeTarget?.mode === mode) {
        if (activeTarget.index === index) {
          captureActiveRef.current = null;
          setCaptureActive(null);
          resetCaptureState();
          void invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
        } else if (activeTarget.index > index) {
          const nextTarget = { ...activeTarget, index: activeTarget.index - 1 };
          captureActiveRef.current = nextTarget;
          setCaptureActive(nextTarget);
        }
      }
      updateShortcutBindings((current) => {
        return {
          ...current,
          [mode]: current[mode].filter((_, bindingIndex) => bindingIndex !== index),
        };
      });
    },
    [
      discardInvalidShortcutDraft,
      resetCaptureState,
      updateShortcutBindings,
    ],
  );

  const handleLocalModelChange = useCallback(
    (modelKey: string) => {
      clearPendingSettingsSave();
      setLocalModel(modelKey);
      void saveSettingsNow({ localModel: modelKey });
    },
    [clearPendingSettingsSave, saveSettingsNow],
  );

  const fetchAvailableModels = useCallback(async () => {
    try {
      const models = await invoke<string[]>("fetch_llm_models", {
        endpoint: llmEndpoint,
        provider: llmProvider,
        apiKey: llmApiKey,
      });
      setAvailableModels(models);
    } catch {
      setAvailableModels([]);
    }
  }, [llmEndpoint, llmProvider, llmApiKey]);

  const handleDownload = useCallback(
    async (modelKey: string) => {
      setDownloadState((prev) => ({
        ...prev,
        [modelKey]: {
          status: "downloading",
          percent: 0,
          downloaded: 0,
          total: 0,
          file: "starting",
        },
      }));
      try {
        await invoke("download_model", { model: modelKey });
        invalidateModelStatus(modelKey);
      } catch (err) {
        const errorMsg = String(err);
        if (errorMsg.toLowerCase().includes("cancelled")) return;
        console.error(err);
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: {
            status: "error",
            message: String(err),
            percent: prev[modelKey]?.percent ?? 0,
            downloaded: prev[modelKey]?.downloaded ?? 0,
            total: prev[modelKey]?.total ?? 0,
          },
        }));
      }
    },
    [invalidateModelStatus],
  );

  const handleDelete = useCallback(
    async (modelKey: string) => {
      try {
        await invoke("delete_model", { model: modelKey });
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: { status: "idle", percent: 0, downloaded: 0, total: 0 },
        }));

        if (localModel === modelKey) {
          const otherInstalledModel = modelCatalog.find(
            (m) => m.key !== modelKey && modelStatus[m.key]?.installed,
          );
          if (otherInstalledModel) {
            handleLocalModelChange(otherInstalledModel.key);
          }
        }

        invalidateModelStatus(modelKey);
      } catch (err) {
        console.error(err);
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: {
            status: "error",
            message: String(err),
            percent: prev[modelKey]?.percent ?? 0,
            downloaded: prev[modelKey]?.downloaded ?? 0,
            total: prev[modelKey]?.total ?? 0,
          },
        }));
      }
    },
    [
      handleLocalModelChange,
      invalidateModelStatus,
      localModel,
      modelCatalog,
      modelStatus,
    ],
  );

  const handleCancelDownload = useCallback(async (modelKey: string) => {
    try {
      await invoke("cancel_download", { model: modelKey });
      setDownloadState((prev) => ({
        ...prev,
        [modelKey]: {
          status: "cancelled",
          percent: 0,
          downloaded: 0,
          total: 0,
        },
      }));
      const resetTimeout = setTimeout(() => {
        downloadResetTimeoutsRef.current.delete(resetTimeout);
        setDownloadState((prev) => {
          if (prev[modelKey]?.status === "cancelled") {
            return {
              ...prev,
              [modelKey]: {
                status: "idle",
                percent: 0,
                downloaded: 0,
                total: 0,
              },
            };
          }
          return prev;
        });
      }, 1500);
      downloadResetTimeoutsRef.current.add(resetTimeout);
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }, []);

  const handleStartLocalApi = useCallback(async () => {
    flushPendingSettingsSave();
    setLocalApiBusy(true);
    try {
      if (!(await saveSettingsNowRef.current())) return;
      const status = await modelsApi.startLocalApi({
        host: localApiHost,
        port: localApiPort,
        model: localApiModel,
        apiKey: localApiKey,
        cors: localApiCors,
      });
      setLocalApiStatus(status);
      clearSettingsError();
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    } finally {
      setLocalApiBusy(false);
    }
  }, [
    clearSettingsError,
    flushPendingSettingsSave,
    localApiCors,
    localApiHost,
    localApiKey,
    localApiModel,
    localApiPort,
    showSettingsError,
  ]);

  const handleStopLocalApi = useCallback(async () => {
    setLocalApiBusy(true);
    try {
      await modelsApi.stopLocalApi();
      const status = await waitForLocalApiStopped();
      setLocalApiStatus(status);
      clearSettingsError();
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    } finally {
      setLocalApiBusy(false);
    }
  }, [clearSettingsError, showSettingsError]);

  const handleRestartLocalApi = useCallback(async () => {
    setLocalApiBusy(true);
    try {
      if (!(await saveSettingsNowRef.current())) return;
      await modelsApi.stopLocalApi();
      const stopped = await waitForLocalApiStopped();
      if (stopped.running) {
        throw new Error("API server did not stop before restart");
      }
      const status = await modelsApi.startLocalApi({
        host: localApiHost,
        port: localApiPort,
        model: localApiModel,
        apiKey: localApiKey,
        cors: localApiCors,
      });
      setLocalApiStatus(status);
      clearSettingsError();
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    } finally {
      setLocalApiBusy(false);
    }
  }, [
    clearSettingsError,
    localApiCors,
    localApiHost,
    localApiKey,
    localApiModel,
    localApiPort,
    showSettingsError,
  ]);

  const handleClearLocalApiLogs = useCallback(async () => {
    try {
      const status = await modelsApi.clearLocalApiLogs();
      setLocalApiStatus(status);
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    }
  }, [showSettingsError]);

  const handleInstallCli = useCallback(async () => {
    setCliInstallBusy(true);
    try {
      const status = await modelsApi.installCli();
      setCliInstallStatus(status);
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    } finally {
      setCliInstallBusy(false);
    }
  }, [showSettingsError]);

  const handleRemoveCli = useCallback(async () => {
    setCliInstallBusy(true);
    try {
      const status = await modelsApi.removeCli();
      setCliInstallStatus(status);
    } catch (err) {
      console.error(err);
      showSettingsError(String(err), "local-api");
    } finally {
      setCliInstallBusy(false);
    }
  }, [showSettingsError]);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const decimals = i >= 3 ? 1 : 0;
    return (
      parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
    );
  }, []);

  return {
    activeTab,
    setActiveTab,
    loading,
    error,
    errorSourceTab,

    smartShortcut,
    shortcutBindings,
    invalidShortcutDrafts,
    smartEnabled,
    setSmartEnabled,
    holdShortcut,
    holdEnabled,
    setHoldEnabled,
    toggleShortcut,
    toggleEnabled,
    setToggleEnabled,
    transcriptionMode,
    setTranscriptionMode,
    localModel,
    setLocalModel: handleLocalModelChange,
    microphoneDevice,
    setMicrophoneDevice,
    language: displayedLanguage,
    setLanguage,
    appLocale,
    setAppLocale,
    languages: displayedLanguageOptions,
    languageBadgeColumns: languageView.badgeColumns,
    showLanguageSupportBadges,


    inputDevices,
    modelCatalog,
    modelStatus,
    downloadState,
    appInfo,

    captureActive,
    capturePreview,
    handleStartCapture,
    updateShortcutBinding,
    addShortcutBinding,
    removeShortcutBinding,

    llmEnabled,
    setLlmEnabled,
    llmProvider,
    setLlmProvider,
    llmEndpoint,
    setLlmEndpoint,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmConfigReady,
    aiFeaturesReady,
    licenseGateActive,
    availableModels,
    fetchAvailableModels,
    editModeEnabled,
    setEditModeEnabled,
    autoDictionaryEnabled,
    autoDictionarySupported,
    setAutoDictionaryEnabled,
    mediaControlEnabled,
    setMediaControlEnabled,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    autoLaunchEnabled,
    setAutoLaunchEnabled,
    autoDeleteTarget,
    setAutoDeleteTarget,
    autoDeleteDuration,
    setAutoDeleteDuration,
    analyticsEnabled,
    setAnalyticsEnabled,
    localApiKey,
    setLocalApiKey,
    localApiPort,
    setLocalApiPort,
    localApiModel,
    setLocalApiModel,
    localApiHost,
    setLocalApiHost,
    localApiStartOnLaunch,
    setLocalApiStartOnLaunch,
    localApiCors,
    setLocalApiCors,
    localApiStatus,
    localApiBusy,
    cliInstallStatus,
    cliInstallBusy,
    handleStartLocalApi,
    handleStopLocalApi,
    handleRestartLocalApi,
    handleClearLocalApiLogs,
    handleInstallCli,
    handleRemoveCli,
    platformCapabilities,

    micPermission,
    accessibilityPermission,
    inputMonitoringPermission,
    handleRequestMicrophonePermission,
    textSizeMode,
    setTextSizeMode,
    themeMode,
    setThemeMode,

    showFAQModal,
    setShowFAQModal,
    whatsNewOpen,
    setWhatsNewOpen,

    handleDownload,
    handleDelete,
    handleCancelDownload,
    handleOpenDataDir,
    formatBytes,
  };
}
