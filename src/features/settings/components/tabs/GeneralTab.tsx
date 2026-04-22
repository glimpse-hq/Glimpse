import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Copy, Info, Mic, Square } from "lucide-react";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import { formatShortcutForDisplay } from "../../../../shared/lib/shortcuts";
import type {
  DeviceInfo,
  ModelStatus,
  TranscriptionMode,
} from "../../../../types";
import type {
  LanguageBadgeColumn,
  TranscriptionLanguageOption,
} from "../../../../shared/lib/transcriptionLanguages";

type CaptureMode = "smart" | "hold" | "toggle" | null;
type HelpTooltipId = "edit-mode" | "cleanup";
type MicrophoneTestStatus = "idle" | "starting" | "listening" | "error";
type MicrophoneTestLevels = {
  left: number;
  right: number;
};

type GeneralTabProps = {
  variants: Variants;
  transcriptionMode: TranscriptionMode;
  onTranscriptionModeChange: (mode: TranscriptionMode) => void;
  modelStatus: Record<string, ModelStatus>;
  localModel: string;
  onOpenModelsTab: () => void;
  inputDevices: DeviceInfo[];
  microphoneDevice: string | null;
  onMicrophoneDeviceChange: (deviceId: string | null) => void;
  language: string;
  onLanguageChange: (language: string) => void;
  languages: TranscriptionLanguageOption[];
  languageBadgeColumns: LanguageBadgeColumn[];
  showLanguageSupportBadges: boolean;
  smartShortcut: string;
  smartEnabled: boolean;
  setSmartEnabled: (value: boolean) => void;
  holdShortcut: string;
  holdEnabled: boolean;
  setHoldEnabled: (value: boolean) => void;
  toggleShortcut: string;
  toggleEnabled: boolean;
  setToggleEnabled: (value: boolean) => void;
  captureActive: CaptureMode;
  capturePreview: string;
  onStartCapture: (mode: Exclude<CaptureMode, null>) => void;
  error: string | null;
  errorCopied: boolean;
  setErrorCopied: (value: boolean) => void;
  editModeEnabled: boolean;
  setEditModeEnabled: (value: boolean) => void;
  cleanupEnabled: boolean;
  setCleanupEnabled: (value: boolean) => void;
  aiFeaturesReady: boolean;
};

const GeneralTab = ({
  variants,
  transcriptionMode,
  onTranscriptionModeChange,
  modelStatus,
  localModel,
  onOpenModelsTab,
  inputDevices,
  microphoneDevice,
  onMicrophoneDeviceChange,
  language,
  onLanguageChange,
  languages,
  languageBadgeColumns,
  showLanguageSupportBadges,
  smartShortcut,
  smartEnabled,
  setSmartEnabled,
  holdShortcut,
  holdEnabled,
  setHoldEnabled,
  toggleShortcut,
  toggleEnabled,
  setToggleEnabled,
  captureActive,
  capturePreview,
  onStartCapture,
  error,
  errorCopied,
  setErrorCopied,
  editModeEnabled,
  setEditModeEnabled,
  cleanupEnabled,
  setCleanupEnabled,
  aiFeaturesReady,
}: GeneralTabProps) => {
  const { t } = useLingui();
  const [openHelpTooltip, setOpenHelpTooltip] =
    useState<HelpTooltipId | null>(null);
  const {
    activeDeviceLabel,
    error: microphoneTestError,
    levels: microphoneTestLevels,
    reset: resetMicrophoneTest,
    start: startMicrophoneTest,
    status: microphoneTestStatus,
  } = useMicrophoneTest(inputDevices, microphoneDevice);
  const aiFeaturesDisabled = transcriptionMode === "local" && !aiFeaturesReady;
  const localModelStatus = localModel ? modelStatus[localModel] : undefined;
  const systemDefaultLabel = t({
    id: "settings.general.system_default",
    message: "System Default",
  });
  const shouldShowMissingModelWarning =
    transcriptionMode === "local" &&
    Boolean(localModel) &&
    localModelStatus !== undefined &&
    !localModelStatus.installed;

  const showHelpTooltip = (tooltip: HelpTooltipId) => {
    setOpenHelpTooltip(tooltip);
  };

  const hideHelpTooltip = (tooltip: HelpTooltipId) => {
    setOpenHelpTooltip((current) => (current === tooltip ? null : current));
  };

  const toggleHelpTooltip = (tooltip: HelpTooltipId) => {
    setOpenHelpTooltip((current) => (current === tooltip ? null : tooltip));
  };

  const isMicrophoneTestActive =
    microphoneTestStatus === "starting" ||
    microphoneTestStatus === "listening";

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
    <div className="space-y-2">
      <h2 className="ui-text-section-label ui-color-muted">
        {t({
          id: "settings.general.processing",
          message: "Processing",
        })}
      </h2>
      <div
        className="grid grid-cols-2 gap-3"
        role="radiogroup"
        aria-label={t({
          id: "settings.general.processing_mode",
          message: "Processing Mode",
        })}
      >
        <button
          onClick={() => {}}
          disabled
          role="radio"
          aria-checked={transcriptionMode === "cloud"}
          aria-label={t({
            id: "settings.general.cloud.aria",
            message: "Cloud processing (Coming soon)",
          })}
          className={`py-3 px-3.5 rounded-lg border text-left transition-all duration-100 opacity-60 cursor-not-allowed ${
            transcriptionMode === "cloud"
              ? "border-cloud-30 bg-cloud-5 shadow-[0_3px_0_-1px_rgba(251,191,36,0.4),inset_0_1px_0_0_rgba(251,191,36,0.1)]"
              : "border-border-primary bg-surface-surface shadow-[0_3px_0_-1px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          }`}
          aria-disabled="true"
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className={`ui-text-body-strong ${
                transcriptionMode === "cloud"
                  ? "ui-color-cloud"
                  : "ui-color-secondary"
              }`}
            >
              {t({
                id: "settings.general.cloud.label",
                message: "Cloud",
              })}
            </span>
            <span
              className={`ui-text-label ${
                transcriptionMode === "cloud"
                  ? "text-cloud-50"
                  : "ui-color-disabled"
              }`}
            >
              {t({
                id: "settings.general.cloud.badge",
                message: "coming soon",
              })}
            </span>
          </div>
          <p
            className={`ui-text-label mt-1 ${
              transcriptionMode === "cloud"
                ? "text-cloud-50"
                : "ui-color-disabled"
            }`}
          >
            {t({
              id: "settings.general.cloud.description",
              message: "In development",
            })}
          </p>
        </button>
        <button
          onClick={() => onTranscriptionModeChange("local")}
          role="radio"
          aria-checked={transcriptionMode === "local"}
          className={`py-3 px-3.5 rounded-lg border text-left transition-all duration-100 ${
            transcriptionMode === "local"
              ? "border-local-30 bg-local-5 shadow-[0_3px_0_-1px_rgba(165,179,254,0.4),inset_0_1px_0_0_rgba(165,179,254,0.1)]"
              : "border-border-primary bg-surface-surface shadow-[0_3px_0_-1px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-local-30 hover:bg-local-5 hover:shadow-[0_2px_0_-1px_rgba(165,179,254,0.4),inset_0_1px_0_0_rgba(165,179,254,0.1)] hover:translate-y-[1px]"
          } active:translate-y-[2px] active:shadow-none`}
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className={`ui-text-body-strong ${
                transcriptionMode === "local"
                  ? "ui-color-local"
                  : "ui-color-secondary"
              }`}
            >
              {t({
                id: "settings.general.local.label",
                message: "Local",
              })}
            </span>
            <span
              className={`ui-text-label ${
                transcriptionMode === "local"
                  ? "text-local-50"
                  : "ui-color-disabled"
              }`}
            >
              {t({
                id: "settings.general.local.badge",
                message: "private",
              })}
            </span>
          </div>
          <p
            className={`ui-text-label mt-1 ${
              transcriptionMode === "local"
                ? "text-local-50"
                : "ui-color-disabled"
            }`}
          >
            {t({
              id: "settings.general.local.description",
              message: "Runs entirely on your device",
            })}
          </p>
        </button>
      </div>
      <AnimatePresence>
        {shouldShowMissingModelWarning && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="ui-text-label ui-color-warning"
            >
              {t({
                id: "settings.general.no_model",
                message: "No model installed.",
              })}{" "}
              <button
                onClick={onOpenModelsTab}
                className="underline hover:text-cloud transition-colors"
              >
                {t({
                  id: "settings.general.download_one",
                  message: "Download one",
                })}
              </button>{" "}
              {t({
                id: "settings.general.to_use_local",
                message: "to use local.",
              })}
            </motion.p>
          )}
      </AnimatePresence>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <div className="flex h-5 items-center justify-between gap-2">
          <label className="ui-text-label-strong ui-color-muted leading-none">
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
        <div className="relative z-20 h-[38px]">
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
              onChange={(val) =>
                onMicrophoneDeviceChange(val === "" ? null : val)
              }
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
                id: "settings.general.transcription_language",
                message: "Transcription Language",
              })}
            </label>
            <div className="relative group">
              <button
                className="flex h-4 w-4 items-center justify-center text-content-disabled hover:text-content-muted transition-colors"
                aria-label={t({
                  id: "settings.general.language_info_aria",
                  message:
                    "More information about transcription language support badges",
                })}
              >
                <Info size={10} aria-hidden="true" />
              </button>
              <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block group-focus-within:block z-10">
                <div className="ui-surface-menu w-56 px-2.5 py-1.5 ui-text-micro ui-color-secondary leading-tight">
                  <p>
                    {t({
                      id: "settings.general.language_info.installed",
                      message:
                        "Language list is filtered to the models you have installed.",
                    })}
                  </p>
                  {showLanguageSupportBadges && (
                    <p className="mt-1">
                      {t({
                        id: "settings.general.language_info.badges",
                        message:
                          "Badges show which installed engine supports each language.",
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <Dropdown
            value={language}
            onChange={(val) => onLanguageChange(val)}
            options={languages.map((lang) => {
              if (!showLanguageSupportBadges) {
                return {
                  value: lang.code,
                  label: lang.name,
                };
              }

              return {
                value: lang.code,
                label: lang.name,
                badges: languageBadgeColumns.map((column) => {
                  const source = lang.badges.find(
                    (badge) => badge.engine === column.engine,
                  );
                  return {
                    label: column.label,
                    highlighted: source?.highlighted ?? false,
                    visible: Boolean(source),
                  };
                }),
                fixedBadgeSlots: true,
              };
            })}
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
        <h2 className="ui-text-section-label ui-color-muted">
          {t({
            id: "settings.general.shortcuts",
            message: "Shortcuts",
          })}
        </h2>

        <div className="space-y-3 rounded-lg bg-surface-surface p-2.5">
          <ShortcutRow
            label={t({
              id: "settings.general.shortcuts.smart",
              message: "Smart",
            })}
            description={t({
              id: "settings.general.shortcuts.smart_description",
              message: "tap to toggle, hold to talk",
            })}
            shortcut={smartShortcut}
            enabled={smartEnabled}
            isCapturing={captureActive === "smart"}
            capturePreview={capturePreview}
            onToggle={() => {
              if (!smartEnabled && !holdEnabled && !toggleEnabled) return;
              setSmartEnabled(!smartEnabled);
            }}
            onCapture={() => {
              if (!smartEnabled) return;
              onStartCapture("smart");
            }}
            canDisable={holdEnabled || toggleEnabled}
          />
          <ShortcutRow
            label={t({
              id: "settings.general.shortcuts.hold",
              message: "Hold",
            })}
            description={t({
              id: "settings.general.shortcuts.hold_description",
              message: "hold to talk, release to stop",
            })}
            shortcut={holdShortcut}
            enabled={holdEnabled}
            isCapturing={captureActive === "hold"}
            capturePreview={capturePreview}
            onToggle={() => {
              if (!holdEnabled && !toggleEnabled && !smartEnabled) return;
              setHoldEnabled(!holdEnabled);
            }}
            onCapture={() => {
              if (!holdEnabled) return;
              onStartCapture("hold");
            }}
            canDisable={smartEnabled || toggleEnabled}
          />
          <ShortcutRow
            label={t({
              id: "settings.general.shortcuts.toggle",
              message: "Toggle",
            })}
            description={t({
              id: "settings.general.shortcuts.toggle_description",
              message: "tap to start, tap to stop",
            })}
            shortcut={toggleShortcut}
            enabled={toggleEnabled}
            isCapturing={captureActive === "toggle"}
            capturePreview={capturePreview}
            onToggle={() => {
              if (!toggleEnabled && !holdEnabled && !smartEnabled) return;
              setToggleEnabled(!toggleEnabled);
            }}
            onCapture={() => {
              if (!toggleEnabled) return;
              onStartCapture("toggle");
            }}
            canDisable={smartEnabled || holdEnabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="ui-text-section-label ui-color-muted">
          {t({
            id: "settings.general.features",
            message: "Features",
          })}
        </h2>

        <div className="space-y-3">
          <div
            className={`rounded-lg transition-colors ${
              editModeEnabled ? "bg-surface-overlay" : "bg-surface-surface"
            }`}
          >
            <div className="py-2 px-2.5">
              <div className="flex items-center justify-between">
                <span className="ui-text-label-strong ui-color-primary">
                  {t({
                    id: "settings.general.edit_mode",
                    message: "Edit Mode",
                  })}
                </span>
                <ToggleSwitch
                  enabled={editModeEnabled}
                  onToggle={() => aiFeaturesReady && setEditModeEnabled(!editModeEnabled)}
                  ariaLabel={t({
                    id: "settings.general.edit_mode.toggle_aria",
                    message: "Toggle Edit Mode",
                  })}
                  disabled={aiFeaturesDisabled}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="ui-text-meta ui-color-muted">
                  {aiFeaturesDisabled ? (
                    <>
                      {t({
                        id: "settings.general.edit_mode.configure_prefix",
                        message: "Configure a language model in",
                      })}{" "}
                      <button
                        type="button"
                        onClick={onOpenModelsTab}
                        className="ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] hover:decoration-[var(--color-text-primary)] transition-colors"
                      >
                        {t({
                          id: "settings.general.models_tab",
                          message: "Models",
                        })}
                      </button>{" "}
                      {t({
                        id: "settings.general.edit_mode.models_suffix",
                        message: "to use Edit Mode.",
                      })}
                    </>
                  ) : (
                    t({
                      id: "settings.general.edit_mode.body",
                      message: "transform selected text with voice",
                    })
                  )}
                </span>
                <div
                  className="relative"
                  onMouseEnter={() => showHelpTooltip("edit-mode")}
                  onMouseLeave={() => hideHelpTooltip("edit-mode")}
                >
                  <button
                    type="button"
                    className="p-0.5 text-content-disabled hover:text-content-muted transition-colors"
                    aria-label={t({
                      id: "settings.general.edit_mode.info_aria",
                      message: "More information about Edit Mode",
                    })}
                    aria-expanded={openHelpTooltip === "edit-mode"}
                    aria-controls="edit-mode-help-tooltip"
                    onFocus={() => showHelpTooltip("edit-mode")}
                    onBlur={() => hideHelpTooltip("edit-mode")}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        hideHelpTooltip("edit-mode");
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleHelpTooltip("edit-mode");
                      }
                    }}
                  >
                    <Info size={10} aria-hidden="true" />
                  </button>
                  <div
                    id="edit-mode-help-tooltip"
                    role="tooltip"
                    className={`absolute right-0 bottom-full mb-1 z-10 ${
                      openHelpTooltip === "edit-mode" ? "block" : "hidden"
                    }`}
                  >
                    <div className="bg-surface-overlay border border-border-secondary rounded-lg px-2.5 py-1.5 ui-text-micro ui-color-secondary w-44 shadow-lg leading-tight">
                      <p>
                        {t({
                          id: "settings.general.edit_mode.help",
                          message:
                            'Select text in any app, and speak a command like "make this formal" or "fix my grammar".',
                        })}
                      </p>
                      {transcriptionMode === "local" && !aiFeaturesReady && (
                        <p className="text-warning mt-1">
                          {t({
                            id: "settings.general.edit_mode.help_requirement",
                            message:
                              "Requires an enabled and configured language model in the Models tab.",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`rounded-lg transition-colors ${
              cleanupEnabled ? "bg-surface-overlay" : "bg-surface-surface"
            }`}
          >
            <div className="py-2 px-2.5">
              <div className="flex items-center justify-between">
                <span className="ui-text-label-strong ui-color-primary">
                  {t({
                    id: "settings.general.cleanup",
                    message: "Cleanup",
                  })}
                </span>
                <ToggleSwitch
                  enabled={cleanupEnabled}
                  onToggle={() => aiFeaturesReady && setCleanupEnabled(!cleanupEnabled)}
                  ariaLabel={t({
                    id: "settings.general.cleanup.toggle_aria",
                    message: "Toggle Cleanup",
                  })}
                  disabled={aiFeaturesDisabled}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="ui-text-meta ui-color-muted">
                  {aiFeaturesDisabled ? (
                    <>
                      {t({
                        id: "settings.general.cleanup.configure_prefix",
                        message: "Configure a language model in",
                      })}{" "}
                      <button
                        type="button"
                        onClick={onOpenModelsTab}
                        className="ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] hover:decoration-[var(--color-text-primary)] transition-colors"
                      >
                        {t({
                          id: "settings.general.models_tab",
                          message: "Models",
                        })}
                      </button>{" "}
                      {t({
                        id: "settings.general.cleanup.models_suffix",
                        message: "to use Cleanup.",
                      })}
                    </>
                  ) : (
                    t({
                      id: "settings.general.cleanup.body",
                      message: "remove filler words and polish transcripts",
                    })
                  )}
                </span>
                <div
                  className="relative"
                  onMouseEnter={() => showHelpTooltip("cleanup")}
                  onMouseLeave={() => hideHelpTooltip("cleanup")}
                >
                  <button
                    type="button"
                    className="p-0.5 text-content-disabled hover:text-content-muted transition-colors"
                    aria-label={t({
                      id: "settings.general.cleanup.info_aria",
                      message: "More information about Cleanup",
                    })}
                    aria-expanded={openHelpTooltip === "cleanup"}
                    aria-controls="cleanup-help-tooltip"
                    onFocus={() => showHelpTooltip("cleanup")}
                    onBlur={() => hideHelpTooltip("cleanup")}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        hideHelpTooltip("cleanup");
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleHelpTooltip("cleanup");
                      }
                    }}
                  >
                    <Info size={10} aria-hidden="true" />
                  </button>
                  <div
                    id="cleanup-help-tooltip"
                    role="tooltip"
                    className={`absolute right-0 bottom-full mb-1 z-10 ${
                      openHelpTooltip === "cleanup" ? "block" : "hidden"
                    }`}
                  >
                    <div className="bg-surface-overlay border border-border-secondary rounded-lg px-2.5 py-1.5 ui-text-micro ui-color-secondary w-44 shadow-lg leading-tight">
                      <p>
                        {t({
                          id: "settings.general.cleanup.help",
                          message:
                            "Cleans up transcripts after transcription while keeping the original meaning intact.",
                        })}
                      </p>
                      {transcriptionMode === "local" && !aiFeaturesReady && (
                        <p className="text-warning mt-1">
                          {t({
                            id: "settings.general.cleanup.help_requirement",
                            message:
                              "Requires an enabled and configured language model in the Models tab.",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          <div className="flex items-center gap-2 ui-text-label ui-color-error">
            <span className="flex-1">{error}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(error || "");
                setErrorCopied(true);
                setTimeout(() => setErrorCopied(false), 1500);
              }}
              className="text-error/60 hover:text-error transition-colors"
            >
              {errorCopied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
const MICROPHONE_TEST_UPDATE_INTERVAL_MS = 24;

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
        <p className="ui-text-meta ui-color-error truncate">
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
      Array.from(
        { length: MICROPHONE_TEST_DOT_COLS },
        (_, col) => {
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
        },
      ),
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

const useMicrophoneTest = (
  inputDevices: DeviceInfo[],
  microphoneDevice: string | null,
) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [levels, setLevels] = useState<MicrophoneTestLevels>(
    EMPTY_MICROPHONE_TEST_LEVELS,
  );
  const [error, setError] = useState<string | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string | null>(
    null,
  );
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const smoothedLevelsRef = useRef<MicrophoneTestLevels>(
    EMPTY_MICROPHONE_TEST_LEVELS,
  );
  const runIdRef = useRef(0);

  const releaseResources = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    void audioContextRef.current?.close();
    audioContextRef.current = null;
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
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setStatus("error");
      setError(
        t({
          id: "settings.general.microphone_test.unsupported",
          message: "Microphone testing isn't available in this window.",
        }),
      );
      return;
    }

    runIdRef.current += 1;
    const runId = runIdRef.current;
    releaseResources();
    setStatus("starting");
    clearMeterState();
    setError(null);

    let stream: MediaStream | null = null;

    try {
      const selectedDeviceName = getSelectedMicrophoneName(
        inputDevices,
        microphoneDevice,
      );

      stream = await mediaDevices.getUserMedia({ audio: true });

      if (runIdRef.current !== runId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const matchedDeviceId = await findBrowserMicrophoneDeviceId(
        mediaDevices,
        selectedDeviceName,
      );

      if (matchedDeviceId) {
        let selectedStream: MediaStream | null = null;
        try {
          selectedStream = await mediaDevices.getUserMedia({
            audio: { deviceId: { exact: matchedDeviceId } },
          });

          if (runIdRef.current !== runId) {
            selectedStream.getTracks().forEach((track) => track.stop());
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          stream.getTracks().forEach((track) => track.stop());
          stream = selectedStream;
          selectedStream = null;
        } catch (err) {
          selectedStream?.getTracks().forEach((track) => track.stop());
          stream?.getTracks().forEach((track) => track.stop());
          stream = null;
          throw err;
        }
      }

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error("AudioContext is not available");
      }

      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const leftAnalyser = audioContext.createAnalyser();
      const rightAnalyser = audioContext.createAnalyser();
      const splitter = audioContext.createChannelSplitter(2);
      const channelCount =
        stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
      leftAnalyser.fftSize = 128;
      rightAnalyser.fftSize = 128;
      leftAnalyser.smoothingTimeConstant = 0.12;
      rightAnalyser.smoothingTimeConstant = 0.12;
      source.connect(splitter);
      splitter.connect(leftAnalyser, 0);
      splitter.connect(rightAnalyser, channelCount > 1 ? 1 : 0);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      const displayLabel =
        stream.getAudioTracks()[0]?.label || selectedDeviceName;
      setActiveDeviceLabel(displayLabel);
      setStatus("listening");

      const leftData = new Uint8Array(leftAnalyser.fftSize);
      const rightData = new Uint8Array(rightAnalyser.fftSize);
      let lastUpdate = 0;

      const updateLevel = (now: number) => {
        leftAnalyser.getByteTimeDomainData(leftData);
        rightAnalyser.getByteTimeDomainData(rightData);

        if (now - lastUpdate > MICROPHONE_TEST_UPDATE_INTERVAL_MS) {
          smoothedLevelsRef.current = smoothMicrophoneLevels(
            smoothedLevelsRef.current,
            {
              left: calculateMicrophoneLevel(leftData),
              right: calculateMicrophoneLevel(rightData),
            },
          );
          setLevels(smoothedLevelsRef.current);
          lastUpdate = now;
        }

        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      if (runIdRef.current !== runId) return;
      releaseResources();
      clearMeterState();
      setStatus("error");
      setError(t(formatMicrophoneTestError(err)));
    }
  }, [
    clearMeterState,
    inputDevices,
    microphoneDevice,
    releaseResources,
    t,
  ]);

  useEffect(() => releaseResources, [releaseResources]);

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

const calculateMicrophoneLevel = (data: Uint8Array) => {
  let sum = 0;
  for (const sample of data) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }

  const noiseFloor = 0.012;
  const speechCeiling = 0.18;
  const rms = Math.sqrt(sum / data.length);
  const normalized =
    Math.max(0, rms - noiseFloor) / (speechCeiling - noiseFloor);

  return Math.min(1, Math.pow(normalized, 0.72));
};

const findBrowserMicrophoneDeviceId = async (
  mediaDevices: MediaDevices,
  selectedDeviceName: string | null,
) => {
  if (!selectedDeviceName || !mediaDevices.enumerateDevices) return null;

  const browserDevices = await mediaDevices.enumerateDevices();
  const selectedName = normalizeMicrophoneLabel(selectedDeviceName);
  if (!selectedName) return null;

  const match = browserDevices.find((device) => {
    if (device.kind !== "audioinput" || !device.deviceId || !device.label) {
      return false;
    }

    const browserLabel = normalizeMicrophoneLabel(device.label);
    return (
      browserLabel.includes(selectedName) ||
      selectedName.includes(browserLabel)
    );
  });

  return match?.deviceId ?? null;
};

const normalizeMicrophoneLabel = (label: string) =>
  label
    .toLowerCase()
    .replace(/^default\s*[-:]\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const formatMicrophoneTestError = (err: unknown) => {
  if (err instanceof DOMException) {
    if (
      err.name === "NotAllowedError" ||
      err.name === "PermissionDeniedError"
    ) {
      return msg({
        id: "settings.general.microphone_test.permission_error",
        message: "Microphone access was denied.",
      });
    }

    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return msg({
        id: "settings.general.microphone_test.not_found_error",
        message: "No microphone was found.",
      });
    }

    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return msg({
        id: "settings.general.microphone_test.busy_error",
        message: "That microphone is already in use.",
      });
    }
  }

  return msg({
    id: "settings.general.microphone_test.start_error",
    message: "Couldn't start microphone test.",
  });
};

type ShortcutRowProps = {
  label: string;
  description: string;
  shortcut: string;
  enabled: boolean;
  isCapturing: boolean;
  capturePreview: string;
  onToggle: () => void;
  onCapture: () => void;
  canDisable: boolean;
};

const ShortcutRow = ({
  label,
  description,
  shortcut,
  enabled,
  isCapturing,
  capturePreview,
  onToggle,
  onCapture,
  canDisable,
}: ShortcutRowProps) => {
  const { t } = useLingui();
  const displayShortcut = formatShortcutForDisplay(shortcut);

  return (
    <div
      className={`space-y-1.5 px-2 py-1.5 transition-opacity ${
        enabled ? "opacity-100" : "opacity-80"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="ui-text-label-strong ui-color-primary">{label}</span>
          <span className="truncate ui-text-meta ui-color-disabled">
            {description}
          </span>
        </div>
        <ToggleSwitch
          enabled={enabled}
          onToggle={onToggle}
          ariaLabel={t({
            id: "settings.general.shortcut.toggle_aria",
            message: `Toggle ${label} shortcut`,
          })}
          disabled={enabled && !canDisable}
        />
      </div>
      <motion.button
        onClick={onCapture}
        disabled={!enabled}
        aria-label={t({
          id: "settings.general.shortcut.record_aria",
          message: `Record new shortcut for ${label}, currently ${displayShortcut}`,
        })}
        className={`w-full border-b pb-1 pt-1 text-left ui-text-kbd transition-colors flex items-center ${
          isCapturing
            ? "ui-color-primary border-border-hover"
            : enabled
              ? "ui-color-secondary border-border-primary hover:border-border-secondary hover:text-content-primary"
              : "ui-color-disabled border-border-primary cursor-not-allowed"
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5 h-5">
          {isCapturing ? (
            <>
              <motion.span
                className="w-1 h-1 rounded-full bg-cloud"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              <span
                className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
              >
                {capturePreview ||
                  t({
                    id: "settings.general.shortcut.capture_placeholder",
                    message: "...",
                  })}
              </span>
            </>
          ) : (
            <span className="block truncate">{displayShortcut}</span>
          )}
        </div>
      </motion.button>
    </div>
  );
};

export default GeneralTab;
