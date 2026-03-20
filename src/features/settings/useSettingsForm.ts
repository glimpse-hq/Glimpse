import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { getProviderPreset } from "../../shared/lib/llmProviders";
import { logout, type User as AuthUser } from "../auth/api";
import {
  buildTranscriptionLanguageView,
  getActiveTranscriptionEngine,
  getCatalogTranscriptionEngines,
  getInstalledTranscriptionEngines,
  type TranscriptionEngineId,
} from "../../shared/lib/transcriptionLanguages";
import {
  buildShortcutPreviewString,
  buildShortcutString,
  formatShortcutForDisplay,
  normalizeShortcutModifier,
} from "../../shared/lib/shortcuts";
import type {
  TranscriptionMode,
  TextSizeMode,
  StoredSettings,
  AppInfo,
  ModelInfo,
  ModelStatus,
  DownloadProgressPayload,
  DeviceInfo,
  DownloadEvent,
  LlmProvider,
  UpdateChannel,
} from "../../types";

const TEXT_SIZE_MODE_STORAGE_KEY = "glimpse_text_size_mode";

const parseTextSizeMode = (value: string | null): TextSizeMode =>
  value === "small" || value === "default" || value === "large"
    ? value
    : "default";

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
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [inputDevices, setInputDevices] = useState<DeviceInfo[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>(
    {},
  );
  const [downloadState, setDownloadState] = useState<
    Record<string, DownloadEvent>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [captureActive, setCaptureActive] = useState<
    "smart" | "hold" | "toggle" | null
  >(null);
  const [capturePreview, setCapturePreview] = useState<string>("");
  const pressedModifiers = useRef<Set<string>>(new Set());
  const primaryKey = useRef<string | null>(null);
  const captureActiveRef = useRef<"smart" | "hold" | "toggle" | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("general");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [llmEnabled, setLlmEnabledRaw] = useState(false);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [llmProvider, setLlmProviderRaw] = useState<LlmProvider>("none");
  const [llmEndpoint, setLlmEndpointRaw] = useState("");
  const [llmApiKey, setLlmApiKeyRaw] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [mediaControlEnabled, setMediaControlEnabled] = useState(true);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [textSizeMode, setTextSizeModeRaw] = useState<TextSizeMode>(() =>
    parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
  );
  const [authLoading, setAuthLoading] = useState(false);
  const [showFAQModal, setShowFAQModal] = useState(false);
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [accessibilityPermission, setAccessibilityPermission] = useState<
    boolean | null
  >(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const didHydrateRef = useRef(false);

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
    setUpdateChannel(s.update_channel ?? "stable");
    setLlmEnabledRaw(s.llm_enabled ?? false);
    setCleanupEnabled(s.cleanup_enabled ?? false);
    setLlmProviderRaw(s.llm_provider ?? "none");
    setLlmEndpointRaw(s.llm_endpoint ?? "");
    setLlmApiKeyRaw(s.llm_api_key ?? "");
    setLlmModel(s.llm_model ?? "");
    setEditModeEnabled(s.edit_mode_enabled ?? false);
    setMediaControlEnabled(s.media_control_enabled ?? true);
    setAutoUpdateEnabled(s.auto_update_enabled ?? true);
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
  const languageView = useMemo(
    () =>
      buildTranscriptionLanguageView(
        modelCatalog,
        activeTranscriptionEngine,
        visibleTranscriptionEngines,
      ),
    [modelCatalog, activeTranscriptionEngine, visibleTranscriptionEngines],
  );
  const languageForcedAuto = activeTranscriptionEngine === "parakeet_v3";
  const displayedLanguage = languageForcedAuto ? "" : language;
  const displayedLanguageOptions = useMemo(
    () =>
      languageForcedAuto
        ? languageView.options.filter((option) => option.code === "")
        : languageView.options,
    [languageForcedAuto, languageView.options],
  );

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

  // Guard: non-subscribers can't have cloud sync
  useEffect(() => {
    if (currentUser && !isSubscriber && cloudSyncEnabled) {
      setCloudSyncEnabled(false);
    }
  }, [currentUser, isSubscriber, cloudSyncEnabled, setCloudSyncEnabled]);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) {
      didHydrateRef.current = false;
      if (captureActive) {
        invoke("set_shortcut_capture_active", { active: false }).catch(
          () => {},
        );
        setCaptureActive(null);
        captureActiveRef.current = null;
        setCapturePreview("");
        pressedModifiers.current.clear();
        primaryKey.current = null;
      }
    }
  }, [isOpen, captureActive]);

  useEffect(() => {
    captureActiveRef.current = captureActive;
  }, [captureActive]);

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

  useEffect(() => {
    if (activeTab !== "app" || !isOpen) return;
    const checkPermissions = async () => {
      try {
        const nativeMic = await checkMicrophonePermission();
        if (nativeMic) {
          setMicPermission(true);
        } else {
          try {
            const result = await navigator.permissions.query({
              name: "microphone" as PermissionName,
            });
            setMicPermission(result.state === "granted");
          } catch {
            setMicPermission(false);
          }
        }
      } catch {
        setMicPermission(false);
      }
      try {
        const acc = await checkAccessibilityPermission();
        setAccessibilityPermission(acc);
      } catch {
        setAccessibilityPermission(false);
      }
    };
    checkPermissions();
    const interval = setInterval(checkPermissions, 1500);
    return () => clearInterval(interval);
  }, [activeTab, isOpen]);

  useEffect(() => {
    const unlistenPromise = listen<StoredSettings>(
      "settings:changed",
      (event) => {
        const s = event.payload;
        if (!s) return;
        // Skip the echo if we're in the middle of an auto-save
        if (isSavingRef.current) return;
        hydrateFromSettings(s);
      },
    );
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [hydrateFromSettings]);

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
    if (!isOpen) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const settings = await invoke<StoredSettings>("get_settings");
        hydrateFromSettings(settings);
      } catch (err) {
        console.error("Failed to load settings:", err);
        setError("Failed to load settings");
      }

      try {
        const devices = await invoke<DeviceInfo[]>("list_input_devices");
        setInputDevices(devices);
      } catch (err) {
        console.error("Failed to list input devices:", err);
      }

      try {
        const models = await invoke<ModelInfo[]>("list_models");
        setModelCatalog(models);
        for (const model of models) {
          void refreshModelStatus(model.key);
        }
        setLocalModel((current) =>
          models.some((model) => model.key === current)
            ? current
            : (models[0]?.key ?? ""),
        );
      } catch (err) {
        console.error("Failed to list models:", err);
      }

      try {
        const info = await invoke<AppInfo>("get_app_info");
        setAppInfo(info);
      } catch (err) {
        console.error("Failed to get app info:", err);
      }

      setLoading(false);
    };
    loadData();
  }, [isOpen, refreshModelStatus, hydrateFromSettings]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;

    const setup = async () => {
      const progressUnlisten = await listen<DownloadProgressPayload>(
        "download:progress",
        (event) => {
          const payload = event.payload;
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
      );
      if (cancelled) {
        progressUnlisten();
        return;
      }
      unlistenProgress = progressUnlisten;

      const completeUnlisten = await listen<{ model: string }>(
        "download:complete",
        (event) => {
          const model = event.payload.model;
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
      );
      if (cancelled) {
        completeUnlisten();
        return;
      }
      unlistenComplete = completeUnlisten;

      const errorUnlisten = await listen<{ model: string; error: string }>(
        "download:error",
        (event) => {
          const { model, error } = event.payload;
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
      );
      if (cancelled) {
        errorUnlisten();
        return;
      }
      unlistenError = errorUnlisten;
    };

    void setup().catch((err) => {
      console.error("Failed to register download listeners:", err);
    });

    return () => {
      cancelled = true;
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, [isOpen, refreshModelStatus]);

  const finalizeCapture = useCallback(() => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    captureActiveRef.current = null;
    setCaptureActive(null);
    pressedModifiers.current.clear();
    primaryKey.current = null;
  }, []);

  useEffect(() => {
    if (!captureActive) {
      setCapturePreview("");
      return;
    }

    const updatePreview = () => {
      const preview = buildShortcutPreviewString(
        pressedModifiers.current,
        primaryKey.current,
      );
      setCapturePreview(preview ? formatShortcutForDisplay(preview) : "");
    };

    const captureCurrentCombo = () => {
      const combo = buildShortcutString(
        pressedModifiers.current,
        primaryKey.current,
      );
      if (!combo) {
        setError(
          "Shortcut must include a non-modifier key (for example, Control+Space).",
        );
        pressedModifiers.current.clear();
        primaryKey.current = null;
        setCapturePreview("");
        return;
      }

      if (captureActive === "smart") {
        setSmartShortcut(combo);
      } else if (captureActive === "hold") {
        setHoldShortcut(combo);
      } else if (captureActive === "toggle") {
        setToggleShortcut(combo);
      }
      setError(null);
      finalizeCapture();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      event.preventDefault();
      setError(null);
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.add(modifier);
        updatePreview();
        return;
      }
      if (event.code) {
        primaryKey.current = event.code;
        updatePreview();
        captureCurrentCombo();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      event.preventDefault();
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.delete(modifier);
        updatePreview();
        return;
      }
      if (event.code && !primaryKey.current) {
        primaryKey.current = event.code;
        updatePreview();
        captureCurrentCombo();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeCapture();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("keydown", handleEscape, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [captureActive, finalizeCapture]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (captureActiveRef.current) {
        e.preventDefault();
        finalizeCapture();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, finalizeCapture]);

  const isSavingRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }

    const saveSettings = async () => {
      if (!localModel) return;

      const effectiveLlm = llmEnabled && llmConfigReady;

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
            updateChannel,
            llmEnabled,
            cleanupEnabled: effectiveLlm ? cleanupEnabled : false,
            llmProvider,
            llmEndpoint,
            llmApiKey,
            llmModel,
            editModeEnabled: effectiveLlm ? editModeEnabled : false,
            mediaControlEnabled,
            autoUpdateEnabled,
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

    saveSettings();
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
    updateChannel,
    llmEnabled,
    cleanupEnabled,
    llmProvider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    editModeEnabled,
    mediaControlEnabled,
    autoUpdateEnabled,
    analyticsEnabled,
    llmConfigReady,
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
        setError(null);
        return;
      }
      pressedModifiers.current.clear();
      primaryKey.current = null;
      setCapturePreview("");
      captureActiveRef.current = mode;
      setCaptureActive(mode);
      setError(null);
      invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
        console.error("Failed to disable shortcuts for capture", err);
      });
    },
    [captureActive, finalizeCapture],
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
    languages: displayedLanguageOptions,
    languageBadgeColumns: languageView.badgeColumns,
    showLanguageSupportBadges,
    updateChannel,
    setUpdateChannel,

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
    analyticsEnabled,
    setAnalyticsEnabled,

    authLoading,
    currentUser,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    handleSignOut,
    handleCancelAuth,

    micPermission,
    accessibilityPermission,
    textSizeMode,
    setTextSizeMode,

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
