import { useCallback, useEffect, useMemo } from "react";
import { useMachine } from "@xstate/react";
import { AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { onboardingMachine, getSteps, type LocalDownloadStatus } from "./machine";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ModelSelectionStep } from "./steps/ModelSelectionStep";
import { MicrophoneStep } from "./steps/MicrophoneStep";
import { AccessibilityStep } from "./steps/AccessibilityStep";
import { ReadyStep } from "./steps/ReadyStep";
import { SigninStep } from "./steps/SigninStep";
import { GlimpseLogo, StepIndicator } from "./steps/shared";
import FAQModal from "../../shared/ui/FAQModal";
import type { ModelInfo, ModelStatus, StoredSettings } from "../../types";

const hasRecommendedTag = (model: Pick<ModelInfo, "tags">) =>
  model.tags.some((tag) => tag.toLowerCase() === "recommended");

const FEATURED_ONBOARDING_MODEL_KEYS = [
  "whisper_large_v3_turbo_q8",
  "parakeet_tdt_int8",
] as const;

const sortOnboardingModels = (models: ModelInfo[]) =>
  [...models].sort((a, b) => {
    const recommendedDelta = Number(hasRecommendedTag(b)) - Number(hasRecommendedTag(a));
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
  return featured.length > 0 ? featured : sortOnboardingModels(models).slice(0, 2);
};

const pickDefaultOnboardingModel = (models: ModelInfo[]) =>
  pickOnboardingModels(models)[0]?.key ?? "";

interface OnboardingScreenProps {
  onComplete: () => void;
}

const stepTransitionVariants = {
  enter: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? -28 : 28 }),
};

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [state, send] = useMachine(onboardingMachine);
  const ctx = state.context;

  const steps = useMemo(() => getSteps(ctx.selectedMode), [ctx.selectedMode]);
  const currentStep = state.value as string;
  const currentStepIndex = steps.indexOf(currentStep as typeof steps[number]);

  const onboardingModelCatalog = useMemo(
    () => pickOnboardingModels(ctx.modelCatalog),
    [ctx.modelCatalog],
  );

  // Load model catalog + settings on mount
  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      send({ type: "SET_CATALOG_LOADING", loading: true });
      try {
        const [modelsResult, settingsResult] = await Promise.allSettled([
          invoke<ModelInfo[]>("list_models"),
          invoke<StoredSettings>("get_settings"),
        ]);
        if (!isMounted) return;

        const settings = settingsResult.status === "fulfilled" ? settingsResult.value : null;
        const persistedModel = settings?.local_model ?? "";

        if (modelsResult.status === "fulfilled") {
          const orderedModels = sortOnboardingModels(modelsResult.value);
          send({ type: "SET_MODEL_CATALOG", catalog: orderedModels, persistedModel });

          // Check status of all models
          orderedModels.forEach((model) => {
            invoke<ModelStatus>("check_model_status", { model: model.key })
              .then((status) => {
                if (isMounted) send({ type: "SET_MODEL_STATUS", key: model.key, status });
              })
              .catch((err) => console.error("Failed to check model status", err));
          });

          // Set default model choice
          const onboarding = pickOnboardingModels(orderedModels);
          let choice = "";
          if (settings?.local_model && onboarding.some((m) => m.key === settings.local_model)) {
            choice = settings.local_model;
          } else {
            choice = pickDefaultOnboardingModel(onboarding);
          }
          if (choice) send({ type: "SELECT_MODEL", key: choice });
        } else {
          send({ type: "SET_CATALOG_UNAVAILABLE", unavailable: true });
          if (persistedModel) send({ type: "SELECT_MODEL", key: persistedModel });
        }
      } catch (err) {
        console.error("Failed to preload onboarding data", err);
        if (isMounted) send({ type: "SET_CATALOG_UNAVAILABLE", unavailable: true });
      }
    };

    load();
    return () => { isMounted = false; };
  }, [send]);

  // Download event listeners
  useEffect(() => {
    let active = true;
    const disposers: UnlistenFn[] = [];

    const setup = async () => {
      const results = await Promise.allSettled([
        listen<{ model: string; percent: number; downloaded: number; total: number; file: string }>(
          "download:progress",
          (event) => {
            const p = event.payload;
            send({
              type: "SET_DOWNLOAD_STATUS",
              key: p.model,
              status: { status: "downloading", percent: Math.min(100, p.percent), file: p.file },
            });
          },
        ),
        listen<{ model: string }>("download:complete", (event) => {
          const model = event.payload.model;
          send({
            type: "SET_DOWNLOAD_STATUS",
            key: model,
            status: { status: "complete", percent: 100 },
          });
          invoke<ModelStatus>("check_model_status", { model })
            .then((status) => send({ type: "SET_MODEL_STATUS", key: model, status }))
            .catch((err) => console.error("Failed to check model status", err));
        }),
        listen<{ model: string; error: string }>("download:error", (event) => {
          const { model, error } = event.payload;
          if (error.toLowerCase().includes("cancelled")) return;
          send({
            type: "SET_DOWNLOAD_STATUS",
            key: model,
            status: { status: "error", percent: 0, message: error },
          });
        }),
      ]);

      results.forEach((res) => {
        if (res.status === "fulfilled") {
          if (!active) res.value();
          else disposers.push(res.value);
        }
      });
    };

    setup();
    return () => {
      active = false;
      disposers.forEach((fn) => fn());
    };
  }, [send]);

  // Shortcut capture cleanup
  useEffect(() => {
    return () => {
      invoke("set_shortcut_capture_active", { active: false }).catch(() => {});
    };
  }, []);

  const handleDownload = useCallback(async (modelKey: string) => {
    send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "downloading", percent: 0, file: "starting..." } });
    try {
      await invoke("download_model", { model: modelKey });
    } catch (err) {
      const errorMsg = String(err);
      if (errorMsg.toLowerCase().includes("cancelled")) return;
      send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "error", percent: 0, message: "Download failed" } });
    }
  }, [send]);

  const handleDelete = useCallback(async (modelKey: string) => {
    try {
      await invoke("delete_model", { model: modelKey });
      send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "idle", percent: 0 } });
      invoke<ModelStatus>("check_model_status", { model: modelKey })
        .then((status) => send({ type: "SET_MODEL_STATUS", key: modelKey, status }))
        .catch(() => {});
    } catch {
      send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "error", percent: 0, message: "Delete failed" } });
    }
  }, [send]);

  const handleCancelDownload = useCallback(async (modelKey: string) => {
    try {
      await invoke("cancel_download", { model: modelKey });
      send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "cancelled", percent: 0 } });
      setTimeout(() => {
        send({ type: "SET_DOWNLOAD_STATUS", key: modelKey, status: { status: "idle", percent: 0 } });
      }, 1500);
    } catch {
      // ignore
    }
  }, [send]);

  const handleRequestMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const granted = await checkMicrophonePermission();
      send({ type: "MIC_PERMISSION_CHANGED", granted, checking: false });
    } catch {
      try {
        await invoke("open_microphone_settings");
      } catch { /* ignore */ }
    }
  }, [send]);

  const handleRequestAccessibility = useCallback(async () => {
    try {
      await requestAccessibilityPermission();
      const granted = await checkAccessibilityPermission();
      send({ type: "ACCESSIBILITY_PERMISSION_CHANGED", granted, checking: false });
    } catch {
      try {
        await invoke("open_accessibility_settings");
      } catch { /* ignore */ }
    }
  }, [send]);

  const displayStateByModel = useMemo(() => {
    const buildState = (key: string): LocalDownloadStatus => {
      const installed = ctx.modelStatus[key]?.installed;
      const base = ctx.downloadStatus[key];
      if (installed) return { status: "complete", percent: 100, file: base?.file, message: base?.message };
      return base ?? { status: "idle", percent: 0 };
    };
    return onboardingModelCatalog.reduce<Record<string, LocalDownloadStatus>>(
      (acc, model) => { acc[model.key] = buildState(model.key); return acc; },
      {},
    );
  }, [ctx.downloadStatus, onboardingModelCatalog, ctx.modelStatus]);

  const selectedModelReady = useMemo(() => {
    if (!ctx.localModelChoice) return false;
    const displayState = displayStateByModel[ctx.localModelChoice];
    return Boolean(ctx.modelStatus[ctx.localModelChoice]?.installed || displayState?.status === "complete");
  }, [displayStateByModel, ctx.localModelChoice, ctx.modelStatus]);

  const handleComplete = useCallback(async () => {
    const resolvedLocalModel = ctx.localModelChoice || pickDefaultOnboardingModel(ctx.modelCatalog) || ctx.persistedLocalModel;

    send({ type: "COMPLETING" });

    if (!resolvedLocalModel) {
      send({ type: "COMPLETE_ERROR", error: "Could not load a local model selection. Try reopening onboarding." });
      return;
    }

    try {
      localStorage.setItem("glimpse_cloud_sync_enabled", "false");
      await invoke("update_settings", {
        args: {
          smartShortcut: ctx.smartShortcut,
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
          llmEnabled: false,
          cleanupEnabled: false,
          llmProvider: "custom",
          llmEndpoint: "",
          llmApiKey: "",
          llmModel: "",
          editModeEnabled: false,
          mediaControlEnabled: true,
          autoUpdateEnabled: true,
          analyticsEnabled: true,
        },
      });
      await invoke("complete_onboarding");
      send({ type: "COMPLETE_SUCCESS" });
      onComplete();
    } catch {
      send({ type: "COMPLETE_ERROR", error: "Could not finish setup. Check your settings and try again." });
    }
  }, [ctx, send, onComplete]);

  const goNext = useCallback(() => {
    send({ type: "NEXT" });
  }, [send]);

  const goBack = useCallback(() => send({ type: "BACK" }), [send]);

  const stepMotionProps = {
    custom: ctx.transitionDirection,
    variants: stepTransitionVariants,
    animate: "center" as const,
    exit: "exit" as const,
    transition: { duration: 0.22, ease: "easeOut" as const },
  };

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <WelcomeStep
            key="welcome"
            stepMotionProps={stepMotionProps}
            hasStepTransitioned={ctx.hasStepTransitioned}
            selectedMode={ctx.selectedMode}
            onSelectMode={(mode) => send({ type: "SELECT_MODE", mode })}
            onNext={goNext}
          />
        );
      case "localModel":
        return (
          <ModelSelectionStep
            key="local-model"
            stepMotionProps={stepMotionProps}
            modelCatalog={onboardingModelCatalog}
            isLoading={ctx.isLoadingModelCatalog}
            unavailable={ctx.modelCatalogUnavailable}
            selectedModel={ctx.localModelChoice}
            onSelectModel={(key) => send({ type: "SELECT_MODEL", key })}
            displayStateByModel={displayStateByModel}
            modelStatus={ctx.modelStatus}
            selectedModelReady={selectedModelReady}
            showLocalConfirm={ctx.showLocalConfirm}
            onShowConfirm={(show) => send({ type: "SHOW_LOCAL_CONFIRM", show })}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onCancelDownload={handleCancelDownload}
            onNext={goNext}
          />
        );
      case "localSignin":
        return (
          <SigninStep
            key="local-signin"
            stepMotionProps={stepMotionProps}
            onNext={goNext}
          />
        );
      case "microphone":
        return (
          <MicrophoneStep
            key="microphone"
            stepMotionProps={stepMotionProps}
            micPermission={ctx.micPermission}
            isChecking={ctx.isCheckingMic}
            onRequestAccess={handleRequestMic}
            onNext={goNext}
          />
        );
      case "accessibility":
        return (
          <AccessibilityStep
            key="accessibility"
            stepMotionProps={stepMotionProps}
            accessibilityPermission={ctx.accessibilityPermission}
            isChecking={ctx.isCheckingAccessibility}
            onRequestAccess={handleRequestAccessibility}
            onNext={goNext}
          />
        );
      case "ready":
        return (
          <ReadyStep
            key="ready"
            stepMotionProps={stepMotionProps}
            smartShortcut={ctx.smartShortcut}
            captureActive={ctx.captureActive}
            capturePreview={ctx.capturePreview}
            isCompleting={ctx.isCompleting}
            completionError={ctx.completionError}
            onStartCapture={() => send({ type: "CAPTURE_START" })}
            onEndCapture={(shortcut) => send({ type: "CAPTURE_END", shortcut })}
            onSetPreview={(preview) => send({ type: "SET_CAPTURE_PREVIEW", preview })}
            onSetShortcut={(shortcut) => send({ type: "SET_SHORTCUT", shortcut })}
            onComplete={handleComplete}
            send={send}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-secondary ui-color-on-solid select-none relative">
      <div data-tauri-drag-region className="h-7 w-full shrink-0" />

      <div className="flex justify-center pt-6 pb-6">
        <StepIndicator currentStep={currentStepIndex} total={steps.length} />
      </div>

      <div className="flex-1 flex items-center justify-center px-10 pb-10">
        <AnimatePresence mode="wait" custom={ctx.transitionDirection}>
          {renderStep()}
        </AnimatePresence>
      </div>

      <div className="flex justify-center pb-5">
        <div className="flex items-center gap-2 text-content-disabled">
          <GlimpseLogo size="sm" />
          <span className="ui-text-meta font-medium">Glimpse</span>
        </div>
      </div>

      <FAQModal isOpen={ctx.showFAQModal} onClose={() => send({ type: "TOGGLE_FAQ", show: false })} />

      {currentStepIndex > 0 && (
        <button
          onClick={goBack}
          className="absolute left-6 bottom-6 flex items-center gap-1 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
        >
          <ChevronLeft size={14} />
          Back
        </button>
      )}
    </div>
  );
}
