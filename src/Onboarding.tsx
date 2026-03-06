import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import {
  Mic,
  Accessibility,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  Loader2,
  Square,
  AlertTriangle,
  Mail,
} from "lucide-react";
import DotMatrix from "./components/DotMatrix";
import FAQModal from "./components/FAQModal";
import {
  buildShortcutPreviewString,
  buildShortcutString,
  formatShortcutForDisplay,
  normalizeShortcutModifier,
} from "./lib/shortcuts";
import type {
  ModelInfo,
  ModelStatus,
  StoredSettings,
  TranscriptionMode,
} from "./types";

type OnboardingStep =
  | "welcome"
  | "local-model"
  | "local-signin"
  | "microphone"
  | "accessibility"
  | "ready";

type LocalDownloadStatus = {
  status: "idle" | "downloading" | "complete" | "error" | "cancelled";
  percent: number;
  file?: string;
  message?: string;
};

interface OnboardingProps {
  onComplete: () => void;
}

const hasRecommendedTag = (model: Pick<ModelInfo, "tags">) =>
  model.tags.some((tag) => tag.toLowerCase() === "recommended");

// Keep in sync with the intended onboarding shortlist.
const FEATURED_ONBOARDING_MODEL_KEYS = [
  "whisper_large_v3_turbo_q8",
  "parakeet_tdt_int8",
] as const;

const sortOnboardingModels = (models: ModelInfo[]) =>
  [...models].sort((a, b) => {
    const recommendedDelta =
      Number(hasRecommendedTag(b)) - Number(hasRecommendedTag(a));
    if (recommendedDelta !== 0) return recommendedDelta;
    return a.label.localeCompare(b.label);
  });

const pickOnboardingModels = (models: ModelInfo[]) => {
  const featured = sortOnboardingModels(
    models.filter((model) =>
      FEATURED_ONBOARDING_MODEL_KEYS.includes(
        model.key as (typeof FEATURED_ONBOARDING_MODEL_KEYS)[number],
      ),
    ),
  );
  return featured.length > 0
    ? featured
    : sortOnboardingModels(models).slice(0, 2);
};

const pickDefaultOnboardingModel = (models: ModelInfo[]) =>
  pickOnboardingModels(models)[0]?.key ?? "";

// Keep in sync with src-tauri/src/settings.rs default_local_model().
const DEFAULT_LOCAL_MODEL_KEY = "parakeet_tdt_int8";

const GlimpseLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const [pattern, setPattern] = useState(0);
  const intervalRef = useRef<number | null>(null);

  const sizes = {
    sm: { dot: 5, gap: 4 },
    md: { dot: 10, gap: 7 },
    lg: { dot: 14, gap: 10 },
  }[size];

  const patterns = [
    [true, false, false, true],
    [false, true, true, false],
    [true, true, true, true],
  ];

  const dotColors = [
    "var(--color-cloud)",
    "var(--color-local)",
    "var(--color-local)",
    "var(--color-cloud)",
  ];

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setPattern((p) => (p + 1) % patterns.length);
    }, 700);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const currentPattern = patterns[pattern];
  const gridSize = sizes.dot * 2 + sizes.gap;

  return (
    <div className="relative" style={{ width: gridSize, height: gridSize }}>
      {[0, 1, 2, 3].map((i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const isActive = currentPattern[i];

        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: sizes.dot,
              height: sizes.dot,
              left: col * (sizes.dot + sizes.gap),
              top: row * (sizes.dot + sizes.gap),
              backgroundColor: dotColors[i],
            }}
            animate={{
              opacity: isActive ? 1 : 0.15,
              scale: isActive ? 1 : 0.85,
            }}
            transition={{
              duration: 0.3,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
};

const StepIndicator = ({
  currentStep,
  total,
}: {
  currentStep: number;
  total: number;
}) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: total }).map((_, i) => (
      <motion.div
        key={i}
        className="h-1.5 rounded-full bg-amber-400"
        animate={{
          width: i === currentStep ? 20 : 6,
          opacity: i <= currentStep ? 1 : 0.25,
        }}
        transition={{ duration: 0.25 }}
      />
    ))}
  </div>
);

const StatusBadge = ({
  granted,
  checking,
}: {
  granted: boolean;
  checking?: boolean;
}) => {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 ui-text-label text-content-muted">
        <Loader2 size={11} className="animate-spin" />
        Checking...
      </span>
    );
  }

  if (granted) {
    return (
      <motion.span
        className="inline-flex items-center gap-1 ui-text-label font-medium ui-color-success-strong"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <Check size={12} />
        Enabled
      </motion.span>
    );
  }

  return <span className="ui-text-label text-content-muted">Not enabled</span>;
};

const stepTransitionVariants = {
  enter: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? -28 : 28 }),
};

const Onboarding = ({ onComplete }: OnboardingProps) => {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [transitionDirection, setTransitionDirection] = useState<1 | -1>(1);
  const [hasStepTransitioned, setHasStepTransitioned] = useState(false);
  const [micPermission, setMicPermission] = useState(false);
  const [accessibilityPermission, setAccessibilityPermission] = useState(false);
  const [isCheckingMic, setIsCheckingMic] = useState(true);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(true);
  const [selectedMode, setSelectedMode] = useState<TranscriptionMode>("local");
  const [localModelChoice, setLocalModelChoice] = useState("");
  const [persistedLocalModel, setPersistedLocalModel] = useState("");
  const [localDownload, setLocalDownload] = useState<
    Record<string, LocalDownloadStatus>
  >({});
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>(
    {},
  );
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(true);
  const [modelCatalogUnavailable, setModelCatalogUnavailable] = useState(false);
  const [showLocalConfirm, setShowLocalConfirm] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const [showFAQModal, setShowFAQModal] = useState(false);

  const [smartShortcut, setSmartShortcut] = useState("Control+Space");
  const [captureActive, setCaptureActive] = useState(false);
  const [capturePreview, setCapturePreview] = useState("");
  const pressedModifiers = useRef<Set<string>>(new Set());
  const primaryKey = useRef<string | null>(null);

  const steps: OnboardingStep[] = useMemo(
    () =>
      selectedMode === "cloud"
        ? [
            "welcome",
            "local-signin",
            "local-model",
            "microphone",
            "accessibility",
            "ready",
          ]
        : ["welcome", "local-model", "microphone", "accessibility", "ready"],
    [selectedMode],
  );
  const onboardingModelCatalog = useMemo(
    () => pickOnboardingModels(modelCatalog),
    [modelCatalog],
  );
  const currentStepIndex = steps.indexOf(step);

  useEffect(() => {
    if (showLocalConfirm) setShowLocalConfirm(false);
  }, [step]);

  useEffect(() => {
    if (completionError) {
      setCompletionError(null);
    }
  }, [step]);

  const checkMicPermission = useCallback(async () => {
    try {
      const nativeGranted = await checkMicrophonePermission();
      if (nativeGranted) {
        setMicPermission(true);
        return;
      }

      try {
        const result = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (result.state === "granted") {
          setMicPermission(true);
          return;
        }
      } catch {
        // Permissions API not supported or failed
      }

      setMicPermission(false);
    } catch (err) {
      console.error("Failed to check microphone permission:", err);
      setMicPermission(false);
    } finally {
      setIsCheckingMic(false);
    }
  }, []);

  const checkAccessPermission = useCallback(async () => {
    try {
      const granted = await checkAccessibilityPermission();
      setAccessibilityPermission(granted);
    } catch (err) {
      console.error("Failed to check accessibility permission:", err);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, []);

  useEffect(() => {
    checkMicPermission();
    checkAccessPermission();
  }, [checkMicPermission, checkAccessPermission]);

  useEffect(() => {
    if (step === "microphone") {
      const interval = setInterval(checkMicPermission, 1500);
      return () => clearInterval(interval);
    }
  }, [step, checkMicPermission]);

  useEffect(() => {
    if (step === "accessibility") {
      const interval = setInterval(checkAccessPermission, 800);
      return () => clearInterval(interval);
    }
  }, [step, checkAccessPermission]);

  const handleRequestMicrophoneAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await checkMicPermission();
    } catch (err) {
      console.error("Failed to request microphone:", err);
      try {
        await invoke("open_microphone_settings");
      } catch (e) {
        console.error("Failed to open settings:", e);
      }
    }
  };

  const handleRequestAccessibilityAccess = async () => {
    try {
      await requestAccessibilityPermission();
      await checkAccessPermission();
    } catch (err) {
      console.error("Failed to request accessibility:", err);
      try {
        await invoke("open_accessibility_settings");
      } catch (e) {
        console.error("Failed to open settings:", e);
      }
    }
  };

  const handleComplete = async () => {
    const resolvedLocalModel =
      localModelChoice ||
      pickDefaultOnboardingModel(modelCatalog) ||
      persistedLocalModel ||
      DEFAULT_LOCAL_MODEL_KEY;

    setIsCompleting(true);
    setCompletionError(null);

    if (!resolvedLocalModel) {
      setCompletionError(
        "Could not load a local model selection. Try reopening onboarding.",
      );
      setIsCompleting(false);
      return;
    }

    try {
      localStorage.setItem("glimpse_cloud_sync_enabled", "false");

      await invoke("update_settings", {
        smartShortcut,
        smartEnabled: true,
        holdShortcut: "Control+Shift+Space",
        holdEnabled: false,
        toggleShortcut: "Control+Alt+Space",
        toggleEnabled: false,
        transcriptionMode: "local",
        localModel: resolvedLocalModel,
        microphoneDevice: null,
        language: "en",
        updateChannel: "stable",
        llmCleanupEnabled: false,
        llmProvider: "custom",
        llmEndpoint: "",
        llmApiKey: "",
        llmModel: "",
        editModeEnabled: false,
      });
      await invoke("complete_onboarding");
      onComplete();
    } catch (err) {
      console.error("Failed to save onboarding settings:", err);
      setCompletionError(
        "Could not finish setup. Check your settings and try again.",
      );
    } finally {
      setIsCompleting(false);
    }
  };

  const goToNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setHasStepTransitioned(true);
      setTransitionDirection(1);
      setStep(steps[nextIndex]);
    }
  };

  const goToPrevStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setHasStepTransitioned(true);
      setTransitionDirection(-1);
      setStep(steps[prevIndex]);
    }
  };

  const finalizeCapture = () => {
    invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    setCaptureActive(false);
    setCapturePreview("");
    pressedModifiers.current.clear();
    primaryKey.current = null;
  };

  const buildShortcut = () => {
    return buildShortcutString(pressedModifiers.current, primaryKey.current);
  };

  const startCapture = () => {
    pressedModifiers.current.clear();
    primaryKey.current = null;
    setCapturePreview("");
    setCaptureActive(true);
    invoke("set_shortcut_capture_active", { active: true }).catch((err) => {
      console.error("Failed to disable shortcuts for capture", err);
    });
  };

  useEffect(() => {
    if (!captureActive) return;

    const updatePreview = () => {
      const preview = buildShortcutPreviewString(
        pressedModifiers.current,
        primaryKey.current,
      );
      setCapturePreview(preview ? formatShortcutForDisplay(preview) : "");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeCapture();
        return;
      }
      event.preventDefault();
      const modifier = normalizeShortcutModifier(event);
      if (modifier) {
        pressedModifiers.current.add(modifier);
        updatePreview();
        return;
      }

      if (event.code) {
        primaryKey.current = event.code;
        updatePreview();
        const combo = buildShortcut();
        if (combo) {
          setSmartShortcut(combo);
          finalizeCapture();
        } else {
          pressedModifiers.current.clear();
          primaryKey.current = null;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalizeCapture();
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
        const combo = buildShortcut();
        if (combo) {
          setSmartShortcut(combo);
          finalizeCapture();
        } else {
          pressedModifiers.current.clear();
          primaryKey.current = null;
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented) {
          return;
        }
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
    return () => {
      invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    };
  }, []);

  const refreshModelStatus = useCallback((modelKey: string) => {
    invoke<ModelStatus>("check_model_status", { model: modelKey })
      .then((status) => {
        setModelStatus((prev) => ({ ...prev, [modelKey]: status }));
      })
      .catch((err) => console.error("Failed to check model status", err));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) {
        setIsLoadingModelCatalog(true);
        setModelCatalogUnavailable(false);
      }
      try {
        const [modelsResult, settingsResult] = await Promise.allSettled([
          invoke<ModelInfo[]>("list_models"),
          invoke<StoredSettings>("get_settings"),
        ]);
        if (!isMounted) return;

        const settings =
          settingsResult.status === "fulfilled" ? settingsResult.value : null;
        if (settings?.local_model) {
          setPersistedLocalModel(settings.local_model);
        }

        if (modelsResult.status === "fulfilled") {
          const orderedModels = sortOnboardingModels(modelsResult.value);
          const onboardingModels = pickOnboardingModels(orderedModels);
          orderedModels.forEach((model) => {
            refreshModelStatus(model.key);
          });
          setModelCatalog(orderedModels);
          setModelCatalogUnavailable(false);
          setLocalModelChoice((current) => {
            if (
              settings?.local_model &&
              onboardingModels.some(
                (model) => model.key === settings.local_model,
              )
            ) {
              return settings.local_model;
            }
            if (
              current &&
              onboardingModels.some((model) => model.key === current)
            ) {
              return current;
            }
            return pickDefaultOnboardingModel(onboardingModels);
          });
        } else {
          console.error("Failed to preload model info", modelsResult.reason);
          setModelCatalog([]);
          setModelCatalogUnavailable(true);
          setLocalModelChoice(
            (current) =>
              current || settings?.local_model || DEFAULT_LOCAL_MODEL_KEY,
          );
        }

        if (settingsResult.status === "rejected") {
          console.error("Failed to preload settings", settingsResult.reason);
        }
      } catch (err) {
        console.error("Failed to preload onboarding data", err);
        if (!isMounted) return;
        setModelCatalog([]);
        setModelCatalogUnavailable(true);
        setLocalModelChoice((current) => current || DEFAULT_LOCAL_MODEL_KEY);
      } finally {
        if (isMounted) {
          setIsLoadingModelCatalog(false);
        }
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [refreshModelStatus]);

  useEffect(() => {
    let active = true;
    const disposers: UnlistenFn[] = [];

    const setup = async () => {
      try {
        const results = await Promise.allSettled([
          listen<{
            model: string;
            percent: number;
            downloaded: number;
            total: number;
            file: string;
          }>("download:progress", (event) => {
            const payload = event.payload;
            setLocalDownload((prev) => ({
              ...prev,
              [payload.model]: {
                status: "downloading",
                percent: Math.min(100, payload.percent),
                file: payload.file,
              },
            }));
          }),
          listen<{ model: string }>("download:complete", (event) => {
            const model = event.payload.model;
            setLocalDownload((prev) => ({
              ...prev,
              [model]: {
                status: "complete",
                percent: 100,
                file: prev[model]?.file,
                message: prev[model]?.message,
              },
            }));
            refreshModelStatus(model);
          }),
          listen<{ model: string; error: string }>(
            "download:error",
            (event) => {
              const { model, error } = event.payload;
              if (error.toLowerCase().includes("cancelled")) return;
              setLocalDownload((prev) => ({
                ...prev,
                [model]: {
                  status: "error",
                  percent: prev[model]?.percent ?? 0,
                  message: error,
                },
              }));
            },
          ),
        ]);

        results.forEach((res) => {
          if (res.status === "fulfilled") {
            if (!active) {
              res.value();
            } else {
              disposers.push(res.value);
            }
          } else {
            console.error("Failed to set up download listener", res.reason);
          }
        });
      } catch (err) {
        console.error("Failed to set up download listeners", err);
      }
    };

    setup();

    return () => {
      active = false;
      disposers.forEach((fn) => fn());
    };
  }, [refreshModelStatus]);

  const handleLocalDownload = async (modelKey: string) => {
    setLocalDownload((prev) => ({
      ...prev,
      [modelKey]: { status: "downloading", percent: 0, file: "starting..." },
    }));
    try {
      await invoke("download_model", { model: modelKey });
    } catch (err) {
      const errorMsg = String(err);
      if (errorMsg.toLowerCase().includes("cancelled")) {
        return;
      }
      console.error(err);
      setLocalDownload((prev) => ({
        ...prev,
        [modelKey]: { status: "error", percent: 0, message: "Download failed" },
      }));
    }
  };

  const handleLocalDelete = async (modelKey: string) => {
    try {
      await invoke("delete_model", { model: modelKey });
      setLocalDownload((prev) => ({
        ...prev,
        [modelKey]: { status: "idle", percent: 0 },
      }));
      refreshModelStatus(modelKey);
    } catch (err) {
      console.error(err);
      setLocalDownload((prev) => ({
        ...prev,
        [modelKey]: {
          status: "error",
          percent: prev[modelKey]?.percent ?? 0,
          message: "Delete failed",
        },
      }));
    }
  };

  const handleCancelDownload = async (modelKey: string) => {
    try {
      await invoke("cancel_download", { model: modelKey });
      setLocalDownload((prev) => ({
        ...prev,
        [modelKey]: { status: "cancelled", percent: 0 },
      }));
      setTimeout(() => {
        setLocalDownload((prev) => {
          if (prev[modelKey]?.status === "cancelled") {
            return { ...prev, [modelKey]: { status: "idle", percent: 0 } };
          }
          return prev;
        });
      }, 1500);
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  };

  const displayStateByModel = useMemo(() => {
    const buildState = (key: string): LocalDownloadStatus => {
      const installed = modelStatus[key]?.installed;
      const base = localDownload[key];
      if (installed) {
        return {
          status: "complete" as const,
          percent: 100,
          file: base?.file,
          message: base?.message,
        };
      }
      return base ?? { status: "idle", percent: 0 };
    };
    return onboardingModelCatalog.reduce<Record<string, LocalDownloadStatus>>(
      (acc, model) => {
        acc[model.key] = buildState(model.key);
        return acc;
      },
      {},
    );
  }, [localDownload, onboardingModelCatalog, modelStatus]);

  const selectedModelReady = useMemo(() => {
    if (!localModelChoice) {
      return false;
    }

    const displayState = displayStateByModel[localModelChoice];
    return Boolean(
      modelStatus[localModelChoice]?.installed ||
      displayState?.status === "complete",
    );
  }, [displayStateByModel, localModelChoice, modelStatus]);

  const handleLocalModelContinue = () => {
    if (!selectedModelReady) {
      setShowLocalConfirm(true);
      return;
    }
    goToNextStep();
  };

  const stepMotionProps = {
    custom: transitionDirection,
    variants: stepTransitionVariants,
    animate: "center" as const,
    exit: "exit" as const,
    transition: { duration: 0.22, ease: "easeOut" as const },
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-secondary ui-color-on-solid select-none relative">
      <div data-tauri-drag-region className="h-7 w-full shrink-0" />

      <div className="flex justify-center pt-6 pb-6">
        <StepIndicator currentStep={currentStepIndex} total={steps.length} />
      </div>

      <div className="flex-1 flex items-center justify-center px-10 pb-10">
        <AnimatePresence mode="wait" custom={transitionDirection}>
          {step === "welcome" && (
            <motion.div
              key="welcome"
              {...stepMotionProps}
              initial={hasStepTransitioned ? "enter" : false}
              className="flex flex-col items-center text-center w-full max-w-5xl"
            >
              <div className="mb-6">
                <GlimpseLogo size="lg" />
              </div>

              <h1 className="ui-text-screen-title font-semibold text-content-primary mb-2">
                Welcome to Glimpse
              </h1>

              <p className="ui-text-body-lg text-content-muted mb-8">
                Build at the speed of speech.
              </p>

              <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <button
                  type="button"
                  disabled
                  className={`group relative w-full rounded-2xl border p-4 text-left space-y-3 ui-shadow-onboarding-cloud overflow-hidden transition-colors ${
                    selectedMode === "cloud"
                      ? "border-cloud-50 bg-surface-tertiary ring-1 ring-cloud-30"
                      : "border-border-primary bg-surface-tertiary opacity-70 cursor-not-allowed"
                  }`}
                  aria-pressed={selectedMode === "cloud"}
                  aria-disabled="true"
                >
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 opacity-18">
                      <DotMatrix
                        rows={6}
                        cols={18}
                        activeDots={[
                          1, 4, 7, 10, 12, 15, 18, 20, 23, 26, 29, 32, 35, 38,
                          41, 44, 47, 50, 53, 56, 59, 62, 65, 68,
                        ]}
                        dotSize={2}
                        gap={4}
                        color="var(--color-border-secondary)"
                      />
                    </div>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <DotMatrix
                      rows={2}
                      cols={2}
                      activeDots={[0, 3]}
                      dotSize={3}
                      gap={2}
                      color="var(--color-cloud)"
                    />
                    <span className="ui-text-meta font-semibold ui-color-warning-strong">
                      Glimpse Cloud
                    </span>
                    <span className="ml-2 rounded-lg bg-surface-elevated px-2 py-0.5 ui-text-micro font-medium text-content-muted">
                      In development
                    </span>
                  </div>
                  <div className="relative flex flex-col gap-1.5 ui-text-label text-content-secondary font-medium">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                      <span>Cross-device sync</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                      <span>Bigger & better models</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                      <span>Faster cleanup & delivery</span>
                    </div>
                  </div>
                  <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 ui-text-meta text-content-secondary leading-relaxed">
                    <DotMatrix
                      rows={3}
                      cols={5}
                      activeDots={[0, 2, 4, 6, 8, 10, 12, 14]}
                      dotSize={2}
                      gap={2}
                      color="var(--color-border-secondary)"
                    />
                    <p className="flex-1">
                      Get better models and faster cleanup & delivery ($5.99/mo)
                      with cloud.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMode("local")}
                  className={`group relative w-full rounded-2xl border p-4 text-left space-y-3 ui-shadow-onboarding-local overflow-hidden transition-colors ${
                    selectedMode === "local"
                      ? "border-local-50 bg-surface-tertiary ring-1 ring-local-30"
                      : "border-border-primary bg-surface-tertiary"
                  }`}
                  aria-pressed={selectedMode === "local"}
                  aria-label="Select Local mode (Privacy-first, on-device)"
                >
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 opacity-14">
                      <DotMatrix
                        rows={6}
                        cols={18}
                        activeDots={[
                          0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38,
                          41, 44, 47, 50, 53, 56, 59, 62, 65, 68,
                        ]}
                        dotSize={2}
                        gap={4}
                        color="var(--color-border-primary)"
                      />
                    </div>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <DotMatrix
                      rows={2}
                      cols={2}
                      activeDots={[1, 2]}
                      dotSize={3}
                      gap={2}
                      color="var(--color-local)"
                    />
                    <span className="ui-text-meta font-semibold text-local">
                      Glimpse Local
                    </span>
                  </div>
                  <div className="relative flex flex-col gap-1.5 ui-text-label text-content-secondary font-medium">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-local-80" />
                      <span>Everything stays on-device for privacy </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-local-80" />
                      <span>Local models</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-3 rounded-full bg-local-80" />
                      <span>free optional Cloud transcription sync</span>
                    </div>
                  </div>
                  <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 ui-text-meta text-content-muted leading-relaxed">
                    <DotMatrix
                      rows={3}
                      cols={5}
                      activeDots={[1, 4, 6, 9, 12, 15, 18, 21]}
                      dotSize={2}
                      gap={2}
                      color="var(--color-local)"
                    />
                    <p className="flex-1">
                      Best for privacy-first or offline sessions. Cloud remains
                      optional if you want sync and faster responses.
                    </p>
                  </div>
                </button>
              </div>

              <button
                onClick={goToNextStep}
                className="flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight"
              >
                {selectedMode === "cloud" ? "> Cloud" : "> Local"}
              </button>
            </motion.div>
          )}

          {step === "local-model" && (
            <motion.div
              key="local-model"
              {...stepMotionProps}
              initial="enter"
              className="flex flex-col items-center text-center w-full max-w-2xl"
            >
              <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
                Choose your local model
              </h2>
              <div className="mb-6 flex flex-col gap-1 ui-text-body-lg text-content-muted">
                <p>
                  More models & AI cleanup available in Settings after setup.
                </p>
              </div>

              {isLoadingModelCatalog ? (
                <div className="w-full rounded-2xl border border-border-primary bg-surface-tertiary px-5 py-6 text-left">
                  <p className="ui-text-body-lg font-semibold text-content-primary">
                    Loading local models
                  </p>
                  <p className="mt-2 ui-text-body text-content-muted">
                    Fetching the available local transcription engines for this
                    build.
                  </p>
                </div>
              ) : onboardingModelCatalog.length === 0 ? (
                <div className="w-full rounded-2xl border border-border-primary bg-surface-tertiary px-5 py-6 text-left">
                  <p className="ui-text-body-lg font-semibold text-content-primary">
                    {modelCatalogUnavailable
                      ? "Model list unavailable"
                      : "No local models found"}
                  </p>
                  <p className="mt-2 ui-text-body text-content-muted">
                    {modelCatalogUnavailable
                      ? "Glimpse couldn&apos;t load the local model list. Setup can continue with the default local engine, and you can manage downloads later in Settings."
                      : "This build did not return any local models. You can continue setup and manage models later in Settings."}
                  </p>
                </div>
              ) : (
                <div
                  className={`grid w-full items-start gap-4 ${onboardingModelCatalog.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}
                >
                  {onboardingModelCatalog.map((model) => {
                    const displayState = displayStateByModel[model.key] ?? {
                      status: "idle",
                      percent: 0,
                    };
                    const installed =
                      modelStatus[model.key]?.installed ||
                      displayState.status === "complete";
                    const isSelected = localModelChoice === model.key;
                    const isActive = isSelected && installed;
                    const isWhisper = model.engine_id === "whisper";
                    const accentTextClass = isWhisper
                      ? "text-cloud"
                      : "text-local";
                    const accentFillClass =
                      "bg-cloud/15 text-cloud border-cloud/40";
                    const accentDotColor = isWhisper
                      ? "var(--color-cloud)"
                      : "var(--color-local)";
                    const borderClass = isActive
                      ? "border-cloud-50 bg-surface-tertiary"
                      : isSelected
                        ? "border-border-primary bg-surface-tertiary ring-1 ring-amber-400/30"
                        : "border-border-primary bg-surface-tertiary hover:border-border-hover";
                    const heroDots = isWhisper
                      ? [
                          1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53,
                          57, 61, 65,
                        ]
                      : [
                          0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38,
                          41, 44, 47, 50, 53, 56, 59, 62, 65, 68,
                        ];
                    const headerDots = isWhisper ? [1, 2] : [0];

                    return (
                      <div
                        key={model.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setLocalModelChoice(model.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setLocalModelChoice(model.key);
                          }
                        }}
                        aria-label={`Select ${model.label}`}
                        aria-pressed={isSelected}
                        className={`relative flex w-full self-start cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-colors ${
                          isWhisper
                            ? "ui-shadow-onboarding-model"
                            : "ui-shadow-onboarding-model-alt"
                        } ${borderClass}`}
                        style={
                          isActive
                            ? {
                                outline: "1px solid var(--color-cloud-50)",
                                outlineOffset: "-1px",
                              }
                            : undefined
                        }
                      >
                        <div className="absolute inset-0 pointer-events-none">
                          <div className="absolute inset-0 opacity-10">
                            <DotMatrix
                              rows={6}
                              cols={18}
                              activeDots={heroDots}
                              dotSize={2}
                              gap={4}
                              color="var(--color-border-primary)"
                            />
                          </div>
                        </div>
                        <div className="relative flex flex-col gap-3 p-4 pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <DotMatrix
                                rows={2}
                                cols={2}
                                activeDots={headerDots}
                                dotSize={3}
                                gap={2}
                                color={accentDotColor}
                              />
                              <span className="ui-text-body-lg font-semibold leading-tight text-content-primary text-balance">
                                {model.label}
                              </span>
                            </div>
                            <span className="shrink-0 pt-0.5 ui-text-micro text-content-muted tabular-nums">
                              {model.size_mb >= 1000
                                ? `${(model.size_mb / 1000).toFixed(1)} GB`
                                : `${Math.round(model.size_mb)} MB`}
                            </span>
                          </div>

                          <div className="flex items-center flex-wrap gap-1.5">
                            {model.tags.map((tag) => (
                              <span
                                key={tag}
                                className={`px-1.5 py-0.5 rounded ui-text-nano font-semibold uppercase tracking-wider border ${
                                  tag.toLowerCase() === "recommended"
                                    ? "bg-emerald-500/15 ui-color-success-subtle border-emerald-500/30"
                                    : accentFillClass
                                }`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>

                          <p className="h-16 ui-text-label leading-relaxed text-content-muted text-pretty">
                            {model.description}
                          </p>
                        </div>

                        <div className="relative border-t border-border-primary bg-surface-surface/40 px-4 pt-2 pb-1 ui-text-meta text-content-tertiary leading-relaxed space-y-1.5">
                          <div className="flex items-center gap-2">
                            <button
                              aria-label={
                                displayState.status === "downloading"
                                  ? `Stop downloading ${model.label}`
                                  : displayState.status === "complete"
                                    ? `Delete ${model.label}`
                                    : `Download ${model.label}`
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                if (displayState.status === "downloading") {
                                  handleCancelDownload(model.key);
                                } else if (displayState.status === "complete") {
                                  handleLocalDelete(model.key);
                                } else if (
                                  displayState.status !== "cancelled"
                                ) {
                                  handleLocalDownload(model.key);
                                }
                              }}
                              disabled={displayState.status === "cancelled"}
                              className={`flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary transition-colors ${
                                displayState.status === "downloading" ||
                                displayState.status === "complete"
                                  ? "text-error hover:bg-surface-elevated"
                                  : displayState.status === "cancelled"
                                    ? "text-content-disabled cursor-default"
                                    : "text-content-primary hover:bg-surface-elevated"
                              }`}
                            >
                              {displayState.status === "downloading" ? (
                                <Square size={10} className="fill-current" />
                              ) : displayState.status === "complete" ? (
                                <Trash2 size={14} />
                              ) : (
                                <Download
                                  size={14}
                                  className={
                                    displayState.status === "cancelled"
                                      ? ""
                                      : accentTextClass
                                  }
                                />
                              )}
                            </button>
                            <span className="ui-text-label-strong text-content-secondary">
                              {displayState.status === "complete"
                                ? "Downloaded"
                                : "Download"}
                            </span>
                          </div>
                          <ModelProgress
                            percent={displayState.percent}
                            status={displayState.status}
                          />
                          <div className="h-4 flex items-center">
                            {displayState.status === "downloading" && (
                              <p className="ui-text-meta leading-none text-content-muted tabular-nums truncate w-full">
                                {displayState.percent.toFixed(0)}% ·{" "}
                                {displayState.file ?? ""}
                              </p>
                            )}
                            {displayState.status === "error" && (
                              <p className="ui-text-meta leading-none text-error truncate w-full">
                                {displayState.message ?? "Download failed"}
                              </p>
                            )}
                            {displayState.status === "cancelled" && (
                              <p className="ui-text-meta leading-none text-content-muted">
                                Cancelled
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={handleLocalModelContinue}
                disabled={isLoadingModelCatalog}
                className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingModelCatalog ? "Loading..." : "Continue"}
              </button>
            </motion.div>
          )}

          {step === "local-signin" && (
            <motion.div
              key="local-signin"
              {...stepMotionProps}
              initial="enter"
              className="flex flex-col items-center text-center w-full max-w-sm"
            >
              <div className="mb-4 rounded-2xl bg-local/10 p-4">
                <Mail size={28} className="text-local" />
              </div>
              <h2 className="ui-text-title-lg font-semibold text-content-primary mb-2">
                Transcription Sync
              </h2>
              <p className="ui-text-body-lg text-content-muted mb-2 leading-relaxed">
                Cloud sync is currently{" "}
                <span className="text-content-primary font-medium">
                  in development
                </span>
                .
              </p>
              <p className="ui-text-body-sm text-content-disabled mb-7 leading-relaxed">
                You can keep using Glimpse locally. This screen will be enabled
                in a future update.
              </p>

              <button
                type="button"
                onClick={goToNextStep}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-3 ui-text-body-lg font-semibold text-surface-secondary hover:bg-white transition-colors"
              >
                Continue
              </button>
            </motion.div>
          )}

          {step === "microphone" && (
            <motion.div
              key="microphone"
              {...stepMotionProps}
              initial="enter"
              className="flex flex-col items-center text-center max-w-sm"
            >
              <div className="mb-5">
                <Mic size={32} className="ui-color-warning-strong" />
              </div>

              <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
                Microphone Access
              </h2>

              <div className="mb-3">
                <StatusBadge granted={micPermission} checking={isCheckingMic} />
              </div>

              <p className="ui-text-body-lg text-content-muted mb-6">
                Required to capture your voice for transcription.
              </p>

              {!micPermission ? (
                <button
                  onClick={handleRequestMicrophoneAccess}
                  disabled={isCheckingMic}
                  className="flex items-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-warning hover:bg-amber-300 transition-colors disabled:opacity-50"
                >
                  <Mic size={15} />
                  Grant Access
                </button>
              ) : (
                <button
                  onClick={goToNextStep}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-emerald-400 transition-colors"
                >
                  Continue
                  <ChevronRight size={15} />
                </button>
              )}

              <button
                onClick={goToNextStep}
                className="mt-3 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
              >
                Skip
              </button>
            </motion.div>
          )}

          {step === "accessibility" && (
            <motion.div
              key="accessibility"
              {...stepMotionProps}
              initial="enter"
              className="flex flex-col items-center text-center max-w-sm"
            >
              <div className="mb-5">
                <Accessibility size={32} className="ui-color-accent" />
              </div>

              <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
                Accessibility
              </h2>

              <div className="mb-3">
                <StatusBadge
                  granted={accessibilityPermission}
                  checking={isCheckingAccessibility}
                />
              </div>

              <p className="ui-text-body-lg text-content-muted mb-5">
                Enables auto-paste into any application.
              </p>

              {!accessibilityPermission && (
                <p className="ui-text-body-sm text-content-disabled mb-5">
                  Click below to open System Settings, then toggle on{" "}
                  <span className="text-content-muted">Glimpse</span>
                </p>
              )}

              {!accessibilityPermission ? (
                <button
                  onClick={handleRequestAccessibilityAccess}
                  className="flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-violet-400 transition-colors"
                >
                  <ExternalLink size={15} />
                  Enable in Settings
                </button>
              ) : (
                <button
                  onClick={goToNextStep}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid hover:bg-emerald-400 transition-colors"
                >
                  Continue
                  <ChevronRight size={15} />
                </button>
              )}

              <button
                onClick={goToNextStep}
                className="mt-3 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
              >
                Skip
              </button>
            </motion.div>
          )}

          {step === "ready" && (
            <motion.div
              key="ready"
              {...stepMotionProps}
              initial="enter"
                            className="flex w-full max-w-sm flex-col items-center text-center"
            >
              <h2 className="ui-text-title-lg font-semibold text-content-primary mb-1">
                You're ready!
              </h2>

              <p className="ui-text-body-lg text-content-muted mb-6">
                Smart is on by default. Set the shortcut you want here:
              </p>

              <div className="w-full rounded-lg bg-surface-surface p-2.5 text-left">
                <div className="space-y-1.5 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="ui-text-label-strong ui-color-primary">
                        Smart
                      </span>
                      <span className="truncate ui-text-meta ui-color-disabled">
                        tap to toggle, hold to talk
                      </span>
                    </div>
                    <span className="shrink-0 rounded-md bg-amber-400/20 px-1.5 py-0.5 ui-text-micro font-medium ui-color-warning-strong">
                      Default
                    </span>
                  </div>

                  <motion.button
                    type="button"
                    onClick={() => {
                      if (!captureActive) {
                        startCapture();
                      }
                    }}
                    aria-label={`Record new shortcut for Smart, currently ${formatShortcutForDisplay(smartShortcut)}`}
                    className={`w-full border-b pb-1 pt-1 text-left ui-text-kbd transition-colors ${
                      captureActive
                        ? "ui-color-primary border-border-hover"
                        : "ui-color-secondary border-border-primary hover:border-border-secondary hover:text-content-primary"
                    }`}
                  >
                    {captureActive ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <motion.span
                          className="h-1 w-1 rounded-full bg-cloud"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        />
                        <span
                          className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
                        >
                          {capturePreview || "Press new shortcut..."}
                        </span>
                      </span>
                    ) : (
                      <span className="block truncate">
                        {formatShortcutForDisplay(smartShortcut)}
                      </span>
                    )}
                  </motion.button>

                  <p className="ui-text-meta text-content-muted">
                    {captureActive
                      ? "Press your new shortcut, or hit Esc to cancel."
                      : "Click the shortcut to change it."}
                  </p>
                </div>
              </div>

              <p className="mt-4 ui-text-label text-content-disabled">
                You can add more shortcuts in Settings later.
              </p>

              <button
                onClick={handleComplete}
                disabled={captureActive || isCompleting}
                className="mt-6 flex items-center gap-2 rounded-lg bg-amber-400 px-6 py-2.5 ui-text-body-lg font-semibold ui-color-on-warning hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCompleting ? "Saving..." : "Get Started"}
              </button>

              {completionError && (
                <p className="mt-3 ui-text-label text-error text-center">
                  {completionError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex justify-center pb-5">
        <div className="flex items-center gap-2 text-content-disabled">
          <GlimpseLogo size="sm" />
          <span className="ui-text-meta font-medium">Glimpse</span>
        </div>
      </div>

      <AnimatePresence>
        {showLocalConfirm && (
          <motion.div
            key="local-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
            onClick={() => setShowLocalConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle
                  size={20}
                  className="ui-color-warning-strong shrink-0"
                />
                <div>
                  <p className="ui-text-body-lg font-semibold text-content-primary">
                    Continue without a model?
                  </p>
                  <p className="ui-text-label text-content-disabled">
                    You haven't downloaded a local model yet. Transcription will
                    not run offline until you add one in Settings.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowLocalConfirm(false)}
                  className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary hover:border-border-hover transition-colors"
                >
                  Stay here
                </button>
                <button
                  onClick={() => {
                    setShowLocalConfirm(false);
                    goToNextStep();
                  }}
                  className="rounded-lg bg-amber-400 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-warning hover:bg-amber-300 transition-colors"
                >
                  Continue anyway
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <FAQModal isOpen={showFAQModal} onClose={() => setShowFAQModal(false)} />

      {currentStepIndex > 0 && (
        <button
          onClick={goToPrevStep}
          className="absolute left-6 bottom-6 flex items-center gap-1 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
        >
          <ChevronLeft size={14} />
          Back
        </button>
      )}
    </div>
  );
};

const ModelProgress = ({
  percent,
  status,
}: {
  percent: number;
  status: string;
}) => {
  const cols = 50;
  const rows = 3;
  const totalDots = cols * rows;
  const activeCount = Math.round((percent / 100) * totalDots);

  const activeDots = useMemo(() => {
    const dots: number[] = [];
    for (let i = 0; i < activeCount && i < totalDots; i++) {
      dots.push(i);
    }
    return dots;
  }, [activeCount, totalDots]);

  const color =
    status === "error"
      ? "var(--color-error)"
      : status === "complete"
        ? "var(--color-success)"
        : "var(--color-cloud)";

  return (
    <DotMatrix
      rows={rows}
      cols={cols}
      activeDots={activeDots}
      dotSize={3}
      gap={2}
      color={color}
      className="opacity-70"
    />
  );
};

export default Onboarding;
