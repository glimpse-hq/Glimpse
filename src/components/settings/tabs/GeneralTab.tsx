import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Copy, Info } from "lucide-react";
import { Dropdown } from "../../Dropdown";
import { formatShortcutForDisplay } from "../../../lib/shortcuts";
import type {
  DeviceInfo,
  ModelStatus,
  TranscriptionMode,
} from "../../../types";
import type {
  LanguageBadgeColumn,
  TranscriptionLanguageOption,
} from "../../../lib/transcriptionLanguages";

type CaptureMode = "smart" | "hold" | "toggle" | null;

type GeneralTabProps = {
  variants: Variants;
  transcriptionMode: TranscriptionMode;
  onTranscriptionModeChange: (mode: TranscriptionMode) => void;
  loading: boolean;
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
  llmCleanupEnabled: boolean;
};

const GeneralTab = ({
  variants,
  transcriptionMode,
  onTranscriptionModeChange,
  loading,
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
  llmCleanupEnabled,
}: GeneralTabProps) => (
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
        Processing
      </h2>
      <div
        className="grid grid-cols-2 gap-3"
        role="radiogroup"
        aria-label="Processing Mode"
      >
        <button
          onClick={() => {}}
          disabled
          role="radio"
          aria-checked={transcriptionMode === "cloud"}
          aria-label="Cloud processing (Coming soon)"
          className={`py-3 px-3.5 rounded-lg border text-left transition-colors opacity-60 cursor-not-allowed ${
            transcriptionMode === "cloud"
              ? "border-cloud-30 bg-cloud-5"
              : "border-border-primary bg-transparent"
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
              Cloud
            </span>
            <span
              className={`ui-text-label ${
                transcriptionMode === "cloud"
                  ? "text-cloud-50"
                  : "ui-color-disabled"
              }`}
            >
              coming soon
            </span>
          </div>
          <p
            className={`ui-text-label mt-1 ${
              transcriptionMode === "cloud"
                ? "text-cloud-50"
                : "ui-color-disabled"
            }`}
          >
            In development
          </p>
        </button>
        <button
          onClick={() => onTranscriptionModeChange("local")}
          role="radio"
          aria-checked={transcriptionMode === "local"}
          className={`py-3 px-3.5 rounded-lg border text-left transition-colors ${
            transcriptionMode === "local"
              ? "border-local-30 bg-local-5"
              : "border-border-primary bg-transparent hover:border-border-secondary"
          }`}
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className={`ui-text-body-strong ${
                transcriptionMode === "local"
                  ? "ui-color-local"
                  : "ui-color-secondary"
              }`}
            >
              Local
            </span>
            <span
              className={`ui-text-label ${
                transcriptionMode === "local"
                  ? "text-local-50"
                  : "ui-color-disabled"
              }`}
            >
              private
            </span>
          </div>
          <p
            className={`ui-text-label mt-1 ${
              transcriptionMode === "local"
                ? "text-local-50"
                : "ui-color-disabled"
            }`}
          >
            Runs entirely on your device
          </p>
        </button>
      </div>
      <AnimatePresence>
        {!loading &&
          transcriptionMode === "local" &&
          !modelStatus[localModel]?.installed && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="ui-text-label ui-color-warning"
            >
              No model installed.{" "}
              <button
                onClick={onOpenModelsTab}
                className="underline hover:text-cloud transition-colors"
              >
                Download one
              </button>{" "}
              to use local.
            </motion.p>
          )}
      </AnimatePresence>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label className="ui-text-label-strong ui-color-muted">
          Microphone
        </label>
        <div className="relative z-20">
          <Dropdown
            value={microphoneDevice || ""}
            onChange={(val) =>
              onMicrophoneDeviceChange(val === "" ? null : val)
            }
            options={[
              { value: "", label: "System Default" },
              ...inputDevices.map((device) => ({
                value: device.id,
                label: device.name,
              })),
            ]}
            placeholder="Select microphone..."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <label className="ui-text-label-strong ui-color-muted">
              Transcription Language
            </label>
            <div className="relative group">
              <button
                className="p-0.5 text-content-disabled hover:text-content-muted transition-colors"
                aria-label="More information about transcription language support badges"
              >
                <Info size={10} aria-hidden="true" />
              </button>
              <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block group-focus-within:block z-10">
                <div className="bg-surface-overlay border border-border-secondary rounded-lg px-2.5 py-1.5 ui-text-micro ui-color-secondary w-56 shadow-lg leading-tight">
                  <p>
                    Language list is filtered to the models you have installed.
                  </p>
                  <p className="mt-1">
                    When multiple engines are installed, badges show which
                    engine supports each language (for example WS, MS, P3).
                  </p>
                  <p className="mt-1">
                    Amber badge matches your active local model.
                  </p>
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
            searchPlaceholder="Search language..."
          />
        </div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <h2 className="ui-text-section-label ui-color-muted">
          Shortcuts
        </h2>

        <div className="space-y-1.5">
          <ShortcutRow
            label="Smart"
            description="tap to toggle, hold to talk"
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
            label="Hold"
            description="hold to talk, release to stop"
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
            label="Toggle"
            description="tap to start, tap to stop"
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
          Features
        </h2>

        <div
          className={`rounded-lg border transition-colors ${
            editModeEnabled
              ? "border-border-secondary bg-surface-surface"
              : "border-border-primary bg-transparent"
          }`}
        >
          <div className="py-2 px-2.5">
            <div className="flex items-center justify-between">
              <span className="ui-text-label-strong ui-color-primary">
                Edit Mode
              </span>
              <button
                onClick={() => setEditModeEnabled(!editModeEnabled)}
                role="switch"
                aria-checked={editModeEnabled}
                aria-label="Toggle Edit Mode"
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  editModeEnabled ? "bg-cloud" : "bg-border-secondary"
                }`}
              >
                <motion.div
                  className="absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm"
                  animate={{
                    left: editModeEnabled ? "calc(100% - 14px)" : "2px",
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              </button>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="ui-text-meta ui-color-disabled">
                transform selected text with voice
              </span>
              <div className="relative group">
                <button
                  className="p-0.5 text-content-disabled hover:text-content-muted transition-colors"
                  aria-label="More information about Edit Mode"
                >
                  <Info size={10} aria-hidden="true" />
                </button>
                <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block z-10">
                  <div className="bg-surface-overlay border border-border-secondary rounded-lg px-2.5 py-1.5 ui-text-micro ui-color-secondary w-44 shadow-lg leading-tight">
                    <p>
                      Select text in any app, and speak a command like "make
                      this formal" or "fix my grammar".
                    </p>
                    {transcriptionMode === "local" && !llmCleanupEnabled && (
                      <p className="text-warning mt-1">
                        Requires AI cleanup to be enabled in the Models tab.
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
  const displayShortcut = formatShortcutForDisplay(shortcut);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        enabled
          ? "border-border-secondary bg-surface-surface"
          : "border-border-primary bg-transparent"
      }`}
    >
      <div className="py-2 px-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="ui-text-label-strong ui-color-primary">
              {label}
            </span>
            <span className="truncate ui-text-meta ui-color-disabled">
              {description}
            </span>
          </div>
          <button
            onClick={onToggle}
            disabled={enabled && !canDisable}
            role="switch"
            aria-checked={enabled}
            aria-label={`Toggle ${label} shortcut`}
            className={`w-7 h-4 rounded-full transition-colors relative ${enabled ? "bg-cloud" : "bg-border-secondary"} ${enabled && !canDisable ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <motion.div
              className="absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm"
              animate={{ left: enabled ? "calc(100% - 14px)" : "2px" }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          </button>
        </div>
        <motion.button
          onClick={onCapture}
          disabled={!enabled}
          aria-label={`Record new shortcut for ${label}, currently ${displayShortcut}`}
          className={`w-full text-left ui-text-kbd px-1.5 py-1 rounded transition-colors ${
            isCapturing
              ? "ui-color-primary border border-border-hover"
              : enabled
                ? "ui-color-secondary hover:text-content-primary hover:bg-surface-elevated"
                : "ui-color-disabled cursor-not-allowed"
          }`}
        >
          {isCapturing ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <motion.span
                className="w-1 h-1 rounded-full bg-cloud"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              <span
                className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
              >
                {capturePreview || "..."}
              </span>
            </span>
          ) : (
            <span className="block truncate">{displayShortcut}</span>
          )}
        </motion.button>
      </div>
    </div>
  );
};

export default GeneralTab;
