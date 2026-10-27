import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { Check, Info, Microphone as Mic, Square } from "@phosphor-icons/react";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import ShortcutList from "../ShortcutList";
import { useLanguageModelStatus } from "../../useLanguageModelStatus";
import type { DeviceInfo, LlmProvider } from "../../../../types";
import type { TranscriptionLanguageOption } from "../../../../shared/lib/transcriptionLanguages";
import type { ShortcutBinding, ShortcutBindings } from "../../../../types";

type ShortcutMode = "smart" | "hold" | "toggle";
type CaptureMode = { mode: ShortcutMode; index: number } | null;
type InvalidShortcutDrafts = Partial<
  Record<ShortcutMode, Record<number, string>>
>;
type MicrophoneTestStatus = "idle" | "starting" | "listening" | "error";
type MicrophoneTestLevels = {
  left: number;
  right: number;
};

type GeneralTabProps = {
  variants: Variants;
  inputDevices: DeviceInfo[];
  microphoneDevice: string | null;
  onMicrophoneDeviceChange: (deviceId: string | null) => void;
  language: string;
  onLanguageChange: (language: string) => void;
  languages: TranscriptionLanguageOption[];
  shortcutBindings: ShortcutBindings;
  invalidShortcutDrafts: InvalidShortcutDrafts;
  captureActive: CaptureMode;
  capturePreview: string;
  onStartCapture: (mode: ShortcutMode, index?: number) => void;
  updateShortcutBinding: (
    mode: ShortcutMode,
    index: number,
    patch: Partial<ShortcutBinding>,
  ) => void;
  addShortcutBinding: (mode: ShortcutMode) => void;
  removeShortcutBinding: (mode: ShortcutMode, index: number) => void;
  moveShortcutBinding: (
    from: ShortcutMode,
    index: number,
    to: ShortcutMode,
  ) => void;
  autoDictionaryEnabled: boolean;
  autoDictionarySupported: boolean;
  setAutoDictionaryEnabled: (value: boolean) => void;
  licenseGateActive: boolean;
  llmProvider: LlmProvider;
  llmAuto: boolean;
  llmServiceProvider: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  onOpenAccountTab: () => void;
  onOpenModelsTab: () => void;
};

const GeneralTab = ({
  variants,
  inputDevices,
  microphoneDevice,
  onMicrophoneDeviceChange,
  language,
  onLanguageChange,
  languages,
  shortcutBindings,
  invalidShortcutDrafts,
  captureActive,
  capturePreview,
  onStartCapture,
  updateShortcutBinding,
  addShortcutBinding,
  removeShortcutBinding,
  moveShortcutBinding,
  autoDictionaryEnabled,
  autoDictionarySupported,
  setAutoDictionaryEnabled,
  licenseGateActive,
  llmProvider,
  llmAuto,
  llmServiceProvider,
  llmEndpoint,
  llmApiKey,
  llmModel,
  onOpenAccountTab,
  onOpenModelsTab,
}: GeneralTabProps) => {
  const { t } = useLingui();
  const languageModel = useLanguageModelStatus({
    llmProvider,
    llmAuto,
    llmServiceProvider,
    llmEndpoint,
    llmApiKey,
    llmModel,
    licenseGateActive,
  });
  const cleanupWaitsForModel =
    licenseGateActive &&
    languageModel.ready === false &&
    Object.values(shortcutBindings).some((bindings) =>
      bindings.some((binding) => binding.cleanup_enabled),
    );
  const languageInfoId = useId();
  const [micDropdownOpen, setMicDropdownOpen] = useState(false);
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const deviceRowElevated = micDropdownOpen || languageDropdownOpen;
  const {
    activeDeviceLabel,
    error: microphoneTestError,
    levels: microphoneTestLevels,
    reset: resetMicrophoneTest,
    start: startMicrophoneTest,
    status: microphoneTestStatus,
  } = useMicrophoneTest(microphoneDevice);
  const autoDictionaryBody = autoDictionarySupported
    ? t({
        id: "settings.general.auto_dictionary.body",
        message: "suggests names and terms after you correct dictated text",
      })
    : t({
        id: "settings.general.auto_dictionary.unsupported_body",
        message: "requires a model with dictionary support",
      });
  const systemDefaultLabel = t({
    id: "settings.general.system_default.v2",
    message: "System default",
  });

  const isMicrophoneTestActive =
    microphoneTestStatus === "starting" || microphoneTestStatus === "listening";

  const handleMicrophoneTestButton = () => {
    if (isMicrophoneTestActive || microphoneTestStatus === "error") {
      resetMicrophoneTest();
      return;
    }

    void startMicrophoneTest();
  };

  return (
    <motion.div
      key="general"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-6"
    >
      <div
        className={`grid grid-cols-2 gap-3${deviceRowElevated ? " relative z-dropdown-open" : ""}`}
      >
        <div className="space-y-1.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <label className="ui-text-label-strong ui-color-primary leading-none">
              {t({
                id: "settings.general.microphone",
                message: "Microphone",
              })}
            </label>
            <button
              type="button"
              onClick={handleMicrophoneTestButton}
              className={`flex h-5 items-center gap-1 rounded-md px-1.5 ui-text-meta transition-colors ${
                isMicrophoneTestActive
                  ? "ui-color-error hover:bg-error/10"
                  : "ui-color-muted hover:bg-surface-elevated hover:text-content-primary"
              }`}
            >
              {isMicrophoneTestActive ? (
                <>
                  <Square size={9} fill="currentColor" aria-hidden="true" />
                  {t({
                    id: "settings.general.microphone_test.stop",
                    message: "Stop",
                  })}
                </>
              ) : microphoneTestStatus === "error" ? (
                <>
                  <Check size={10} aria-hidden="true" />
                  {t({
                    id: "settings.general.microphone_test.done",
                    message: "Done",
                  })}
                </>
              ) : (
                <>
                  <Mic size={10} aria-hidden="true" />
                  {t({
                    id: "settings.general.microphone_test.test",
                    message: "Test",
                  })}
                </>
              )}
            </button>
          </div>
          <div className="h-[38px]">
            {microphoneTestStatus === "listening" ||
            microphoneTestStatus === "error" ? (
              <MicrophoneTestSlot
                status={microphoneTestStatus}
                levels={microphoneTestLevels}
                label={
                  activeDeviceLabel ??
                  getSelectedMicrophoneName(inputDevices, microphoneDevice) ??
                  systemDefaultLabel
                }
                error={microphoneTestError}
              />
            ) : (
              <Dropdown
                value={microphoneDevice || ""}
                ariaLabel={t({
                  id: "settings.general.microphone",
                  message: "Microphone",
                })}
                onChange={(val) =>
                  onMicrophoneDeviceChange(val === "" ? null : val)
                }
                onOpenChange={setMicDropdownOpen}
                options={[
                  {
                    value: "",
                    label: systemDefaultLabel,
                  },
                  ...inputDevices.map((device) => ({
                    value: device.id,
                    label: device.name,
                  })),
                ]}
                placeholder={t({
                  id: "settings.general.select_microphone",
                  message: "Select microphone...",
                })}
                className="h-[38px]"
                buttonClassName="h-[38px] px-3 py-2 ui-text-body-sm"
                menuClassName="top-[38px]"
              />
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex h-5 items-center">
            <div className="flex items-center gap-1">
              <label className="ui-text-label-strong ui-color-primary leading-none">
                {t({
                  id: "settings.general.transcription_language.v2",
                  message: "Transcription language",
                })}
              </label>
              <div className="relative group">
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center rounded-sm text-content-muted hover:text-content-secondary transition-colors"
                  aria-describedby={languageInfoId}
                  aria-label={t({
                    id: "settings.general.language_info_aria",
                    message:
                      "More information about transcription language support",
                  })}
                >
                  <Info size={10} aria-hidden="true" />
                </button>
                <div className="absolute right-0 top-full mt-1.5 hidden group-hover:block group-focus-within:block z-tooltip">
                  <div
                    id={languageInfoId}
                    role="tooltip"
                    className="ui-surface-menu w-56 px-2.5 py-1.5 ui-text-micro ui-color-secondary leading-tight"
                  >
                    <p>
                      {t({
                        id: "settings.general.language_info.active_model",
                        message:
                          "Unsupported languages aren't available on your active model. Switch to a supported model to use them.",
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <Dropdown
              value={language}
              ariaLabel={t({
                id: "settings.general.transcription_language.v2",
                message: "Transcription language",
              })}
              onChange={(val) => onLanguageChange(val)}
              onOpenChange={setLanguageDropdownOpen}
              options={languages.map((lang) => ({
                value: lang.code,
                label: lang.name,
                locked: lang.locked,
                isHeader: lang.isHeader,
                prominentHeader: lang.prominentHeader,
                description: lang.description,
              }))}
              searchable
              searchPlaceholder={t({
                id: "settings.general.search_language",
                message: "Search language...",
              })}
              buttonClassName="min-h-[38px] px-3 py-2 ui-text-body-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <SectionLabel>
            {t({
              id: "settings.general.shortcuts",
              message: "Shortcuts",
            })}
          </SectionLabel>
          <ShortcutList
            bindings={shortcutBindings}
            invalidDrafts={invalidShortcutDrafts}
            captureActive={captureActive}
            capturePreview={capturePreview}
            cleanupDisabled={!licenseGateActive}
            onStartCapture={onStartCapture}
            onUpdate={updateShortcutBinding}
            onAdd={addShortcutBinding}
            onRemove={removeShortcutBinding}
            onMove={moveShortcutBinding}
          />

          {cleanupWaitsForModel && (
            <p className="ui-text-meta ui-color-warning px-0.5">
              {t({
                id: "settings.general.shortcuts.cleanup_needs_model",
                message: "Clean up needs a language model. Set one up in",
              })}{" "}
              <button
                type="button"
                onClick={onOpenModelsTab}
                className="ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] hover:decoration-[var(--color-text-primary)] transition-colors"
              >
                {t({
                  id: "settings.general.shortcuts.models_link",
                  message: "Models",
                })}
              </button>
            </p>
          )}

          {!licenseGateActive && (
            <p className="ui-text-meta ui-color-muted px-0.5">
              {t({
                id: "settings.general.shortcuts.cleanup_locked.license_prefix.v2",
                message: "Cleanup comes with Glimpse Plus. Get it in",
              })}{" "}
              <button
                type="button"
                onClick={() => {
                  void invoke("track_gate_blocked", {
                    feature: "cleanup",
                  }).catch(() => {});
                  onOpenAccountTab();
                }}
                className="ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] hover:decoration-[var(--color-text-primary)] transition-colors"
              >
                {t({
                  id: "settings.general.shortcuts.cleanup_locked.account_link",
                  message: "Account",
                })}
              </button>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <SectionLabel>
            {t({
              id: "settings.general.features",
              message: "Features",
            })}
          </SectionLabel>
          <div className="rounded-lg bg-surface-surface">
            <div className="py-2 px-2.5">
              <div className="flex items-center justify-between">
                <span className="ui-text-label-strong ui-color-primary">
                  {t({
                    id: "settings.general.auto_dictionary",
                    message: "Auto Dictionary",
                  })}
                </span>
                <ToggleSwitch
                  enabled={autoDictionarySupported && autoDictionaryEnabled}
                  disabled={!autoDictionarySupported}
                  onToggle={() => {
                    if (autoDictionarySupported) {
                      setAutoDictionaryEnabled(!autoDictionaryEnabled);
                    }
                  }}
                  ariaLabel={t({
                    id: "settings.general.auto_dictionary.toggle_aria",
                    message: "Toggle Auto Dictionary",
                  })}
                />
              </div>
              <span className="ui-text-meta ui-color-muted block mt-0.5">
                {autoDictionaryBody}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const MICROPHONE_TEST_DOT_COLS = 32;
const MICROPHONE_TEST_DOT_SIZE = 2;
const MICROPHONE_TEST_DOT_GAP = 2;
const MICROPHONE_TEST_DOT_WIDTH =
  MICROPHONE_TEST_DOT_COLS * MICROPHONE_TEST_DOT_SIZE +
  (MICROPHONE_TEST_DOT_COLS - 1) * MICROPHONE_TEST_DOT_GAP;
const EMPTY_MICROPHONE_TEST_LEVELS = { left: 0, right: 0 };

type MicrophoneTestSlotProps = {
  status: MicrophoneTestStatus;
  levels: MicrophoneTestLevels;
  label: string;
  error: string | null;
};

const MicrophoneTestSlot = ({
  status,
  levels,
  label,
  error,
}: MicrophoneTestSlotProps) => {
  const { t } = useLingui();

  if (status === "error") {
    return (
      <div className="flex h-[38px] items-center rounded-lg border border-error/30 bg-error/5 px-3">
        <p role="alert" className="ui-text-meta ui-color-error truncate">
          {error ??
            t({
              id: "settings.general.microphone_test.generic_error",
              message: "Couldn't start microphone test.",
            })}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex h-[38px] items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3"
      aria-live="polite"
    >
      <span
        className="min-w-0 flex-1 truncate ui-text-meta ui-color-muted"
        title={label}
      >
        {label}
      </span>
      <MicrophoneLevelMeter levels={levels} />
    </div>
  );
};

type MicrophoneLevelMeterProps = {
  levels: MicrophoneTestLevels;
};

const MicrophoneLevelMeter = ({ levels }: MicrophoneLevelMeterProps) => (
  <div
    className="ml-auto grid shrink-0 place-items-center overflow-hidden"
    style={{
      gridTemplateColumns: `repeat(${MICROPHONE_TEST_DOT_COLS}, ${MICROPHONE_TEST_DOT_SIZE}px)`,
      gap: MICROPHONE_TEST_DOT_GAP,
      width: MICROPHONE_TEST_DOT_WIDTH,
    }}
  >
    {[levels.left, levels.right].flatMap((level, row) =>
      Array.from({ length: MICROPHONE_TEST_DOT_COLS }, (_, col) => {
        const active = col < levelToDotCount(level);
        return (
          <div
            key={`${row}-${col}`}
            style={{
              width: MICROPHONE_TEST_DOT_SIZE,
              height: MICROPHONE_TEST_DOT_SIZE,
              backgroundColor: getMicrophoneDotColor(col),
              opacity: active ? 0.95 : 0.16,
              borderRadius: active ? 0.5 : "50%",
              transition:
                "border-radius 0.18s ease-out, opacity 0.18s ease-out",
            }}
          />
        );
      }),
    )}
  </div>
);

const levelToDotCount = (level: number) =>
  Math.min(
    MICROPHONE_TEST_DOT_COLS,
    Math.round(level * MICROPHONE_TEST_DOT_COLS),
  );

const getMicrophoneDotColor = (col: number) => {
  if (col < 5) return "var(--color-warning)";
  if (col >= MICROPHONE_TEST_DOT_COLS - 4) return "var(--color-error)";
  return "var(--color-success)";
};

const getSelectedMicrophoneName = (
  inputDevices: DeviceInfo[],
  microphoneDevice: string | null,
) => {
  if (!microphoneDevice) return null;
  return (
    inputDevices.find((device) => device.id === microphoneDevice)?.name ?? null
  );
};

const useMicrophoneTest = (microphoneDevice: string | null) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [levels, setLevels] = useState<MicrophoneTestLevels>(
    EMPTY_MICROPHONE_TEST_LEVELS,
  );
  const [error, setError] = useState<string | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string | null>(
    null,
  );
  const unlistenRef = useRef<(() => void) | null>(null);
  const smoothedLevelsRef = useRef<MicrophoneTestLevels>(
    EMPTY_MICROPHONE_TEST_LEVELS,
  );
  const runIdRef = useRef(0);

  const releaseResources = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    void invoke("stop_microphone_test");
  }, []);

  const clearMeterState = useCallback(() => {
    smoothedLevelsRef.current = EMPTY_MICROPHONE_TEST_LEVELS;
    setLevels(EMPTY_MICROPHONE_TEST_LEVELS);
    setActiveDeviceLabel(null);
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    releaseResources();
    setStatus("idle");
    clearMeterState();
    setError(null);
  }, [clearMeterState, releaseResources]);

  const start = useCallback(async () => {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    releaseResources();
    setStatus("starting");
    clearMeterState();
    setError(null);

    try {
      const unlistenLevel = await listen<number>(
        "microphone-test:level",
        (event) => {
          smoothedLevelsRef.current = smoothMicrophoneLevels(
            smoothedLevelsRef.current,
            { left: event.payload, right: event.payload },
          );
          setLevels(smoothedLevelsRef.current);
        },
      );
      // The backend ended the test: dictation started or the window closed.
      const unlistenStopped = await listen("microphone-test:stopped", reset);
      const unlisten = () => {
        unlistenLevel();
        unlistenStopped();
      };

      // A newer run owns the shared ref by now; only drop this run's listeners.
      if (runIdRef.current !== runId) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;

      // The backend reports the device it opened, which is the default input
      // when the selected one is gone.
      const openedDevice = await invoke<string>("start_microphone_test", {
        deviceId: microphoneDevice,
      });

      if (runIdRef.current !== runId) return;
      setActiveDeviceLabel(microphoneDevice ? openedDevice || null : null);
      setStatus("listening");
    } catch (err) {
      if (runIdRef.current !== runId) return;
      releaseResources();
      clearMeterState();
      setStatus("error");
      setError(t(formatMicrophoneTestError(err)));
    }
  }, [clearMeterState, microphoneDevice, releaseResources, reset, t]);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      releaseResources();
    },
    [releaseResources],
  );

  return {
    activeDeviceLabel,
    error,
    levels,
    reset,
    start,
    status,
  };
};

const smoothMicrophoneLevels = (
  previous: MicrophoneTestLevels,
  target: MicrophoneTestLevels,
) => ({
  left: smoothMicrophoneLevel(previous.left, target.left),
  right: smoothMicrophoneLevel(previous.right, target.right),
});

const smoothMicrophoneLevel = (previous: number, target: number) => {
  const factor = target > previous ? 0.78 : 0.32;
  const next = previous + (target - previous) * factor;
  return next < 0.02 ? 0 : next;
};

const formatMicrophoneTestError = (err: unknown) => {
  if (err === "permission") {
    return msg({
      id: "settings.general.microphone_test.permission_error",
      message: "Microphone access was denied.",
    });
  }

  if (err === "busy") {
    return msg({
      id: "settings.general.microphone_test.busy_error",
      message: "That microphone is already in use.",
    });
  }

  if (err === "no_device") {
    return msg({
      id: "settings.general.microphone_test.not_found_error",
      message: "No microphone was found.",
    });
  }

  return msg({
    id: "settings.general.microphone_test.start_error",
    message: "Couldn't start microphone test.",
  });
};

export default GeneralTab;
