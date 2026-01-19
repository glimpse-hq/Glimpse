import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Copy, Info } from "lucide-react";
import { Dropdown } from "../../Dropdown";
import type { DeviceInfo, ModelStatus, TranscriptionMode } from "../../../types";

type CaptureMode = "smart" | "hold" | "toggle" | null;

type LanguageOption = {
    code: string;
    name: string;
};

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
    languages: LanguageOption[];
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
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-content-muted">Processing</h2>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Processing Mode">
                <button
                    onClick={() => {}}
                    disabled
                    role="radio"
                    aria-checked={transcriptionMode === "cloud"}
                    aria-label="Cloud processing (Coming soon)"
                    className={`py-3 px-3.5 rounded-lg border text-left transition-all opacity-60 cursor-not-allowed ${transcriptionMode === "cloud"
                        ? "border-cloud-30 bg-cloud-5"
                        : "border-border-primary bg-transparent"
                        }`}
                    aria-disabled="true"
                >
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-[13px] font-medium ${transcriptionMode === "cloud" ? "text-cloud" : "text-content-secondary"
                            }`}>Cloud</span>
                        <span className={`text-[11px] ${transcriptionMode === "cloud" ? "text-cloud-50" : "text-content-disabled"
                            }`}>coming soon</span>
                    </div>
                    <p className={`text-[11px] mt-1 ${transcriptionMode === "cloud" ? "text-cloud-50" : "text-content-disabled"
                        }`}>In development</p>
                </button>
                <button
                    onClick={() => onTranscriptionModeChange("local")}
                    role="radio"
                    aria-checked={transcriptionMode === "local"}
                    className={`py-3 px-3.5 rounded-lg border text-left transition-all ${transcriptionMode === "local"
                        ? "border-local-30 bg-local-5"
                        : "border-border-primary bg-transparent hover:border-border-secondary"
                        }`}
                >
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-[13px] font-medium ${transcriptionMode === "local" ? "text-local" : "text-content-secondary"
                            }`}>Local</span>
                        <span className={`text-[11px] ${transcriptionMode === "local" ? "text-local-50" : "text-content-disabled"
                            }`}>private</span>
                    </div>
                    <p className={`text-[11px] mt-1 ${transcriptionMode === "local" ? "text-local-50" : "text-content-disabled"
                        }`}>Runs entirely on your device</p>
                </button>
            </div>
            <AnimatePresence>
                {!loading && transcriptionMode === "local" && !modelStatus[localModel]?.installed && (
                    <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-[11px] text-warning"
                    >
                        No model installed. <button onClick={onOpenModelsTab} className="underline hover:text-cloud transition-colors">Download one</button> to use local.
                    </motion.p>
                )}
            </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-content-muted">Microphone</label>
                <div className="relative z-20">
                    <Dropdown
                        value={microphoneDevice || ""}
                        onChange={(val) => onMicrophoneDeviceChange(val === "" ? null : val)}
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
                <label className="text-[11px] font-medium text-content-muted">Transcription Language</label>
                <div className="relative z-10">
                    <Dropdown
                        value={language}
                        onChange={(val) => onLanguageChange(val)}
                        options={languages.map(lang => ({
                            value: lang.code,
                            label: lang.name
                        }))}
                        searchable
                        searchPlaceholder="Search language..."
                    />
                </div>
            </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
                <h2 className="text-[12px] font-semibold uppercase tracking-wider text-content-muted">Shortcuts</h2>

                <div className="space-y-1.5">
                    <ShortcutRow
                        label="Smart"
                        description="tap to hold, long-press to toggle"
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
                <h2 className="text-[12px] font-semibold uppercase tracking-wider text-content-muted">Features</h2>

                <div className={`rounded-lg border transition-all ${editModeEnabled ? "border-border-secondary bg-surface-surface" : "border-border-primary bg-transparent"
                    }`}>
                    <div className="py-2 px-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-content-primary">Edit Mode</span>
                            <button
                                onClick={() => setEditModeEnabled(!editModeEnabled)}
                                role="switch"
                                aria-checked={editModeEnabled}
                                aria-label="Toggle Edit Mode"
                                className={`w-7 h-4 rounded-full transition-colors relative ${editModeEnabled ? "bg-cloud" : "bg-border-secondary"
                                    }`}
                            >
                                <motion.div
                                    className="absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm"
                                    animate={{ left: editModeEnabled ? "calc(100% - 14px)" : "2px" }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            </button>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-content-disabled">transform selected text with voice</span>
                            <div className="relative group">
                                <button
                                    className="p-0.5 text-content-disabled hover:text-content-muted transition-colors"
                                    aria-label="More information about Edit Mode"
                                >
                                    <Info size={10} aria-hidden="true" />
                                </button>
                                <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block z-10">
                                    <div className="bg-surface-overlay border border-border-secondary rounded-lg px-2.5 py-1.5 text-[9px] text-content-secondary w-44 shadow-lg leading-tight">
                                        <p>Select text in any app, and speak a command like "make this formal" or "fix my grammar".</p>
                                        {transcriptionMode === "local" && !llmCleanupEnabled && (
                                            <p className="text-warning mt-1">Requires AI cleanup to be enabled in the Models tab.</p>
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
                    <div className="flex items-center gap-2 text-[11px] text-error">
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
}: ShortcutRowProps) => (
    <div className={`rounded-lg border transition-all ${enabled ? "border-border-secondary bg-surface-surface" : "border-border-primary bg-transparent"
        }`}>
        <div className="py-2 px-2.5">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-content-primary">{label}</span>
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
            <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-content-disabled">{description}</span>
                <motion.button
                    onClick={onCapture}
                    disabled={!enabled}
                    aria-label={`Record new shortcut for ${label}, currently ${shortcut}`}
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded transition-all ${isCapturing
                        ? "text-content-primary border border-border-hover"
                        : enabled
                            ? "text-content-secondary hover:text-content-primary hover:bg-surface-elevated"
                            : "text-content-disabled cursor-not-allowed"
                        }`}
                >
                    {isCapturing ? (
                        <span className="flex items-center gap-1.5">
                            <motion.span
                                className="w-1 h-1 rounded-full bg-cloud"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1, repeat: Infinity }}
                            />
                            <span className={capturePreview ? "text-content-primary" : "text-content-muted"}>
                                {capturePreview || "..."}
                            </span>
                        </span>
                    ) : shortcut}
                </motion.button>
            </div>
        </div>
    </div>
);

export default GeneralTab;
