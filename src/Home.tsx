import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, ChevronLeft, Home as HomeIcon, Book, Brain, User, Info, HelpCircle, Github, X, ArrowUpCircle, Library } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import SettingsModal from "./components/settings/SettingsModal";
import FAQModal from "./components/FAQModal";
import DotMatrix from "./components/DotMatrix";
import TranscriptionList from "./components/TranscriptionList";
import DictionaryView from "./components/DictionaryView";
import PersonalizationView from "./components/PersonalizationView";
import LibraryView from "./components/LibraryView";
import { useAuth } from "./hooks/useAuth";
import type { TranscriptionMode, StoredSettings } from "./types";

const SidebarItem = ({
    icon,
    label,
    active = false,
    collapsed,
    onClick
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    collapsed: boolean;
    onClick?: () => void;
}) => (
    <button
        onClick={onClick}
        className={`group flex w-full items-center rounded-lg h-9 pl-[17px] pr-3 ${collapsed ? "gap-0" : "gap-3"
            } ${active
                ? "bg-surface-elevated text-content-primary"
                : "text-content-muted hover:bg-surface-overlay hover:text-content-secondary"
            }`}
    >
        <div className={`flex items-center justify-center w-[18px] shrink-0 ${active ? "text-content-primary" : "group-hover:text-content-secondary"}`}>
            {icon}
        </div>
        <span
            style={{ width: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 }}
            className="text-[13px] font-medium whitespace-nowrap overflow-hidden transition-[width,opacity] duration-200 ease-out"
        >
            {label}
        </span>
    </button>
);

const Home = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<"general" | "account" | "models" | "about">("general");
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
    const [activeView, setActiveView] = useState<"home" | "dictionary" | "brain" | "library">("home");
    const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>("local");
    const { user: currentUser, refresh: refreshUser } = useAuth();
    const [showSupportPopup, setShowSupportPopup] = useState(false);
    const [showFAQ, setShowFAQ] = useState(false);
    const [appVersion, setAppVersion] = useState("-");
    const popupRef = useRef<HTMLDivElement>(null);
    const supportButtonRef = useRef<HTMLButtonElement>(null);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    const [llmCleanupEnabled, setLlmCleanupEnabled] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [pendingImportPaths, setPendingImportPaths] = useState<string[] | null>(null);

    const sidebarWidth = isSidebarCollapsed ? 68 : 200;

    useEffect(() => {
        let unlistenSettings: UnlistenFn | null = null;
        let unlistenNavigate: UnlistenFn | null = null;
        let unlistenModels: UnlistenFn | null = null;
        let unlistenDragEnter: UnlistenFn | null = null;
        let unlistenDragOver: UnlistenFn | null = null;
        let unlistenDragLeave: UnlistenFn | null = null;
        let unlistenDragDrop: UnlistenFn | null = null;
        let unlistenOpenImport: UnlistenFn | null = null;

        const loadSettings = async () => {
            try {
                const settings = await invoke<StoredSettings & { llm_cleanup_enabled: boolean }>("get_settings");
                setTranscriptionMode(settings.transcription_mode);
                setLlmCleanupEnabled(settings.llm_cleanup_enabled);
            } catch (err) {
                console.error("Failed to load settings:", err);
            }
        };

        loadSettings();

        invoke<{ version: string }>("get_app_info")
            .then((info) => setAppVersion(info.version))
            .catch((err) => console.error("Failed to load app version:", err));

        listen<StoredSettings & { llm_cleanup_enabled: boolean }>("settings:changed", (event) => {
            setTranscriptionMode(event.payload.transcription_mode);
            setLlmCleanupEnabled(event.payload.llm_cleanup_enabled);
        }).then((fn) => {
            unlistenSettings = fn;
        });

        listen("navigate:about", () => {
            setSettingsTab("about");
            setIsSettingsOpen(true);
            setTimeout(() => {
                emit("updater:check");
            }, 100);
        }).then((fn) => {
            unlistenNavigate = fn;
        });

        listen("navigate:models", () => {
            setSettingsTab("models");
            setIsSettingsOpen(true);
        }).then((fn) => {
            unlistenModels = fn;
        });

        listen<{ paths?: string[] }>("tauri://drag-enter", (event) => {
            if (event.payload?.paths?.length) {
                setDragActive(true);
            }
        }).then((fn) => {
            unlistenDragEnter = fn;
        });

        listen<{ paths?: string[] }>("tauri://drag-over", (event) => {
            if (event.payload?.paths?.length) {
                setDragActive(true);
            }
        }).then((fn) => {
            unlistenDragOver = fn;
        });

        listen("tauri://drag-leave", () => {
            setDragActive(false);
        }).then((fn) => {
            unlistenDragLeave = fn;
        });

        listen<{ paths?: string[] }>("tauri://drag-drop", (event) => {
            setDragActive(false);
            if (event.payload?.paths?.length) {
                setPendingImportPaths(Array.from(new Set(event.payload.paths)));
                setActiveView("library");
            }
        }).then((fn) => {
            unlistenDragDrop = fn;
        });

        listen<string[]>("library:open_import", (event) => {
            if (event.payload?.length) {
                setPendingImportPaths(Array.from(new Set(event.payload)));
                setActiveView("library");
            }
        }).then((fn) => {
            unlistenOpenImport = fn;
        });

        let unlistenSignIn: UnlistenFn | null = null;
        listen("navigate:sign-in", () => {
            setSettingsTab("account");
            setIsSettingsOpen(true);
        }).then((fn) => {
            unlistenSignIn = fn;
        });

        return () => {
            unlistenSettings?.();
            unlistenNavigate?.();
            unlistenModels?.();
            unlistenDragEnter?.();
            unlistenDragOver?.();
            unlistenDragLeave?.();
            unlistenDragDrop?.();
            unlistenOpenImport?.();
            unlistenSignIn?.();
        };
    }, []);

    useEffect(() => {
        let unlistenUpdate: UnlistenFn | null = null;
        let unlistenCleared: UnlistenFn | null = null;

        const checkUpdateStatus = async () => {
            try {
                const status = await invoke<{ available: boolean; version: string | null }>("get_update_status");
                setUpdateAvailable(status.available);
            } catch (err) {
                console.error("Failed to check update status:", err);
            }
        };

        checkUpdateStatus();

        listen<string>("update:available", () => {
            setUpdateAvailable(true);
        }).then((fn) => {
            unlistenUpdate = fn;
        });

        listen("update:cleared", () => {
            setUpdateAvailable(false);
        }).then((fn) => {
            unlistenCleared = fn;
        });

        return () => {
            unlistenUpdate?.();
            unlistenCleared?.();
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                popupRef.current &&
                !popupRef.current.contains(event.target as Node) &&
                !supportButtonRef.current?.contains(event.target as Node)
            ) {
                setShowSupportPopup(false);
            }
        };

        if (showSupportPopup) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [showSupportPopup]);

    useEffect(() => {
        const handleCopy = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if (!((event.metaKey || event.ctrlKey) && key === "c")) return;

            const active = document.activeElement as HTMLElement | null;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
            ) {
                return;
            }

            const selection = window.getSelection();
            const text = selection?.toString() ?? "";
            if (!text.trim()) return;

            event.preventDefault();
            navigator.clipboard.writeText(text).catch((err) => {
                console.error("Failed to copy selection:", err);
            });
        };

        document.addEventListener("keydown", handleCopy);
        return () => document.removeEventListener("keydown", handleCopy);
    }, []);

    const isCloudMode = transcriptionMode === "cloud";
    const logoColor = isCloudMode ? "var(--color-cloud)" : "var(--color-local)";
    const logoActiveDots = isCloudMode ? [0, 3] : [1, 2];

    const showLlmButtons = isCloudMode || llmCleanupEnabled;

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    };

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-surface-tertiary font-sans text-white select-none">
            <aside
                data-app-sidebar
                style={{ width: sidebarWidth }}
                className="relative flex flex-col border-r border-border-primary bg-surface-secondary shrink-0 transition-[width] duration-200 ease-out will-change-[width]"
            >
                <div data-tauri-drag-region className="h-8 w-full shrink-0" />

                <div className="pl-6 pb-6 pt-1">
                    <div className="flex items-center gap-3 h-6">
                        <div className="shrink-0">
                            <DotMatrix
                                rows={2}
                                cols={2}
                                activeDots={logoActiveDots}
                                dotSize={4}
                                gap={3}
                                color={logoColor}
                            />
                        </div>
                        <span
                            style={{ width: isSidebarCollapsed ? 0 : 'auto', opacity: isSidebarCollapsed ? 0 : 1 }}
                            className="text-[14px] font-bold tracking-wide text-content-primary whitespace-nowrap overflow-hidden transition-[width,opacity] duration-200 ease-out"
                        >
                            Glimpse
                        </span>
                    </div>
                </div>

                <nav className="flex-1 px-2 space-y-1">
                    <SidebarItem
                        icon={<HomeIcon size={18} />}
                        label="Home"
                        active={activeView === "home"}
                        collapsed={isSidebarCollapsed}
                        onClick={() => setActiveView("home")}
                    />
                    <SidebarItem
                        icon={<Book size={18} />}
                        label="Dictionary"
                        active={activeView === "dictionary"}
                        collapsed={isSidebarCollapsed}
                        onClick={() => setActiveView("dictionary")}
                    />
                    <SidebarItem
                        icon={<Brain size={18} />}
                        label="Personalization"
                        active={activeView === "brain"}
                        collapsed={isSidebarCollapsed}
                        onClick={() => setActiveView("brain")}
                    />

                    <div className="pt-3">
                        <div className="h-px bg-border-primary mx-4 mb-3" />
                        <SidebarItem
                            icon={<Library size={18} />}
                            label="Library"
                            active={activeView === "library"}
                            collapsed={isSidebarCollapsed}
                            onClick={() => setActiveView("library")}
                        />
                    </div>
                </nav>

                <div className="p-2 space-y-1 border-t border-border-primary">
                    <button
                        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                        className="flex w-full items-center rounded-lg h-9 pl-[17px] text-content-disabled hover:text-content-muted"
                        aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                        <div className="flex items-center justify-center w-[18px]">
                            <motion.div
                                animate={{ rotate: isSidebarCollapsed ? 180 : 0 }}
                                transition={{ type: "tween", duration: 0.2 }}
                            >
                                <ChevronLeft size={16} />
                            </motion.div>
                        </div>
                    </button>

                    <div className="relative">
                        <button
                            ref={supportButtonRef}
                            onClick={() => setShowSupportPopup(!showSupportPopup)}
                            className={`group flex w-full items-center rounded-lg h-9 pl-[17px] pr-3 text-content-muted hover:bg-surface-overlay hover:text-content-secondary ${isSidebarCollapsed ? "gap-0" : "gap-3"
                                }`}
                            aria-expanded={showSupportPopup}
                            aria-haspopup="menu"
                            aria-label="Support menu"
                        >
                            <div className="flex items-center justify-center w-[18px] shrink-0 group-hover:text-content-secondary">
                                <Info size={18} />
                            </div>
                            <span
                                style={{ width: isSidebarCollapsed ? 0 : 'auto', opacity: isSidebarCollapsed ? 0 : 1 }}
                                className="text-[13px] font-medium whitespace-nowrap overflow-hidden transition-[width,opacity] duration-200 ease-out"
                            >
                                Support
                            </span>
                        </button>

                        <AnimatePresence>
                            {showSupportPopup && (
                                <motion.div
                                    ref={popupRef}
                                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                    transition={{ duration: 0.15, ease: "easeOut" }}
                                    className="absolute bottom-full left-2 mb-2 w-56 bg-surface-surface border border-border-secondary rounded-xl shadow-xl overflow-hidden z-50"
                                >
                                    <div className="p-3 border-b border-border-primary">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[12px] font-medium text-content-primary">Get Support</span>
                                            <button
                                                onClick={() => setShowSupportPopup(false)}
                                                className="p-1 rounded-md hover:bg-surface-elevated text-content-muted hover:text-content-secondary transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-2 space-y-1">
                                        <button
                                            onClick={() => {
                                                setShowSupportPopup(false);
                                                setShowFAQ(true);
                                            }}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors group w-full text-left"
                                        >
                                            <HelpCircle size={16} className="text-amber-400" />
                                            <div>
                                                <div className="text-[12px] font-medium text-content-primary">FAQ</div>
                                                <div className="text-[10px] text-content-muted">Common questions</div>
                                            </div>
                                        </button>
                                        <a
                                            href="https://github.com/LegendarySpy/Glimpse/issues/new/choose"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={() => setShowSupportPopup(false)}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors group"
                                        >
                                            <Github size={16} className="text-content-secondary" />
                                            <div>
                                                <div className="text-[12px] font-medium text-content-primary">GitHub Issues</div>
                                                <div className="text-[10px] text-content-muted">Report bugs & request features</div>
                                            </div>
                                        </a>
                                        <button
                                            onClick={() => {
                                                setShowSupportPopup(false);
                                                setSettingsTab("about");
                                                setIsSettingsOpen(true);
                                            }}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors group w-full text-left"
                                        >
                                            <Info size={16} className="text-[#5865F2]" />
                                            <div>
                                                <div className="text-[12px] font-medium text-content-primary">About</div>
                                                <div className="text-[10px] text-content-muted">v{appVersion} • {isCloudMode ? "Cloud" : "Local"}</div>
                                            </div>
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {updateAvailable && (
                        <button
                            onClick={() => {
                                setSettingsTab("about");
                                setIsSettingsOpen(true);
                            }}
                            className={`group flex w-full items-center rounded-lg h-9 pl-[17px] pr-3 ${isSidebarCollapsed ? "gap-0" : "gap-3"} hover:bg-surface-overlay transition-colors`}
                            style={{ color: "var(--color-accent)" }}
                        >
                            <div className="flex items-center justify-center w-[18px] shrink-0">
                                <ArrowUpCircle size={18} />
                            </div>
                            <span
                                style={{ width: isSidebarCollapsed ? 0 : 'auto', opacity: isSidebarCollapsed ? 0 : 1 }}
                                className="text-[13px] font-medium whitespace-nowrap overflow-hidden transition-[width,opacity] duration-200 ease-out"
                            >
                                Update available
                            </span>
                        </button>
                    )}

                    <SidebarItem
                        icon={<Settings size={18} />}
                        label="Settings"
                        collapsed={isSidebarCollapsed}
                        onClick={() => setIsSettingsOpen(true)}
                    />
                </div>
            </aside>

            <main className="flex flex-1 flex-col min-w-0 bg-surface-tertiary overflow-hidden relative will-change-contents">
                <div data-tauri-drag-region className="h-8 w-full shrink-0" />

                {currentUser && (
                    <button
                        onClick={() => {
                            setSettingsTab("account");
                            setIsSettingsOpen(true);
                        }}
                        className="fixed top-10 right-6 flex items-center gap-2 px-3 py-1.5 rounded-full border border-border-primary bg-surface-surface hover:bg-surface-overlay hover:border-border-secondary transition-colors z-10"
                    >
                        <div className="w-6 h-6 rounded-full bg-surface-elevated border border-border-secondary flex items-center justify-center overflow-hidden">
                            {(currentUser.prefs as Record<string, string>)?.avatar ? (
                                <img
                                    src={(currentUser.prefs as Record<string, string>).avatar}
                                    alt=""
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <User size={14} className="text-content-muted" />
                            )}
                        </div>
                        <span className="text-[10px] text-content-secondary max-w-[100px] truncate">
                            {currentUser.name || currentUser.email?.split("@")[0] || "Account"}
                        </span>
                    </button>
                )}

                <div className="flex-1 flex flex-col px-12 pb-16 min-h-0">
                    <div className={`w-full max-w-2xl mx-auto pt-8 ${activeView === "home" ? "" : "hidden"}`}>
                        <div className="mb-8">
                            <h1 className="text-3xl font-medium text-content-primary tracking-tight">
                                {getGreeting()}
                            </h1>
                            <p className="mt-2 text-[15px] text-content-muted pl-[2px]">
                                Ready when you are
                            </p>
                        </div>

                        <TranscriptionList showLlmButtons={showLlmButtons} />
                    </div>

                    <div className={`w-full max-w-3xl mx-auto pt-8 ${activeView === "dictionary" ? "" : "hidden"}`}>
                        <DictionaryView />
                    </div>

                    <div className={`w-full max-w-5xl mx-auto pt-8 ${activeView === "brain" ? "" : "hidden"}`}>
                        <PersonalizationView />
                    </div>

                    <div className={`w-full pt-8 flex-1 min-h-0 ${activeView === "library" ? "" : "hidden"}`}>
                        <LibraryView
                            pendingImportPaths={pendingImportPaths}
                            onSetImportPaths={setPendingImportPaths}
                            sidebarWidth={sidebarWidth}
                        />
                    </div>
                </div>
            </main>

            <AnimatePresence>
                {dragActive && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ scale: 0.96, y: 12 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.96, y: 12 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="flex flex-col items-center justify-center rounded-2xl border border-border-secondary bg-surface-overlay px-8 py-6 shadow-2xl"
                        >
                            <div className="text-[12px] uppercase tracking-[0.2em] text-content-muted">
                                Library Import
                            </div>
                            <div className="mt-2 text-[16px] font-medium text-content-primary">
                                Drop files to transcribe
                            </div>
                            <div className="mt-1 text-[12px] text-content-disabled">
                                MP3, WAV, M4A, MP4, MOV, and more
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => {
                    setIsSettingsOpen(false);
                    setSettingsTab("general");
                }}
                initialTab={settingsTab}
                currentUser={currentUser}
                onUpdateUser={refreshUser}
                transcriptionMode={transcriptionMode}
            />

            <FAQModal
                isOpen={showFAQ}
                onClose={() => setShowFAQ(false)}
            />
        </div>
    );
};

export default Home;
