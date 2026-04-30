import { msg } from "@lingui/core/macro";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkMacAccessibilityPermission,
  checkMacInputMonitoringPermission,
} from "../../shared/lib/macosPermissions";
import { getPlatformCapabilities } from "../../platform/service";
import { getProviderPreset } from "../../shared/lib/llmProviders";
import { parseTextSizeMode } from "../../shared/lib/textSize";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import { logout, type User as AuthUser } from "../auth/api";
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
import { useModelCatalog } from "./models-queries";
import type {
  TranscriptionMode,
  TextSizeMode,
  ThemeMode,
  StoredSettings,
  ModelStatus,
  DownloadEvent,
  LlmProvider,
  RecordingPrunePolicy,
  AppLocaleSetting,
} from "../../types";


const TEXT_SIZE_MODE_STORAGE_KEY = "glimpse_text_size_mode";
const THEME_MODE_STORAGE_KEY = "glimpse_theme_mode";

const parseThemeMode = (value: string | null): ThemeMode =>
  value === "light" || value === "dark" || value === "system"
    ? value
    : "system";

type ActiveTab = "general" | "models" | "about" | "account" | "app";

interface UseSettingsFormOptions {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ActiveTab;
  currentUser: AuthUser | null;
  onUpdateUser: () => Promise<void>;
  transcriptionMode: TranscriptionMode;
}

export function useSettingsForm({
  isOpen,
  onClose,
  initialTab = "general",
  currentUser,
  onUpdateUser,
  transcriptionMode: initialTranscriptionMode,
}: UseSettingsFormOptions) {
  const [smartShortcut, setSmartShortcut] = useState("Control+Space");
  const [smartEnabled, setSmartEnabled] = useState(true);
  const [holdShortcut, setHoldShortcut] = useState("Control+Shift+Space");
  const [holdEnabled, setHoldEnabled] = useState(false);
  const [toggleShortcut, setToggleShortcut] = useState("Control+Alt+Space");
  const [toggleEnabled, setToggleEnabled] = useState(false);
  const [transcriptionMode, setTranscriptionModeRaw] =
    useState<TranscriptionMode>(initialTranscriptionMode);
  const [localModel, setLocalModel] = useState("");
  const [microphoneDevice, setMicrophoneDevice] = useState<string | null>(null);
  const [language, setLanguage] = useState("en");
  const [appLocale, setAppLocale] = useState<AppLocaleSetting>("system");
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>(
    {},
  );
  const [downloadState, setDownloadState] = useState<
    Record<string, DownloadEvent>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [captureActive, setCaptureActive] = useState<
    "smart" | "hold" | "toggle" | null
  >(null);
  const [capturePreview, setCapturePreview] = useState<string>("");
  const captureActiveRef = useRef<"smart" | "hold" | "toggle" | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("general");
  const [llmEnabled, setLlmEnabledRaw] = useState(false);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [llmProvider, setLlmProviderRaw] = useState<LlmProvider>("none");
  const [llmEndpoint, setLlmEndpointRaw] = useState("");
  const [llmApiKey, setLlmApiKeyRaw] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [mediaControlEnabled, setMediaControlEnabled] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [recordingPrunePolicy, setRecordingPrunePolicy] =
    useState<RecordingPrunePolicy>("never");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [textSizeMode, setTextSizeModeRaw] = useState<TextSizeMode>(() =>
    parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
  );
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>(() =>
    parseThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY)),
  );
  const [authLoading, setAuthLoading] = useState(false);
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
  const settingsQuery = useSettings(undefined, isOpen);
  const appInfoQuery = useAppInfo(isOpen);
  const inputDevicesQuery = useInputDevices(isOpen);
  const modelCatalogQuery = useModelCatalog(isOpen);
  const inputDevices = inputDevicesQuery.data ?? [];
  const modelCatalog = modelCatalogQuery.data ?? [];
  const appInfo = appInfoQuery.data ?? null;
  const platformCapabilities = useMemo(() => getPlatformCapabilities(), []);
  const loading =
    isOpen &&
    (settingsQuery.isLoading ||
      modelCatalogQuery.isLoading ||
      inputDevicesQuery.isLoading ||
      appInfoQuery.isLoading);

  const [cloudSyncEnabled, setCloudSyncEnabledRaw] = useState(() => {
    const stored = localStorage.getItem("glimpse_cloud_sync_enabled");
    return stored !== null ? stored === "true" : false;
  });

  const setLlmEnabled = useCallback((value: boolean) => {
    setLlmEnabledRaw(value);
    if (!value) {
      setCleanupEnabled(false);
      setEditModeEnabled(false);
      setError(null);
    }
  }, []);

  const setTranscriptionMode = useCallback(
    (mode: TranscriptionMode) => {
      setTranscriptionModeRaw(mode);
      if (mode === "cloud" && activeTab === "models") {
        setActiveTab("general");
      }
    },
    [activeTab],
  );

  const setCloudSyncEnabled = useCallback((value: boolean) => {
    setCloudSyncEnabledRaw(value);
    localStorage.setItem("glimpse_cloud_sync_enabled", String(value));
    emit("auth:changed").catch(() => {});
  }, []);

  const setTextSizeMode = useCallback((mode: TextSizeMode) => {
    setTextSizeModeRaw(mode);
    localStorage.setItem(TEXT_SIZE_MODE_STORAGE_KEY, mode);
    emit("ui:text_size_changed", { mode }).catch(() => {});
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeRaw(mode);
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
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
    setSmartShortcut(s.smart_shortcut);
    setSmartEnabled(s.smart_enabled);
    setHoldShortcut(s.hold_shortcut);
    setHoldEnabled(s.hold_enabled);
    setToggleShortcut(s.toggle_shortcut);
    setToggleEnabled(s.toggle_enabled);
    setTranscriptionModeRaw(s.transcription_mode);
    setLocalModel(s.local_model);
    setMicrophoneDevice(s.microphone_device);
    setLanguage(s.language);
    setAppLocale(s.app_locale ?? "system");

    setLlmEnabledRaw(s.llm_enabled ?? false);
    setCleanupEnabled(s.cleanup_enabled ?? false);
    setLlmProviderRaw(s.llm_provider ?? "none");
    setLlmEndpointRaw(s.llm_endpoint ?? "");
    setLlmApiKeyRaw(s.llm_api_key ?? "");
    setLlmModel(s.llm_model ?? "");
    setEditModeEnabled(s.edit_mode_enabled ?? false);
    setMediaControlEnabled(s.media_control_enabled ?? false);
    setAutoUpdateEnabled(s.auto_update_enabled ?? false);
    setAutoLaunchEnabled(s.auto_launch_enabled ?? false);
    setRecordingPrunePolicy(s.recording_prune_policy ?? "never");
    setAnalyticsEnabled(s.analytics_enabled ?? true);
  }, []);

  const isSubscriber = currentUser?.labels?.includes("cloud") ?? false;

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
  const aiFeaturesReady = llmEnabled && llmConfigReady;

  const finalizeCapture = useCallback(() => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    captureActiveRef.current = null;
    setCaptureActive(null);
  }, []);

  const { resetCaptureState } = useShortcutCapture({
    active: captureActive !== null,
    onCancel: finalizeCapture,
    onPreviewChange: setCapturePreview,
    onShortcutCaptured: (combo) => {
      if (captureActive === "smart") {
        setSmartShortcut(combo);
      } else if (captureActive === "hold") {
        setHoldShortcut(combo);
      } else if (captureActive === "toggle") {
        setToggleShortcut(combo);
      }
      setError(null);
    },
    onError: setError,
    onCaptureInput: () => setError(null),
  });

  // Guard: non-subscribers can't have cloud sync
  useEffect(() => {
    if (currentUser && !isSubscriber && cloudSyncEnabled) {
      setCloudSyncEnabled(false);
    }
  }, [currentUser, isSubscriber, cloudSyncEnabled, setCloudSyncEnabled]);

  useEffect(() => {
    if (aiFeaturesReady) return;
    setCleanupEnabled(false);
    setEditModeEnabled(false);
  }, [aiFeaturesReady]);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) {
      didHydrateRef.current = false;
      if (captureActive) {
        finalizeCapture();
        resetCaptureState();
      }
    }
  }, [captureActive, finalizeCapture, isOpen, resetCaptureState]);

  useEffect(() => {
    return () => {
      invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("open_whats_new", () => {
      setWhatsNewOpen(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
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
      setError("Failed to load settings");
      return;
    }

    if (!settingsQuery.data || isSavingRef.current) return;

    hydrateFromSettings(settingsQuery.data);
  }, [hydrateFromSettings, isOpen, settingsQuery.data, settingsQuery.error]);

  const refreshModelStatus = useCallback((modelKey: string) => {
    invoke<ModelStatus>("check_model_status", { model: modelKey })
      .then((status) => {
        setModelStatus((prev) => ({ ...prev, [modelKey]: status }));
      })
      .catch((err) => {
        console.error(err);
        setModelStatus((prev) => ({
          ...prev,
          [modelKey]: {
            key: modelKey,
            installed: false,
            bytes_on_disk: 0,
            missing_files: [],
            directory: "",
          },
        }));
      });
  }, []);

  useEffect(() => {
    if (!isOpen || modelCatalog.length === 0) return;

    for (const model of modelCatalog) {
      void refreshModelStatus(model.key);
    }

    setLocalModel((current) =>
      modelCatalog.some((model) => model.key === current)
        ? current
        : (modelCatalog[0]?.key ?? ""),
    );
  }, [isOpen, modelCatalog, refreshModelStatus]);

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
      refreshModelStatus(model);
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
        resetCaptureState();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [finalizeCapture, isOpen, onClose, resetCaptureState]);

  const isSavingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }

    const saveSettings = async () => {
      if (!localModel) return;

      isSavingRef.current = true;
      try {
        await invoke("update_settings", {
          args: {
            smartShortcut,
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

            llmEnabled: aiFeaturesReady,
            cleanupEnabled: aiFeaturesReady ? cleanupEnabled : false,
            llmProvider,
            llmEndpoint,
            llmApiKey,
            llmModel,
            editModeEnabled: aiFeaturesReady ? editModeEnabled : false,
            mediaControlEnabled,
            autoUpdateEnabled,
            autoLaunchEnabled,
            recordingPrunePolicy,
            analyticsEnabled,
          },
        });
        setError(null);
      } catch (err) {
        console.error(err);
        setError(String(err));
      } finally {
        isSavingRef.current = false;
      }
    };

    const timeoutId = setTimeout(() => {
      saveSettings();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    loading,
    smartShortcut,
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

    llmEnabled,
    cleanupEnabled,
    llmProvider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    editModeEnabled,
    mediaControlEnabled,
    autoUpdateEnabled,
    autoLaunchEnabled,
    recordingPrunePolicy,
    analyticsEnabled,
    aiFeaturesReady,
  ]);

  const handleOpenDataDir = useCallback(async () => {
    if (!appInfo?.data_dir_path) return;
    try {
      await invoke("open_data_dir", { path: appInfo.data_dir_path });
    } catch (err) {
      console.error("Failed to open data directory:", err);
    }
  }, [appInfo?.data_dir_path]);

  const handleStartCapture = useCallback(
    (mode: "smart" | "hold" | "toggle") => {
      if (captureActive === mode) {
        finalizeCapture();
        resetCaptureState();
        setError(null);
        return;
      }
      resetCaptureState();
      captureActiveRef.current = mode;
      setCaptureActive(mode);
      setError(null);
      invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
        console.error("Failed to disable shortcuts for capture", err);
        captureActiveRef.current = null;
        setCaptureActive(null);
        resetCaptureState();
        setError(String(err));
      });
    },
    [captureActive, finalizeCapture, resetCaptureState],
  );

  const handleSignOut = useCallback(async () => {
    setAuthLoading(true);
    try {
      await logout();
      await onUpdateUser();
    } catch (err) {
      console.error("Sign out failed:", err);
    } finally {
      setAuthLoading(false);
    }
  }, [onUpdateUser]);

  const handleCancelAuth = useCallback(() => {
    setAuthLoading(false);
  }, []);

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
        refreshModelStatus(modelKey);
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
    [refreshModelStatus],
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
            setLocalModel(otherInstalledModel.key);
          }
        }

        refreshModelStatus(modelKey);
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
    [localModel, modelCatalog, modelStatus, refreshModelStatus],
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
      setTimeout(() => {
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
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }, []);

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
    errorCopied,
    setErrorCopied,

    smartShortcut,
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
    setLocalModel,
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
    availableModels,
    fetchAvailableModels,
    cleanupEnabled,
    setCleanupEnabled,
    editModeEnabled,
    setEditModeEnabled,
    mediaControlEnabled,
    setMediaControlEnabled,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    autoLaunchEnabled,
    setAutoLaunchEnabled,
    recordingPrunePolicy,
    setRecordingPrunePolicy,
    analyticsEnabled,
    setAnalyticsEnabled,
    platformCapabilities,

    authLoading,
    currentUser,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    handleSignOut,
    handleCancelAuth,

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

    onUpdateUser,
  };
}
