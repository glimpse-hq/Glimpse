import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { CaretLeft as ChevronLeft } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import { pricingUrlFor } from "../license/purchaseConfig";
import { settingsKeys, useSettings } from "../settings/queries";
import * as settingsApi from "../settings/api";
import * as modelsApi from "../settings/models-api";
import {
  modelKeys,
  pickDefaultOnboardingModel,
  useCleanupModel,
  useDiarizerModel,
  useModelCatalog,
  useModelRecommendation,
  useModelStatuses,
} from "../settings/models-queries";
import { onboardingMachine, getSteps } from "./machine";
import type { OnboardingStep } from "./platform";
import { useImportableApps } from "../import/queries";
import { ImportStep } from "../import/components/ImportStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { ReadyStep } from "./steps/ReadyStep";
import { LicenseStep } from "./steps/LicenseStep";
import { SourceStep, type OnboardingSource } from "./steps/SourceStep";
import { ModelDownloadStatus, type ModelDownload } from "./ModelDownloadStatus";
import FirstDictationGuide from "./FirstDictationGuide";
import { StepIndicator } from "./steps/shared";
import {
  useActivateLicense,
  useLicenseGate,
  useLicenseState,
} from "../license/queries";
import FAQModal from "../../shared/ui/FAQModal";
import WindowControls from "../../shared/ui/WindowControls";
import { showErrorToast } from "../../shared/lib/errorToast";
import { downloadFailureLabel } from "../../shared/lib/modelStats";
import { useDevRequest } from "../../shared/hooks/devSandbox";
import type {
  DownloadEvent,
  StoredSettings,
  UpdateSettingsResult,
} from "../../types";

const onboardingPermissionKeys = {
  all: ["onboarding", "permissions"] as const,
  microphone: () => [...onboardingPermissionKeys.all, "microphone"] as const,
};

const refreshModelStatus = (queryClient: QueryClient, model: string) =>
  queryClient.invalidateQueries({ queryKey: modelKeys.status(model) });

// The OS can refuse launch at login, for example when Glimpse is turned off in
// Windows Startup apps. Setup then saves without it instead of stopping there.
async function saveSetupSettings(
  build: (autoLaunch: boolean) => settingsApi.UpdateSettingsArgs,
  autoLaunch: boolean,
): Promise<{ result: UpdateSettingsResult; autoLaunch: boolean }> {
  try {
    const result = await settingsApi.updateSettings(build(autoLaunch));
    return { result, autoLaunch };
  } catch (err) {
    if (!autoLaunch) throw err;
    console.error("Launch at login was refused; saving without it", err);
    const result = await settingsApi.updateSettings(build(false));
    return { result, autoLaunch: false };
  }
}

// Setup writes what it asks about and keeps the rest, so running it again
// from Settings leaves other choices alone.
const buildSetupArgs = (
  latest: StoredSettings,
  smartShortcut: string,
  localModel: string,
  autoLaunchEnabled: boolean,
  microphoneDevice: string | null,
) => {
  const [smartBinding, ...otherSmartBindings] = latest.shortcut_bindings.smart;
  return settingsApi.buildUpdateSettingsArgs(latest, {
    smartShortcut,
    smartEnabled: true,
    shortcutBindings: {
      ...latest.shortcut_bindings,
      smart: [
        {
          ...(smartBinding ?? { temporary: false, cleanup_enabled: false }),
          shortcut: smartShortcut,
        },
        ...otherSmartBindings,
      ],
    },
    transcriptionMode: "local",
    localModel,
    remoteSpeechEnabled: false,
    microphoneDevice,
    mediaAction: "pause",
    autoLaunchEnabled,
  });
};

interface OnboardingScreenProps {
  onComplete: () => void;
}

// Direction 0 is the zoom out of the welcome intro; 1 and -1 slide.
const stepTransitionVariants = {
  enter: (direction: number) =>
    direction === 0
      ? { opacity: 0, scale: 0.94, x: 0, filter: "blur(8px)" }
      : {
          opacity: 0,
          scale: 1,
          x: direction > 0 ? 28 : -28,
          filter: "blur(0px)",
        },
  center: (direction: number) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    filter: "blur(0px)",
    transition:
      direction === 0
        ? { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }
        : { duration: 0.22, ease: "easeOut" as const },
  }),
  exit: (direction: number) =>
    direction === 0
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, x: direction > 0 ? -28 : 28 },
};

export default function OnboardingScreen({
  onComplete,
}: OnboardingScreenProps) {
  const { t } = useLingui();
  const [state, send, actor] = useMachine(onboardingMachine);
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, DownloadEvent>
  >({});
  const [openingLicenseCheckout, setOpeningLicenseCheckout] = useState(false);
  const [licenseOpenError, setLicenseOpenError] = useState<string | null>(null);
  const [source, setSource] = useState<OnboardingSource | null>(null);
  const ctx = state.context;
  const queryClient = useQueryClient();

  const importableAppsQuery = useImportableApps();

  useEffect(() => {
    if (importableAppsQuery.data) {
      send({ type: "SET_IMPORTABLE", apps: importableAppsQuery.data });
    }
  }, [importableAppsQuery.data, send]);

  const hasImportStep = ctx.importableApps.length > 0;

  const steps = useMemo(
    () => getSteps(ctx.platform, hasImportStep),
    [ctx.platform, hasImportStep],
  );
  const currentStep = state.value as string;
  const currentStepIndex = Math.max(
    0,
    steps.indexOf(currentStep as (typeof steps)[number]),
  );
  useEffect(() => {
    void invoke("track_onboarding_step_viewed", { step: currentStep }).catch(
      () => {},
    );
  }, [currentStep]);
  const settingsQuery = useSettings();
  const modelCatalogQuery = useModelCatalog();
  const diarizer = useDiarizerModel().data;
  const cleanupModel = useCleanupModel().data;
  const licensed = useLicenseGate();
  const recommendationQuery = useModelRecommendation();
  const licenseQuery = useLicenseState();
  const activateLicense = useActivateLicense();

  const persistedLocalModel = settingsQuery.data?.local_model ?? "";
  const persistedSettings = settingsQuery.data;

  // Stored settings hold the backend's defaults on a first run.
  const setupSeeded = useRef(false);
  useEffect(() => {
    if (!persistedSettings || setupSeeded.current) return;
    setupSeeded.current = true;
    send({
      type: "SET_MICROPHONE_DEVICE",
      device: persistedSettings.microphone_device,
    });
    send({ type: "SET_SHORTCUT", shortcut: persistedSettings.smart_shortcut });
  }, [persistedSettings, send]);

  const recommendedModel = recommendationQuery.data?.key ?? "";
  const selectedModel =
    ctx.localModelChoice ||
    pickDefaultOnboardingModel(
      modelCatalogQuery.data ?? [],
      persistedLocalModel,
      recommendationQuery.data,
    );
  const selectedModelInfo =
    modelCatalogQuery.data?.find((model) => model.key === selectedModel) ??
    null;
  const statusModelKeys = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(modelCatalogQuery.data ?? []).map((model) => model.key),
            selectedModel,
            diarizer?.key ?? "",
            cleanupModel?.key ?? "",
          ].filter(Boolean),
        ),
      ),
    [modelCatalogQuery.data, selectedModel, diarizer, cleanupModel],
  );
  const { statusByModel: modelStatus } = useModelStatuses(
    statusModelKeys,
    statusModelKeys.length > 0,
  );

  const microphonePermissionQuery = useQuery({
    queryKey: onboardingPermissionKeys.microphone(),
    queryFn: settingsApi.checkMicrophonePermission,
    enabled: ctx.platform.requiresMicrophonePermission,
    refetchOnWindowFocus: currentStep === "permissions" ? "always" : false,
    refetchInterval: (query) =>
      currentStep === "permissions" && query.state.data !== true ? 2000 : false,
    staleTime: 0,
    retry: false,
  });

  const accessibilityPermissionQuery = useQuery({
    queryKey: settingsKeys.accessibility(),
    queryFn: settingsApi.checkAccessibilityPermission,
    enabled: ctx.platform.requiresAccessibilityPermission,
    refetchOnWindowFocus: currentStep === "permissions" ? "always" : false,
    refetchInterval: (query) =>
      currentStep === "permissions" && query.state.data !== true ? 2000 : false,
    staleTime: 0,
    retry: false,
  });

  const {
    mutate: requestMicrophonePermission,
    isPending: isRequestingMicrophonePermission,
  } = useMutation({
    mutationFn: settingsApi.requestMicrophonePermission,
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
    mutationFn: settingsApi.requestAccessibilityPermission,
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: settingsKeys.accessibility(),
      });
    },
  });

  const updateDownloadStatus = useCallback(
    (modelKey: string, status: DownloadEvent) => {
      setDownloadStatus((prev) => {
        const current = prev[modelKey];
        const detail = (event: DownloadEvent | undefined) =>
          event && "file" in event
            ? event.file
            : event && "message" in event
              ? event.message
              : undefined;
        const verifyingOf = (event: DownloadEvent | undefined) =>
          event && "verifying" in event ? event.verifying : undefined;
        const fileIndexOf = (event: DownloadEvent | undefined) =>
          event && "fileIndex" in event ? event.fileIndex : undefined;
        if (
          current?.status === status.status &&
          current?.percent === status.percent &&
          detail(current) === detail(status) &&
          verifyingOf(current) === verifyingOf(status) &&
          fileIndexOf(current) === fileIndexOf(status)
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
        verifying: payload.verifying,
        fileIndex: payload.file_index,
        fileCount: payload.file_count,
      });
    },
    onComplete: ({ model }) => {
      updateDownloadStatus(model, { status: "complete", percent: 100 });
      void refreshModelStatus(queryClient, model);
    },
    onError: ({ model, error, reason }) => {
      updateDownloadStatus(model, {
        status: "error",
        percent: 0,
        message: error,
        reason,
      });
    },
    onCancelled: ({ model }) => {
      updateDownloadStatus(model, { status: "cancelled", percent: 0 });
      void refreshModelStatus(queryClient, model);
    },
  });

  const handleDownload = useCallback(
    async (modelKey: string, ane?: boolean) => {
      updateDownloadStatus(modelKey, {
        status: "downloading",
        percent: 0,
        file: t({
          id: "onboarding.download.starting",
          message: "starting...",
        }),
      });
      try {
        const includeAne =
          ane ??
          modelCatalogQuery.data?.some(
            (model) => model.key === modelKey && model.ane_size_mb != null,
          );
        await modelsApi.downloadModel(modelKey, includeAne);
        void refreshModelStatus(queryClient, modelKey);
      } catch (err) {
        // download:error usually lands first and carries the reason.
        setDownloadStatus((prev) =>
          prev[modelKey]?.status === "error"
            ? prev
            : {
                ...prev,
                [modelKey]: {
                  status: "error",
                  percent: 0,
                  message: String(err),
                  reason: "failed",
                },
              },
        );
      }
    },
    [modelCatalogQuery.data, queryClient, t, updateDownloadStatus],
  );

  const handleCancelDownload = useCallback(
    async (modelKey: string) => {
      try {
        await modelsApi.cancelDownload(modelKey);
        updateDownloadStatus(modelKey, { status: "cancelled", percent: 0 });
        setTimeout(() => {
          // A download started again in the meantime keeps its status.
          setDownloadStatus((prev) =>
            prev[modelKey]?.status === "cancelled"
              ? { ...prev, [modelKey]: { status: "idle", percent: 0 } }
              : prev,
          );
        }, 1500);
      } catch {
        return;
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

  const openLicenseCheckout = useCallback(async () => {
    setLicenseOpenError(null);
    setOpeningLicenseCheckout(true);
    void invoke("track_paywall_clicked", { source: "onboarding" }).catch(
      () => {},
    );
    try {
      await openUrl(pricingUrlFor("onboarding"));
    } catch (err) {
      setLicenseOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningLicenseCheckout(false);
    }
  }, []);

  const displayStateByModel = useMemo(() => {
    const buildState = (key: string): DownloadEvent => {
      const installed = modelStatus[key]?.installed;
      const base = downloadStatus[key];
      if (base && base.status !== "complete") return base;
      if (installed) return { status: "complete", percent: 100 };
      return base ?? { status: "idle", percent: 0 };
    };
    return (modelCatalogQuery.data ?? []).reduce<Record<string, DownloadEvent>>(
      (acc, model) => {
        acc[model.key] = buildState(model.key);
        return acc;
      },
      {},
    );
  }, [downloadStatus, modelStatus, modelCatalogQuery.data]);

  const selectedModelReady = useMemo(() => {
    if (!selectedModel) return false;
    const displayState = displayStateByModel[selectedModel];
    return Boolean(
      modelStatus[selectedModel]?.installed ||
      displayState?.status === "complete",
    );
  }, [displayStateByModel, modelStatus, selectedModel]);

  const micPermission = ctx.platform.requiresMicrophonePermission
    ? microphonePermissionQuery.data === true
    : true;
  const accessibilityPermission = ctx.platform.requiresAccessibilityPermission
    ? accessibilityPermissionQuery.data === true
    : true;
  const isCheckingMic =
    ctx.platform.requiresMicrophonePermission &&
    (microphonePermissionQuery.isPending || isRequestingMicrophonePermission);
  const isCheckingAccessibility =
    ctx.platform.requiresAccessibilityPermission &&
    (accessibilityPermissionQuery.isPending ||
      isRequestingAccessibilityPermission);
  const isModelCatalogLoading =
    modelCatalogQuery.isLoading ||
    settingsQuery.isLoading ||
    recommendationQuery.isLoading;

  const handleStartPractice = useCallback(async () => {
    if (
      settingsQuery.isLoading ||
      settingsQuery.isError ||
      !persistedSettings
    ) {
      send({
        type: "COMPLETE_ERROR",
        error: t({
          id: "onboarding.complete.failed",
          message: "Could not finish setup. Check your settings and try again.",
        }),
      });
      return;
    }

    const resolvedLocalModel = selectedModel;

    send({ type: "COMPLETING" });
    void invoke("track_onboarding_model_chosen", {
      recommended: recommendedModel,
      chosen: resolvedLocalModel,
    }).catch(() => {});

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
      const latestSettings = await settingsApi.getSettings();
      const { result, autoLaunch } = await saveSetupSettings(
        (launch) =>
          buildSetupArgs(
            latestSettings,
            ctx.smartShortcut,
            resolvedLocalModel,
            launch,
            ctx.microphoneDevice,
          ),
        ctx.autoLaunch,
      );
      if (!autoLaunch) send({ type: "SET_AUTO_LAUNCH", value: false });
      if (result.shortcut_error) throw result.shortcut_error;
      send({ type: "COMPLETE_SUCCESS" });
      send({ type: "START_PRACTICE" });
    } catch (err) {
      console.error("Failed to finish onboarding", err);
      const message = typeof err === "string" ? err : String(err);
      send({
        type: "COMPLETE_ERROR",
        error:
          message ||
          t({
            id: "onboarding.complete.failed",
            message:
              "Could not finish setup. Check your settings and try again.",
          }),
      });
    }
  }, [
    ctx.autoLaunch,
    ctx.microphoneDevice,
    ctx.smartShortcut,
    persistedSettings,
    recommendedModel,
    selectedModel,
    send,
    settingsQuery.isError,
    settingsQuery.isLoading,
    t,
  ]);

  const handleFinishOnboarding = useCallback(
    async (firstDictation: boolean) => {
      send({ type: "COMPLETING" });
      try {
        await invoke("complete_onboarding", { firstDictation });
        send({ type: "COMPLETE_SUCCESS" });
        onComplete();
      } catch (err) {
        console.error("Failed to finish onboarding", err);
        const message = typeof err === "string" ? err : String(err);
        send({
          type: "COMPLETE_ERROR",
          error:
            message ||
            t({
              id: "onboarding.complete.failed",
              message:
                "Could not finish setup. Check your settings and try again.",
            }),
        });
      }
    },
    [onComplete, send, t],
  );

  const applySmartShortcut = useCallback(
    async (shortcut: string) => {
      try {
        const latest = await settingsApi.getSettings();
        const { result, autoLaunch } = await saveSetupSettings(
          (launch) =>
            buildSetupArgs(
              latest,
              shortcut,
              selectedModel,
              launch,
              ctx.microphoneDevice,
            ),
          ctx.autoLaunch,
        );
        if (!autoLaunch) send({ type: "SET_AUTO_LAUNCH", value: false });
        if (result.shortcut_error) throw new Error(result.shortcut_error);
        send({ type: "SET_SHORTCUT", shortcut });
      } catch (err) {
        console.error("Failed to set shortcut", err);
        showErrorToast(
          t({
            id: "onboarding.shortcut.failed",
            message: "Couldn't use that shortcut. Try another one.",
          }),
        );
      }
    },
    [ctx.autoLaunch, ctx.microphoneDevice, selectedModel, send, t],
  );

  const zoomingFromWelcome = useRef(false);

  const goNext = useCallback(() => {
    zoomingFromWelcome.current = state.matches("welcome");
    send({ type: "NEXT" });
  }, [send, state]);

  const goBack = useCallback(() => {
    zoomingFromWelcome.current = false;
    send({ type: "BACK" });
  }, [send]);

  // `glimpse dev onboarding <action>` in the screenshot sandbox.
  useDevRequest("dev:onboarding", ({ action }) => {
    const order: OnboardingStep[] = [
      "welcome",
      "import",
      "source",
      "permissions",
      "license",
      "done",
      "practice",
    ];
    const target = action as OnboardingStep;
    if (order.includes(target)) {
      for (let hop = 0; hop < order.length * 2; hop += 1) {
        const current = actor.getSnapshot().value as OnboardingStep;
        if (current === target) return;
        if (order.indexOf(target) < order.indexOf(current)) {
          send({ type: "BACK" });
        } else {
          send({ type: current === "done" ? "START_PRACTICE" : "NEXT" });
        }
      }
      throw new Error(`Setup has no ${target} step here.`);
    }
    if (action === "download-failed" || action === "disk-full") {
      updateDownloadStatus(selectedModel, {
        status: "error",
        percent: 0,
        message: String(action),
        reason: action === "disk-full" ? "disk_full" : "network",
      });
    } else if (action === "setup-failed") {
      send({
        type: "COMPLETE_ERROR",
        error: t({
          id: "onboarding.complete.failed",
          message: "Could not finish setup. Check your settings and try again.",
        }),
      });
    } else if (action === "faq") {
      send({ type: "TOGGLE_FAQ", show: true });
    } else if (action === "close") {
      send({ type: "TOGGLE_FAQ", show: false });
    } else {
      throw new Error(`Unknown onboarding action ${String(action)}.`);
    }
  });

  // A short beat on the picked option, then move on without a Continue.
  const sourceAdvanceTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (sourceAdvanceTimer.current !== null) {
        window.clearTimeout(sourceAdvanceTimer.current);
        sourceAdvanceTimer.current = null;
      }
    },
    [currentStep],
  );

  const handleSelectSource = useCallback(
    (picked: OnboardingSource) => {
      if (sourceAdvanceTimer.current !== null) return;
      if (picked !== source) {
        void invoke("track_onboarding_source", { source: picked }).catch(
          () => {},
        );
      }
      setSource(picked);
      sourceAdvanceTimer.current = window.setTimeout(() => {
        sourceAdvanceTimer.current = null;
        goNext();
      }, 220);
    },
    [goNext, source],
  );

  // The speech model starts at launch, so it's ready by the first dictation.
  const speechDownloadStarted = useRef(false);
  useEffect(() => {
    if (speechDownloadStarted.current || isModelCatalogLoading) return;
    const status = modelStatus[selectedModel];
    if (!status) return;
    speechDownloadStarted.current = true;
    if (status.installed) return;
    void invoke("track_onboarding_step_viewed", {
      step: "model_downloading",
    }).catch(() => {});
    void handleDownload(selectedModel);
  }, [handleDownload, isModelCatalogLoading, modelStatus, selectedModel]);

  const speakerWanted = Boolean(
    licensed && diarizer && modelStatus[diarizer.key]?.installed === false,
  );
  const speakerStarted = diarizer
    ? Boolean(downloadStatus[diarizer.key])
    : false;

  // Speaker detection follows the speech model, so it never slows the first
  // dictation, and only with a license or trial, since only licensed features
  // use it. Setup's end retries it if this doesn't finish.
  useEffect(() => {
    if (!selectedModelReady || !diarizer || !speakerWanted || speakerStarted) {
      return;
    }
    void handleDownload(diarizer.key, false);
  }, [
    selectedModelReady,
    diarizer,
    speakerWanted,
    speakerStarted,
    handleDownload,
  ]);

  const cleanupWanted = Boolean(
    licensed &&
    cleanupModel &&
    modelStatus[cleanupModel.key]?.installed === false,
  );
  const cleanupStarted = cleanupModel
    ? Boolean(downloadStatus[cleanupModel.key])
    : false;
  const speakerStatus = diarizer ? downloadStatus[diarizer.key]?.status : null;
  const speakerSettled =
    !speakerWanted ||
    (speakerStatus != null && speakerStatus !== "downloading");

  // The cleanup model goes last, under the same rules as speaker detection.
  useEffect(() => {
    if (
      !selectedModelReady ||
      !speakerSettled ||
      !cleanupModel ||
      !cleanupWanted ||
      cleanupStarted
    ) {
      return;
    }
    void handleDownload(cleanupModel.key, false);
  }, [
    selectedModelReady,
    speakerSettled,
    cleanupModel,
    cleanupWanted,
    cleanupStarted,
    handleDownload,
  ]);

  const speechModelState = displayStateByModel[selectedModel];
  const speechModelFailure =
    !selectedModelReady && speechModelState?.status === "error"
      ? speechModelState
      : null;
  const practiceModelState = selectedModelReady
    ? "ready"
    : speechModelFailure
      ? "failed"
      : "downloading";
  const speechModelFailed = speechModelFailure
    ? t({
        id: "onboarding.speech_model_failed",
        message: "The speech model didn't download.",
      })
    : null;
  const speechModelReason =
    speechModelFailure?.reason && speechModelFailure.reason !== "failed"
      ? `${downloadFailureLabel(speechModelFailure.reason)}.`
      : null;
  const speechModelError = speechModelFailed
    ? [speechModelFailed, speechModelReason].filter(Boolean).join(" ")
    : null;
  const retrySpeechModel = () => void handleDownload(selectedModel);

  const stepDirection = zoomingFromWelcome.current
    ? 0
    : ctx.transitionDirection;

  const stepMotionProps = {
    custom: stepDirection,
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
            onStart={goNext}
            startDisabled={importableAppsQuery.isLoading}
          />
        );
      case "import":
        return (
          <ImportStep
            key="import"
            stepMotionProps={stepMotionProps}
            apps={ctx.importableApps}
            onApplied={(result) => {
              if (result.modelKey && result.modelKey !== selectedModel) {
                if (
                  displayStateByModel[selectedModel]?.status === "downloading"
                ) {
                  void handleCancelDownload(selectedModel);
                }
                send({ type: "SELECT_MODEL", key: result.modelKey });
                if (!modelStatus[result.modelKey]?.installed) {
                  void handleDownload(result.modelKey);
                }
              }
              if (result.shortcut) {
                send({ type: "SET_SHORTCUT", shortcut: result.shortcut });
              }
              if (result.autoLaunch !== null) {
                send({ type: "SET_AUTO_LAUNCH", value: result.autoLaunch });
              }
              goNext();
            }}
            onNext={goNext}
          />
        );
      case "source":
        return (
          <SourceStep
            key="source"
            stepMotionProps={stepMotionProps}
            isWindows={ctx.platform.id === "windows"}
            selected={source}
            onSelect={handleSelectSource}
            onSkip={goNext}
          />
        );
      case "permissions":
        return (
          <PermissionsStep
            key="permissions"
            stepMotionProps={stepMotionProps}
            requiresMicrophone={ctx.platform.requiresMicrophonePermission}
            requiresAccessibility={ctx.platform.requiresAccessibilityPermission}
            micPermission={micPermission}
            accessibilityPermission={accessibilityPermission}
            isCheckingMic={isCheckingMic}
            isCheckingAccessibility={isCheckingAccessibility}
            onRequestMic={handleRequestMic}
            onRequestAccessibility={handleRequestAccessibility}
            onNext={goNext}
          />
        );
      case "license":
        return (
          <LicenseStep
            key="license"
            stepMotionProps={stepMotionProps}
            smartShortcut={ctx.smartShortcut}
            licenseState={licenseQuery.data ?? null}
            opening={openingLicenseCheckout}
            openError={licenseOpenError}
            activating={activateLicense.isPending}
            activationError={activateLicense.error}
            onOpenCheckout={openLicenseCheckout}
            onActivate={(key) => activateLicense.mutate(key)}
            onNext={goNext}
          />
        );
      case "done":
        return (
          <ReadyStep
            key="done"
            stepMotionProps={stepMotionProps}
            smartShortcut={ctx.smartShortcut}
            onSetShortcut={applySmartShortcut}
            speechModelError={speechModelReason ?? speechModelFailed}
            onRetrySpeechModel={retrySpeechModel}
            microphoneDevice={ctx.microphoneDevice}
            onSetMicrophoneDevice={(device) =>
              send({ type: "SET_MICROPHONE_DEVICE", device })
            }
            autoLaunch={ctx.autoLaunch}
            onSetAutoLaunch={(value) =>
              send({ type: "SET_AUTO_LAUNCH", value })
            }
            isCompleting={ctx.isCompleting}
            completionError={ctx.completionError}
            onComplete={handleStartPractice}
          />
        );
      case "practice":
        return (
          <FirstDictationGuide
            key="practice"
            stepMotionProps={stepMotionProps}
            smartShortcut={ctx.smartShortcut}
            onSetShortcut={applySmartShortcut}
            modelState={practiceModelState}
            speechModelError={speechModelError}
            onRetrySpeechModel={retrySpeechModel}
            onFinish={handleFinishOnboarding}
            isFinishing={ctx.isCompleting}
            completionError={ctx.completionError}
          />
        );
      default:
        return null;
    }
  };

  // In download order. Speaker detection shows as waiting until the speech
  // model is done.
  const downloads: ModelDownload[] = [];
  if (selectedModelInfo && downloadStatus[selectedModel]) {
    downloads.push({
      key: selectedModel,
      name: t({ id: "onboarding.downloads.speech", message: "Speech model" }),
      state: displayStateByModel[selectedModel] ?? null,
      // Done and practice put the retry in their main button.
      onRetry:
        currentStep === "done" || currentStep === "practice"
          ? null
          : retrySpeechModel,
    });
  }
  if (diarizer && (speakerWanted || speakerStarted)) {
    downloads.push({
      key: diarizer.key,
      name: t({
        id: "onboarding.downloads.speakers",
        message: "Speaker detection",
      }),
      state: downloadStatus[diarizer.key] ?? null,
      onRetry: () => void handleDownload(diarizer.key, false),
    });
  }
  if (cleanupModel && (cleanupWanted || cleanupStarted)) {
    downloads.push({
      key: cleanupModel.key,
      name: t({
        id: "onboarding.downloads.cleanup",
        message: "Cleanup model",
      }),
      state: downloadStatus[cleanupModel.key] ?? null,
      onRetry: () => void handleDownload(cleanupModel.key, false),
    });
  }

  const showChrome =
    currentStep !== "welcome" &&
    currentStep !== "done" &&
    currentStep !== "practice";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-secondary ui-color-on-solid select-none relative">
        <WindowControls />
        <div data-tauri-drag-region className="h-7 w-full shrink-0" />

        <div className="flex justify-center pt-6">
          <div className="flex h-1.5 items-center">
            {showChrome && (
              <StepIndicator
                currentStep={currentStepIndex}
                total={steps.length}
              />
            )}
          </div>
        </div>

        <div
          className={`flex-1 flex flex-col items-center px-10 pb-6 ${currentStep === "welcome" ? "overflow-hidden" : "overflow-y-auto"}`}
        >
          <AnimatePresence mode="wait" custom={stepDirection}>
            {renderStep()}
          </AnimatePresence>
        </div>

        {currentStep !== "welcome" &&
          steps.indexOf(currentStep as (typeof steps)[number]) !== 0 && (
            <button
              type="button"
              onClick={goBack}
              className="absolute left-6 bottom-6 flex items-center gap-1 ui-text-body-sm text-content-muted hover:text-content-primary transition-colors"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {t({
                id: "onboarding.back",
                message: "Back",
              })}
            </button>
          )}

        {currentStep !== "welcome" && downloads.length > 0 ? (
          <ModelDownloadStatus downloads={downloads} />
        ) : null}

        <FAQModal
          isOpen={ctx.showFAQModal}
          onClose={() => send({ type: "TOGGLE_FAQ", show: false })}
        />
      </div>
    </MotionConfig>
  );
}
