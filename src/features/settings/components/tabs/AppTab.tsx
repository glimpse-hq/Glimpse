import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  ArrowElbowDownRight as CornerDownRight,
  CircleNotch as Loader2,
} from "@phosphor-icons/react";
import FieldLabel from "../../../../shared/ui/FieldLabel";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import SettingCard from "../../../../shared/ui/SettingCard";
import SettingRow, { ToggleRow } from "../../../../shared/ui/SettingRow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildAppLocaleOptions } from "../../../../shared/lib/appLocales";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import HoldButton from "../../../../shared/ui/HoldButton";
import { useFocusTrap } from "../../../../shared/hooks/useFocusTrap";
import type { PlatformCapabilities } from "../../../../shared/lib/platform";
import type {
  AppLocaleSetting,
  AutoDeleteTarget,
  MediaAction,
  RecordingPrunePolicy,
  TextSizeMode,
  ThemeMode,
} from "../../../../types";
import { GITHUB_URL } from "../../../../shared/lib/links";
import { startDragStep } from "../../dragStep";

type RecordingPrunePreview = {
  candidate_count: number;
};

type PruneTarget = AutoDeleteTarget;

type PendingPruneConfirmation = {
  target: PruneTarget;
  duration: RecordingPrunePolicy;
  candidateCount: number | null;
};

const recordingPrunePolicyFor = (
  target: PruneTarget,
  duration: RecordingPrunePolicy,
) => (target === "audio" ? duration : "never");

const transcriptionPrunePolicyFor = (
  target: PruneTarget,
  duration: RecordingPrunePolicy,
) => (target === "transcripts" ? duration : "never");

const recordingPrunePolicySeverity: Record<RecordingPrunePolicy, number> = {
  never: 0,
  year: 1,
  month: 3,
  week: 4,
  day: 5,
  immediately: 6,
};

const inlineAutoDeleteDropdownProps = {
  className: "w-fit",
  buttonClassName:
    "!h-[22px] !w-auto !rounded-md !border-transparent !bg-transparent !px-0.5 !py-0 ui-text-label-strong focus:!border-transparent",
  optionClassName: "!px-2 !py-1.5",
  optionLabelClassName: "ui-text-meta font-medium whitespace-nowrap",
  menuClassName: "w-max min-w-full !left-auto",
  truncate: false as const,
};

const PermissionStatus = ({
  granted,
  onRequest,
}: {
  granted: boolean | null;
  onRequest: () => void;
}) => {
  const { t } = useLingui();

  if (granted === null) {
    return (
      <Loader2
        size={10}
        className="animate-spin text-content-muted"
        aria-label={t({
          id: "settings.app.permission.checking",
          message: "Checking permission",
        })}
      />
    );
  }
  if (granted) {
    return (
      <span className="ui-text-meta ui-color-success flex items-center gap-1">
        <Check size={10} aria-hidden="true" />
        <span className="sr-only">
          {t({
            id: "settings.app.permission.enabled",
            message: "Enabled",
          })}
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRequest}
      className="ui-text-meta ui-color-muted transition-colors hover:text-content-secondary"
    >
      {t({
        id: "settings.app.open_settings",
        message: "Open Settings",
      })}
    </button>
  );
};

type AppTabProps = {
  active: boolean;
  micPermission: boolean | null;
  accessibilityPermission: boolean | null;
  inputMonitoringPermission: boolean | null;
  onRequestMicrophonePermission: () => Promise<void>;
  onRequestAccessibilityPermission: () => Promise<void>;
  onRequestInputMonitoringPermission: () => Promise<void>;
  textSizeMode: TextSizeMode;
  onTextSizeModeChange: (mode: TextSizeMode) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  appLocale: AppLocaleSetting;
  onAppLocaleChange: (locale: AppLocaleSetting) => void;
  mediaAction: MediaAction;
  onMediaActionChange: (action: MediaAction) => void;
  autoUpdateEnabled: boolean;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  storeBuild: boolean;
  autoLaunchEnabled: boolean;
  onAutoLaunchEnabledChange: (enabled: boolean) => void;
  startInBackground: boolean;
  onStartInBackgroundChange: (enabled: boolean) => void;
  autoDeleteTarget: AutoDeleteTarget;
  onAutoDeleteTargetChange: (target: AutoDeleteTarget) => void;
  autoDeleteDuration: RecordingPrunePolicy;
  onAutoDeleteDurationChange: (duration: RecordingPrunePolicy) => void;
  analyticsEnabled: boolean;
  onAnalyticsEnabledChange: (enabled: boolean) => void;
  platformCapabilities: PlatformCapabilities;
};

const AppTab = ({
  active,
  micPermission,
  accessibilityPermission,
  inputMonitoringPermission,
  onRequestMicrophonePermission,
  onRequestAccessibilityPermission,
  onRequestInputMonitoringPermission,
  textSizeMode,
  onTextSizeModeChange,
  themeMode,
  onThemeModeChange,
  appLocale,
  onAppLocaleChange,
  mediaAction,
  onMediaActionChange,
  autoUpdateEnabled,
  onAutoUpdateEnabledChange,
  storeBuild,
  autoLaunchEnabled,
  onAutoLaunchEnabledChange,
  startInBackground,
  onStartInBackgroundChange,
  autoDeleteTarget,
  onAutoDeleteTargetChange,
  autoDeleteDuration,
  onAutoDeleteDurationChange,
  analyticsEnabled,
  onAnalyticsEnabledChange,
  platformCapabilities,
}: AppTabProps) => {
  const { t } = useLingui();
  const [isPreviewingPrune, setIsPreviewingPrune] = useState(false);
  const [pendingPruneConfirmation, setPendingPruneConfirmation] =
    useState<PendingPruneConfirmation | null>(null);

  const duckStops: Array<{ label: string; value: MediaAction }> = [
    {
      label: t({ id: "settings.app.auto_pause_media.off", message: "Off" }),
      value: "off",
    },
    { label: "10%", value: "duck10" },
    { label: "25%", value: "duck25" },
    { label: "50%", value: "duck50" },
    { label: "75%", value: "duck75" },
    {
      label: t({ id: "settings.app.auto_pause_media.pause", message: "Pause" }),
      value: "pause",
    },
  ];
  const duckIndex = Math.max(
    0,
    duckStops.findIndex((stop) => stop.value === mediaAction),
  );
  const handleDuckChange = (index: number) => {
    onMediaActionChange(duckStops[index].value);
  };
  const handleDuckScrubStart = (
    event:
      React.MouseEvent<HTMLSpanElement> | React.TouchEvent<HTMLSpanElement>,
  ) => startDragStep(event, duckIndex, duckStops.length, handleDuckChange);
  const duckDescription =
    mediaAction === "off"
      ? t({
          id: "settings.app.auto_pause_media.body_off",
          message: "System audio plays while recording.",
        })
      : mediaAction === "pause"
        ? t({
            id: "settings.app.auto_pause_media.body_pause",
            message: "Pauses system audio while recording.",
          })
        : t({
            id: "settings.app.auto_pause_media.body_duck",
            message: "Lowers system volume while recording.",
          });

  const textSizeOptions: Array<{ value: TextSizeMode; label: string }> = [
    {
      value: "small",
      label: t({ id: "settings.app.text_size.small", message: "Small" }),
    },
    {
      value: "default",
      label: t({ id: "settings.app.text_size.default", message: "Default" }),
    },
    {
      value: "large",
      label: t({ id: "settings.app.text_size.large", message: "Large" }),
    },
  ];

  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    {
      value: "system",
      label: t({ id: "settings.app.theme.system", message: "System" }),
    },
    {
      value: "light",
      label: t({ id: "settings.app.theme.light", message: "Light" }),
    },
    {
      value: "dark",
      label: t({ id: "settings.app.theme.dark", message: "Dark" }),
    },
  ];

  const deleteAfterOptions: Array<{
    value: RecordingPrunePolicy;
    label: string;
  }> = [
    {
      value: "never",
      label: t({ id: "settings.app.prune.never", message: "Never" }),
    },
    {
      value: "immediately",
      label: t({
        id: "settings.app.auto_delete.after_transcribing",
        message: "After transcribing",
      }),
    },
    {
      value: "day",
      label: t({
        id: "settings.app.auto_delete.after_day",
        message: "After a day",
      }),
    },
    {
      value: "week",
      label: t({
        id: "settings.app.auto_delete.after_week",
        message: "After a week",
      }),
    },
    {
      value: "month",
      label: t({
        id: "settings.app.auto_delete.after_month",
        message: "After a month",
      }),
    },
    {
      value: "year",
      label: t({
        id: "settings.app.auto_delete.after_year",
        message: "After a year",
      }),
    },
  ];

  const appLanguageOptions = buildAppLocaleOptions(
    t({
      id: "settings.app.language.system",
      message: "System",
    }),
  );

  const isMoreAggressivePolicy = (
    nextPolicy: RecordingPrunePolicy,
    currentPolicy: RecordingPrunePolicy,
  ) =>
    recordingPrunePolicySeverity[nextPolicy] >
    recordingPrunePolicySeverity[currentPolicy];

  const describeRecordingPruneThreshold = (policy: RecordingPrunePolicy) => {
    switch (policy) {
      case "day":
        return t({
          id: "settings.app.prune.threshold.day",
          message: "a day",
        });
      case "week":
        return t({
          id: "settings.app.prune.threshold.week",
          message: "a week",
        });
      case "month":
        return t({
          id: "settings.app.prune.threshold.month",
          message: "a month",
        });
      case "year":
        return t({
          id: "settings.app.prune.threshold.year",
          message: "a year",
        });
      case "never":
      default:
        return null;
    }
  };

  const buildPruneConfirmation = ({
    target,
    duration,
    candidateCount,
  }: PendingPruneConfirmation) => {
    const threshold = describeRecordingPruneThreshold(duration);
    const title =
      candidateCount === null
        ? t({
            id: "settings.app.auto_delete.confirm.title",
            message: "Delete older items now?",
          })
        : target === "audio"
          ? t({
              id: "settings.app.auto_delete.confirm.title_audio",
              message: plural(candidateCount, {
                one: "Delete # audio file?",
                other: "Delete # audio files?",
              }),
            })
          : t({
              id: "settings.app.auto_delete.confirm.title_dictations",
              message: plural(candidateCount, {
                one: "Delete # dictation?",
                other: "Delete # dictations?",
              }),
            });
    const body =
      target === "audio"
        ? threshold
          ? t({
              id: "settings.app.auto_delete.confirm.body_audio_older",
              message: `This deletes audio from dictations older than ${{ threshold }}. Transcripts and Library stay.`,
            })
          : t({
              id: "settings.app.auto_delete.confirm.body_audio_all",
              message:
                "This deletes the audio of every saved dictation. Transcripts and Library stay.",
            })
        : threshold
          ? t({
              id: "settings.app.auto_delete.confirm.body_dictations_older",
              message: `This deletes dictations older than ${{ threshold }} and their audio. Library stays.`,
            })
          : t({
              id: "settings.app.auto_delete.confirm.body_dictations_all",
              message:
                "This deletes every saved dictation and its audio. Library stays.",
            });
    return { title, body };
  };

  const applyAutoDeleteChange = async (
    nextTarget: PruneTarget,
    nextDuration: RecordingPrunePolicy,
  ) => {
    if (isPreviewingPrune) return;
    if (
      nextTarget === autoDeleteTarget &&
      nextDuration === autoDeleteDuration
    ) {
      return;
    }

    const nextRecordingPolicy = recordingPrunePolicyFor(
      nextTarget,
      nextDuration,
    );
    const nextTranscriptionPolicy = transcriptionPrunePolicyFor(
      nextTarget,
      nextDuration,
    );
    const currentRecordingPolicy = recordingPrunePolicyFor(
      autoDeleteTarget,
      autoDeleteDuration,
    );
    const currentTranscriptionPolicy = transcriptionPrunePolicyFor(
      autoDeleteTarget,
      autoDeleteDuration,
    );

    const recordingMoreAggressive = isMoreAggressivePolicy(
      nextRecordingPolicy,
      currentRecordingPolicy,
    );
    const transcriptionMoreAggressive = isMoreAggressivePolicy(
      nextTranscriptionPolicy,
      currentTranscriptionPolicy,
    );

    const commitChange = () => {
      onAutoDeleteTargetChange(nextTarget);
      onAutoDeleteDurationChange(nextDuration);
    };

    if (!recordingMoreAggressive && !transcriptionMoreAggressive) {
      commitChange();
      return;
    }

    setIsPreviewingPrune(true);
    try {
      let total = 0;
      let unknown = false;
      if (recordingMoreAggressive) {
        try {
          const preview = await invoke<RecordingPrunePreview>(
            "preview_recording_prune",
            { policy: nextRecordingPolicy },
          );
          total += preview.candidate_count;
        } catch (error) {
          console.error("Failed to preview recording prune impact", error);
          unknown = true;
        }
      }
      if (transcriptionMoreAggressive) {
        try {
          const preview = await invoke<RecordingPrunePreview>(
            "preview_transcription_prune",
            { policy: nextTranscriptionPolicy },
          );
          total += preview.candidate_count;
        } catch (error) {
          console.error("Failed to preview transcription prune impact", error);
          unknown = true;
        }
      }

      if (!unknown && total <= 0) {
        commitChange();
        return;
      }

      setPendingPruneConfirmation({
        target: nextTarget,
        duration: nextDuration,
        candidateCount: unknown ? null : total,
      });
    } finally {
      setIsPreviewingPrune(false);
    }
  };

  const handleConfirmPruneChange = () => {
    if (!pendingPruneConfirmation) {
      return;
    }
    onAutoDeleteTargetChange(pendingPruneConfirmation.target);
    onAutoDeleteDurationChange(pendingPruneConfirmation.duration);
    setPendingPruneConfirmation(null);
  };

  const handleClosePruneConfirmation = () => {
    setPendingPruneConfirmation(null);
  };

  const pruneDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    pruneDialogRef,
    active && pendingPruneConfirmation !== null,
    handleClosePruneConfirmation,
  );

  useEffect(() => {
    if (active) return;
    setPendingPruneConfirmation(null);
  }, [active]);

  const holdToDeleteLabel = t({
    id: "settings.about.data.hold_to_delete",
    message: "Hold to delete",
  });
  const pruneConfirmation = pendingPruneConfirmation
    ? buildPruneConfirmation(pendingPruneConfirmation)
    : null;

  const permissionRowCount = [
    platformCapabilities.showsMicrophonePermission,
    platformCapabilities.requiresAccessibilityPermission,
    platformCapabilities.requiresInputMonitoringPermission,
  ].filter(Boolean).length;

  return (
    <>
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <FieldLabel>
              {t({
                id: "settings.app.text_size.label.v2",
                message: "Text size",
              })}
            </FieldLabel>
            <Dropdown
              value={textSizeMode}
              ariaLabel={t({
                id: "settings.app.text_size.label.v2",
                message: "Text size",
              })}
              onChange={onTextSizeModeChange}
              options={textSizeOptions}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>
              {t({
                id: "settings.app.theme.label",
                message: "Theme",
              })}
            </FieldLabel>
            <Dropdown
              value={themeMode}
              ariaLabel={t({
                id: "settings.app.theme.label",
                message: "Theme",
              })}
              onChange={onThemeModeChange}
              options={themeOptions}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>
              {t({
                id: "settings.app.language.label",
                message: "Language",
              })}
            </FieldLabel>
            <Dropdown
              value={appLocale}
              ariaLabel={t({
                id: "settings.app.language.label",
                message: "Language",
              })}
              onChange={(value) => onAppLocaleChange(value)}
              options={appLanguageOptions}
              searchable
              searchPlaceholder={t({
                id: "settings.app.language.search",
                message: "Search language...",
              })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 items-stretch">
          <div className="space-y-2 flex flex-col">
            <SectionLabel className="shrink-0">
              {t({
                id: "settings.app.privacy_permissions",
                message: "Privacy & Permissions",
              })}
            </SectionLabel>

            {permissionRowCount > 0 && (
              <SettingCard equalizeRows className="flex-1 gap-3">
                {platformCapabilities.showsMicrophonePermission && (
                  <SettingRow
                    title={t({
                      id: "settings.app.microphone",
                      message: "Microphone",
                    })}
                    description={t({
                      id: "settings.app.microphone.description",
                      message: "required for transcription",
                    })}
                    control={
                      <PermissionStatus
                        granted={micPermission}
                        onRequest={() => void onRequestMicrophonePermission()}
                      />
                    }
                  />
                )}

                {platformCapabilities.requiresAccessibilityPermission && (
                  <SettingRow
                    title={t({
                      id: "settings.app.accessibility",
                      message: "Accessibility",
                    })}
                    description={t({
                      id: "settings.app.accessibility.description",
                      message: "required for auto-paste",
                    })}
                    control={
                      <PermissionStatus
                        granted={accessibilityPermission}
                        onRequest={() =>
                          void onRequestAccessibilityPermission()
                        }
                      />
                    }
                  />
                )}

                {platformCapabilities.requiresInputMonitoringPermission && (
                  <SettingRow
                    title={t({
                      id: "settings.app.input_monitoring",
                      message: "Input Monitoring",
                    })}
                    description={t({
                      id: "settings.app.input_monitoring.description",
                      message: "required for global shortcuts",
                    })}
                    control={
                      <PermissionStatus
                        granted={inputMonitoringPermission}
                        onRequest={() =>
                          void onRequestInputMonitoringPermission()
                        }
                      />
                    }
                  />
                )}
              </SettingCard>
            )}

            {permissionRowCount > 0 && (
              <p className="ui-text-micro ui-color-muted px-0.5">
                {t({
                  id: "settings.app.permissions_restart_notice",
                  message: "Permission changes may require a restart.",
                })}
              </p>
            )}

            {/* One card in each column grows, so both columns end level. */}
            <SettingCard className={permissionRowCount > 0 ? "" : "flex-1"}>
              <ToggleRow
                title={t({
                  id: "settings.app.analytics.v2",
                  message: "Usage analytics",
                })}
                enabled={analyticsEnabled}
                onToggle={() => onAnalyticsEnabledChange(!analyticsEnabled)}
                ariaLabel={t({
                  id: "settings.app.analytics.toggle_aria",
                  message: "Toggle usage analytics",
                })}
                description={
                  <>
                    {t({
                      id: "settings.app.analytics.body.v2",
                      message:
                        "Anonymous. Never includes transcripts or audio.",
                    })}{" "}
                    <button
                      onClick={() => openUrl(`${GITHUB_URL}/wiki/Analytics`)}
                      className="ui-color-muted hover:text-content-secondary transition-colors underline"
                    >
                      {t({
                        id: "settings.app.analytics.more_info",
                        message: "More info",
                      })}
                    </button>
                  </>
                }
              />
            </SettingCard>
          </div>

          <div className="space-y-2 flex flex-col">
            <SectionLabel className="shrink-0">
              {t({
                id: "settings.app.automation",
                message: "Automation",
              })}
            </SectionLabel>

            <SettingCard className="flex-1 space-y-6">
              {platformCapabilities.supportsAutoPauseMedia && (
                <SettingRow
                  title={t({
                    id: "settings.app.auto_pause_media.v2",
                    message: "Auto-pause media",
                  })}
                  description={duckDescription}
                  control={
                    <div className="flex items-center gap-0.5 ui-text-micro leading-none">
                      <button
                        type="button"
                        onClick={() =>
                          handleDuckChange(Math.max(0, duckIndex - 1))
                        }
                        disabled={duckIndex === 0}
                        aria-label={t({
                          id: "settings.app.auto_pause_media.lower",
                          message: "Previous media action",
                        })}
                        className={`transition-colors p-0.5 ${
                          duckIndex === 0
                            ? "text-content-disabled"
                            : "text-content-muted hover:text-content-primary"
                        }`}
                      >
                        <ChevronLeft size={10} className="rtl:rotate-180" />
                      </button>
                      <div
                        aria-live="polite"
                        onMouseDown={handleDuckScrubStart}
                        onTouchStart={handleDuckScrubStart}
                        className="inline-grid whitespace-nowrap px-0.5 text-center font-medium tabular-nums cursor-ew-resize select-none"
                      >
                        {duckStops.map((stop) => (
                          <span
                            key={stop.value}
                            aria-hidden="true"
                            className="invisible col-start-1 row-start-1"
                          >
                            {stop.label}
                          </span>
                        ))}
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={duckIndex}
                            initial={{ opacity: 0, y: -2, scale: 0.92 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 2, scale: 0.92 }}
                            transition={{ duration: 0.16, ease: "easeOut" }}
                            className={`col-start-1 row-start-1 ${
                              mediaAction === "off"
                                ? "ui-color-disabled"
                                : "ui-color-cloud"
                            }`}
                          >
                            {duckStops[duckIndex].label}
                          </motion.span>
                        </AnimatePresence>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleDuckChange(
                            Math.min(duckStops.length - 1, duckIndex + 1),
                          )
                        }
                        disabled={duckIndex === duckStops.length - 1}
                        aria-label={t({
                          id: "settings.app.auto_pause_media.raise",
                          message: "Next media action",
                        })}
                        className={`transition-colors p-0.5 ${
                          duckIndex === duckStops.length - 1
                            ? "text-content-disabled"
                            : "text-content-muted hover:text-content-primary"
                        }`}
                      >
                        <ChevronRight size={10} className="rtl:rotate-180" />
                      </button>
                    </div>
                  }
                />
              )}

              {!storeBuild && (
                <ToggleRow
                  title={t({
                    id: "settings.app.auto_update",
                    message: "Auto-update",
                  })}
                  enabled={autoUpdateEnabled}
                  onToggle={() => onAutoUpdateEnabledChange(!autoUpdateEnabled)}
                  ariaLabel={t({
                    id: "settings.app.auto_update.toggle_aria",
                    message: "Toggle auto-update",
                  })}
                  description={t({
                    id: "settings.app.auto_update.body.v2",
                    message:
                      "Downloads and installs updates in the background.",
                  })}
                />
              )}

              <ToggleRow
                title={t({
                  id: "settings.app.auto_launch.v2",
                  message: "Launch at login",
                })}
                enabled={autoLaunchEnabled}
                onToggle={() => onAutoLaunchEnabledChange(!autoLaunchEnabled)}
                ariaLabel={t({
                  id: "settings.app.auto_launch.toggle_aria",
                  message: "Toggle launch at login",
                })}
              >
                <div className="flex items-center justify-between gap-2 ps-3 mt-1.5">
                  <div className="flex min-w-0 items-center gap-1.5 ui-text-meta text-content-secondary">
                    <CornerDownRight
                      size={10}
                      className="shrink-0 text-content-disabled"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      {t({
                        id: "settings.app.start_in_background",
                        message: "Start in background",
                      })}
                    </span>
                  </div>
                  <ToggleSwitch
                    enabled={autoLaunchEnabled && startInBackground}
                    disabled={!autoLaunchEnabled}
                    onToggle={() =>
                      onStartInBackgroundChange(!startInBackground)
                    }
                    ariaLabel={t({
                      id: "settings.app.start_in_background.toggle_aria",
                      message: "Toggle start in background",
                    })}
                    size="xs"
                  />
                </div>
              </ToggleRow>
              <SettingRow
                title={t({
                  id: "settings.app.auto_delete_dictation_audio",
                  message: "Auto-delete dictation audio",
                })}
                control={
                  <Dropdown
                    value={autoDeleteDuration}
                    ariaLabel={t({
                      id: "settings.app.auto_delete.after_aria",
                      message: "Delete after",
                    })}
                    onChange={(value) => {
                      void applyAutoDeleteChange(autoDeleteTarget, value);
                    }}
                    options={deleteAfterOptions}
                    disabled={isPreviewingPrune}
                    {...inlineAutoDeleteDropdownProps}
                  />
                }
              >
                <div className="flex items-center justify-between gap-2 ps-3 mt-1.5">
                  <div className="flex min-w-0 items-center gap-1.5 ui-text-meta text-content-secondary">
                    <CornerDownRight
                      size={10}
                      className="shrink-0 text-content-disabled"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      {t({
                        id: "settings.app.auto_delete.include_transcripts",
                        message: "Also delete transcripts",
                      })}
                    </span>
                  </div>
                  <ToggleSwitch
                    enabled={
                      autoDeleteDuration !== "never" &&
                      autoDeleteTarget === "transcripts"
                    }
                    disabled={
                      autoDeleteDuration === "never" || isPreviewingPrune
                    }
                    onToggle={() => {
                      void applyAutoDeleteChange(
                        autoDeleteTarget === "transcripts"
                          ? "audio"
                          : "transcripts",
                        autoDeleteDuration,
                      );
                    }}
                    ariaLabel={t({
                      id: "settings.app.auto_delete.include_transcripts",
                      message: "Also delete transcripts",
                    })}
                    size="xs"
                  />
                </div>
              </SettingRow>
            </SettingCard>
          </div>
        </div>
      </div>

      {active &&
        createPortal(
          <AnimatePresence>
            {pendingPruneConfirmation && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="settings-typescale font-sans fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
                onClick={handleClosePruneConfirmation}
              >
                <motion.div
                  ref={pruneDialogRef}
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
                  onClick={(event) => event.stopPropagation()}
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="auto-delete-confirm-title"
                  aria-describedby="auto-delete-confirm-body"
                >
                  <p
                    id="auto-delete-confirm-title"
                    className="ui-text-body-lg font-semibold text-content-primary"
                  >
                    {pruneConfirmation?.title}
                  </p>
                  <p
                    id="auto-delete-confirm-body"
                    className="mt-1 ui-text-body-sm text-content-secondary text-pretty"
                  >
                    {pruneConfirmation?.body}
                  </p>
                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleClosePruneConfirmation}
                      className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary"
                    >
                      {t({
                        id: "settings.app.cancel",
                        message: "Cancel",
                      })}
                    </button>
                    <HoldButton
                      onConfirm={handleConfirmPruneChange}
                      label={holdToDeleteLabel}
                      ariaLabel={holdToDeleteLabel}
                      holdMs={1500}
                      className="rounded-lg bg-red-500/90 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-solid transition-colors hover:bg-red-500"
                      fillClassName="bg-black/20"
                    />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};

export default AppTab;
