import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { Cpu, Info, Keyboard, Sliders, User, X } from "lucide-react";
import FAQModal from "../FAQModal";
import WhatsNewModal from "./WhatsNewModal";
import AboutTab from "./tabs/AboutTab";
import AccountTab from "./tabs/AccountTab";
import AdvancedTab from "./tabs/AdvancedTab";
import GeneralTab from "./tabs/GeneralTab";
import ModelsTab from "./tabs/ModelsTab";
import { logout, type User as AuthUser } from "../../lib/auth";
import {
  buildTranscriptionLanguageView,
  getActiveTranscriptionEngine,
  getCatalogTranscriptionEngines,
  getInstalledTranscriptionEngines,
  type TranscriptionEngineId,
} from "../../lib/transcriptionLanguages";
import {
  buildShortcutPreviewString,
  buildShortcutString,
  formatShortcutForDisplay,
  normalizeShortcutModifier,
} from "../../lib/shortcuts";
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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "general" | "account" | "models" | "about";
  currentUser: AuthUser | null;
  onUpdateUser: () => Promise<void>;
  transcriptionMode: TranscriptionMode;
}

const SettingsModal = ({
  isOpen,
  onClose,
  initialTab = "general",
  currentUser,
  onUpdateUser,
  transcriptionMode: initialTranscriptionMode,
}: SettingsModalProps) => {
  const [smartShortcut, setSmartShortcut] = useState("Control+Space");
  const [smartEnabled, setSmartEnabled] = useState(true);
  const [holdShortcut, setHoldShortcut] = useState("Control+Shift+Space");
  const [holdEnabled, setHoldEnabled] = useState(false);
  const [toggleShortcut, setToggleShortcut] = useState("Control+Alt+Space");
  const [toggleEnabled, setToggleEnabled] = useState(false);
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>(
    initialTranscriptionMode,
  );
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
  const [activeTab, setActiveTab] = useState<
    "general" | "models" | "about" | "account" | "advanced"
  >("general");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("custom");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [textSizeMode, setTextSizeMode] = useState<TextSizeMode>(() =>
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

  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(() => {
    const stored = localStorage.getItem("glimpse_cloud_sync_enabled");
    return stored !== null ? stored === "true" : false;
  });

  useEffect(() => {
    if (currentUser && !isSubscriber && cloudSyncEnabled) {
      setCloudSyncEnabled(false);
    }
  }, [currentUser, isSubscriber, cloudSyncEnabled]);

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
    localStorage.setItem(
      "glimpse_cloud_sync_enabled",
      String(cloudSyncEnabled),
    );
    emit("auth:changed").catch(() => {});
  }, [cloudSyncEnabled]);

  useEffect(() => {
    localStorage.setItem(TEXT_SIZE_MODE_STORAGE_KEY, textSizeMode);
    emit("ui:text_size_changed", { mode: textSizeMode }).catch(() => {});
  }, [textSizeMode]);

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
    if (activeTab === "advanced" && isOpen) {
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
    }
  }, [activeTab, isOpen]);

  const handleOpenDataDir = useCallback(async () => {
    if (!appInfo?.data_dir_path) return;
    try {
      await invoke("open_data_dir", { path: appInfo.data_dir_path });
    } catch (err) {
      console.error("Failed to open data directory:", err);
    }
  }, [appInfo?.data_dir_path]);

  useEffect(() => {
    if (transcriptionMode === "cloud" && activeTab === "models") {
      setActiveTab("general");
    }
  }, [transcriptionMode, activeTab]);

  useEffect(() => {
    const unlistenPromise = listen<StoredSettings>(
      "settings:changed",
      (event) => {
        const settings = event.payload;
        if (!settings) return;
        setSmartShortcut(settings.smart_shortcut);
        setSmartEnabled(settings.smart_enabled);
        setHoldShortcut(settings.hold_shortcut);
        setHoldEnabled(settings.hold_enabled);
        setToggleShortcut(settings.toggle_shortcut);
        setToggleEnabled(settings.toggle_enabled);
        setTranscriptionMode(settings.transcription_mode);
        setLocalModel(settings.local_model);
        setMicrophoneDevice(settings.microphone_device);
        setLanguage(settings.language);
        setUpdateChannel(settings.update_channel ?? "stable");
        setLlmEnabled(settings.llm_enabled ?? false);
        setCleanupEnabled(settings.cleanup_enabled ?? false);
        setLlmProvider(settings.llm_provider ?? "none");
        setLlmEndpoint(settings.llm_endpoint ?? "");
        setLlmApiKey(settings.llm_api_key ?? "");
        setLlmModel(settings.llm_model ?? "");
        setEditModeEnabled(settings.edit_mode_enabled ?? false);
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

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
    if (isOpen) {
      const loadData = async () => {
        setLoading(true);
        try {
          const settings = await invoke<StoredSettings>("get_settings");
          setSmartShortcut(settings.smart_shortcut);
          setSmartEnabled(settings.smart_enabled);
          setHoldShortcut(settings.hold_shortcut);
          setHoldEnabled(settings.hold_enabled);
          setToggleShortcut(settings.toggle_shortcut);
          setToggleEnabled(settings.toggle_enabled);
          setTranscriptionMode(settings.transcription_mode);
          setLocalModel(settings.local_model);
          setMicrophoneDevice(settings.microphone_device);
          setLanguage(settings.language);
          setUpdateChannel(settings.update_channel ?? "stable");
          setLlmEnabled(settings.llm_enabled ?? false);
          setCleanupEnabled(settings.cleanup_enabled ?? false);
          setLlmProvider(settings.llm_provider ?? "none");
          setLlmEndpoint(settings.llm_endpoint ?? "");
          setLlmApiKey(settings.llm_api_key ?? "");
          setLlmModel(settings.llm_model ?? "");
          setEditModeEnabled(settings.edit_mode_enabled ?? false);
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
        setLoading(false);
      };
      loadData();
    }
  }, [isOpen, refreshModelStatus]);

  useEffect(() => {
    if (isOpen) {
      invoke<AppInfo>("get_app_info")
        .then((result) => {
          setAppInfo(result);
        })
        .catch((err) => {
          console.error("Failed to get app info:", err);
        });
    }
  }, [isOpen]);

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await logout();
      await onUpdateUser();
    } catch (err) {
      console.error("Sign out failed:", err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCancelAuth = () => {
    setAuthLoading(false);
  };

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

  useEffect(() => {
    setAvailableModels([]);
  }, [llmProvider, llmEndpoint, llmApiKey]);

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
      const combo = buildShortcut();
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
      if (event.key === "Escape") {
        return;
      }
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
      if (event.key === "Escape") {
        return;
      }
      event.preventDefault();
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.delete(modifier);
        updatePreview();
        return;
      }

      // Some system-reserved combos can swallow keydown but still emit keyup.
      // Fall back to keyup capture so combos like Control+Space can still be recorded.
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
  }, [captureActive]);

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
  }, [isOpen, onClose]);

  const handleStartCapture = (mode: "smart" | "hold" | "toggle") => {
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
  };

  const finalizeCapture = () => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    captureActiveRef.current = null;
    setCaptureActive(null);
    pressedModifiers.current.clear();
    primaryKey.current = null;
  };

  const buildShortcut = () => {
    return buildShortcutString(pressedModifiers.current, primaryKey.current);
  };

  useEffect(() => {
    if (loading) return;
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }

    const saveSettings = async () => {
      if (!localModel) return;

      try {
        await invoke("update_settings", {
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
        });
        setError(null);
      } catch (err) {
        console.error(err);
        setError(String(err));
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
  ]);

  const handleDownload = async (modelKey: string) => {
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
      if (errorMsg.toLowerCase().includes("cancelled")) {
        return;
      }
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
  };

  const handleDelete = async (modelKey: string) => {
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
  };

  const handleCancelDownload = async (modelKey: string) => {
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
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const decimals = i >= 3 ? 1 : 0;
    return (
      parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
    );
  };

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.97, y: 6 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 400, damping: 30 },
    },
    exit: {
      opacity: 0,
      scale: 0.97,
      y: 6,
      transition: { duration: 0.12 },
    },
  };

  const tabContentVariants = {
    hidden: { opacity: 1, x: 0 },
    visible: { opacity: 1, x: 0, transition: { duration: 0 } },
    exit: { opacity: 1, x: 0, transition: { duration: 0 } },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            variants={backdropVariants}
            onClick={onClose}
          />

          <motion.div
            className="relative flex max-h-[80vh] h-[625px] w-[850px] overflow-hidden rounded-2xl border border-border-secondary bg-surface-overlay shadow-2xl shadow-black/50"
            variants={modalVariants}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <motion.button
              onClick={onClose}
              className="absolute right-2 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-lg text-content-muted hover:bg-surface-elevated hover:text-content-secondary transition-colors"
              whileTap={{ scale: 0.95 }}
              aria-label="Close settings"
            >
              <X size={14} aria-hidden="true" />
            </motion.button>
            <aside className="flex w-44 flex-col border-r border-border-primary bg-surface-surface">
              <div className="px-4 pt-5 pb-4">
                <h2 className="ui-text-title-strong ui-color-primary">
                  Settings
                </h2>
              </div>
              <nav className="flex-1 px-2 space-y-4">
                <div className="space-y-1">
                  <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                    Account
                  </p>
                  <ModalNavItem
                    icon={<User size={14} aria-hidden="true" />}
                    label="Account"
                    active={activeTab === "account"}
                    onClick={() => setActiveTab("account")}
                  />
                </div>

                <div className="space-y-1">
                  <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                    General
                  </p>
                  <ModalNavItem
                    icon={<Keyboard size={14} aria-hidden="true" />}
                    label="General"
                    active={activeTab === "general"}
                    onClick={() => setActiveTab("general")}
                  />
                  <ModalNavItem
                    icon={<Sliders size={14} aria-hidden="true" />}
                    label="Advanced"
                    active={activeTab === "advanced"}
                    onClick={() => setActiveTab("advanced")}
                  />
                  <ModalNavItem
                    icon={<Info size={14} aria-hidden="true" />}
                    label="About"
                    active={activeTab === "about"}
                    onClick={() => setActiveTab("about")}
                  />
                </div>

                <AnimatePresence>
                  {!loading && transcriptionMode === "local" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                        Local
                      </p>
                      <ModalNavItem
                        icon={<Cpu size={14} aria-hidden="true" />}
                        label="Models"
                        active={activeTab === "models"}
                        onClick={() => setActiveTab("models")}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </nav>
            </aside>

            <main className="flex flex-1 flex-col min-h-0 bg-surface-overlay">
              <div
                className="flex-1 min-h-0 overflow-y-scroll px-6 pt-8 pb-5 settings-scroll"
                style={{ scrollbarGutter: "stable" }}
              >
                <AnimatePresence mode="wait">
                  {activeTab === "account" && (
                    <AccountTab
                      variants={tabContentVariants}
                      authLoading={authLoading}
                      currentUser={currentUser}
                      cloudSyncEnabled={cloudSyncEnabled}
                      setCloudSyncEnabled={setCloudSyncEnabled}
                      onUpdateUser={onUpdateUser}
                      handleSignOut={handleSignOut}
                      handleCancelAuth={handleCancelAuth}
                    />
                  )}

                  {activeTab === "general" && (
                    <GeneralTab
                      variants={tabContentVariants}
                      transcriptionMode={transcriptionMode}
                      onTranscriptionModeChange={setTranscriptionMode}
                      loading={loading}
                      modelStatus={modelStatus}
                      localModel={localModel}
                      onOpenModelsTab={() => setActiveTab("models")}
                      inputDevices={inputDevices}
                      microphoneDevice={microphoneDevice}
                      onMicrophoneDeviceChange={setMicrophoneDevice}
                      language={displayedLanguage}
                      onLanguageChange={setLanguage}
                      languages={displayedLanguageOptions}
                      languageBadgeColumns={languageView.badgeColumns}
                      showLanguageSupportBadges={showLanguageSupportBadges}
                      smartShortcut={smartShortcut}
                      smartEnabled={smartEnabled}
                      setSmartEnabled={setSmartEnabled}
                      holdShortcut={holdShortcut}
                      holdEnabled={holdEnabled}
                      setHoldEnabled={setHoldEnabled}
                      toggleShortcut={toggleShortcut}
                      toggleEnabled={toggleEnabled}
                      setToggleEnabled={setToggleEnabled}
                      captureActive={captureActive}
                      capturePreview={capturePreview}
                      onStartCapture={handleStartCapture}
                      error={error}
                      errorCopied={errorCopied}
                      setErrorCopied={setErrorCopied}
                      editModeEnabled={editModeEnabled}
                      setEditModeEnabled={setEditModeEnabled}
                      cleanupEnabled={cleanupEnabled}
                      setCleanupEnabled={setCleanupEnabled}
                      llmEnabled={llmEnabled}
                    />
                  )}

                  {activeTab === "models" && (
                    <ModelsTab
                      variants={tabContentVariants}
                      llmEnabled={llmEnabled}
                      setLlmEnabled={setLlmEnabled}
                      llmProvider={llmProvider}
                      setLlmProvider={setLlmProvider}
                      llmEndpoint={llmEndpoint}
                      setLlmEndpoint={setLlmEndpoint}
                      llmApiKey={llmApiKey}
                      setLlmApiKey={setLlmApiKey}
                      llmModel={llmModel}
                      setLlmModel={setLlmModel}
                      availableModels={availableModels}
                      fetchAvailableModels={fetchAvailableModels}
                      modelCatalog={modelCatalog}
                      modelStatus={modelStatus}
                      downloadState={downloadState}
                      localModel={localModel}
                      setLocalModel={setLocalModel}
                      handleDownload={handleDownload}
                      handleDelete={handleDelete}
                      handleCancelDownload={handleCancelDownload}
                      formatBytes={formatBytes}
                    />
                  )}

                  {activeTab === "advanced" && (
                    <AdvancedTab
                      variants={tabContentVariants}
                      micPermission={micPermission}
                      accessibilityPermission={accessibilityPermission}
                      textSizeMode={textSizeMode}
                      onTextSizeModeChange={setTextSizeMode}
                    />
                  )}

                  {activeTab === "about" && (
                    <AboutTab
                      variants={tabContentVariants}
                      appInfo={appInfo}
                      formatBytes={formatBytes}
                      onOpenDataDir={handleOpenDataDir}
                      onOpenFAQ={() => setShowFAQModal(true)}
                      updateChannel={updateChannel}
                      onUpdateChannelChange={setUpdateChannel}
                    />
                  )}
                </AnimatePresence>
              </div>
            </main>
          </motion.div>
        </motion.div>
      )}

      <FAQModal isOpen={showFAQModal} onClose={() => setShowFAQModal(false)} />
      <WhatsNewModal
        isOpen={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        updateChannel={updateChannel}
      />
    </AnimatePresence>
  );
};

const ModalNavItem = ({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <motion.button
    onClick={onClick}
    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 ui-text-body-sm-strong transition-colors ${
      active
        ? "bg-surface-elevated ui-color-primary"
        : "ui-color-muted hover:bg-surface-elevated hover:text-content-secondary"
    }`}
    whileTap={{ scale: 0.98 }}
  >
    <div className={active ? "text-cloud/80" : "text-content-disabled"}>
      {icon}
    </div>
    {label}
  </motion.button>
);

export default SettingsModal;
