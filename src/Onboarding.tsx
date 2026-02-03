import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
    checkAccessibilityPermission,
    requestAccessibilityPermission,
    checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import {
    Mic,
    Accessibility,
    Sparkles,
    Download,
    Trash2,
    ChevronLeft,
    Server,
    Key,
    Cpu,
    ChevronRight,
    Check,
    ExternalLink,
    Loader2,
    Square,
    Wand2,
    AlertTriangle,
    Mail,
} from "lucide-react";
import DotMatrix from "./components/DotMatrix";
import { Dropdown } from "./components/Dropdown";
import FAQModal from "./components/FAQModal";
import { LOCAL_PROVIDERS, CLOUD_PROVIDERS, getProviderPreset } from "./lib/llmProviders";
import type { ModelInfo, ModelStatus, StoredSettings, TranscriptionMode, LlmProvider } from "./types";

 type OnboardingStep = "welcome" | "local-model" | "cleanup" | "local-signin" | "microphone" | "accessibility" | "ready";


type LocalDownloadStatus = {
    status: "idle" | "downloading" | "complete" | "error" | "cancelled";
    percent: number;
    file?: string;
    message?: string;
};

interface OnboardingProps {
    onComplete: () => void;
}

const PARAKEET_KEY = "parakeet_tdt_int8";
const WHISPER_KEY = "whisper_large_v3_turbo_q8";

const GlimpseLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
    const [pattern, setPattern] = useState(0);
    const intervalRef = useRef<number | null>(null);

    const sizes = {
        sm: { dot: 5, gap: 4 },
        md: { dot: 10, gap: 7 },
        lg: { dot: 14, gap: 10 },
    }[size];

    const patterns = [
        [true, false, false, true],
        [false, true, true, false],
        [true, true, true, true],
    ];

    const dotColors = ["var(--color-cloud)", "var(--color-local)", "var(--color-local)", "var(--color-cloud)"];

    useEffect(() => {
        intervalRef.current = window.setInterval(() => {
            setPattern(p => (p + 1) % patterns.length);
        }, 700);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const currentPattern = patterns[pattern];
    const gridSize = sizes.dot * 2 + sizes.gap;

    return (
        <div
            className="relative"
            style={{ width: gridSize, height: gridSize }}
        >
            {[0, 1, 2, 3].map((i) => {
                const row = Math.floor(i / 2);
                const col = i % 2;
                const isActive = currentPattern[i];

                return (
                    <motion.div
                        key={i}
                        className="absolute rounded-full"
                        style={{
                            width: sizes.dot,
                            height: sizes.dot,
                            left: col * (sizes.dot + sizes.gap),
                            top: row * (sizes.dot + sizes.gap),
                            backgroundColor: dotColors[i],
                        }}
                        animate={{
                            opacity: isActive ? 1 : 0.15,
                            scale: isActive ? 1 : 0.85,
                        }}
                        transition={{
                            duration: 0.3,
                            ease: "easeOut",
                        }}
                    />
                );
            })}
        </div>
    );
};

const StepIndicator = ({ currentStep, total }: { currentStep: number; total: number }) => (
    <div className="flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
            <motion.div
                key={i}
                className="h-1.5 rounded-full bg-amber-400"
                animate={{
                    width: i === currentStep ? 20 : 6,
                    opacity: i <= currentStep ? 1 : 0.25,
                }}
                transition={{ duration: 0.25 }}
            />
        ))}
    </div>
);

const StatusBadge = ({ granted, checking }: { granted: boolean; checking?: boolean }) => {
    if (checking) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-content-muted">
                <Loader2 size={11} className="animate-spin" />
                Checking...
            </span>
        );
    }

    if (granted) {
        return (
            <motion.span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
            >
                <Check size={12} />
                Enabled
            </motion.span>
        );
    }

    return (
        <span className="text-[11px] text-content-muted">
            Not enabled
        </span>
    );
};

const modifierOrder = ["Control", "Shift", "Alt", "Command"];

const normalizeModifier = (event: KeyboardEvent): string | null => {
    switch (event.key) {
        case "Control": return "Control";
        case "Shift": return "Shift";
        case "Alt": return "Alt";
        case "Meta": return "Command";
        default: return null;
    }
};

const formatKey = (code: string): string | null => {
    if (code.startsWith("Key")) return code.replace("Key", "");
    if (code.startsWith("Digit")) return code.replace("Digit", "");
    const specialKeys: Record<string, string> = {
        Space: "Space", Backspace: "Backspace", Enter: "Enter", Tab: "Tab",
        ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
        Escape: "Escape", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End",
        PageUp: "PageUp", PageDown: "PageDown", Backquote: "`", Minus: "-", Equal: "=",
        BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
        Quote: "'", Comma: ",", Period: ".", Slash: "/",
    };
    if (specialKeys[code]) return specialKeys[code];
    if (code.startsWith("F") && !isNaN(Number(code.slice(1)))) return code;
    return null;
};

const formatShortcutForDisplay = (shortcut: string): string => {
    return shortcut
        .replace(/Control/g, "Ctrl")
        .replace(/Command/g, "⌘")
        .replace(/\+/g, " + ");
};

const Onboarding = ({ onComplete }: OnboardingProps) => {
    const [step, setStep] = useState<OnboardingStep>("welcome");
    const skippedFrom = useRef<OnboardingStep | null>(null);
    const [micPermission, setMicPermission] = useState(false);
    const [accessibilityPermission, setAccessibilityPermission] = useState(false);
    const [isCheckingMic, setIsCheckingMic] = useState(true);
    const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(true);
    const [selectedMode, setSelectedMode] = useState<TranscriptionMode>("local");
    const [localModelChoice, setLocalModelChoice] = useState<typeof PARAKEET_KEY | typeof WHISPER_KEY>(WHISPER_KEY);
    const [localDownload, setLocalDownload] = useState<Record<string, LocalDownloadStatus>>({
        [PARAKEET_KEY]: { status: "idle", percent: 0 },
        [WHISPER_KEY]: { status: "idle", percent: 0 },
    });
    const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({});
    const [modelInfo, setModelInfo] = useState<Record<string, ModelInfo>>({});
    const [llmCleanupEnabled, setLlmCleanupEnabled] = useState(false);
    const [llmProvider, setLlmProvider] = useState<LlmProvider>("custom");
    const [llmEndpoint, setLlmEndpoint] = useState("");
    const [llmApiKey, setLlmApiKey] = useState("");
    const [llmModel, setLlmModel] = useState("");
    const [showLocalConfirm, setShowLocalConfirm] = useState(false);

    const [showFAQModal, setShowFAQModal] = useState(false);

    const [smartShortcut, setSmartShortcut] = useState("Control+Space");
    const [captureActive, setCaptureActive] = useState(false);
    const pressedModifiers = useRef<Set<string>>(new Set());
    const primaryKey = useRef<string | null>(null);

    const steps: OnboardingStep[] = ["welcome", "local-model", "cleanup", "microphone", "accessibility", "ready"];
    const currentStepIndex = steps.indexOf(step);

    useEffect(() => {
        if (showLocalConfirm) setShowLocalConfirm(false);
    }, [step]);

    const checkMicPermission = useCallback(async () => {
        try {
            const nativeGranted = await checkMicrophonePermission();
            if (nativeGranted) {
                setMicPermission(true);
                return;
            }

            try {
                const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                if (result.state === 'granted') {
                    setMicPermission(true);
                    return;
                }
            } catch {
                // Permissions API not supported or failed
            }

            setMicPermission(false);
        } catch (err) {
            console.error("Failed to check microphone permission:", err);
            setMicPermission(false);
        } finally {
            setIsCheckingMic(false);
        }
    }, []);

    const checkAccessPermission = useCallback(async () => {
        try {
            const granted = await checkAccessibilityPermission();
            setAccessibilityPermission(granted);
        } catch (err) {
            console.error("Failed to check accessibility permission:", err);
        } finally {
            setIsCheckingAccessibility(false);
        }
    }, []);

    useEffect(() => {
        checkMicPermission();
        checkAccessPermission();
    }, [checkMicPermission, checkAccessPermission]);

    useEffect(() => {
        if (step === "microphone") {
            const interval = setInterval(checkMicPermission, 1500);
            return () => clearInterval(interval);
        }
    }, [step, checkMicPermission]);

    useEffect(() => {
        if (step === "accessibility") {
            const interval = setInterval(checkAccessPermission, 800);
            return () => clearInterval(interval);
        }
    }, [step, checkAccessPermission]);

    const handleRequestMicrophoneAccess = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            await checkMicPermission();
        } catch (err) {
            console.error("Failed to request microphone:", err);
            try {
                await invoke("open_microphone_settings");
            } catch (e) {
                console.error("Failed to open settings:", e);
            }
        }
    };

    const handleRequestAccessibilityAccess = async () => {
        try {
            await requestAccessibilityPermission();
            await checkAccessPermission();
        } catch (err) {
            console.error("Failed to request accessibility:", err);
            try {
                await invoke("open_accessibility_settings");
            } catch (e) {
                console.error("Failed to open settings:", e);
            }
        }
    };

    const handleComplete = async () => {
        try {
            localStorage.setItem("glimpse_cloud_sync_enabled", "false");

            await invoke("update_settings", {
                smartShortcut,
                smartEnabled: true,
                holdShortcut: "Control+Shift+Space",
                holdEnabled: false,
                toggleShortcut: "Control+Alt+Space",
                toggleEnabled: false,
                transcriptionMode: selectedMode,
                localModel: localModelChoice,
                microphoneDevice: null,
                language: "en",
                llmCleanupEnabled,
                llmProvider,
                llmEndpoint,
                llmApiKey,
                llmModel,
                editModeEnabled: false,
            });
            await invoke("complete_onboarding");
            onComplete();
        } catch (err) {
            console.error("Failed to save onboarding settings:", err);
            onComplete();
        }
    };

    const goToNextStep = () => {
        const nextIndex = currentStepIndex + 1;
        if (nextIndex < steps.length) {
            setStep(steps[nextIndex]);
        }
    };

    const goToPrevStep = () => {
        if (skippedFrom.current) {
            setStep(skippedFrom.current);
            skippedFrom.current = null;
            return;
        }
        const prevIndex = currentStepIndex - 1;
        if (prevIndex >= 0) {
            setStep(steps[prevIndex]);
        }
    };

    const finalizeCapture = () => {
        setCaptureActive(false);
        pressedModifiers.current.clear();
        primaryKey.current = null;
    };

    const buildShortcut = () => {
        if (!primaryKey.current) return null;
        const orderedMods = Array.from(pressedModifiers.current).sort(
            (a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b)
        );
        const formattedKey = formatKey(primaryKey.current);
        if (!formattedKey) return null;
        return [...orderedMods, formattedKey].join("+");
    };

    useEffect(() => {
        if (!captureActive) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            const modifier = normalizeModifier(event);
            if (modifier) {
                pressedModifiers.current.add(modifier);
            } else if (event.code) {
                primaryKey.current = event.code;
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            event.preventDefault();
            if (!primaryKey.current && pressedModifiers.current.size === 0) return;

            const combo = buildShortcut();
            if (combo) {
                setSmartShortcut(combo);
            }
            finalizeCapture();
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                finalizeCapture();
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("keydown", handleEscape, true);

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("keydown", handleEscape, true);
        };
    }, [captureActive]);

    const refreshModelStatus = useCallback((modelKey: string) => {
        invoke<ModelStatus>("check_model_status", { model: modelKey })
            .then((status) => {
                setModelStatus((prev) => ({ ...prev, [modelKey]: status }));
            })
            .catch((err) => console.error("Failed to check model status", err));
    }, []);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            try {
                const [models, settings] = await Promise.all([
                    invoke<ModelInfo[]>("list_models"),
                    invoke<StoredSettings>("get_settings"),
                ]);
                if (!isMounted) return;
                const infoMap: Record<string, ModelInfo> = {};
                models.forEach((model) => {
                    infoMap[model.key] = model;
                    refreshModelStatus(model.key);
                });
                setModelInfo(infoMap);
                if (
                    settings?.local_model &&
                    (settings.local_model === PARAKEET_KEY || settings.local_model === WHISPER_KEY)
                ) {
                    setLocalModelChoice(settings.local_model as typeof PARAKEET_KEY | typeof WHISPER_KEY);
                }
            } catch (err) {
                console.error("Failed to preload model info", err);
                if (!isMounted) return;
                [PARAKEET_KEY, WHISPER_KEY].forEach((model) => refreshModelStatus(model));
            }
        };
        load();
        return () => {
            isMounted = false;
        };
    }, [refreshModelStatus]);

    useEffect(() => {
        let active = true;
        const disposers: UnlistenFn[] = [];

        const setup = async () => {
            try {
                const results = await Promise.allSettled([
                    listen<{ model: string; percent: number; downloaded: number; total: number; file: string }>(
                        "download:progress",
                        (event) => {
                            const payload = event.payload;
                            setLocalDownload((prev) => ({
                                ...prev,
                                [payload.model]: {
                                    status: "downloading",
                                    percent: Math.min(100, payload.percent),
                                    file: payload.file,
                                },
                            }));
                        }
                    ),
                    listen<{ model: string }>("download:complete", (event) => {
                        const model = event.payload.model;
                        setLocalDownload((prev) => ({
                            ...prev,
                            [model]: {
                                status: "complete",
                                percent: 100,
                                file: prev[model]?.file,
                                message: prev[model]?.message,
                            },
                        }));
                        refreshModelStatus(model as "parakeet_tdt_int8" | "whisper_small_q5");
                    }),
                    listen<{ model: string; error: string }>("download:error", (event) => {
                        const { model, error } = event.payload;
                        if (error.toLowerCase().includes("cancelled")) return;
                        setLocalDownload((prev) => ({
                            ...prev,
                            [model]: { status: "error", percent: prev[model]?.percent ?? 0, message: error },
                        }));
                    }),
                ]);

                results.forEach((res) => {
                    if (res.status === "fulfilled") {
                        if (!active) {
                            res.value();
                        } else {
                            disposers.push(res.value);
                        }
                    } else {
                        console.error("Failed to set up download listener", res.reason);
                    }
                });
            } catch (err) {
                console.error("Failed to set up download listeners", err);
            }
        };

        setup();

        return () => {
            active = false;
            disposers.forEach((fn) => fn());
        };
    }, [refreshModelStatus]);

    const handleLocalDownload = async (modelKey: typeof PARAKEET_KEY | typeof WHISPER_KEY) => {
        setLocalDownload((prev) => ({
            ...prev,
            [modelKey]: { status: "downloading", percent: 0, file: "starting..." },
        }));
        try {
            await invoke("download_model", { model: modelKey });
        } catch (err) {
            const errorMsg = String(err);
            if (errorMsg.toLowerCase().includes("cancelled")) {
                return;
            }
            console.error(err);
            setLocalDownload((prev) => ({
                ...prev,
                [modelKey]: { status: "error", percent: 0, message: "Download failed" },
            }));
        }
    };

    const handleLocalDelete = async (modelKey: typeof PARAKEET_KEY | typeof WHISPER_KEY) => {
        try {
            await invoke("delete_model", { model: modelKey });
            setLocalDownload((prev) => ({
                ...prev,
                [modelKey]: { status: "idle", percent: 0 },
            }));
            refreshModelStatus(modelKey);
        } catch (err) {
            console.error(err);
            setLocalDownload((prev) => ({
                ...prev,
                [modelKey]: { status: "error", percent: prev[modelKey]?.percent ?? 0, message: "Delete failed" },
            }));
        }
    };

    const handleCancelDownload = async (modelKey: typeof PARAKEET_KEY | typeof WHISPER_KEY) => {
        try {
            await invoke("cancel_download", { model: modelKey });
            setLocalDownload((prev) => ({
                ...prev,
                [modelKey]: { status: "cancelled", percent: 0 },
            }));
            setTimeout(() => {
                setLocalDownload((prev) => {
                    if (prev[modelKey]?.status === "cancelled") {
                        return { ...prev, [modelKey]: { status: "idle", percent: 0 } };
                    }
                    return prev;
                });
            }, 1500);
        } catch (err) {
            console.error("Failed to cancel download:", err);
        }
    };

    const displayState = useMemo(() => {
        const buildState = (key: typeof PARAKEET_KEY | typeof WHISPER_KEY) => {
            const installed = modelStatus[key]?.installed;
            const base = localDownload[key];
            if (installed) {
                return {
                    status: "complete" as const,
                    percent: 100,
                    file: base?.file,
                    message: base?.message,
                };
            }
            return base ?? { status: "idle", percent: 0 };
        };
        return {
            parakeet: buildState(PARAKEET_KEY),
            whisper: buildState(WHISPER_KEY),
        };
    }, [localDownload, modelStatus]);

    const parakeetInstalled = modelStatus[PARAKEET_KEY]?.installed || displayState.parakeet.status === "complete";
    const whisperInstalled = modelStatus[WHISPER_KEY]?.installed || displayState.whisper.status === "complete";
    const isParakeetActive = localModelChoice === PARAKEET_KEY && parakeetInstalled;
    const isWhisperActive = localModelChoice === WHISPER_KEY && whisperInstalled;

    const selectedModelReady = useMemo(() => {
        const selectedKey = localModelChoice;
        const isParakeet = selectedKey === PARAKEET_KEY;
        const ready =
            (isParakeet
                ? modelStatus[PARAKEET_KEY]?.installed || displayState.parakeet.status === "complete"
                : modelStatus[WHISPER_KEY]?.installed || displayState.whisper.status === "complete");
        return !!ready;
    }, [localModelChoice, displayState.parakeet.status, displayState.whisper.status, modelStatus]);

    const handleLocalModelContinue = () => {
        if (!selectedModelReady) {
            setShowLocalConfirm(true);
            return;
        }
        goToNextStep();
    };

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-secondary text-white select-none relative">
            <div data-tauri-drag-region className="h-7 w-full shrink-0" />

            <div className="flex justify-center pt-6 pb-6">
                <StepIndicator currentStep={currentStepIndex} total={steps.length} />
            </div>

            <div className="flex-1 flex items-center justify-center px-10 pb-10">
                <AnimatePresence mode="wait">
                    {step === "welcome" && (
                        <motion.div
                            key="welcome"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center w-full max-w-5xl"
                        >
                            <div className="mb-6">
                                <GlimpseLogo size="lg" />
                            </div>

                            <h1 className="text-2xl font-semibold text-content-primary mb-2">
                                Welcome to Glimpse
                            </h1>

                            <p className="text-sm text-content-muted mb-8">
                                Build at the speed of speech.
                            </p>

                            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <button
                                    type="button"
                                    onClick={() => {}}
                                    disabled
                                    className={`group relative w-full rounded-2xl border border-border-primary bg-surface-tertiary p-4 text-left space-y-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)] overflow-hidden transition-all opacity-60 cursor-not-allowed`}
                                    aria-disabled
                                >
                                    <div className="absolute inset-0 pointer-events-none">
                                        <div className="absolute inset-0 opacity-18">
                                            <DotMatrix rows={6} cols={18} activeDots={[1, 4, 7, 10, 12, 15, 18, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68]} dotSize={2} gap={4} color="var(--color-border-secondary)" />
                                        </div>
                                    </div>
                                    <div className="relative flex items-center gap-2">
                                        <DotMatrix rows={2} cols={2} activeDots={[0, 3]} dotSize={3} gap={2} color="var(--color-cloud)" />
                                        <span className="text-[10px] font-semibold text-amber-400">Glimpse Cloud</span>
                                        <span className="ml-2 rounded-lg bg-surface-elevated px-2 py-0.5 text-[9px] font-medium text-content-muted">In development</span>
                                    </div>
                                    <div className="relative flex flex-col gap-1.5 text-[11px] text-content-secondary font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                                            <span>Cross-device sync</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                                            <span>Bigger & better models</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-amber-400/80" />
                                            <span>Faster cleanup & delivery</span>
                                        </div>
                                    </div>
                                    <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 text-[10px] text-content-secondary leading-relaxed">
                                        <DotMatrix rows={3} cols={5} activeDots={[0, 2, 4, 6, 8, 10, 12, 14]} dotSize={2} gap={2} color="var(--color-border-secondary)" />
                                        <p className="flex-1">Get better models and faster cleanup & delivery ($5.99/mo) with cloud.</p>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setSelectedMode("local")}
                                    className={`group relative w-full rounded-2xl border p-4 text-left space-y-3 shadow-[0_10px_24px_rgba(0,0,0,0.18)] overflow-hidden transition-colors ${selectedMode === "local"
                                        ? "border-local-50 bg-surface-tertiary ring-1 ring-local-30"
                                        : "border-border-primary bg-surface-tertiary"
                                        }`}
                                    aria-pressed={selectedMode === "local"}
                                    aria-label="Select Local mode (Privacy-first, on-device)"
                                >
                                    <div className="absolute inset-0 pointer-events-none">
                                        <div className="absolute inset-0 opacity-14">
                                            <DotMatrix rows={6} cols={18} activeDots={[0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68]} dotSize={2} gap={4} color="var(--color-border-primary)" />
                                        </div>
                                    </div>
                                    <div className="relative flex items-center gap-2">
                                        <DotMatrix rows={2} cols={2} activeDots={[1, 2]} dotSize={3} gap={2} color="var(--color-local)" />
                                        <span className="text-[10px] font-semibold text-local">Glimpse Local</span>
                                    </div>
                                    <div className="relative flex flex-col gap-1.5 text-[11px] text-content-secondary font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-local-80" />
                                            <span>Everything stays on-device for privacy </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-local-80" />
                                            <span>Local models</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-local-80" />
                                            <span>free optional Cloud transcription sync</span>
                                        </div>
                                    </div>
                                    <div className="relative flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 text-[10px] text-content-muted leading-relaxed">
                                        <DotMatrix rows={3} cols={5} activeDots={[1, 4, 6, 9, 12, 15, 18, 21]} dotSize={2} gap={2} color="var(--color-local)" />
                                        <p className="flex-1">Best for privacy-first or offline sessions. Cloud remains optional if you want sync and faster responses.</p>
                                    </div>
                                </button>
                            </div>

                            <button
                                onClick={goToNextStep}
                                className="flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 text-sm font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight"
                            >
                                {selectedMode === "cloud" ? "> Cloud" : "> Local"}
                            </button>
                        </motion.div>
                    )}




                    {step === "local-model" && (
                        <motion.div
                            key="local-model"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center w-full max-w-2xl"
                        >

                            <h2 className="text-xl font-semibold text-content-primary mb-1">
                                Choose your local model
                            </h2>
                            <div className="mb-6 flex flex-col gap-1 text-sm text-content-muted">
                                <p>Pick a model, then download it. You can add more in Settings later.</p>
                                <p className="text-xs text-content-disabled">Both models work offline; choose one and get it ready.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setLocalModelChoice(WHISPER_KEY)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setLocalModelChoice(WHISPER_KEY);
                                        }
                                    }}
                                    aria-label="Select Whisper Large V3 Turbo model"
                                    aria-pressed={localModelChoice === WHISPER_KEY}
                                    className={`relative w-full rounded-2xl border p-4 text-left space-y-3 shadow-[0_10px_24px_rgba(0,0,0,0.16)] overflow-hidden transition-colors cursor-pointer ${isWhisperActive
                                        ? "border-border-primary bg-amber-400/5 ring-1 ring-amber-400/60"
                                        : localModelChoice === WHISPER_KEY
                                            ? "border-border-primary bg-surface-tertiary ring-1 ring-amber-400/30"
                                            : "border-border-primary bg-surface-tertiary hover:border-border-hover"
                                        }`}
                                >
                                    <div className="absolute inset-0 pointer-events-none">
                                        <div className="absolute inset-0 opacity-10">
                                            <DotMatrix rows={6} cols={18} activeDots={[1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65]} dotSize={2} gap={4} color="var(--color-border-primary)" />
                                        </div>
                                    </div>
                                    <div className="relative flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <DotMatrix rows={2} cols={2} activeDots={[1, 2]} dotSize={3} gap={2} color="var(--color-local)" />
                                            <span className="text-[11px] font-semibold text-content-primary">Whisper Large V3 Turbo (Q8)</span>
                                            {modelInfo[WHISPER_KEY]?.size_mb && (
                                                <span className="text-[9px] text-content-muted tabular-nums">{modelInfo[WHISPER_KEY].size_mb >= 1000 ? `${(modelInfo[WHISPER_KEY].size_mb / 1000).toFixed(1)} GB` : `${Math.round(modelInfo[WHISPER_KEY].size_mb)} MB`}</span>
                                            )}
                                        </div>
                                        <span
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border ${isWhisperActive
                                                ? "bg-amber-400/20 text-amber-400 border-amber-400/40"
                                                : "opacity-0 border-transparent text-transparent pointer-events-none select-none"
                                                }`}
                                        >
                                            Active
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border bg-local-15 text-local border-local-40">
                                            Recommended
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border ${whisperInstalled
                                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                            : "bg-surface-elevated text-content-tertiary border-border-secondary"
                                            }`}>
                                            {whisperInstalled ? "Ready" : "Download needed"}
                                        </span>
                                    </div>
                                    <div className="relative space-y-1.5 text-[11px] text-content-secondary font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-content-tertiary" />
                                            <span>Good quality, balanced speed</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-content-tertiary" />
                                            <span>Supports custom words</span>
                                        </div>
                                    </div>
                                    <div className="relative rounded-lg border border-border-primary bg-surface-tertiary px-3 py-2 text-[10px] text-content-tertiary leading-relaxed space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-semibold text-content-secondary">Download</span>
                                            <button
                                                aria-label={displayState.whisper.status === "downloading" ? "Stop download" : displayState.whisper.status === "complete" ? "Delete model" : "Download model"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (displayState.whisper.status === "downloading") {
                                                        handleCancelDownload(WHISPER_KEY);
                                                    } else if (displayState.whisper.status === "complete") {
                                                        handleLocalDelete(WHISPER_KEY);
                                                    } else if (displayState.whisper.status !== "cancelled") {
                                                        handleLocalDownload(WHISPER_KEY);
                                                    }
                                                }}
                                                disabled={displayState.whisper.status === "cancelled"}
                                                className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${displayState.whisper.status === "downloading"
                                                    ? "border-error/30 text-error hover:bg-error/10"
                                                    : displayState.whisper.status === "complete"
                                                        ? "border-error/30 text-error hover:bg-error/10"
                                                        : displayState.whisper.status === "cancelled"
                                                            ? "border-border-secondary text-content-disabled cursor-default"
                                                            : "border-border-secondary text-content-primary hover:border-border-hover"
                                                    }`}
                                            >
                                                {displayState.whisper.status === "downloading" ? (
                                                    <Square size={10} className="fill-current" />
                                                ) : displayState.whisper.status === "complete" ? (
                                                    <Trash2 size={10} />
                                                ) : (
                                                    <Download size={10} className={displayState.whisper.status === "cancelled" ? "" : "text-cloud"} />
                                                )}
                                            </button>
                                        </div>
                                        <ModelProgress percent={displayState.whisper.percent} status={displayState.whisper.status} />
                                        <div className="h-4 flex items-center">
                                            {displayState.whisper.status === "downloading" && (
                                                <p className="text-[10px] leading-none text-content-muted tabular-nums truncate w-full">
                                                    {displayState.whisper.percent.toFixed(0)}% · {displayState.whisper.file ?? ""}
                                                </p>
                                            )}
                                            {displayState.whisper.status === "error" && (
                                                <p className="text-[10px] leading-none text-error truncate w-full">
                                                    {displayState.whisper.message ?? "Download failed"}
                                                </p>
                                            )}
                                            {displayState.whisper.status === "cancelled" && (
                                                <p className="text-[10px] leading-none text-content-muted">
                                                    Cancelled
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setLocalModelChoice(PARAKEET_KEY)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setLocalModelChoice(PARAKEET_KEY);
                                        }
                                    }}
                                    aria-label="Select Parakeet (INT8) model"
                                    aria-pressed={localModelChoice === PARAKEET_KEY}
                                    className={`relative w-full rounded-2xl border border-border-primary p-4 text-left space-y-3 shadow-[0_10px_24px_rgba(0,0,0,0.2)] overflow-hidden transition-colors cursor-pointer ${isParakeetActive
                                        ? "bg-amber-400/5 ring-1 ring-amber-400/60"
                                        : localModelChoice === PARAKEET_KEY
                                            ? "bg-surface-tertiary ring-1 ring-amber-400/30"
                                            : "bg-surface-tertiary hover:border-border-secondary"
                                        }`}
                                >
                                    <div className="absolute inset-0 pointer-events-none">
                                        <div className="absolute inset-0 opacity-12">
                                            <DotMatrix rows={6} cols={18} activeDots={[0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66]} dotSize={2} gap={4} color="var(--color-border-primary)" />
                                        </div>
                                    </div>
                                    <div className="relative flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <DotMatrix rows={2} cols={2} activeDots={[0]} dotSize={3} gap={2} color="var(--color-cloud)" />
                                            <span className="text-[11px] font-semibold text-content-primary">Parakeet (INT8)</span>
                                            {modelInfo[PARAKEET_KEY]?.size_mb && (
                                                <span className="text-[9px] text-content-muted tabular-nums">{modelInfo[PARAKEET_KEY].size_mb >= 1000 ? `${(modelInfo[PARAKEET_KEY].size_mb / 1000).toFixed(1)} GB` : `${Math.round(modelInfo[PARAKEET_KEY].size_mb)} MB`}</span>
                                            )}
                                        </div>
                                        <span
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border ${isParakeetActive
                                                ? "bg-amber-400/20 text-amber-400 border-amber-400/40"
                                                : "opacity-0 border-transparent text-transparent pointer-events-none select-none"
                                                }`}
                                        >
                                            Active
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border ${parakeetInstalled
                                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                            : "bg-surface-elevated text-content-tertiary border-border-secondary"
                                            }`}>
                                            {parakeetInstalled ? "Ready" : "Download needed"}
                                        </span>
                                    </div>
                                    <div className="relative space-y-1.5 text-[11px] text-content-secondary font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-content-tertiary" />
                                            <span>Good accuracy, fast</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1 w-3 rounded-full bg-content-tertiary" />
                                            <span>Multilingual</span>
                                        </div>
                                    </div>
                                    <div className="relative rounded-lg border border-border-primary bg-surface-elevated px-3 py-2 text-[10px] text-content-tertiary leading-relaxed space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-semibold text-content-secondary">Download</span>
                                            <button
                                                aria-label={displayState.parakeet.status === "downloading" ? "Stop download" : displayState.parakeet.status === "complete" ? "Delete model" : "Download model"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (displayState.parakeet.status === "downloading") {
                                                        handleCancelDownload(PARAKEET_KEY);
                                                    } else if (displayState.parakeet.status === "complete") {
                                                        handleLocalDelete(PARAKEET_KEY);
                                                    } else if (displayState.parakeet.status !== "cancelled") {
                                                        handleLocalDownload(PARAKEET_KEY);
                                                    }
                                                }}
                                                disabled={displayState.parakeet.status === "cancelled"}
                                                className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${displayState.parakeet.status === "downloading"
                                                    ? "border-error/30 text-error hover:bg-error/10"
                                                    : displayState.parakeet.status === "complete"
                                                        ? "border-error/30 text-error hover:bg-error/10"
                                                        : displayState.parakeet.status === "cancelled"
                                                            ? "border-border-secondary text-content-disabled cursor-default"
                                                            : "border-border-secondary text-content-primary hover:border-border-hover"
                                                    }`}
                                            >
                                                {displayState.parakeet.status === "downloading" ? (
                                                    <Square size={10} className="fill-current" />
                                                ) : displayState.parakeet.status === "complete" ? (
                                                    <Trash2 size={10} />
                                                ) : (
                                                    <Download size={10} className={displayState.parakeet.status === "cancelled" ? "" : "text-cloud"} />
                                                )}
                                            </button>
                                        </div>
                                        <ModelProgress percent={displayState.parakeet.percent} status={displayState.parakeet.status} />
                                        <div className="h-4 flex items-center">
                                            {displayState.parakeet.status === "downloading" && (
                                                <p className="text-[10px] leading-none text-content-muted tabular-nums truncate w-full">
                                                    {displayState.parakeet.percent.toFixed(0)}% · {displayState.parakeet.file ?? ""}
                                                </p>
                                            )}
                                            {displayState.parakeet.status === "error" && (
                                                <p className="text-[10px] leading-none text-error truncate w-full">
                                                    {displayState.parakeet.message ?? "Download failed"}
                                                </p>
                                            )}
                                            {displayState.parakeet.status === "cancelled" && (
                                                <p className="text-[10px] leading-none text-content-muted">
                                                    Cancelled
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <p className="mt-4 text-[11px] text-content-muted">
                                More models available in Settings after setup.
                            </p>

                            <button
                                onClick={handleLocalModelContinue}
                                className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 text-sm font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight"
                            >
                                Continue
                            </button>
                        </motion.div>
                    )}

                    {step === "cleanup" && selectedMode === "local" && (
                        <motion.div
                            key="cleanup"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center w-full max-w-xl"
                        >

                            <h2 className="text-xl font-semibold text-content-primary mb-1">
                                AI Cleanup (optional)
                            </h2>
                            <p className="text-sm text-content-muted mb-6">
                                Let an LLM tidy transcriptions before delivery. You can adjust later in Settings.
                            </p>

                            <div className="w-full rounded-2xl border border-border-primary bg-surface-tertiary p-4 space-y-3 shadow-[0_10px_24px_rgba(0,0,0,0.25)] text-left">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-elevated border border-border-primary">
                                            <Wand2 size={14} className="text-content-primary" />
                                        </div>
                                        <div>
                                            <p className="text-[13px] font-medium text-content-primary">AI Cleanup</p>
                                            <p className="text-[11px] text-content-muted">Uses an LLM to polish text</p>
                                        </div>
                                    </div>
                                    <motion.button
                                        onClick={() => setLlmCleanupEnabled(!llmCleanupEnabled)}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${llmCleanupEnabled ? "bg-amber-400" : "bg-border-secondary"}`}
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        <motion.div
                                            className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm"
                                            animate={{ left: llmCleanupEnabled ? "calc(100% - 22px)" : "2px" }}
                                            transition={{ type: "spring", stiffness: 500, damping: 32 }}
                                        />
                                    </motion.button>
                                </div>

<div className="space-y-2">
                                                    <div className="space-y-1.5">
                                                        <label className="text-[11px] font-medium text-content-muted ml-1">Provider</label>
                                                        <Dropdown
                                                            value={llmProvider}
                                                            onChange={(val) => {
                                                                setLlmProvider(val);
                                                                const preset = getProviderPreset(val);
                                                                if (preset) {
                                                                    setLlmEndpoint(preset.endpoint);
                                                                    setLlmModel(preset.defaultModel);
                                                                }
                                                            }}
                                                            options={[
                                                                { value: "custom" as LlmProvider, label: "Custom" },
                                                                { value: "_local_header" as LlmProvider, label: "Local", isHeader: true },
                                                                ...LOCAL_PROVIDERS.filter(p => p.id !== "custom").map(p => ({
                                                                    value: p.id,
                                                                    label: p.label
                                                                })),
                                                                { value: "_cloud_header" as LlmProvider, label: "Cloud (API Key)", isHeader: true },
                                                                ...CLOUD_PROVIDERS.map(p => ({
                                                                    value: p.id,
                                                                    label: p.label
                                                                }))
                                                            ]}
                                                            placeholder="Select provider..."
                                                            searchable
                                                            searchPlaceholder="Search providers..."
                                                        />
                                                    </div>

                                                    {llmProvider && (
                                                        <>
                                                            <div className="space-y-1.5">
                                                                <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                                    <Server size={10} />
                                                                    Endpoint {llmProvider !== "custom" && <span className="text-content-disabled">(auto-filled)</span>}
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={llmEndpoint}
                                                                    onChange={(e) => setLlmEndpoint(e.target.value)}
                                                                    placeholder={getProviderPreset(llmProvider)?.endpoint ?? "https://your-llm-endpoint.com"}
                                                                    className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                                                />
                                                            </div>

                                                            <div className="space-y-1.5">
                                                                <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                                    <Key size={10} />
                                                                    API Key {!getProviderPreset(llmProvider)?.apiKeyRequired && <span className="text-content-disabled">(if required)</span>}
                                                                </label>
                                                                <input
                                                                    type="password"
                                                                    value={llmApiKey}
                                                                    onChange={(e) => setLlmApiKey(e.target.value)}
                                                                    placeholder={getProviderPreset(llmProvider)?.apiKeyRequired ? "Required" : "Optional"}
                                                                    className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                                                />
                                                            </div>

                                                            <div className="space-y-1.5">
                                                                <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                                    <Cpu size={10} />
                                                                    Model <span className="text-content-disabled">(leave empty for default)</span>
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={llmModel}
                                                                    onChange={(e) => setLlmModel(e.target.value)}
                                                                    placeholder={getProviderPreset(llmProvider)?.defaultModel ?? "model-name"}
                                                                    className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                                                />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                            </div>

                            <button
                                onClick={goToNextStep}
                                className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-2.5 text-sm font-mono font-semibold text-surface-secondary hover:bg-white transition-colors min-w-[150px] tracking-tight"
                            >
                                Continue
                            </button>
                        </motion.div>
                    )}

                    {step === "local-signin" && (
                        <motion.div
                            key="local-signin"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center w-full max-w-sm"
                        >
                            <div className="mb-4 rounded-2xl bg-local/10 p-4">
                                <Mail size={28} className="text-local" />
                            </div>
                            <h2 className="text-xl font-semibold text-content-primary mb-2">Transcription Sync</h2>
                            <p className="text-sm text-content-muted mb-2 leading-relaxed">
                                Cloud sync is currently <span className="text-content-primary font-medium">in development</span>.
                            </p>
                            <p className="text-xs text-content-disabled mb-7 leading-relaxed">
                                You can keep using Glimpse locally. This screen will be enabled in a future update.
                            </p>

                            <button
                                type="button"
                                onClick={() => {
                                    skippedFrom.current = "local-signin";
                                    setStep("microphone");
                                }}
                                className="w-full flex items-center justify-center gap-2 rounded-lg bg-content-primary px-5 py-3 text-sm font-semibold text-surface-secondary hover:bg-white transition-colors"
                            >
                                Continue
                            </button>
                        </motion.div>
                    )}

                    {step === "microphone" && (

                        <motion.div
                            key="microphone"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center max-w-sm"
                        >
                            <div className="mb-5">
                                <Mic size={32} className="text-amber-400" />
                            </div>

                            <h2 className="text-xl font-semibold text-content-primary mb-1">
                                Microphone Access
                            </h2>

                            <div className="mb-3">
                                <StatusBadge granted={micPermission} checking={isCheckingMic} />
                            </div>

                            <p className="text-sm text-content-muted mb-6">
                                Required to capture your voice for transcription.
                            </p>

                            {!micPermission ? (
                                <button
                                    onClick={handleRequestMicrophoneAccess}
                                    disabled={isCheckingMic}
                                    className="flex items-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-medium text-black hover:bg-amber-300 transition-colors disabled:opacity-50"
                                >
                                    <Mic size={15} />
                                    Grant Access
                                </button>
                            ) : (
                                <button
                                    onClick={goToNextStep}
                                    className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
                                >
                                    Continue
                                    <ChevronRight size={15} />
                                </button>
                            )}

                            <button
                                onClick={goToNextStep}
                                className="mt-3 text-xs text-content-muted hover:text-content-muted transition-colors"
                            >
                                Skip
                            </button>
                        </motion.div>
                    )}

                    {step === "accessibility" && (
                        <motion.div
                            key="accessibility"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center max-w-sm"
                        >
                            <div className="mb-5">
                                <Accessibility size={32} className="text-violet-400" />
                            </div>

                            <h2 className="text-xl font-semibold text-content-primary mb-1">
                                Accessibility
                            </h2>

                            <div className="mb-3">
                                <StatusBadge granted={accessibilityPermission} checking={isCheckingAccessibility} />
                            </div>

                            <p className="text-sm text-content-muted mb-5">
                                Enables auto-paste into any application.
                            </p>

                            {!accessibilityPermission && (
                                <p className="text-xs text-content-disabled mb-5">
                                    Click below to open System Settings, then toggle on <span className="text-content-muted">Glimpse</span>
                                </p>
                            )}

                            {!accessibilityPermission ? (
                                <button
                                    onClick={handleRequestAccessibilityAccess}
                                    className="flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-400 transition-colors"
                                >
                                    <ExternalLink size={15} />
                                    Enable in Settings
                                </button>
                            ) : (
                                <button
                                    onClick={goToNextStep}
                                    className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
                                >
                                    Continue
                                    <ChevronRight size={15} />
                                </button>
                            )}

                            {!accessibilityPermission && (
                                <button
                                    onClick={goToNextStep}
                                    className="mt-3 text-xs text-content-disabled hover:text-content-muted transition-colors"
                                >
                                    Skip
                                </button>
                            )}
                        </motion.div>
                    )}

                    {step === "ready" && (
                        <motion.div
                            key="ready"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -16 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center max-w-md"
                        >

                            <h2 className="text-xl font-semibold text-content-primary mb-1">
                                You're ready!
                            </h2>

                            <p className="text-sm text-content-muted mb-6">
                                Smart Mode is your default shortcut. Click to customize:
                            </p>

                            <motion.button
                                onClick={() => {
                                    if (!captureActive) {
                                        pressedModifiers.current.clear();
                                        primaryKey.current = null;
                                        setCaptureActive(true);
                                    }
                                }}
                                className={`w-full max-w-xs rounded-xl border p-4 text-left transition-all ${captureActive
                                    ? "border-amber-400 bg-amber-400/10"
                                    : "border-amber-400/30 bg-amber-400/5 hover:border-amber-400/50 hover:bg-amber-400/10"
                                    }`}
                                animate={captureActive ? {
                                    borderColor: ["var(--color-cloud-50)", "var(--color-cloud)", "var(--color-cloud-50)"]
                                } : {}}
                                transition={{ duration: 1.2, repeat: captureActive ? Infinity : 0 }}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/20">
                                        <Wand2 size={14} className="text-amber-400" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[12px] font-medium text-content-primary">Smart Mode</span>
                                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400">Default</span>
                                        </div>
                                        <p className="text-[10px] text-content-muted">Quick tap = hold, long press = toggle</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <code className={`text-sm font-mono ${captureActive ? "text-amber-400" : "text-content-primary"}`}>
                                        {captureActive ? "Press new shortcut..." : formatShortcutForDisplay(smartShortcut)}
                                    </code>
                                    <span className="text-[10px] text-content-muted">
                                        {captureActive ? "Esc to cancel" : "Click to change"}
                                    </span>
                                </div>
                            </motion.button>

                            <p className="mt-4 text-[11px] text-content-disabled">
                                You can add more shortcuts in Settings later.
                            </p>

                            <button
                                onClick={handleComplete}
                                disabled={captureActive}
                                className="mt-6 flex items-center gap-2 rounded-lg bg-amber-400 px-6 py-2.5 text-sm font-semibold text-black hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Sparkles size={15} />
                                Get Started
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="flex justify-center pb-5">
                <div className="flex items-center gap-2 text-content-disabled">
                    <GlimpseLogo size="sm" />
                    <span className="text-[10px] font-medium">Glimpse</span>
                </div>
            </div>

            <AnimatePresence>
                {showLocalConfirm && (
                    <motion.div
                        key="local-confirm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
                        onClick={() => setShowLocalConfirm(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.96, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <AlertTriangle size={20} className="text-amber-400 shrink-0" />
                                <div>
                                    <p className="text-[14px] font-semibold text-content-primary">Continue without a model?</p>
                                    <p className="text-[11px] text-content-disabled">You haven't downloaded a local model yet. Transcription will not run offline until you add one in Settings.</p>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowLocalConfirm(false)}
                                    className="rounded-lg border border-border-secondary px-4 py-2 text-[12px] font-medium text-content-secondary hover:border-border-hover transition-colors"
                                >
                                    Stay here
                                </button>
                                <button
                                    onClick={() => {
                                        setShowLocalConfirm(false);
                                        goToNextStep();
                                    }}
                                    className="rounded-lg bg-amber-400 px-4 py-2 text-[12px] font-semibold text-black hover:bg-amber-300 transition-colors"
                                >
                                    Continue anyway
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>


            <FAQModal isOpen={showFAQModal} onClose={() => setShowFAQModal(false)} />

            {currentStepIndex > 0 && (
                <button
                    onClick={goToPrevStep}
                    className="absolute left-6 bottom-6 flex items-center gap-1 text-xs text-content-muted hover:text-content-muted transition-colors"
                >
                    <ChevronLeft size={14} />
                    Back
                </button>
            )}
        </div>
    );
};

const ModelProgress = ({ percent, status }: { percent: number; status: string }) => {
    const cols = 50;
    const rows = 3;
    const totalDots = cols * rows;
    const activeCount = Math.round((percent / 100) * totalDots);

    const activeDots = useMemo(() => {
        const dots: number[] = [];
        for (let i = 0; i < activeCount && i < totalDots; i++) {
            dots.push(i);
        }
        return dots;
    }, [activeCount, totalDots]);

    const color = status === "error" ? "var(--color-error)" : status === "complete" ? "var(--color-success)" : "var(--color-cloud)";

    return (
        <DotMatrix
            rows={rows}
            cols={cols}
            activeDots={activeDots}
            dotSize={3}
            gap={2}
            color={color}
            className="opacity-70"
        />
    );
};

export default Onboarding;
