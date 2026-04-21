import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkInputMonitoringPermission,
  requestAccessibilityPermission,
  requestInputMonitoringPermission,
} from "tauri-plugin-macos-permissions-api";
import { buildAppLocaleOptions } from "../../../../shared/lib/appLocales";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import type {
  AppLocaleSetting,
  RecordingPrunePolicy,
  TextSizeMode,
  ThemeMode,
} from "../../../../types";

type RecordingPrunePreview = {
  candidate_count: number;
};

type PendingPruneConfirmation = {
  policy: RecordingPrunePolicy;
  candidateCount: number | null;
};

const recordingPrunePolicySeverity: Record<RecordingPrunePolicy, number> = {
  never: 0,
  year: 1,
  three_months: 2,
  month: 3,
  week: 4,
  day: 5,
  immediately: 6,
};

const PermissionStatus = ({ granted }: { granted: boolean | null }) => {
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
    <span className="ui-text-meta ui-color-warning">
      {t({
        id: "settings.app.permission.off",
        message: "off",
      })}
    </span>
  );
};

type AppTabProps = {
  variants: Variants;
  micPermission: boolean | null;
  accessibilityPermission: boolean | null;
  inputMonitoringPermission: boolean | null;
  onRequestMicrophonePermission: () => Promise<void>;
  textSizeMode: TextSizeMode;
  onTextSizeModeChange: (mode: TextSizeMode) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  appLocale: AppLocaleSetting;
  onAppLocaleChange: (locale: AppLocaleSetting) => void;
  mediaControlEnabled: boolean;
  onMediaControlEnabledChange: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  autoLaunchEnabled: boolean;
  onAutoLaunchEnabledChange: (enabled: boolean) => void;
  recordingPrunePolicy: RecordingPrunePolicy;
  onRecordingPrunePolicyChange: (policy: RecordingPrunePolicy) => void;
  analyticsEnabled: boolean;
  onAnalyticsEnabledChange: (enabled: boolean) => void;
};

const AppTab = ({
  variants,
  micPermission,
  accessibilityPermission,
  inputMonitoringPermission,
  onRequestMicrophonePermission,
  textSizeMode,
  onTextSizeModeChange,
  themeMode,
  onThemeModeChange,
  appLocale,
  onAppLocaleChange,
  mediaControlEnabled,
  onMediaControlEnabledChange,
  autoUpdateEnabled,
  onAutoUpdateEnabledChange,
  autoLaunchEnabled,
  onAutoLaunchEnabledChange,
  recordingPrunePolicy,
  onRecordingPrunePolicyChange,
  analyticsEnabled,
  onAnalyticsEnabledChange,
}: AppTabProps) => {
  const { t } = useLingui();
  const [draftPolicy, setDraftPolicy] = useState<RecordingPrunePolicy>(
    recordingPrunePolicy,
  );
  const [isPreviewingPrune, setIsPreviewingPrune] = useState(false);
  const [pendingPruneConfirmation, setPendingPruneConfirmation] =
    useState<PendingPruneConfirmation | null>(null);

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

  const recordingPruneOptions: Array<{
    value: RecordingPrunePolicy;
    label: string;
  }> = [
    { value: "never", label: t({ id: "settings.app.prune.never", message: "Never" }) },
    { value: "immediately", label: t({ id: "settings.app.prune.instantly", message: "Instantly" }) },
    { value: "day", label: t({ id: "settings.app.prune.day", message: "1 Day" }) },
    { value: "week", label: t({ id: "settings.app.prune.week", message: "1 Week" }) },
    { value: "month", label: t({ id: "settings.app.prune.month", message: "1 Month" }) },
    { value: "three_months", label: t({ id: "settings.app.prune.three_months", message: "3 Months" }) },
    { value: "year", label: t({ id: "settings.app.prune.year", message: "1 Year" }) },
  ];

  const appLanguageOptions = buildAppLocaleOptions(
    t({
      id: "settings.app.language.system",
      message: "System",
    }),
  );

  useEffect(() => {
    setDraftPolicy(recordingPrunePolicy);
  }, [recordingPrunePolicy]);

  const isDirty = draftPolicy !== recordingPrunePolicy;

  const isMoreAggressivePolicy = (
    nextPolicy: RecordingPrunePolicy,
    currentPolicy: RecordingPrunePolicy,
  ) =>
    recordingPrunePolicySeverity[nextPolicy] >
    recordingPrunePolicySeverity[currentPolicy];

  const getRecordingPrunePolicyLabel = (policy: RecordingPrunePolicy) =>
    recordingPruneOptions.find((option) => option.value === policy)?.label ??
    policy;

  const describeRecordingPruneThreshold = (policy: RecordingPrunePolicy) => {
    switch (policy) {
      case "immediately":
        return t({
          id: "settings.app.prune.threshold.immediately",
          message: "right now",
        });
      case "day":
        return t({
          id: "settings.app.prune.threshold.day",
          message: "1 day",
        });
      case "week":
        return t({
          id: "settings.app.prune.threshold.week",
          message: "1 week",
        });
      case "month":
        return t({
          id: "settings.app.prune.threshold.month",
          message: "1 month",
        });
      case "three_months":
        return t({
          id: "settings.app.prune.threshold.three_months",
          message: "3 months",
        });
      case "year":
        return t({
          id: "settings.app.prune.threshold.year",
          message: "1 year",
        });
      case "never":
      default:
        return null;
    }
  };

  const buildPruneConfirmationMessage = (
    policy: RecordingPrunePolicy,
    candidateCount: number | null,
  ) => {
    const policyLabel = getRecordingPrunePolicyLabel(policy);
    if (policy === "immediately") {
      if (candidateCount === null) {
        return t({
          id: "settings.app.auto_delete_recordings.confirm.immediately.unknown_count",
          message: `Changing auto-delete to ${{ policyLabel }} may immediately delete your existing local recordings.`,
        });
      }
      return t({
        id: "settings.app.auto_delete_recordings.confirm.immediately.known_count",
        message: `Changing auto-delete to ${{ policyLabel }} will immediately delete ${plural(candidateCount, {
          one: "# existing local recording",
          other: "# existing local recordings",
        })}.`,
      });
    }

    const threshold = describeRecordingPruneThreshold(policy);
    if (!threshold) {
      return "";
    }

    if (candidateCount === null) {
      return t({
        id: "settings.app.auto_delete_recordings.confirm.threshold.unknown_count",
        message: `Changing auto-delete to ${{ policyLabel }} may immediately delete local recordings that are already older than ${{ threshold }}.`,
      });
    }

    return t({
      id: "settings.app.auto_delete_recordings.confirm.threshold.known_count",
      message: `Changing auto-delete to ${{ policyLabel }} will immediately delete ${plural(candidateCount, {
        one: `# local recording that is already older than ${{ threshold }}`,
        other: `# local recordings that are already older than ${{ threshold }}`,
      })}.`,
    });
  };

  const handleApply = async () => {
    if (!isDirty) {
      return;
    }

    if (!isMoreAggressivePolicy(draftPolicy, recordingPrunePolicy)) {
      onRecordingPrunePolicyChange(draftPolicy);
      return;
    }

    const previewedPolicy = draftPolicy;
    setIsPreviewingPrune(true);
    try {
      const preview = await invoke<RecordingPrunePreview>(
        "preview_recording_prune",
        {
          policy: previewedPolicy,
        },
      );

      if (preview.candidate_count <= 0) {
        onRecordingPrunePolicyChange(previewedPolicy);
        return;
      }

      setPendingPruneConfirmation({
        policy: previewedPolicy,
        candidateCount: preview.candidate_count,
      });
    } catch (error) {
      console.error("Failed to preview recording prune impact", error);
      setPendingPruneConfirmation({
        policy: previewedPolicy,
        candidateCount: null,
      });
    } finally {
      setIsPreviewingPrune(false);
    }
  };

  const handleConfirmPruneChange = () => {
    if (!pendingPruneConfirmation) {
      return;
    }

    onRecordingPrunePolicyChange(pendingPruneConfirmation.policy);
    setPendingPruneConfirmation(null);
  };

  const handleClosePruneConfirmation = () => {
    setPendingPruneConfirmation(null);
  };

  const handleCancel = () => {
    setPendingPruneConfirmation(null);
    setIsPreviewingPrune(false);
    setDraftPolicy(recordingPrunePolicy);
  };

  const pruneConfirmationMessage = pendingPruneConfirmation
    ? buildPruneConfirmationMessage(
        pendingPruneConfirmation.policy,
        pendingPruneConfirmation.candidateCount,
      )
    : "";

  const pruneConfirmationFootnote =
    pendingPruneConfirmation?.candidateCount === null
      ? t({
          id: "settings.app.auto_delete_recordings.confirm.unknown_count",
          message: "We couldn't count them right now, but the cleanup will still run as soon as you save this change.",
        })
      : t({
          id: "settings.app.auto_delete_recordings.confirm.audio_only",
          message: "This only removes saved local audio files, not your transcript history.",
        });

  const confirmButtonLabel = isPreviewingPrune
    ? t({
        id: "settings.app.confirm.checking",
        message: "Checking...",
      })
    : t({
        id: "settings.app.confirm",
        message: "Confirm",
      });

  const confirmButtonAriaLabel = isPreviewingPrune
    ? t({
        id: "settings.app.auto_delete_recordings.preview.loading",
        message: "Checking how many recordings would be deleted",
      })
    : confirmButtonLabel;

  return (
    <>
      <motion.div
        key="app"
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="space-y-6"
      >
        <div className="space-y-2">
          <h2 className="ui-text-section-label-sm ui-color-muted">
            {t({
              id: "settings.app.appearance",
              message: "Appearance",
            })}
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "settings.app.text_size.label",
                  message: "Text Size",
                })}
              </span>
              <Dropdown
                value={textSizeMode}
                onChange={onTextSizeModeChange}
                options={textSizeOptions}
              />
            </div>
            <div className="space-y-1.5">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "settings.app.theme.label",
                  message: "Theme",
                })}
              </span>
              <Dropdown
                value={themeMode}
                onChange={onThemeModeChange}
                options={themeOptions}
              />
            </div>
            <div className="space-y-1.5">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "settings.app.language.label",
                  message: "Language",
                })}
              </span>
              <Dropdown
                value={appLocale}
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
        </div>

        <div className="grid grid-cols-2 gap-3 items-stretch">
          <div className="space-y-2 flex flex-col">
            <h2 className="ui-text-section-label-sm ui-color-muted shrink-0">
              {t({
                id: "settings.app.privacy_permissions",
                message: "Privacy & Permissions",
              })}
            </h2>

            <div className="space-y-3 rounded-lg bg-surface-surface p-2.5 flex-1">
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="ui-text-label-strong ui-color-primary">
                      {t({
                        id: "settings.app.microphone",
                        message: "Microphone",
                      })}
                    </span>
                    <span className="truncate ui-text-meta ui-color-disabled">
                      {t({
                        id: "settings.app.microphone.description",
                        message: "required for transcription",
                      })}
                    </span>
                  </div>
                  <PermissionStatus granted={micPermission} />
                </div>
                <button
                  onClick={() => {
                    void onRequestMicrophonePermission();
                  }}
                  className="mt-1.5 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
                >
                  {t({
                    id: "settings.app.open_settings",
                    message: "Open Settings",
                  })}
                </button>
              </div>

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="ui-text-label-strong ui-color-primary">
                      {t({
                        id: "settings.app.accessibility",
                        message: "Accessibility",
                      })}
                    </span>
                    <span className="truncate ui-text-meta ui-color-disabled">
                      {t({
                        id: "settings.app.accessibility.description",
                        message: "required for auto-paste",
                      })}
                    </span>
                  </div>
                  <PermissionStatus granted={accessibilityPermission} />
                </div>
                <button
                  onClick={async () => {
                    try {
                      const granted = await requestAccessibilityPermission();
                      if (!granted) await invoke("open_accessibility_settings");
                    } catch {
                      await invoke("open_accessibility_settings");
                    }
                  }}
                  className="mt-1.5 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
                >
                  {t({
                    id: "settings.app.open_settings",
                    message: "Open Settings",
                  })}
                </button>
              </div>

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="ui-text-label-strong ui-color-primary">
                      {t({
                        id: "settings.app.input_monitoring",
                        message: "Input Monitoring",
                      })}
                    </span>
                    <span className="truncate ui-text-meta ui-color-disabled">
                      {t({
                        id: "settings.app.input_monitoring.description",
                        message: "required for global shortcuts",
                      })}
                    </span>
                  </div>
                  <PermissionStatus granted={inputMonitoringPermission} />
                </div>
                <button
                  onClick={async () => {
                    try {
                      await requestInputMonitoringPermission();
                      const granted = await checkInputMonitoringPermission();
                      if (!granted) await invoke("open_input_monitoring_settings");
                    } catch {
                      await invoke("open_input_monitoring_settings");
                    }
                  }}
                  className="mt-1.5 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
                >
                  {t({
                    id: "settings.app.open_settings",
                    message: "Open Settings",
                  })}
                </button>
              </div>

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="ui-text-label-strong ui-color-primary">
                    {t({
                      id: "settings.app.analytics",
                      message: "Usage Analytics",
                    })}
                  </span>
                  <ToggleSwitch
                    enabled={analyticsEnabled}
                    onToggle={() => onAnalyticsEnabledChange(!analyticsEnabled)}
                    ariaLabel={t({
                      id: "settings.app.analytics.toggle_aria",
                      message: "Toggle usage analytics",
                    })}
                  />
                </div>
                <span className="ui-text-micro ui-color-disabled block mt-0.5">
                  {t({
                    id: "settings.app.analytics.body",
                    message: "anonymous, no transcripts or audio shared.",
                  })}{" "}
                  <button
                    onClick={() =>
                      openUrl(
                        "https://github.com/LegendarySpy/Glimpse/wiki/Analytics",
                      )
                    }
                    className="ui-color-muted hover:text-content-secondary transition-colors underline"
                  >
                    {t({
                      id: "settings.app.analytics.more_info",
                      message: "More info",
                    })}
                  </button>
                </span>
              </div>
            </div>

            <p className="ui-text-micro ui-color-disabled px-0.5">
              {t({
                id: "settings.app.permissions_restart_notice",
                message: "Permission changes may require a restart.",
              })}
            </p>
          </div>

          <div className="space-y-2 flex flex-col">
            <h2 className="ui-text-section-label-sm ui-color-muted shrink-0">
              {t({
                id: "settings.app.automation",
                message: "Automation",
              })}
            </h2>

            <div className="space-y-3 rounded-lg bg-surface-surface p-2.5 flex-1">
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="ui-text-label-strong ui-color-primary">
                    {t({
                      id: "settings.app.auto_pause_media",
                      message: "Auto-pause Media",
                    })}
                  </span>
                  <ToggleSwitch
                    enabled={mediaControlEnabled}
                    onToggle={() =>
                      onMediaControlEnabledChange(!mediaControlEnabled)
                    }
                    ariaLabel={t({
                      id: "settings.app.auto_pause_media.toggle_aria",
                      message: "Toggle auto-pause media while recording",
                    })}
                  />
                </div>
                <span className="ui-text-micro ui-color-disabled block mt-0.5">
                  {t({
                    id: "settings.app.auto_pause_media.body",
                    message: "pauses music while recording, resumes when done.",
                  })}
                </span>
              </div>

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="ui-text-label-strong ui-color-primary">
                    {t({
                      id: "settings.app.auto_update",
                      message: "Auto-update",
                    })}
                  </span>
                  <ToggleSwitch
                    enabled={autoUpdateEnabled}
                    onToggle={() =>
                      onAutoUpdateEnabledChange(!autoUpdateEnabled)
                    }
                    ariaLabel={t({
                      id: "settings.app.auto_update.toggle_aria",
                      message: "Toggle auto-update",
                    })}
                  />
                </div>
                <span className="ui-text-micro ui-color-disabled block mt-0.5">
                  {t({
                    id: "settings.app.auto_update.body",
                    message: "downloads and installs updates in the background.",
                  })}
                </span>
              </div>

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="ui-text-label-strong ui-color-primary">
                    {t({
                      id: "settings.app.auto_launch",
                      message: "Launch at Login",
                    })}
                  </span>
                  <ToggleSwitch
                    enabled={autoLaunchEnabled}
                    onToggle={() =>
                      onAutoLaunchEnabledChange(!autoLaunchEnabled)
                    }
                    ariaLabel={t({
                      id: "settings.app.auto_launch.toggle_aria",
                      message: "Toggle launch at login",
                    })}
                  />
                </div>
                <span className="ui-text-micro ui-color-disabled block mt-0.5">
                  {t({
                    id: "settings.app.auto_launch.body",
                    message: "starts Glimpse automatically when you sign in.",
                  })}
                </span>
              </div>

              <div className="px-2 py-1.5 flex flex-col justify-center">
                <div className="flex items-center justify-between gap-1">
                  <span className="ui-text-label-strong ui-color-primary whitespace-nowrap overflow-hidden text-ellipsis">
                    {t({
                      id: "settings.app.auto_delete_recordings",
                      message: "Auto-delete Recordings",
                    })}
                  </span>
                  <div className="w-[110px] shrink-0 relative z-20">
                    <Dropdown
                      value={draftPolicy}
                      onChange={(value) => {
                        if (!isPreviewingPrune) {
                          setDraftPolicy(value);
                        }
                      }}
                      options={recordingPruneOptions}
                      buttonClassName="py-0.5 px-2 ui-text-meta h-[24px]"
                      disabled={isPreviewingPrune}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 mt-1 min-h-[22px]">
                  <span className="ui-text-micro ui-color-disabled overflow-hidden text-ellipsis whitespace-nowrap">
                    {t({
                      id: "settings.app.auto_delete_recordings.body",
                      message: "Auto deletes local audio files.",
                    })}
                  </span>
                  <div
                    className={`flex items-center gap-1.5 shrink-0 transition-opacity ${isDirty ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                  >
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={isPreviewingPrune}
                      className="rounded-md px-2 py-0.5 ui-text-meta ui-color-muted hover:bg-surface-elevated hover:text-content-secondary transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {t({
                        id: "settings.app.cancel",
                        message: "Cancel",
                      })}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleApply();
                      }}
                      disabled={isPreviewingPrune}
                      aria-label={confirmButtonAriaLabel}
                      className="rounded-md border border-border-primary bg-surface-surface px-2.5 py-0.5 ui-text-meta font-medium ui-color-primary transition-colors hover:bg-surface-elevated hover:border-border-secondary active:bg-surface-tertiary disabled:opacity-60 disabled:pointer-events-none"
                    >
                      <span className="flex items-center gap-1.5">
                        {isPreviewingPrune ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : null}
                        <span>{confirmButtonLabel}</span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p className="ui-text-micro px-0.5 invisible" aria-hidden="true">
              &nbsp;
            </p>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {pendingPruneConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
            onClick={handleClosePruneConfirmation}
          >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-surface-tertiary p-5 ui-shadow-modal-deep"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t({
              id: "settings.app.auto_delete_recordings.confirm.title",
                message: "Delete older recordings now?",
              })}
            >
              <div className="mb-3 flex items-start gap-3">
                <AlertTriangle
                  size={20}
                  className="mt-1 shrink-0 text-red-400"
                />
                <div className="min-w-0">
                  <p className="ui-text-body-lg font-semibold ui-color-error-strong leading-tight">
                    {t({
                      id: "settings.app.auto_delete_recordings.confirm.title",
                      message: "Delete older recordings now?",
                    })}
                  </p>
                  <p className="mt-1 ui-text-body text-content-primary leading-relaxed">
                    {pruneConfirmationMessage}
                  </p>
                </div>
              </div>
              <p className="ui-text-micro text-content-muted">
                {pruneConfirmationFootnote}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={handleClosePruneConfirmation}
                  className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary hover:border-border-hover transition-colors"
                >
                  {t({
                    id: "settings.app.cancel",
                    message: "Cancel",
                  })}
                </button>
                <button
                  onClick={handleConfirmPruneChange}
                  className="rounded-lg bg-red-500/90 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-solid hover:bg-red-500 transition-colors"
                >
                  {t({
                    id: "settings.app.auto_delete_recordings.confirm.apply",
                    message: "Apply anyway",
                  })}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AppTab;
