import { invoke } from "@tauri-apps/api/core";
import { motion, type Variants } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestAccessibilityPermission } from "tauri-plugin-macos-permissions-api";
import type { TextSizeMode } from "../../../../types";

const TEXT_SIZE_OPTIONS: Array<{ id: TextSizeMode; label: string }> = [
  { id: "small", label: "Small" },
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
];

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
    <div className="relative h-6 rounded-full border border-border-primary bg-surface-secondary p-0.5">
      <div className="absolute inset-0.5" aria-hidden="true">
        <div
          className="absolute top-0 bottom-0 rounded-full border border-border-secondary bg-surface-elevated shadow-sm motion-reduce:transition-none"
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
            className={`h-full rounded-full ui-text-meta transition-colors ${
              value === option.id
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
  if (granted === null) {
    return (
      <Loader2
        size={10}
        className="animate-spin text-content-muted"
        aria-label="Checking permission"
      />
    );
  }
  if (granted) {
    return (
      <span className="ui-text-meta ui-color-success flex items-center gap-1">
        <Check size={10} aria-hidden="true" />
        <span className="sr-only">Enabled</span>
      </span>
    );
  }
  return <span className="ui-text-meta ui-color-warning">off</span>;
};

type AppTabProps = {
  variants: Variants;
  micPermission: boolean | null;
  accessibilityPermission: boolean | null;
  textSizeMode: TextSizeMode;
  onTextSizeModeChange: (mode: TextSizeMode) => void;
  mediaControlEnabled: boolean;
  onMediaControlEnabledChange: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  analyticsEnabled: boolean;
  onAnalyticsEnabledChange: (enabled: boolean) => void;
};

const AppTab = ({
  variants,
  micPermission,
  accessibilityPermission,
  textSizeMode,
  onTextSizeModeChange,
  mediaControlEnabled,
  onMediaControlEnabledChange,
  autoUpdateEnabled,
  onAutoUpdateEnabledChange,
  analyticsEnabled,
  onAnalyticsEnabledChange,
}: AppTabProps) => (
  <motion.div
    key="app"
    variants={variants}
    initial="hidden"
    animate="visible"
    exit="exit"
    className="space-y-6"
  >
    <div className="space-y-2">
      <h2 className="ui-text-section-label-sm ui-color-muted">Appearance</h2>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-surface">
          <div className="py-2 px-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="ui-text-label-strong ui-color-primary">
                Text Size
              </span>
            </div>
            <SegmentedControl
              value={textSizeMode}
              options={TEXT_SIZE_OPTIONS}
              onChange={onTextSizeModeChange}
            />
          </div>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <h2 className="ui-text-section-label-sm ui-color-muted">
          Privacy & Permissions
        </h2>

        <div className="space-y-3 rounded-lg bg-surface-surface p-2.5">
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="ui-text-label-strong ui-color-primary">
                  Microphone
                </span>
                <span className="truncate ui-text-meta ui-color-disabled">
                  required for transcription
                </span>
              </div>
              <PermissionStatus granted={micPermission} />
            </div>
            <button
              onClick={() => invoke("open_microphone_settings")}
              className="mt-1.5 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
            >
              Open Settings
            </button>
          </div>

          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="ui-text-label-strong ui-color-primary">
                  Accessibility
                </span>
                <span className="truncate ui-text-meta ui-color-disabled">
                  required for auto-paste
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
              Open Settings
            </button>
          </div>

          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-text-label-strong ui-color-primary">
                Usage Analytics
              </span>
              <ToggleSwitch
                enabled={analyticsEnabled}
                onToggle={() => onAnalyticsEnabledChange(!analyticsEnabled)}
                ariaLabel="Toggle usage analytics"
              />
            </div>
            <span className="ui-text-micro ui-color-disabled block mt-0.5">
              anonymous, no transcripts or audio shared.{" "}
              <button
                onClick={() =>
                  openUrl(
                    "https://github.com/LegendarySpy/Glimpse/wiki/Analytics",
                  )
                }
                className="ui-color-muted hover:text-content-secondary transition-colors underline"
              >
                More info
              </button>
            </span>
          </div>
        </div>

        <p className="ui-text-micro ui-color-disabled px-0.5">
          Permission changes may require a restart.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="ui-text-section-label-sm ui-color-muted">
          Automation
        </h2>

        <div className="space-y-3 rounded-lg bg-surface-surface p-2.5">
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-text-label-strong ui-color-primary">
                Auto-pause Media
              </span>
              <ToggleSwitch
                enabled={mediaControlEnabled}
                onToggle={() =>
                  onMediaControlEnabledChange(!mediaControlEnabled)
                }
                ariaLabel="Toggle auto-pause media while recording"
              />
            </div>
            <span className="ui-text-micro ui-color-disabled block mt-0.5">
              pauses the active Now Playing app while recording, then resumes it
              when done.
            </span>
          </div>

          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-text-label-strong ui-color-primary">
                Auto-update
              </span>
              <ToggleSwitch
                enabled={autoUpdateEnabled}
                onToggle={() =>
                  onAutoUpdateEnabledChange(!autoUpdateEnabled)
                }
                ariaLabel="Toggle auto-update"
              />
            </div>
            <span className="ui-text-micro ui-color-disabled block mt-0.5">
              automatically downloads and installs updates when idle.
            </span>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
);

export default AppTab;
