import { useLingui } from "@lingui/react/macro";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, type Variants } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestAccessibilityPermission } from "tauri-plugin-macos-permissions-api";
import { buildAppLocaleOptions } from "../../../../shared/lib/appLocales";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import { ACTION_CARD_BUTTON_ACCENTS } from "../../../../shared/ui/ActionCardButton";
import type {
  AppLocaleSetting,
  RecordingPrunePolicy,
  TextSizeMode,
} from "../../../../types";

const LOCAL_ACTION_SHADOW =
  "0 3px 0 -1px rgba(0, 0, 0, 0.5)";

type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
};

const SegmentedControl = <T extends string>({
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) => {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const segmentCount = Math.max(1, options.length);
  const segmentWidth = 100 / segmentCount;

  return (
    <div className="relative h-9 rounded-lg border border-border-primary bg-surface-surface p-0.5">
      <div className="absolute inset-0.5" aria-hidden="true">
        <div
          className="absolute top-0 bottom-0 rounded-md border border-border-secondary bg-surface-elevated shadow-xs motion-reduce:transition-none"
          style={{
            width: `${segmentWidth}%`,
            left: `${activeIndex * segmentWidth}%`,
            transition: "left 140ms cubic-bezier(0.2, 0, 0, 1)",
            willChange: "left",
          }}
        />
      </div>
      <div
        className="relative grid h-full"
        style={{
          gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))`,
        }}
      >
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={`h-full rounded-md ui-text-body-sm transition-colors ${value === option.id
              ? "ui-color-primary"
              : "ui-color-muted hover:text-content-secondary"
              }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
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
  textSizeMode: TextSizeMode;
  onTextSizeModeChange: (mode: TextSizeMode) => void;
  appLocale: AppLocaleSetting;
  onAppLocaleChange: (locale: AppLocaleSetting) => void;
  mediaControlEnabled: boolean;
  onMediaControlEnabledChange: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  recordingPrunePolicy: RecordingPrunePolicy;
  onRecordingPrunePolicyChange: (policy: RecordingPrunePolicy) => void;
  analyticsEnabled: boolean;
  onAnalyticsEnabledChange: (enabled: boolean) => void;
};

const AppTab = ({
  variants,
  micPermission,
  accessibilityPermission,
  textSizeMode,
  onTextSizeModeChange,
  appLocale,
  onAppLocaleChange,
  mediaControlEnabled,
  onMediaControlEnabledChange,
  autoUpdateEnabled,
  onAutoUpdateEnabledChange,
  recordingPrunePolicy,
  onRecordingPrunePolicyChange,
  analyticsEnabled,
  onAnalyticsEnabledChange,
}: AppTabProps) => {
  const { t } = useLingui();
  const [draftPolicy, setDraftPolicy] = useState<RecordingPrunePolicy>(recordingPrunePolicy);

  const textSizeOptions: Array<{ id: TextSizeMode; label: string }> = [
    { id: "small", label: t({ id: "settings.app.text_size.small", message: "Small" }) },
    { id: "default", label: t({ id: "settings.app.text_size.default", message: "Default" }) },
    { id: "large", label: t({ id: "settings.app.text_size.large", message: "Large" }) },
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

  const handleApply = () => {
    onRecordingPrunePolicyChange(draftPolicy);
  };

  const handleCancel = () => {
    setDraftPolicy(recordingPrunePolicy);
  };

  return (
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

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "settings.app.text_size.label",
                  message: "Text Size",
                })}
              </span>
            </div>
            <SegmentedControl
              value={textSizeMode}
              options={textSizeOptions}
              onChange={onTextSizeModeChange}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="ui-text-label-strong ui-color-primary">
                {t({
                  id: "settings.app.language.label",
                  message: "Language",
                })}
              </span>
            </div>
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
                onClick={() => invoke("open_microphone_settings")}
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
                  onToggle={() => onAutoUpdateEnabledChange(!autoUpdateEnabled)}
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
                    onChange={setDraftPolicy}
                    options={recordingPruneOptions}
                    buttonClassName="py-0.5 px-2 ui-text-meta h-[24px]"
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
                <div className={`flex items-center gap-1.5 shrink-0 transition-opacity ${isDirty ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
                  >
                    {t({
                      id: "settings.app.cancel",
                      message: "Cancel",
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    style={
                      {
                        "--action-card-border": ACTION_CARD_BUTTON_ACCENTS.amber.borderColor,
                        "--action-card-background": ACTION_CARD_BUTTON_ACCENTS.amber.backgroundColor,
                        "--action-card-shadow": `0 2px 0 -1px ${ACTION_CARD_BUTTON_ACCENTS.amber.shadowColor}`,
                        "--action-card-rest-shadow": LOCAL_ACTION_SHADOW,
                      } as React.CSSProperties
                    }
                    className="group rounded-lg border border-border-primary bg-surface-surface px-3 py-0.5 outline-hidden transition-[transform,box-shadow,border-color,background-color] duration-100 ease-out hover:border-[var(--action-card-border)] hover:bg-[var(--action-card-background)] hover:[box-shadow:var(--action-card-shadow)] hover:-translate-y-[1px] active:translate-y-[2px] active:[box-shadow:none] [box-shadow:var(--action-card-rest-shadow)] ui-text-meta font-medium ui-color-primary"
                  >
                    {t({
                      id: "settings.app.confirm",
                      message: "Confirm",
                    })}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p className="ui-text-micro px-0.5 invisible">
            Placeholder
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default AppTab;
