import { msg } from "@lingui/core/macro";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkMacAccessibilityPermission,
  checkMacInputMonitoringPermission,
} from "../../shared/lib/macosPermissions";
import { getPlatformCapabilities } from "../../platform/service";
import {
  getProviderPreset,
  resolvedLlmEndpoint,
} from "../../shared/lib/llmProviders";
import {
  getSpeechProviderPreset,
  isRemoteSpeechConfigured,
  resolvedSpeechEndpoint,
} from "../../shared/lib/speechProviders";
import {
  parseTextSizeMode,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "../../shared/lib/textSize";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
} from "../../shared/lib/modelCapabilities";
import { useModelDownloadEvents } from "../../shared/hooks/useModelDownloadEvents";
import { useLicenseGate, useLicenseState } from "../license/queries";
import {
  buildActiveTranscriptionLanguageOptions,
  collectAllTranscriptionLanguages,
  languageSupportedByModel,
} from "../../shared/lib/transcriptionLanguages";
import { useShortcutCapture } from "../../shared/hooks/useShortcutCapture";
import { formatShortcutForDisplay } from "../../shared/lib/shortcuts";
import { activateLocale, i18n } from "../../i18n";
import {
  settingsKeys,
  useAppInfo,
  useInputDevices,
  useSettings,
} from "./queries";
import * as settingsApi from "./api";
import * as modelsApi from "./models-api";
import { MAX_PER_MODE } from "./components/ShortcutList";
import { LOCAL_API_DEFAULT_PORT, LOCAL_API_LOOPBACK_HOST } from "./localApi";
import { isLlmProviderReady } from "./useLanguageModelStatus";
import type { SettingsPane } from "./settingsPanes";
import {
  modelKeys,
  resolveLocalFallbackModel,
  useCliInstallStatus,
  useDiarizerModel,
  useModelCatalog,
  useModelStatuses,
} from "./models-queries";
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
  MediaAction,
  AppLocaleSetting,
  LocalApiLogEntry,
  LocalApiStatus,
  RemoteSpeechProvider,
} from "../../types";

type ShortcutMode = "smart" | "hold" | "toggle";
type CaptureTarget = { mode: ShortcutMode; index: number } | null;
type ShortcutTarget = { mode: ShortcutMode; index: number };
type SettingsErrorSourceTab = Exclude<SettingsPane, "account">;
type InvalidShortcutDrafts = Partial<
  Record<ShortcutMode, Record<number, string>>
>;
type InvalidShortcutDraft = { target: ShortcutTarget; message: string } | null;

type SaveSettingsOverrides = {
  localModel?: string;
  remoteSpeechEnabled?: boolean;
  localApiModel?: string;
  language?: string;
  appLocale?: AppLocaleSetting;
  shortcutBindings?: ShortcutBindings;
  shortcutDraftTarget?: ShortcutTarget;
};

async function waitForLocalApiStopped(
  timeoutMs = 10000,
): Promise<LocalApiStatus> {
  const started = Date.now();
  let latest = await modelsApi.getLocalApiStatus();
  while (
    (latest.running || latest.starting) &&
    Date.now() - started < timeoutMs
  ) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    latest = await modelsApi.getLocalApiStatus();
  }
  return latest;
}

// The tray and app menu can change these while Settings has a save pending.
type MenuSettings = Pick<
  StoredSettings,
  "microphone_device" | "local_model" | "remote_speech_enabled"
>;

const defaultShortcutBindings = (): ShortcutBindings => ({
  smart: [
    { shortcut: "Control+Space", temporary: false, cleanup_enabled: false },
  ],
  hold: [],
  toggle: [],
});

// The list shows only the shortcuts you have; a disabled mode has none.
const bindingsFromSettings = (settings: StoredSettings): ShortcutBindings => {
  const forMode = (
    enabled: boolean,
    bindings: ShortcutBinding[] | undefined,
    legacyShortcut: string,
  ): ShortcutBinding[] => {
    if (!enabled) return [];
    if (bindings && bindings.length > 0) return bindings;
    return [
      {
        shortcut: legacyShortcut,
        temporary: false,
        cleanup_enabled: settings.cleanup_enabled ?? false,
      },
    ];
  };
  return {
    smart: forMode(
      settings.smart_enabled,
      settings.shortcut_bindings?.smart,
      settings.smart_shortcut,
    ),
    hold: forMode(
      settings.hold_enabled,
      settings.shortcut_bindings?.hold,
      settings.hold_shortcut,
    ),
    toggle: forMode(
      settings.toggle_enabled,
      settings.shortcut_bindings?.toggle,
      settings.toggle_shortcut,
    ),
  };
};

const hasShortcut = (bindings: ShortcutBinding[]) =>
  bindings.some((binding) => binding.shortcut.trim() !== "");

const bindingCount = (bindings: ShortcutBindings) =>
  bindings.smart.length + bindings.hold.length + bindings.toggle.length;

const withoutShortcutCleanup = (
  bindings: ShortcutBindings,
): ShortcutBindings => ({
  smart: bindings.smart.map((binding) => ({
    ...binding,
    cleanup_enabled: false,
  })),
  hold: bindings.hold.map((binding) => ({
    ...binding,
    cleanup_enabled: false,
  })),
  toggle: bindings.toggle.map((binding) => ({
    ...binding,
    cleanup_enabled: false,
  })),
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
  pane: SettingsPane;
  active: boolean;
  onClose: () => void;
}

export function useSettingsForm({
  pane,
  active,
  onClose,
}: UseSettingsFormOptions) {
  const [smartShortcut, setSmartShortcut] = useState("Control+Space");
  const [holdShortcut, setHoldShortcut] = useState("Control+Shift+Space");
  const [toggleShortcut, setToggleShortcut] = useState("Control+Alt+Space");
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(
    defaultShortcutBindings,
  );
  const shortcutBindingsRef = useRef<ShortcutBindings>(
    defaultShortcutBindings(),
  );
  const persistedShortcutBindingsRef = useRef<ShortcutBindings>(
    defaultShortcutBindings(),
  );
  const [invalidShortcutDraft, setInvalidShortcutDraftState] =
    useState<InvalidShortcutDraft>(null);
  const invalidShortcutDraftRef = useRef<InvalidShortcutDraft>(null);
  const [transcriptionMode, setTranscriptionModeRaw] =
    useState<TranscriptionMode>("local");
  const [localModel, setLocalModel] = useState("");
  const [remoteSpeechEnabled, setRemoteSpeechEnabled] = useState(false);
  const [remoteSpeechProvider, setRemoteSpeechProvider] =
    useState<RemoteSpeechProvider>("openai");
  const [remoteSpeechEndpoint, setRemoteSpeechEndpoint] = useState(
    () => getSpeechProviderPreset("openai")?.endpoint ?? "",
  );
  const [remoteSpeechApiKey, setRemoteSpeechApiKey] = useState("");
  const [remoteSpeechModel, setRemoteSpeechModel] = useState("auto");
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
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("none");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmServiceProvider, setLlmServiceProvider] = useState("");
  const [llmAuto, setLlmAuto] = useState(false);
  const [autoDictionaryEnabled, setAutoDictionaryEnabled] = useState(false);
  const [mediaAction, setMediaAction] = useState<MediaAction>("off");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoLaunchEnabled, setAutoLaunchEnabledState] = useState(false);
  const [startInBackground, setStartInBackground] = useState(false);
  const [autoDeleteTarget, setAutoDeleteTarget] =
    useState<AutoDeleteTarget>("transcripts");
  const [autoDeleteDuration, setAutoDeleteDuration] =
    useState<RecordingPrunePolicy>("never");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [localApiKey, setLocalApiKey] = useState("");
  const [localApiPort, setLocalApiPort] = useState(LOCAL_API_DEFAULT_PORT);
  const [localApiModel, setLocalApiModel] = useState("auto");
  const [localApiHost, setLocalApiHost] = useState(LOCAL_API_LOOPBACK_HOST);
  const [localApiStartOnLaunch, setLocalApiStartOnLaunch] = useState(false);
  const [localApiCors, setLocalApiCors] = useState(false);
  const [localApiStatus, setLocalApiStatus] = useState<LocalApiStatus | null>(
    null,
  );
  const [localApiBusy, setLocalApiBusy] = useState(false);
  // Stop stays usable while a start waits for its model to load.
  const [localApiStopping, setLocalApiStopping] = useState(false);
  // A start the user stopped fails on purpose; don't report that as an error.
  const localApiStopRequestedRef = useRef(false);
  const [textSizeMode, setTextSizeModeRaw] = useState<TextSizeMode>(() =>
    parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
  );
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>("system");
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [accessibilityPermission, setAccessibilityPermission] = useState<
    boolean | null
  >(null);
  const [inputMonitoringPermission, setInputMonitoringPermission] = useState<
    boolean | null
  >(null);
  const didHydrateRef = useRef(false);
  const hydratedSettingsRef = useRef<StoredSettings | null>(null);
  const sentMenuSettingsRef = useRef<MenuSettings | null>(null);
  const isSavingRef = useRef(false);
  const settingsSaveRef = useRef(Promise.resolve(true));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadResetTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const scheduleDownloadStateReset = useCallback(
    (modelKey: string, from: DownloadEvent["status"], delayMs: number) => {
      const timeout = setTimeout(() => {
        downloadResetTimeoutsRef.current.delete(timeout);
        setDownloadState((prev) => {
          if (prev[modelKey]?.status !== from) return prev;
          return { ...prev, [modelKey]: { status: "idle", percent: 0 } };
        });
      }, delayMs);
      downloadResetTimeoutsRef.current.add(timeout);
    },
    [],
  );
  const queryClient = useQueryClient();
  const settingsQuery = useSettings();
  const licenseStateQuery = useLicenseState();
  const licenseGateActive = useLicenseGate();
  const activeLicense = licenseStateQuery.data?.status === "active";
  const appInfoQuery = useAppInfo();
  const inputDevicesQuery = useInputDevices();
  // Settings stays mounted, and only macOS reports device changes, so a mic
  // plugged in on Windows would otherwise not show up until restart.
  const refetchInputDevices = inputDevicesQuery.refetch;
  useEffect(() => {
    if (active) void refetchInputDevices();
  }, [active, refetchInputDevices]);
  const modelCatalogQuery = useModelCatalog();
  const diarizerModel = useDiarizerModel().data ?? null;
  const cliInstallQuery = useCliInstallStatus();
  const inputDevices = inputDevicesQuery.data ?? [];
  const modelCatalog = modelCatalogQuery.data ?? [];
  const cliInstallStatus = cliInstallQuery.data ?? null;

  const cliInstallError = cliInstallQuery.error;
  useEffect(() => {
    if (cliInstallError) {
      console.error("Failed to load CLI install status:", cliInstallError);
    }
  }, [cliInstallError]);
  const modelKeysForStatus = useMemo(
    () => [
      ...modelCatalog.map((model) => model.key),
      ...(diarizerModel ? [diarizerModel.key] : []),
    ],
    [modelCatalog, diarizerModel],
  );
  const modelStatusesQuery = useModelStatuses(
    modelKeysForStatus,
    modelKeysForStatus.length > 0,
  );
  const modelStatus = modelStatusesQuery.statusByModel;
  const appInfo = appInfoQuery.data ?? null;
  const appInfoFailed = appInfoQuery.isError;
  const platformCapabilities = useMemo(() => getPlatformCapabilities(), []);
  const loading =
    settingsQuery.isLoading ||
    modelCatalogQuery.isLoading ||
    inputDevicesQuery.isLoading ||
    appInfoQuery.isLoading ||
    licenseStateQuery.isLoading;

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
      sourceTab: SettingsErrorSourceTab = pane === "account" ? "general" : pane,
    ) => {
      setError(message);
      setErrorSourceTab(sourceTab);
    },
    [pane],
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

  const setTextSizeMode = useCallback((mode: TextSizeMode) => {
    setTextSizeModeRaw(mode);
    localStorage.setItem(TEXT_SIZE_MODE_STORAGE_KEY, mode);
    emit("ui:text_size_changed", { mode }).catch(() => {});
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeRaw(mode);
    emit("ui:theme_changed", { mode }).catch(() => {});
  }, []);

  const hydrateFromSettings = useCallback(
    (s: StoredSettings) => {
      hydratedSettingsRef.current = s;
      sentMenuSettingsRef.current = null;
      const hydratedBindings = bindingsFromSettings(s);
      persistedShortcutBindingsRef.current = hydratedBindings;
      clearInvalidShortcutDraft();
      setSmartShortcut(s.smart_shortcut);
      setHoldShortcut(s.hold_shortcut);
      setToggleShortcut(s.toggle_shortcut);
      shortcutBindingsRef.current = hydratedBindings;
      setShortcutBindings(hydratedBindings);
      setTranscriptionModeRaw(s.transcription_mode);
      setLocalModel(s.local_model);
      setRemoteSpeechEnabled(s.remote_speech_enabled);
      setRemoteSpeechProvider(s.remote_speech_provider);
      setRemoteSpeechEndpoint(s.remote_speech_endpoint);
      setRemoteSpeechApiKey(s.remote_speech_api_key);
      setRemoteSpeechModel(s.remote_speech_model);
      setMicrophoneDevice(s.microphone_device);
      setLanguage(s.language);
      setAppLocale(s.app_locale);

      setLlmProvider(s.llm_provider);
      setLlmEndpoint(s.llm_endpoint);
      setLlmApiKey(s.llm_api_key);
      setLlmModel(s.llm_model);
      setLlmServiceProvider(s.llm_service_provider);
      setLlmAuto(s.llm_auto);
      setAutoDictionaryEnabled(s.auto_dictionary_enabled);
      setMediaAction(s.media_action);
      setAutoUpdateEnabled(s.auto_update_enabled);
      setAutoLaunchEnabledState(s.auto_launch_enabled);
      setStartInBackground(s.auto_launch_enabled && s.start_in_background);
      setAutoDeleteTarget(s.auto_delete_target);
      setAutoDeleteDuration(s.auto_delete_duration);
      setAnalyticsEnabled(s.analytics_enabled);
      setLocalApiKey(s.local_api_key);
      setLocalApiPort(s.local_api_port);
      setLocalApiModel(s.local_api_model);
      setLocalApiHost(s.local_api_host);
      setLocalApiStartOnLaunch(s.local_api_start_on_launch);
      setLocalApiCors(s.local_api_cors);
      setThemeModeRaw(s.theme_mode);
    },
    [clearInvalidShortcutDraft],
  );

  // While a save is pending, takes menu changes the form hasn't touched, so
  // the save doesn't write the old values back. Our own saves echo back too;
  // they match what was sent and are skipped.
  const rebaseMenuSettings = useCallback((s: StoredSettings) => {
    const base = hydratedSettingsRef.current;
    hydratedSettingsRef.current = s;
    if (!base) return;
    const sent = sentMenuSettingsRef.current;
    const changedOutside = <K extends keyof MenuSettings>(key: K) =>
      s[key] !== base[key] && s[key] !== sent?.[key];
    if (changedOutside("microphone_device")) {
      setMicrophoneDevice((current) =>
        current === base.microphone_device ? s.microphone_device : current,
      );
    }
    if (changedOutside("local_model")) {
      setLocalModel((current) =>
        current === base.local_model ? s.local_model : current,
      );
    }
    if (changedOutside("remote_speech_enabled")) {
      setRemoteSpeechEnabled((current) =>
        current === base.remote_speech_enabled
          ? s.remote_speech_enabled
          : current,
      );
    }
  }, []);

  const setAutoLaunchEnabled = useCallback((enabled: boolean) => {
    setAutoLaunchEnabledState(enabled);
    setStartInBackground(enabled);
  }, []);

  const activeLocalModel = useMemo(
    () => modelCatalog.find((model) => model.key === localModel),
    [modelCatalog, localModel],
  );
  const autoTranscriptionLanguageLabel = i18n._(
    msg({
      id: "transcription.language.auto",
      message: "Auto",
    }),
  );
  const unsupportedTranscriptionLanguageLabel = i18n._(
    msg({
      id: "transcription.language.unsupported",
      message: "Unsupported",
    }),
  );
  const unsupportedTranscriptionLanguageDescription = i18n._(
    msg({
      id: "transcription.language.unsupported_description",
      message: "Choose a compatible model to enable these.",
    }),
  );
  const llmConfigReady =
    Boolean(getProviderPreset(llmProvider)?.onDevice) ||
    isLlmProviderReady({
      provider: llmProvider,
      endpoint: llmEndpoint,
      apiKey: llmApiKey,
      model: llmModel,
    });
  const remoteSpeechConfigReady = isRemoteSpeechConfigured({
    enabled: true,
    provider: remoteSpeechProvider,
    endpoint: remoteSpeechEndpoint,
    model: remoteSpeechModel,
    apiKey: remoteSpeechApiKey,
  });
  const remoteSpeechActive = remoteSpeechEnabled && remoteSpeechConfigReady;
  const allTranscriptionLanguages = useMemo(
    () => collectAllTranscriptionLanguages(modelCatalog),
    [modelCatalog],
  );
  const displayedLanguageOptions = useMemo(
    () =>
      buildActiveTranscriptionLanguageOptions(
        activeLocalModel,
        allTranscriptionLanguages,
        remoteSpeechActive,
        autoTranscriptionLanguageLabel,
        unsupportedTranscriptionLanguageLabel,
        unsupportedTranscriptionLanguageDescription,
      ),
    [
      activeLocalModel,
      allTranscriptionLanguages,
      remoteSpeechActive,
      autoTranscriptionLanguageLabel,
      unsupportedTranscriptionLanguageLabel,
      unsupportedTranscriptionLanguageDescription,
    ],
  );
  const displayedLanguage = displayedLanguageOptions.some(
    (option) => option.code === language,
  )
    ? language
    : "";
  const localModelSupportsDictionary = hasModelCapability(
    activeLocalModel,
    MODEL_CAPABILITY_DICTIONARY,
  );
  const autoDictionarySupported =
    remoteSpeechActive || localModelSupportsDictionary;
  // On Automatic the backend picks a ready model at dictation time.
  const aiFeaturesReady = licenseGateActive && (llmAuto || llmConfigReady);

  useEffect(() => {
    if (loading || !language) return;
    if (
      !remoteSpeechActive &&
      activeLocalModel &&
      !languageSupportedByModel(activeLocalModel, language)
    ) {
      setLanguage("");
    }
  }, [activeLocalModel, language, loading, remoteSpeechActive]);

  const buildSettingsArgs = useCallback(
    (overrides: SaveSettingsOverrides = {}): settingsApi.UpdateSettingsArgs => {
      const rawShortcutBindings =
        overrides.shortcutBindings ?? shortcutBindings;
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
      // Clean up stays on while a model is set up; only a missing license
      // keeps it from being saved.
      const savedShortcutBindings = licenseGateActive
        ? bindingsForSave
        : withoutShortcutCleanup(bindingsForSave);

      const persistedRemoteEndpoint = resolvedSpeechEndpoint(
        remoteSpeechProvider,
        remoteSpeechEndpoint,
      );
      const persistedLlmEndpoint = resolvedLlmEndpoint(
        llmProvider,
        llmEndpoint,
      );
      const modelToValidate = overrides.localModel
        ? modelCatalog.find((model) => model.key === overrides.localModel)
        : activeLocalModel;
      const persistedLanguage =
        overrides.language ??
        (!remoteSpeechActive &&
        modelToValidate &&
        !languageSupportedByModel(modelToValidate, language)
          ? ""
          : language);

      return {
        smartShortcut: primaryShortcut(
          savedShortcutBindings,
          "smart",
          smartShortcut,
        ),
        smartEnabled: hasShortcut(savedShortcutBindings.smart),
        holdShortcut: primaryShortcut(
          savedShortcutBindings,
          "hold",
          holdShortcut,
        ),
        holdEnabled: hasShortcut(savedShortcutBindings.hold),
        toggleShortcut: primaryShortcut(
          savedShortcutBindings,
          "toggle",
          toggleShortcut,
        ),
        toggleEnabled: hasShortcut(savedShortcutBindings.toggle),
        shortcutBindings: savedShortcutBindings,
        transcriptionMode,
        localModel: overrides.localModel ?? localModel,
        remoteSpeechEnabled:
          overrides.remoteSpeechEnabled ?? remoteSpeechEnabled,
        remoteSpeechProvider,
        remoteSpeechEndpoint: persistedRemoteEndpoint,
        remoteSpeechApiKey,
        remoteSpeechModel,
        microphoneDevice,
        language: persistedLanguage,
        appLocale: overrides.appLocale ?? appLocale,
        themeMode,

        llmEnabled: aiFeaturesReady,
        cleanupEnabled: false,
        llmProvider,
        llmEndpoint: persistedLlmEndpoint,
        llmApiKey,
        llmModel,
        llmServiceProvider,
        llmAuto,
        autoDictionaryEnabled: autoDictionarySupported
          ? autoDictionaryEnabled
          : false,
        mediaAction,
        autoUpdateEnabled,
        autoLaunchEnabled,
        startInBackground,
        autoDeleteTarget,
        autoDeleteDuration,
        analyticsEnabled,
        localApiKey,
        localApiPort,
        localApiModel: overrides.localApiModel ?? localApiModel,
        localApiHost,
        localApiStartOnLaunch: activeLicense ? localApiStartOnLaunch : false,
        localApiCors,
      };
    },
    [
      smartShortcut,
      shortcutBindings,
      holdShortcut,
      toggleShortcut,
      transcriptionMode,
      localModel,
      activeLocalModel,
      remoteSpeechEnabled,
      remoteSpeechActive,
      remoteSpeechProvider,
      remoteSpeechEndpoint,
      remoteSpeechApiKey,
      remoteSpeechModel,
      microphoneDevice,
      language,
      appLocale,
      themeMode,
      aiFeaturesReady,
      licenseGateActive,
      activeLicense,
      llmProvider,
      llmEndpoint,
      llmApiKey,
      llmModel,
      llmServiceProvider,
      llmAuto,
      autoDictionarySupported,
      autoDictionaryEnabled,
      mediaAction,
      autoUpdateEnabled,
      autoLaunchEnabled,
      startInBackground,
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
          sentMenuSettingsRef.current = {
            microphone_device: args.microphoneDevice,
            local_model: args.localModel,
            remote_speech_enabled: args.remoteSpeechEnabled,
          };
          try {
            const { shortcut_error: shortcutError } =
              await settingsApi.updateSettings(args);
            persistedShortcutBindingsRef.current = args.shortcutBindings;
            if (shortcutError) {
              if (overrides?.shortcutDraftTarget) {
                setInvalidShortcutDraft(
                  overrides.shortcutDraftTarget,
                  shortcutError,
                );
              }
              showSettingsError(shortcutError);
              return true;
            }
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

  const handleAppLocaleChange = useCallback(
    (nextLocale: AppLocaleSetting) => {
      clearPendingSettingsSave();
      setAppLocale(nextLocale);
      void activateLocale(nextLocale);
      queryClient.setQueryData<StoredSettings>(
        settingsKeys.detail(),
        (current) =>
          current ? { ...current, app_locale: nextLocale } : current,
      );
      void saveSettingsNow({ appLocale: nextLocale }).then((saved) => {
        if (!saved) {
          void queryClient.invalidateQueries({
            queryKey: settingsKeys.detail(),
          });
        }
      });
    },
    [clearPendingSettingsSave, queryClient, saveSettingsNow],
  );

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
      if (
        binding &&
        binding.shortcut.trim() === "" &&
        bindingCount(current) > 1
      ) {
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
    await invoke("set_shortcut_capture_active", { active: false }).catch(
      () => {},
    );
  }, [flushPendingSettingsSave]);

  const updateShortcutBindings = useCallback(
    (
      updater: (current: ShortcutBindings) => ShortcutBindings,
      shortcutDraftTarget?: ShortcutTarget,
    ) => {
      clearPendingSettingsSave();
      const next = updater(shortcutBindingsRef.current);
      shortcutBindingsRef.current = next;
      setShortcutBindings(next);
      setSmartShortcut(primaryShortcut(next, "smart", smartShortcut));
      setHoldShortcut(primaryShortcut(next, "hold", holdShortcut));
      setToggleShortcut(primaryShortcut(next, "toggle", toggleShortcut));
      void saveSettingsNow({ shortcutBindings: next, shortcutDraftTarget });
    },
    [
      clearPendingSettingsSave,
      holdShortcut,
      saveSettingsNow,
      smartShortcut,
      toggleShortcut,
    ],
  );

  const { resetCaptureState } = useShortcutCapture({
    active: captureActive !== null,
    onCancel: finalizeCapture,
    onCaptureCancelled: discardEmptyCaptureDraft,
    onPreviewChange: (shortcut) =>
      setCapturePreview(shortcut ? formatShortcutForDisplay(shortcut) : ""),
    onShortcutCaptured: (combo) => {
      clearPendingSettingsSave();
      const target = captureActiveRef.current;
      if (target) {
        captureActiveRef.current = null;
        updateShortcutBindings(
          (current) => ({
            ...current,
            [target.mode]: current[target.mode].map((binding, index) =>
              index === target.index
                ? { ...binding, shortcut: combo }
                : binding,
            ),
          }),
          target,
        );
      }
      clearSettingsErrorIfNoInvalidDrafts();
    },
    onError: (message) => showSettingsError(message, "general"),
    onCaptureInput: clearSettingsErrorIfNoInvalidDrafts,
  });

  useEffect(() => {
    if (active) return;
    flushPendingSettingsSave();
    didHydrateRef.current = false;
    if (captureActive) {
      finalizeCapture();
      resetCaptureState();
    }
  }, [
    active,
    captureActive,
    finalizeCapture,
    flushPendingSettingsSave,
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

  const refreshPermissionState = useCallback(async () => {
    const [nativeMic, acc, inputMonitoring] = await Promise.allSettled([
      platformCapabilities.showsMicrophonePermission
        ? invoke<boolean>("check_microphone_permission")
        : Promise.resolve<boolean | null>(null),
      platformCapabilities.requiresAccessibilityPermission
        ? checkMacAccessibilityPermission()
        : Promise.resolve<boolean | null>(null),
      platformCapabilities.requiresInputMonitoringPermission
        ? checkMacInputMonitoringPermission()
        : Promise.resolve<boolean | null>(null),
    ]);

    setMicPermission(
      nativeMic.status === "fulfilled" ? nativeMic.value : false,
    );
    setAccessibilityPermission(acc.status === "fulfilled" ? acc.value : false);
    setInputMonitoringPermission(
      inputMonitoring.status === "fulfilled" ? inputMonitoring.value : false,
    );
  }, [platformCapabilities]);

  useEffect(() => {
    if (pane !== "app") return;

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
  }, [pane, refreshPermissionState]);

  const handleRequestMicrophonePermission = useCallback(async () => {
    await settingsApi.requestMicrophonePermission();
    await refreshPermissionState();
  }, [refreshPermissionState]);

  const handleRequestAccessibilityPermission = useCallback(async () => {
    await settingsApi.requestAccessibilityPermission();
    await refreshPermissionState();
  }, [refreshPermissionState]);

  const handleRequestInputMonitoringPermission = useCallback(async () => {
    await settingsApi.requestInputMonitoringPermission();
    await refreshPermissionState();
  }, [refreshPermissionState]);

  useEffect(() => {
    if (settingsQuery.error) {
      console.error("Failed to load settings:", settingsQuery.error);
      showSettingsError(
        i18n._(
          msg({
            id: "settings.error.load_failed",
            message: "Couldn't load settings.",
          }),
        ),
        "general",
      );
      return;
    }

    if (!settingsQuery.data) return;
    if (isSavingRef.current || saveTimeoutRef.current !== null) {
      rebaseMenuSettings(settingsQuery.data);
      return;
    }

    hydrateFromSettings(settingsQuery.data);
  }, [
    hydrateFromSettings,
    rebaseMenuSettings,
    settingsQuery.data,
    settingsQuery.error,
    showSettingsError,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlistenLog: UnlistenFn | null = null;
    let unlistenStatus: UnlistenFn | null = null;

    modelsApi
      .getLocalApiStatus()
      .then((status) => {
        if (!cancelled) setLocalApiStatus(status);
      })
      .catch((err) => console.error("Failed to load local API status:", err));

    listen<LocalApiLogEntry>("local-api:log", (event) => {
      if (cancelled) return;
      setLocalApiStatus((current) => {
        if (!current) return current;
        const previousLogs = current.logs ?? [];
        return {
          ...current,
          logs: [...previousLogs, event.payload].slice(-200),
        };
      });
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenLog = fn;
      })
      .catch(() => {});

    listen<LocalApiStatus>("local-api:status", (event) => {
      if (!cancelled) setLocalApiStatus(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenStatus = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlistenLog?.();
      unlistenStatus?.();
    };
  }, []);

  const invalidateModelStatus = useCallback(
    (modelKey: string) => {
      void queryClient.invalidateQueries({
        queryKey: modelKeys.status(modelKey),
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (modelCatalog.length === 0) return;

    setLocalModel((current) =>
      modelCatalog.some((model) => model.key === current)
        ? current
        : (modelCatalog.find((model) => model.downloadable)?.key ?? ""),
    );
  }, [modelCatalog]);

  useModelDownloadEvents({
    onProgress: (payload) => {
      setDownloadState((prev) => ({
        ...prev,
        [payload.model]: {
          status: "downloading",
          percent: Math.min(100, payload.percent),
          file: payload.file,
          verifying: payload.verifying,
        },
      }));
    },
    onComplete: ({ model }) => {
      setDownloadState((prev) => ({
        ...prev,
        [model]: {
          status: "complete",
          percent: 100,
        },
      }));
      invalidateModelStatus(model);
    },
    onError: ({ model, error, reason }) => {
      setDownloadState((prev) => ({
        ...prev,
        [model]: {
          status: "error",
          message: error,
          reason,
          percent: prev[model]?.percent ?? 0,
        },
      }));
    },
    onCancelled: ({ model }) => {
      setDownloadState((prev) => ({
        ...prev,
        [model]: { status: "cancelled", percent: 0 },
      }));
      invalidateModelStatus(model);
    },
  });

  useEffect(() => {
    if (!active) return;
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
    active,
    discardEmptyCaptureDraft,
    finalizeCapture,
    onClose,
    resetCaptureState,
  ]);

  useEffect(() => {
    if (!active) return;
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
  }, [active, loading, saveSettingsNow]);

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
      if (current[mode].length >= MAX_PER_MODE) return;
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
      if (bindingCount(shortcutBindingsRef.current) <= 1) return;
      discardInvalidShortcutDraft();
      const activeTarget = captureActiveRef.current;
      if (activeTarget?.mode === mode) {
        if (activeTarget.index === index) {
          captureActiveRef.current = null;
          setCaptureActive(null);
          resetCaptureState();
          void invoke("set_shortcut_capture_active", { active: false }).catch(
            () => {},
          );
        } else if (activeTarget.index > index) {
          const nextTarget = { ...activeTarget, index: activeTarget.index - 1 };
          captureActiveRef.current = nextTarget;
          setCaptureActive(nextTarget);
        }
      }
      updateShortcutBindings((current) => {
        return {
          ...current,
          [mode]: current[mode].filter(
            (_, bindingIndex) => bindingIndex !== index,
          ),
        };
      });
    },
    [discardInvalidShortcutDraft, resetCaptureState, updateShortcutBindings],
  );

  const moveShortcutBinding = useCallback(
    (from: ShortcutMode, index: number, to: ShortcutMode) => {
      const current = shortcutBindingsRef.current;
      const binding = current[from][index];
      if (
        from === to ||
        !binding ||
        current[to].length >= MAX_PER_MODE ||
        captureActiveRef.current
      ) {
        return;
      }
      discardInvalidShortcutDraft();
      updateShortcutBindings((latest) => ({
        ...latest,
        [from]: latest[from].filter(
          (_, bindingIndex) => bindingIndex !== index,
        ),
        [to]: [...latest[to], binding],
      }));
    },
    [discardInvalidShortcutDraft, updateShortcutBindings],
  );

  const handleLocalModelChange = useCallback(
    (modelKey: string) => {
      clearPendingSettingsSave();
      const nextModel = modelCatalog.find((model) => model.key === modelKey);
      const nextLanguage = languageSupportedByModel(nextModel, language)
        ? language
        : "";
      setRemoteSpeechEnabled(false);
      setLocalModel(modelKey);
      setLanguage(nextLanguage);
      void saveSettingsNow({
        localModel: modelKey,
        language: nextLanguage,
        remoteSpeechEnabled: false,
      });
    },
    [clearPendingSettingsSave, language, modelCatalog, saveSettingsNow],
  );

  const handleRemoteSpeechEnabledChange = useCallback(
    (enabled: boolean) => {
      clearPendingSettingsSave();
      const fallback = resolveLocalFallbackModel(
        modelCatalog,
        modelStatus,
        localModel,
      );
      const nextLocalModel =
        fallback && modelStatus[fallback.key]?.installed
          ? fallback.key
          : localModel;
      const nextModel = modelCatalog.find(
        (model) => model.key === nextLocalModel,
      );
      const nextLanguage =
        !enabled && !languageSupportedByModel(nextModel, language)
          ? ""
          : language;

      setRemoteSpeechEnabled(enabled);
      if (nextLocalModel !== localModel) setLocalModel(nextLocalModel);
      if (nextLanguage !== language) setLanguage(nextLanguage);

      void saveSettingsNow({
        localModel: nextLocalModel,
        remoteSpeechEnabled: enabled,
        language: nextLanguage,
      }).then((saved) => {
        if (saved) return;
        setRemoteSpeechEnabled(remoteSpeechEnabled);
        setLocalModel(localModel);
        setLanguage(language);
        void queryClient.invalidateQueries({ queryKey: settingsKeys.detail() });
      });
    },
    [
      clearPendingSettingsSave,
      language,
      localModel,
      modelCatalog,
      modelStatus,
      queryClient,
      remoteSpeechEnabled,
      saveSettingsNow,
    ],
  );

  useEffect(() => {
    if (!remoteSpeechEnabled || modelStatusesQuery.isLoading) return;
    const fallback = resolveLocalFallbackModel(
      modelCatalog,
      modelStatus,
      localModel,
    );
    if (
      !fallback ||
      fallback.key === localModel ||
      !modelStatus[fallback.key]?.installed
    ) {
      return;
    }

    // Keep the persisted remote fallback aligned with what the runtime can use.
    setLocalModel(fallback.key);
  }, [
    localModel,
    modelCatalog,
    modelStatus,
    modelStatusesQuery.isLoading,
    remoteSpeechEnabled,
  ]);

  const handleDownload = useCallback(
    async (modelKey: string, ane?: boolean) => {
      setDownloadState((prev) => ({
        ...prev,
        [modelKey]: {
          status: "downloading",
          percent: 0,
          file: "starting",
        },
      }));
      try {
        const status = await modelsApi.downloadModel(modelKey, ane);
        queryClient.setQueryData(modelKeys.status(modelKey), status);
        void queryClient.invalidateQueries({ queryKey: modelKeys.speech() });
      } catch (err) {
        console.error(err);
        // download:error usually lands first and carries the reason.
        setDownloadState((prev) =>
          prev[modelKey]?.status === "error"
            ? prev
            : {
                ...prev,
                [modelKey]: {
                  status: "error",
                  message: String(err),
                  reason: "failed",
                  percent: prev[modelKey]?.percent ?? 0,
                },
              },
        );
      }
    },
    [queryClient],
  );

  const handleDelete = useCallback(
    async (modelKey: string) => {
      try {
        const status = await modelsApi.deleteModel(modelKey);
        queryClient.setQueryData(modelKeys.status(modelKey), status);
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: { status: "idle", percent: 0 },
        }));

        const otherInstalledModel =
          modelCatalog.find(
            (m) =>
              m.key !== modelKey &&
              modelStatus[m.key]?.installed &&
              m.downloadable,
          ) ??
          modelCatalog.find(
            (m) => m.key !== modelKey && modelStatus[m.key]?.installed,
          );
        const settingsUpdates: SaveSettingsOverrides = {};

        if (localModel === modelKey && otherInstalledModel) {
          settingsUpdates.localModel = otherInstalledModel.key;
          setLocalModel(otherInstalledModel.key);
          const nextLanguage =
            remoteSpeechActive ||
            languageSupportedByModel(otherInstalledModel, language)
              ? language
              : "";
          if (nextLanguage !== language) {
            settingsUpdates.language = nextLanguage;
            setLanguage(nextLanguage);
          }
        }

        if (localApiModel === modelKey) {
          const nextLocalApiModel = otherInstalledModel?.key ?? "auto";
          settingsUpdates.localApiModel = nextLocalApiModel;
          setLocalApiModel(nextLocalApiModel);
        }

        if (Object.keys(settingsUpdates).length > 0) {
          clearPendingSettingsSave();
          void saveSettingsNow(settingsUpdates);
        }

        void queryClient.invalidateQueries({ queryKey: modelKeys.speech() });
      } catch (err) {
        console.error(err);
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: {
            status: "error",
            message: i18n._(
              msg({
                id: "settings.models.delete_failed",
                message: "Delete failed",
              }),
            ),
            percent: 0,
          },
        }));
        scheduleDownloadStateReset(modelKey, "error", 4000);
      }
    },
    [
      clearPendingSettingsSave,
      queryClient,
      language,
      localApiModel,
      localModel,
      modelCatalog,
      modelStatus,
      remoteSpeechActive,
      saveSettingsNow,
      scheduleDownloadStateReset,
    ],
  );

  const handleCancelDownload = useCallback(
    async (modelKey: string) => {
      try {
        await modelsApi.cancelDownload(modelKey);
        setDownloadState((prev) => ({
          ...prev,
          [modelKey]: {
            status: "cancelled",
            percent: 0,
          },
        }));
        scheduleDownloadStateReset(modelKey, "cancelled", 1500);
      } catch (err) {
        console.error("Failed to cancel download:", err);
      }
    },
    [scheduleDownloadStateReset],
  );

  const handleStartLocalApi = useCallback(async () => {
    flushPendingSettingsSave();
    setLocalApiBusy(true);
    localApiStopRequestedRef.current = false;
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
      if (localApiStopRequestedRef.current) return;
      console.error(err);
      showSettingsError(
        err instanceof Error ? err.message : String(err),
        "api",
      );
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
    setLocalApiStopping(true);
    localApiStopRequestedRef.current = true;
    try {
      await modelsApi.stopLocalApi();
      const status = await waitForLocalApiStopped();
      setLocalApiStatus(status);
      clearSettingsError();
    } catch (err) {
      console.error(err);
      showSettingsError(
        err instanceof Error ? err.message : String(err),
        "api",
      );
    } finally {
      setLocalApiBusy(false);
      setLocalApiStopping(false);
    }
  }, [clearSettingsError, showSettingsError]);

  const handleRestartLocalApi = useCallback(async () => {
    setLocalApiBusy(true);
    localApiStopRequestedRef.current = false;
    try {
      if (!(await saveSettingsNowRef.current())) return;
      await modelsApi.stopLocalApi();
      const stopped = await waitForLocalApiStopped();
      if (stopped.running) {
        throw new Error(
          i18n._(
            msg({
              id: "settings.error.api_server_restart",
              message: "The API server didn't stop, so it couldn't restart.",
            }),
          ),
        );
      }
      // Stop pressed while the old server shut down: leave it off.
      if (localApiStopRequestedRef.current) return;
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
      if (localApiStopRequestedRef.current) return;
      console.error(err);
      showSettingsError(
        err instanceof Error ? err.message : String(err),
        "api",
      );
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
      showSettingsError(
        err instanceof Error ? err.message : String(err),
        "api",
      );
    }
  }, [showSettingsError]);

  return {
    loading,
    error,
    errorSourceTab,
    showSettingsError,

    shortcutBindings,
    invalidShortcutDrafts,
    localModel,
    setLocalModel: handleLocalModelChange,
    remoteSpeechEnabled,
    setRemoteSpeechEnabled: handleRemoteSpeechEnabledChange,
    remoteSpeechProvider,
    setRemoteSpeechProvider,
    remoteSpeechEndpoint,
    setRemoteSpeechEndpoint,
    remoteSpeechApiKey,
    setRemoteSpeechApiKey,
    remoteSpeechModel,
    setRemoteSpeechModel,
    remoteSpeechConfigReady,
    microphoneDevice,
    setMicrophoneDevice,
    language: displayedLanguage,
    setLanguage,
    appLocale,
    setAppLocale: handleAppLocaleChange,
    languages: displayedLanguageOptions,

    inputDevices,
    modelCatalog,
    diarizerModel,
    modelStatus,
    downloadState,
    appInfo,
    appInfoFailed,

    captureActive,
    capturePreview,
    handleStartCapture,
    updateShortcutBinding,
    addShortcutBinding,
    removeShortcutBinding,
    moveShortcutBinding,

    llmProvider,
    setLlmProvider,
    llmEndpoint,
    setLlmEndpoint,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmServiceProvider,
    setLlmServiceProvider,
    llmAuto,
    setLlmAuto,
    llmConfigReady,
    licenseGateActive,
    activeLicense,
    autoDictionaryEnabled,
    autoDictionarySupported,
    setAutoDictionaryEnabled,
    mediaAction,
    setMediaAction,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    autoLaunchEnabled,
    setAutoLaunchEnabled,
    startInBackground,
    setStartInBackground,
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
    localApiStopping,
    cliInstallStatus,
    handleStartLocalApi,
    handleStopLocalApi,
    handleRestartLocalApi,
    handleClearLocalApiLogs,
    platformCapabilities,

    micPermission,
    accessibilityPermission,
    inputMonitoringPermission,
    handleRequestMicrophonePermission,
    handleRequestAccessibilityPermission,
    handleRequestInputMonitoringPermission,
    textSizeMode,
    setTextSizeMode,
    themeMode,
    setThemeMode,

    handleDownload,
    handleDelete,
    handleCancelDownload,
    handleOpenDataDir,
  };
}
