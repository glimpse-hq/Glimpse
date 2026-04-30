import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { useMachine } from "@xstate/react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import { requestMacAccessibilityPermission } from "../../shared/lib/macosPermissions";
import { useSettings } from "../settings/queries";
import {
  modelKeys,
  useModelCatalog,
  useModelStatuses,
} from "../settings/models-queries";
import { onboardingMachine, getSteps, type LocalDownloadStatus } from "./machine";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ModelSelectionStep } from "./steps/ModelSelectionStep";
import { MicrophoneStep } from "./steps/MicrophoneStep";
import { AccessibilityStep } from "./steps/AccessibilityStep";
import { ReadyStep } from "./steps/ReadyStep";
import { SigninStep } from "./steps/SigninStep";
import { GlimpseLogo, StepIndicator } from "./steps/shared";
import FAQModal from "../../shared/ui/FAQModal";
import WindowControls from "../../shared/ui/WindowControls";
import type { ModelInfo, ModelStatus } from "../../types";

const hasRecommendedTag = (model: Pick<ModelInfo, "tags">) =>
  model.tags.some((tag) => tag.toLowerCase() === "recommended");

const PREFERRED_ONBOARDING_MODEL_KEYS = [
  "whisper_large_v3_turbo_q8",
  "parakeet_tdt_int8",
] as const;

const ONBOARDING_MODEL_LIMIT = 2;

const onboardingPermissionKeys = {
  all: ["onboarding", "permissions"] as const,
  microphone: () => [...onboardingPermissionKeys.all, "microphone"] as const,
  accessibility: () => [...onboardingPermissionKeys.all, "accessibility"] as const,
};

const sortOnboardingModels = (models: ModelInfo[]) =>
  [...models].sort((a, b) => {
    const recommendedDelta = Number(hasRecommendedTag(b)) - Number(hasRecommendedTag(a));
    if (recommendedDelta !== 0) return recommendedDelta;
    return a.label.localeCompare(b.label);
  });

const pickOnboardingModels = (models: ModelInfo[]) => {
  const sortedModels = sortOnboardingModels(models);
  const preferred = PREFERRED_ONBOARDING_MODEL_KEYS.map((key) =>
    sortedModels.find((model) => model.key === key),
  ).filter((model): model is ModelInfo => Boolean(model));
  const preferredKeys = new Set(preferred.map((model) => model.key));
  const fallback = sortedModels.filter((model) => !preferredKeys.has(model.key));

  return [...preferred, ...fallback].slice(0, ONBOARDING_MODEL_LIMIT);
};

const pickDefaultOnboardingModel = (
  models: ModelInfo[],
  persistedModel: string,
) => {
  if (persistedModel && models.some((model) => model.key === persistedModel)) {
    return persistedModel;
  }
  return models[0]?.key ?? persistedModel;
};

const checkMicrophonePermission = () =>
  invoke<boolean>("check_microphone_permission");

const checkAccessibilityPermission = () =>
  invoke<boolean>("check_accessibility_permission");

const stopShortcutCapture = () =>
  invoke("set_shortcut_capture_active", { active: false }).catch(() => {});

const refreshModelStatus = (
  queryClient: QueryClient,
  model: string,
) => queryClient.invalidateQueries({ queryKey: modelKeys.status(model) });

interface OnboardingScreenProps {
  onComplete: () => void;
}

const stepTransitionVariants = {
  enter: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: 1 | -1) => ({ opacity: 0, x: direction > 0 ? -28 : 28 }),
};

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const { t } = useLingui();
  const [state, send] = useMachine(onboardingMachine);
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, LocalDownloadStatus>
  >({});
  const ctx = state.context;
  const queryClient = useQueryClient();

  const steps = useMemo(
    () => getSteps(ctx.selectedMode, ctx.platform),
    [ctx.platform, ctx.selectedMode],
  );
  const currentStep = state.value as string;
  const currentStepIndex = steps.indexOf(currentStep as typeof steps[number]);
  const settingsQuery = useSettings();
  const modelCatalogQuery = useModelCatalog();

  const onboardingModelCatalog = useMemo(
    () => pickOnboardingModels(modelCatalogQuery.data ?? []),
    [modelCatalogQuery.data],
  );
  const persistedLocalModel = settingsQuery.data?.local_model ?? "";
  const selectedModel = ctx.localModelChoice ||
    pickDefaultOnboardingModel(onboardingModelCatalog, persistedLocalModel);
  const statusModelKeys = useMemo(
    () =>
      Array.from(
        new Set([
          ...onboardingModelCatalog.map((model) => model.key),
          selectedModel,
        ].filter(Boolean)),
      ),
    [onboardingModelCatalog, selectedModel],
  );
  const { statusByModel: modelStatus } = useModelStatuses(
    statusModelKeys,
    statusModelKeys.length > 0,
  );

  const microphonePermissionQuery = useQuery({
    queryKey: onboardingPermissionKeys.microphone(),
    queryFn: checkMicrophonePermission,
    enabled: ctx.platform.requiresMicrophonePermission,
    refetchInterval: currentStep === "microphone" ? 1_500 : false,
    retry: false,
  });

  const accessibilityPermissionQuery = useQuery({
    queryKey: onboardingPermissionKeys.accessibility(),
    queryFn: checkAccessibilityPermission,
    enabled: ctx.platform.requiresAccessibilityPermission,
    refetchInterval: currentStep === "accessibility" ? 800 : false,
    retry: false,
  });

  const {
    mutate: requestMicrophonePermission,
    isPending: isRequestingMicrophonePermission,
  } = useMutation({
    mutationFn: async () => {
      await invoke("request_microphone_permission").catch(() => {});
      const granted = await checkMicrophonePermission().catch(() => false);
      if (!granted) {
        await invoke("open_microphone_settings").catch(() => {});
      }
      return granted;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: onboardingPermissionKeys.microphone(),
      });
    },
  });

  const {
    mutate: requestAccessibilityPermission,
    isPending: isRequestingAccessibilityPermission,
  } = useMutation({
    mutationFn: async () => {
      if (ctx.platform.id === "macos") {
        await requestMacAccessibilityPermission().catch(() => {});
      }
      const granted = await checkAccessibilityPermission().catch(() => false);
      if (!granted) {
        await invoke("open_accessibility_settings").catch(() => {});
      }
      return granted;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: onboardingPermissionKeys.accessibility(),
      });
    },
  });

  const updateDownloadStatus = useCallback(
    (modelKey: string, status: LocalDownloadStatus) => {
      setDownloadStatus((prev) => {
        const current = prev[modelKey];
        if (
          current?.status === status.status &&
          current?.percent === status.percent &&
          current?.file === status.file &&
          current?.message === status.message
        ) {
          return prev;
        }

        return { ...prev, [modelKey]: status };
      });
    },
    [],
  );

  useModelDownloadEvents({
    onProgress: (payload) => {
      updateDownloadStatus(payload.model, {
        status: "downloading",
        percent: Math.min(100, Math.max(0, Math.round(payload.percent))),
        file: payload.file,
      });
    },
    onComplete: ({ model }) => {
      updateDownloadStatus(model, { status: "complete", percent: 100 });
      void refreshModelStatus(queryClient, model);
    },
    onError: ({ model, error }) => {
      if (error.toLowerCase().includes("cancelled")) return;
      updateDownloadStatus(model, {
        status: "error",
        percent: 0,
        message: error,
      });
    },
  });

  const handleDownload = useCallback(
    async (modelKey: string) => {
      updateDownloadStatus(modelKey, {
        status: "downloading",
        percent: 0,
        file: t({
          id: "onboarding.download.starting",
          message: "starting...",
        }),
      });
      try {
        await invoke("download_model", { model: modelKey });
        void refreshModelStatus(queryClient, modelKey);
      } catch (err) {
        const errorMsg = String(err);
        if (errorMsg.toLowerCase().includes("cancelled")) return;
        updateDownloadStatus(modelKey, {
          status: "error",
          percent: 0,
          message: t({
            id: "onboarding.download.failed",
            message: "Download failed",
          }),
        });
      }
    },
    [queryClient, t, updateDownloadStatus],
  );

  const handleDelete = useCallback(
    async (modelKey: string) => {
      try {
        const status = await invoke<ModelStatus>("delete_model", {
          model: modelKey,
        });
        queryClient.setQueryData(modelKeys.status(modelKey), status);
        updateDownloadStatus(modelKey, { status: "idle", percent: 0 });
      } catch {
        updateDownloadStatus(modelKey, {
          status: "error",
          percent: 0,
          message: t({
            id: "onboarding.delete.failed",
            message: "Delete failed",
          }),
        });
      }
    },
    [queryClient, t, updateDownloadStatus],
  );

  const handleCancelDownload = useCallback(
    async (modelKey: string) => {
      try {
        await invoke("cancel_download", { model: modelKey });
        updateDownloadStatus(modelKey, { status: "cancelled", percent: 0 });
        setTimeout(() => {
          updateDownloadStatus(modelKey, { status: "idle", percent: 0 });
        }, 1500);
      } catch {
        // ignore
      }
    },
    [updateDownloadStatus],
  );

  const handleRequestMic = useCallback(() => {
    requestMicrophonePermission();
  }, [requestMicrophonePermission]);

  const handleRequestAccessibility = useCallback(() => {
    requestAccessibilityPermission();
  }, [requestAccessibilityPermission]);

  const displayStateByModel = useMemo(() => {
    const buildState = (key: string): LocalDownloadStatus => {
      const installed = modelStatus[key]?.installed;
      const base = downloadStatus[key];
      if (base && base.status !== "complete") return base;
      if (installed) {
        return {
          status: "complete",
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
  }, [downloadStatus, modelStatus, onboardingModelCatalog]);

  const selectedModelReady = useMemo(() => {
    if (!selectedModel) return false;
    const displayState = displayStateByModel[selectedModel];
    return Boolean(modelStatus[selectedModel]?.installed || displayState?.status === "complete");
  }, [displayStateByModel, modelStatus, selectedModel]);

  const micPermission = ctx.platform.requiresMicrophonePermission
    ? microphonePermissionQuery.data === true
    : true;
  const accessibilityPermission = ctx.platform.requiresAccessibilityPermission
    ? accessibilityPermissionQuery.data === true
    : true;
  const isCheckingMic = ctx.platform.requiresMicrophonePermission &&
    (microphonePermissionQuery.isPending || isRequestingMicrophonePermission);
  const isCheckingAccessibility = ctx.platform.requiresAccessibilityPermission &&
    (
      accessibilityPermissionQuery.isPending ||
      isRequestingAccessibilityPermission
    );
  const isModelCatalogLoading = modelCatalogQuery.isLoading || settingsQuery.isLoading;
  const modelCatalogUnavailable = modelCatalogQuery.isError;

  const handleComplete = useCallback(async () => {
    const resolvedLocalModel = selectedModel;

    send({ type: "COMPLETING" });

    if (!resolvedLocalModel) {
      send({
        type: "COMPLETE_ERROR",
        error: t({
          id: "onboarding.complete.no_model",
          message:
            "Could not load a local model selection. Try reopening onboarding.",
        }),
      });
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
          transcriptionMode: ctx.selectedMode,
          localModel: resolvedLocalModel,
          microphoneDevice: null,
          language: "en",
          appLocale: "system",
          llmEnabled: false,
          cleanupEnabled: false,
          llmProvider: "none",
          llmEndpoint: "",
          llmApiKey: "",
          llmModel: "",
          editModeEnabled: false,
          mediaControlEnabled: true,
          autoUpdateEnabled: true,
          autoLaunchEnabled: false,
          recordingPrunePolicy: "never",
          analyticsEnabled: true,
        },
      });
      await invoke("complete_onboarding");
      send({ type: "COMPLETE_SUCCESS" });
      onComplete();
    } catch (err) {
      console.error("Failed to finish onboarding", err);
      const message = typeof err === "string" ? err : String(err);
      send({
        type: "COMPLETE_ERROR",
        error: message ||
          t({
            id: "onboarding.complete.failed",
            message:
              "Could not finish setup. Check your settings and try again.",
          }),
      });
    }
  }, [
    ctx.selectedMode,
    ctx.smartShortcut,
    onComplete,
    selectedModel,
    send,
    t,
  ]);

  const goNext = useCallback(() => {
    send({ type: "NEXT" });
  }, [send]);

  const goBack = useCallback(() => {
    if (ctx.captureActive) {
      void stopShortcutCapture();
      send({ type: "CAPTURE_END" });
    }
    send({ type: "BACK" });
  }, [ctx.captureActive, send]);

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
            isLoading={isModelCatalogLoading}
            unavailable={modelCatalogUnavailable}
            selectedModel={selectedModel}
            onSelectModel={(key) => send({ type: "SELECT_MODEL", key })}
            displayStateByModel={displayStateByModel}
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
            micPermission={micPermission}
            isChecking={isCheckingMic}
            onRequestAccess={handleRequestMic}
            onNext={goNext}
          />
        );
      case "accessibility":
        return (
          <AccessibilityStep
            key="accessibility"
            stepMotionProps={stepMotionProps}
            accessibilityPermission={accessibilityPermission}
            isChecking={isCheckingAccessibility}
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
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-secondary ui-color-on-solid select-none relative">
      <WindowControls />
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
          <span className="ui-text-meta font-medium">
            {t({
              id: "onboarding.brand",
              message: "Glimpse",
            })}
          </span>
        </div>
      </div>

      <FAQModal isOpen={ctx.showFAQModal} onClose={() => send({ type: "TOGGLE_FAQ", show: false })} />

      {currentStepIndex > 0 && (
        <button
          onClick={goBack}
          className="absolute left-6 bottom-6 flex items-center gap-1 ui-text-body-sm text-content-muted hover:text-content-muted transition-colors"
        >
          <ChevronLeft size={14} />
          {t({
            id: "onboarding.back",
            message: "Back",
          })}
        </button>
      )}
    </div>
  );
}
