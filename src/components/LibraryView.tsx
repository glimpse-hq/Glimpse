import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Howl } from "howler";
import {
    AlertTriangle,
    Check,
    ChevronDown,
    CornerDownRight,
    Copy,
    FolderOpen,
    Loader2,
    MoreVertical,
    Pause,
    Pencil,
    Play,
    Plus,
    RotateCw,
    Search,
    Trash2,
    X,
} from "lucide-react";
import DotMatrix from "./DotMatrix";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { useLibraryItems } from "../hooks/useLibraryItems";
import type {
    ExportFormat,
    LibraryImportOptions,
    LibraryItem,
    LibraryItemPatch,
    LibraryItemStatus,
    ModelInfo,
    ModelStatus,
    StoredSettings,
} from "../types";

const SUPPORTED_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4", "mov", "webm", "mkv"];

type LibraryViewProps = {
    pendingImportPaths: string[] | null;
    onSetImportPaths: (paths: string[] | null) => void;
    sidebarWidth: number;
};

const statusLabel = (status: LibraryItemStatus) => {
    switch (status.type) {
        case "pending":
            return "Queued";
        case "importing":
            return "Converting";
        case "transcribing":
            return status.progress < 0.01
                ? "Starting..."
                : `${Math.round(status.progress * 100)}%`;
        case "complete":
            return "Done";
        case "cancelling":
            return "Canceling...";
        case "cancelled":
            return "Canceled";
        case "error":
            return "Failed";
        default:
            return "Queued";
    }
};

const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const isTimestampSupported = (model?: ModelInfo | null) =>
    model ? !model.engine.toLowerCase().includes("moonshine") : false;

const getFileExtension = (path: string) => {
    const parts = path.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
};

const uniquePaths = (paths: string[]) => Array.from(new Set(paths));
const sanitizeFileName = (value: string) =>
    value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");

const formatImportErrorMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return "Import failed for one of the files.";

    const lower = message.toLowerCase();
    if (lower.includes("selected model is not installed")) {
        return "Selected model isn't installed. Download one in Settings → Models.";
    }
    if (lower.includes("file not found")) {
        return "File not found. It may have moved or been deleted.";
    }
    if (lower.includes("unsupported file format")) {
        return "Unsupported file format.";
    }
    if (lower.includes("no supported audio tracks")) {
        return "No audio track found in this file.";
    }
    if (
        lower.includes("audio decode failed")
        || lower.includes("failed to read audio container")
        || lower.includes("unsupported audio codec")
        || lower.includes("no audio samples decoded")
    ) {
        return "Couldn't decode this audio file. Try installing FFmpeg.";
    }
    if (lower.includes("failed to create library folder")) {
        return "Couldn't create library storage. Check disk permissions.";
    }
    if (lower.includes("failed to copy original file")) {
        return "Couldn't copy the original file into the library.";
    }
    if (
        lower.includes("wav writer init failed")
        || lower.includes("wav finalize error")
        || lower.includes("wav write error")
    ) {
        return "Couldn't convert this file to audio for transcription.";
    }
    if (lower.includes("invalid sample rate") || lower.includes("unknown sample rate")) {
        return "This file has an unsupported sample rate.";
    }

    return "Import failed for one of the files.";
};

const formatDeleteErrorMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return "Failed to delete the library item.";

    const lower = message.toLowerCase();
    if (lower.includes("outside the library folder")) {
        return "Couldn't delete this item because its files are outside the library folder.";
    }
    if (lower.includes("storage location")) {
        return "Couldn't delete this item. Library storage couldn't be found.";
    }
    if (lower.includes("delete library files") || lower.includes("delete library file")) {
        return "Couldn't delete the library files. Check permissions and try again.";
    }
    if (lower.includes("invalid library file path")) {
        return "Couldn't delete this item due to an invalid file path.";
    }

    return "Failed to delete the library item.";
};

const LibraryView = ({ pendingImportPaths, onSetImportPaths, sidebarWidth }: LibraryViewProps) => {
    const {
        items,
        isLoading,
        isLoadingMore,
        error,
        hasMore,
        createItem,
        updateItem,
        deleteItem,
        cancelTranscription,
        retryTranscription,
        exportItem,
        loadMore,
        refresh,
        setFilter,
    } = useLibraryItems();

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [dateFilter, setDateFilter] = useState<string>("all");
    const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
    const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
    const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({});
    const [defaultModelKey, setDefaultModelKey] = useState<string>("");
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [shiftHeld, setShiftHeld] = useState(false);
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingNameDraft, setEditingNameDraft] = useState("");
    const [editingTagId, setEditingTagId] = useState<string | null>(null);
    const [tagDraft, setTagDraft] = useState("");

    const refreshTags = useCallback(() => {
        return invoke<string[]>("get_library_tags")
            .then((tags) => setAvailableTags(tags))
            .catch((err) => console.error("Failed to load tags:", err));
    }, []);

    const updateItemWithTags = useCallback(async (id: string, patch: LibraryItemPatch) => {
        const updated = await updateItem(id, patch);
        if (patch.tags != null) {
            refreshTags();
        }
        return updated;
    }, [refreshTags, updateItem]);

    const deleteItemAndRefreshTags = useCallback(async (id: string) => {
        try {
            await deleteItem(id);
            refreshTags();
        } catch (err) {
            console.error("Failed to delete library item:", err);
            const message = err instanceof Error ? err.message : String(err);
            invoke("debug_show_toast", {
                toastType: "error",
                message: formatDeleteErrorMessage(message),
            }).catch(() => { });
        }
    }, [deleteItem, refreshTags]);

    const installedModels = useMemo(() => {
        return modelCatalog.filter((model) => modelStatus[model.key]?.installed);
    }, [modelCatalog, modelStatus]);

    useEffect(() => {
        const timer = setTimeout(() => {
            const sinceDays =
                dateFilter === "last7" ? 7 : dateFilter === "last30" ? 30 : null;
            setFilter({
                search: searchQuery || null,
                status: statusFilter === "all" ? null : statusFilter,
                tag: tagFilter === "all" ? null : tagFilter,
                since_days: sinceDays,
            });
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, statusFilter, tagFilter, dateFilter, setFilter]);

    const refreshModelStatus = useCallback((modelKey: string) => {
        invoke<ModelStatus>("check_model_status", { model: modelKey })
            .then((status) => {
                setModelStatus((prev) => ({ ...prev, [modelKey]: status }));
            })
            .catch((err) => {
                console.error("Failed to check model status:", err);
                setModelStatus((prev) => ({
                    ...prev,
                    [modelKey]: {
                        key: modelKey,
                        installed: false,
                        bytes_on_disk: 0,
                        missing_files: [],
                        directory: "",
                    },
                }));
            });
    }, []);

    useEffect(() => {
        invoke<ModelInfo[]>("list_models")
            .then((models) => {
                setModelCatalog(models);
                models.forEach((model) => refreshModelStatus(model.key));
            })
            .catch((err) => console.error("Failed to list models:", err));

        invoke<StoredSettings>("get_settings")
            .then((settings) => {
                setDefaultModelKey(settings.local_model);
            })
            .catch((err) => console.error("Failed to load settings:", err));
    }, [refreshModelStatus]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Shift") setShiftHeld(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Shift") setShiftHeld(false);
        };
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    useEffect(() => {
        let unlistenComplete: UnlistenFn | null = null;
        let unlistenError: UnlistenFn | null = null;

        const setup = async () => {
            unlistenComplete = await listen<{ model: string }>("download:complete", (event) => {
                refreshModelStatus(event.payload.model);
            });
            unlistenError = await listen<{ model: string }>("download:error", (event) => {
                refreshModelStatus(event.payload.model);
            });
        };

        setup();

        return () => {
            unlistenComplete?.();
            unlistenError?.();
        };
    }, [refreshModelStatus]);

    useEffect(() => {
        refreshTags();
    }, [refreshTags]);

    useEffect(() => {
        if (!selectedItem) return;
        const updated = items.find((item) => item.id === selectedItem.id);
        if (updated && updated !== selectedItem) {
            setSelectedItem(updated);
        }
        if (!updated) {
            setSelectedItem(null);
        }
    }, [items, selectedItem]);

    useEffect(() => {
        if (!selectedItem) return;

        const handleSidebarClick = (event: MouseEvent) => {
            const sidebar = document.querySelector("[data-app-sidebar]");
            if (sidebar && sidebar.contains(event.target as Node)) {
                setSelectedItem(null);
            }
        };

        document.addEventListener("mousedown", handleSidebarClick);
        return () => document.removeEventListener("mousedown", handleSidebarClick);
    }, [selectedItem]);

    const handleImportClick = async () => {
        try {
            const selection = await open({
                multiple: true,
                filters: [
                    {
                        name: "Audio & Video",
                        extensions: SUPPORTED_EXTENSIONS,
                    },
                ],
            });

            if (!selection) return;

            const paths = Array.isArray(selection) ? selection : [selection];
            if (paths.length > 0) {
                onSetImportPaths(uniquePaths(paths));
            }
        } catch (err) {
            console.error("Failed to open import dialog:", err);
            invoke("debug_show_toast", {
                toastType: "error",
                message: "Could not open the import dialog.",
            }).catch(() => { });
        }
    };

    const startTagEdit = (item: LibraryItem) => {
        setEditingTagId(item.id);
        setTagDraft("");
    };

    const startNameEdit = (item: LibraryItem) => {
        setEditingNameId(item.id);
        setEditingNameDraft(item.name);
    };

    const cancelNameEdit = () => {
        setEditingNameId(null);
        setEditingNameDraft("");
    };

    const commitNameEdit = async (itemId: string) => {
        const nextName = editingNameDraft.trim();
        const original = items.find((entry) => entry.id === itemId)?.name ?? "";
        setEditingNameId(null);
        setEditingNameDraft("");
        if (!nextName || nextName === original) return;
        await updateItemWithTags(itemId, { name: nextName });
    };

    const cancelTagEdit = () => {
        setEditingTagId(null);
        setTagDraft("");
    };

    const commitTagAdd = async (itemId: string) => {
        const nextTag = tagDraft.trim();
        if (!nextTag) {
            setEditingTagId(null);
            setTagDraft("");
            return;
        }
        const item = items.find((entry) => entry.id === itemId);
        if (!item) return;
        if (item.tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
            setTagDraft("");
            setEditingTagId(null);
            return;
        }
        await updateItemWithTags(itemId, { tags: [...item.tags, nextTag] });
        setTagDraft("");
        setEditingTagId(null);
    };

    const selectedModel = installedModels.find((model) => model.key === defaultModelKey) ?? installedModels[0];

    return (
        <div className="relative flex flex-1 flex-col min-h-0 h-full">
            <div className="w-full max-w-5xl mx-auto flex flex-col gap-4 pb-4 text-left">
                <header className="flex items-start gap-3 mb-4">
                    <DotMatrix
                        rows={2}
                        cols={3}
                        activeDots={[0, 1, 2, 4]}
                        dotSize={3}
                        gap={3}
                        color="var(--color-accent)"
                    />
                    <div className="flex-1">
                        <p className="text-2xl font-medium text-content-primary tracking-tight">Library</p>
                        <p className="mt-1 text-[12px] text-content-secondary">
                            Import audio and video files for transcription.
                        </p>
                    </div>
                </header>
                <div className="flex flex-wrap items-center justify-center gap-2 gap-y-2 w-full max-w-5xl">
                    <button
                        onClick={handleImportClick}
                        className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-2 text-[12px] text-content-primary hover:border-border-secondary hover:bg-surface-overlay transition-colors shrink-0"
                    >
                        <Plus size={14} />
                        Import
                    </button>
                    <div className="relative">
                        <div className="relative flex items-center gap-2 bg-surface-secondary border border-border-primary rounded-lg px-2.5 py-2 focus-within:border-border-secondary transition-colors">
                            <Search size={12} className="text-content-disabled shrink-0" aria-hidden="true" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search library..."
                                aria-label="Search library"
                                className="bg-transparent text-[11px] text-content-secondary placeholder-content-disabled outline-none w-32 sm:w-40 md:w-44"
                            />
                        </div>
                    </div>
                    <Dropdown
                        value={statusFilter}
                        onChange={(value) => setStatusFilter(value)}
                        options={[
                            { value: "all", label: "All" },
                            { value: "importing", label: "Converting" },
                            { value: "pending", label: "Queued" },
                            { value: "transcribing", label: "Transcribing" },
                            { value: "complete", label: "Done" },
                            { value: "error", label: "Failed" },
                        ]}
                        className="w-[120px]"
                    />
                    <Dropdown
                        value={dateFilter}
                        onChange={(value) => setDateFilter(value)}
                        options={[
                            { value: "all", label: "All time" },
                            { value: "last7", label: "Last 7 days" },
                            { value: "last30", label: "Last 30 days" },
                        ]}
                        className="w-[120px]"
                    />
                    <Dropdown
                        value={tagFilter}
                        onChange={(value) => setTagFilter(value)}
                        options={[
                            { value: "all", label: "All tags" },
                            ...availableTags.map((tag) => ({ value: tag, label: tag })),
                        ]}
                        className="w-[120px]"
                    />
                </div>

                {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
                        {error}
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden custom-scrollbar scrollbar-gutter pb-6 pr-3">
                <motion.div
                    key="library-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col gap-6 w-full"
                >
                    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                        {isLoading && items.length === 0 && (
                            <div className="col-span-full py-12 flex items-center justify-center">
                                <DotMatrix
                                    rows={2}
                                    cols={8}
                                    activeDots={[0, 1, 2, 3, 4, 5, 6, 7]}
                                    dotSize={3}
                                    gap={3}
                                    color="var(--color-text-muted)"
                                    animated
                                    className="opacity-50"
                                />
                            </div>
                        )}

                        {!isLoading && items.length === 0 && (
                            <div className="col-span-full rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-8 flex flex-col items-center justify-center text-center">
                                <FolderOpen size={20} className="text-content-disabled" />
                                <p className="mt-3 text-[13px] text-content-muted">
                                    Drag files here to build your Library.
                                </p>
                            </div>
                        )}

                        {items.map((item) => (
                            <LibraryCard
                                key={item.id}
                                item={item}
                                onOpen={() => setSelectedItem(item)}
                                editingNameId={editingNameId}
                                editingNameDraft={editingNameDraft}
                                onStartNameEdit={() => startNameEdit(item)}
                                onChangeNameDraft={setEditingNameDraft}
                                onCommitNameEdit={() => commitNameEdit(item.id)}
                                onCancelNameEdit={cancelNameEdit}
                                onRetry={() => retryTranscription(item.id)}
                                onCancel={() => cancelTranscription(item.id)}
                                onDelete={async () => {
                                    await deleteItemAndRefreshTags(item.id);
                                    if (selectedItem?.id === item.id) {
                                        setSelectedItem(null);
                                    }
                                }}
                                editingTagId={editingTagId}
                                tagDraft={tagDraft}
                                onStartTagEdit={() => startTagEdit(item)}
                                onChangeTagDraft={setTagDraft}
                                onCommitTagAdd={() => commitTagAdd(item.id)}
                                onCancelTagEdit={cancelTagEdit}
                                shiftHeld={shiftHeld}
                            />
                        ))}

                        {items.length > 0 && (
                            <button
                                onClick={handleImportClick}
                                className="rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-4 flex flex-col items-center justify-center text-center text-content-muted hover:text-content-secondary hover:border-border-hover transition-colors"
                            >
                                <FolderOpen size={18} />
                                <span className="mt-2 text-[12px]">Drop files to import</span>
                            </button>
                        )}

                            {items.length > 0 && hasMore && (
                                <div className="col-span-full flex items-center justify-center pt-2">
                                    <button
                                        onClick={loadMore}
                                        disabled={isLoadingMore}
                                        className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-4 py-2 text-[12px] text-content-secondary hover:text-content-primary hover:border-border-secondary hover:bg-surface-overlay transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isLoadingMore ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                <span>Loading...</span>
                                            </>
                                        ) : (
                                            <span>Load more</span>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>

            <AnimatePresence>
                {selectedItem && (
                    <motion.div
                        key="library-detail"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed top-0 right-0 bottom-0 z-20 flex items-center justify-center p-6 transition-[left] duration-200 ease-out"
                        style={{ left: sidebarWidth, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
                        onClick={() => setSelectedItem(null)}
                    >
                        <div className="w-full h-full min-h-0" onClick={(e) => e.stopPropagation()}>
                            <LibraryModal
                                item={selectedItem}
                                models={installedModels}
                                onClose={() => setSelectedItem(null)}
                                onDelete={async () => {
                                    await deleteItemAndRefreshTags(selectedItem.id);
                                    setSelectedItem(null);
                                }}
                                onRetry={() => retryTranscription(selectedItem.id)}
                                onCancel={() => cancelTranscription(selectedItem.id)}
                                onUpdate={(patch) => updateItemWithTags(selectedItem.id, patch)}
                                onExport={(format, outputPath) => exportItem(selectedItem.id, format, outputPath)}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {pendingImportPaths !== null && (
                    <LibraryImportModal
                        paths={pendingImportPaths}
                        models={installedModels}
                        defaultModelKey={selectedModel?.key}
                        onCancel={() => onSetImportPaths(null)}
                        onConfirm={async (paths, options) => {
                            const supported = paths.filter((path) =>
                                SUPPORTED_EXTENSIONS.includes(getFileExtension(path))
                            );
                            const unsupported = paths.filter(
                                (path) => !SUPPORTED_EXTENSIONS.includes(getFileExtension(path))
                            );

                            if (unsupported.length > 0) {
                                invoke("debug_show_toast", {
                                    toastType: "warning",
                                    message: `${unsupported.length} file(s) skipped due to unsupported format.`,
                                }).catch(() => { });
                            }

                            for (const path of supported) {
                                try {
                                    await createItem(path, options);
                                } catch (err) {
                                    console.error("Failed to import file:", err);
                                    const message = err instanceof Error ? err.message : String(err);
                                    const toastMessage = formatImportErrorMessage(message);
                                    invoke("debug_show_toast", {
                                        toastType: "error",
                                        message: toastMessage,
                                    }).catch(() => { });
                                }
                            }

                            await refresh();

                            onSetImportPaths(null);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const LibraryCard = ({
    item,
    onOpen,
    editingNameId,
    editingNameDraft,
    onStartNameEdit,
    onChangeNameDraft,
    onCommitNameEdit,
    onCancelNameEdit,
    onRetry,
    onCancel,
    onDelete,
    editingTagId,
    tagDraft,
    onStartTagEdit,
    onChangeTagDraft,
    onCommitTagAdd,
    onCancelTagEdit,
    shiftHeld,
}: {
    item: LibraryItem;
    onOpen: () => void;
    editingNameId: string | null;
    editingNameDraft: string;
    onStartNameEdit: () => void;
    onChangeNameDraft: (value: string) => void;
    onCommitNameEdit: () => void;
    onCancelNameEdit: () => void;
    onRetry: () => Promise<void>;
    onCancel: () => Promise<void>;
    onDelete: () => Promise<void>;
    editingTagId: string | null;
    tagDraft: string;
    onStartTagEdit: () => void;
    onChangeTagDraft: (value: string) => void;
    onCommitTagAdd: () => void;
    onCancelTagEdit: () => void;
    shiftHeld: boolean;
}) => {
    const status = item.status;
    const tagPreview = item.tags.slice(0, 2);
    const progress =
        status.type === "transcribing" ? Math.min(Math.max(status.progress, 0), 1) : 0;
    const [displayProgress, setDisplayProgress] = useState(progress);
    const displayProgressRef = useRef(progress);
    const isEditingName = editingNameId === item.id;
    const isAddingTag = editingTagId === item.id;
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const statusText = statusLabel(status);

    const handleDelete = async () => {
        setMenuOpen(false);
        try {
            await onDelete();
        } catch (err) {
            console.error("Failed to delete library item:", err);
        }
    };

    const handleRetry = async () => {
        setMenuOpen(false);
        try {
            await onRetry();
        } catch (err) {
            console.error("Failed to retry library transcription:", err);
        }
    };

    const handleCancel = async () => {
        setMenuOpen(false);
        try {
            await onCancel();
        } catch (err) {
            console.error("Failed to cancel library transcription:", err);
        }
    };


    const renderStatusControl = () => (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                if (shiftHeld) {
                    handleDelete();
                } else {
                    setMenuOpen((prev) => !prev);
                }
            }}
            className={`p-1.5 rounded-md transition-colors ${
                shiftHeld
                    ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    : "text-content-muted hover:text-content-primary hover:bg-surface-elevated"
            }`}
            aria-label={shiftHeld ? "Delete" : "More options"}
            title={shiftHeld ? "Delete" : "More options"}
        >
            {shiftHeld ? <Trash2 size={14} /> : <MoreVertical size={14} />}
        </button>
    );

    useEffect(() => {
        if (status.type !== "transcribing") {
            displayProgressRef.current = 0;
            setDisplayProgress(0);
            return;
        }

        const start = displayProgressRef.current;
        const target = progress;
        if (target <= start) {
            displayProgressRef.current = target;
            setDisplayProgress(target);
            return;
        }

        const durationMs = 420;
        let frame = 0;
        const startTime = performance.now();
        const tick = (now: number) => {
            const t = Math.min((now - startTime) / durationMs, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const nextValue = start + (target - start) * eased;
            setDisplayProgress(nextValue);
            if (t < 1) {
                frame = requestAnimationFrame(tick);
            } else {
                displayProgressRef.current = target;
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [progress, status.type]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        if (menuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuOpen]);

    return (
        <div
            onClick={() => {
                if (!isEditingName && !isAddingTag) {
                    onOpen();
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                if (shiftHeld) {
                    void handleDelete();
                } else {
                    setMenuOpen(true);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!isEditingName && !isAddingTag) {
                        onOpen();
                    }
                }
            }}
            role="button"
            tabIndex={0}
            className="group text-left rounded-xl border border-border-primary bg-surface-secondary p-4 hover:bg-surface-surface transition-colors outline-none focus-visible:ring-2 focus-visible:ring-border-hover"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {isEditingName ? (
                            <input
                                value={editingNameDraft}
                                onChange={(event) => onChangeNameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        onCommitNameEdit();
                                    }
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        onCancelNameEdit();
                                    }
                                }}
                                onBlur={onCommitNameEdit}
                                onClick={(event) => event.stopPropagation()}
                                className="w-full min-w-0 rounded-md border border-border-primary bg-surface-surface px-2 py-1 text-[13px] font-medium text-content-primary outline-none focus:border-border-hover"
                                autoFocus
                            />
                        ) : (
                            <h3 className="text-[13px] font-medium text-content-primary truncate">{item.name}</h3>
                        )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-content-muted">
                        <span>{formatDuration(item.duration_seconds)}</span>
                        <span className="opacity-50">•</span>
                        {status.type === "complete" ? (
                            <Check size={12} className="text-emerald-400" aria-label="Done" />
                        ) : (
                            <span>{statusText}</span>
                        )}
                    </div>
                </div>
                <div ref={menuRef}>{renderStatusControl()}</div>
            </div>
            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className="fixed z-[100] min-w-[160px] rounded-lg border border-border-secondary bg-surface-overlay shadow-xl shadow-black/50"
                        onClick={(event) => event.stopPropagation()}
                        style={{
                            top: menuRef.current ? menuRef.current.getBoundingClientRect().bottom + 4 : 0,
                            right: menuRef.current ? window.innerWidth - menuRef.current.getBoundingClientRect().right : 0,
                        }}
                    >
                        <button
                            onClick={() => {
                                setMenuOpen(false);
                                onStartNameEdit();
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] text-content-secondary hover:bg-surface-elevated transition-colors"
                        >
                            <Pencil size={12} className="text-content-muted" />
                            <span>Rename</span>
                        </button>

                        {status.type === "transcribing"
                            || status.type === "cancelling"
                            || status.type === "pending"
                            || status.type === "importing" ? (
                            <button
                                onClick={handleCancel}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] text-content-secondary hover:bg-surface-elevated transition-colors"
                            >
                                <X size={12} className="text-warning" />
                                <span>Cancel</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleRetry}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] text-content-secondary hover:bg-surface-elevated transition-colors"
                            >
                                <RotateCw size={12} className="text-cloud" />
                                <span>{status.type === "error" ? "Retry" : "Retranscribe"}</span>
                            </button>
                        )}

                        <div className="h-px bg-border-secondary mx-2" />

                        <button
                            onClick={handleDelete}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={12} />
                            <span>Delete</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {(status.type === "transcribing"
                || status.type === "cancelling"
                || status.type === "pending"
                || status.type === "importing") && (
                <div className="mt-3 h-[8px]">
                    {status.type === "transcribing" ? (
                        <LibraryProgressDots progress={displayProgress} />
                    ) : (
                        <div className="h-full" aria-hidden="true" />
                    )}
                </div>
            )}

            {status.type === "error" && (
                <div className="mt-3 text-[11px] text-red-300 line-clamp-2">
                    {status.message}
                </div>
            )}

            <div className="mt-3">
                {isAddingTag ? (
                    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <input
                            value={tagDraft}
                            onChange={(event) => onChangeTagDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    onCommitTagAdd();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    onCancelTagEdit();
                                }
                            }}
                            onBlur={onCancelTagEdit}
                            placeholder="New tag..."
                            className="flex-1 min-w-0 bg-transparent border-b border-border-primary px-0.5 py-0.5 text-[10px] text-content-secondary outline-none focus:border-border-hover placeholder:text-content-disabled"
                            autoFocus
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 flex-wrap gap-y-2">
                        {tagPreview.map((tag, idx) => (
                            <span key={`${tag}-${idx}`} className="inline-flex items-center px-2 py-1 rounded text-[10px] text-content-muted bg-white/5 border border-white/10 leading-none">
                                <span>{tag.length > 12 ? `${tag.slice(0, 12)}...` : tag}</span>
                            </span>
                        ))}
                        {item.tags.length > 2 && (
                            <span className="text-[9px] text-content-disabled">+{item.tags.length - 2}</span>
                        )}
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onStartTagEdit();
                            }}
                            className="flex items-center justify-center w-5 h-5 text-[11px] text-content-disabled hover:text-content-muted transition-colors"
                        >
                            +
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const LibraryProgressDots = ({ progress }: { progress: number }) => {
    const cols = 36;
    const rows = 2;
    const totalDots = cols * rows;
    const activeCount = Math.round(Math.min(Math.max(progress, 0), 1) * totalDots);
    const activeDots = Array.from({ length: Math.min(activeCount, totalDots) }, (_, i) => i);

    return (
        <DotMatrix
            rows={rows}
            cols={cols}
            activeDots={activeDots}
            dotSize={2}
            gap={2}
            color="var(--color-cloud)"
            className="opacity-60"
        />
    );
};

const LibraryModal = ({
    item,
    models,
    onClose,
    onDelete,
    onRetry,
    onCancel,
    onUpdate,
    onExport,
}: {
    item: LibraryItem;
    models: ModelInfo[];
    onClose: () => void;
    onDelete: () => void;
    onRetry: () => Promise<void>;
    onCancel: () => void;
    onUpdate: (patch: LibraryItemPatch) => Promise<LibraryItem>;
    onExport: (format: ExportFormat, outputPath: string) => Promise<void>;
}) => {
    const [nameDraft, setNameDraft] = useState(item.name);
    const [isEditingName, setIsEditingName] = useState(false);
    const [transcriptDraft, setTranscriptDraft] = useState(item.transcript ?? "");
    const [tagInput, setTagInput] = useState("");
    const [showTimestamps, setShowTimestamps] = useState(item.show_timestamps);
    const [followTimestamps, setFollowTimestamps] = useState(true);
    const [exportOpen, setExportOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [copyConfirmed, setCopyConfirmed] = useState(false);
    const [audioDuration, setAudioDuration] = useState(item.duration_seconds || 0);
    const [audioCurrentTime, setAudioCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioReady, setAudioReady] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [streamChunks, setStreamChunks] = useState<string[]>([]);
    const [showRetranscribe, setShowRetranscribe] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSearchIndex, setActiveSearchIndex] = useState(0);
    const [processingPulse, setProcessingPulse] = useState(false);
    const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const howlRef = useRef<Howl | null>(null);
    const streamTranscriptRef = useRef("");
    const scrubWasPlayingRef = useRef(false);
    const scrubValueRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);
    const isScrubbingRef = useRef(false);
    const isPlayingRef = useRef(false);
    const lastTimestampNavRef = useRef(0);
    const segmentsRef = useRef<HTMLDivElement | null>(null);
    const segmentRefs = useRef<Array<HTMLDivElement | null>>([]);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const streamChunkRefs = useRef<Array<HTMLParagraphElement | null>>([]);
    const transcriptAreaRef = useRef<HTMLTextAreaElement | null>(null);
    const followScrollRef = useRef<number | null>(null);

    const modelLabel = models.find((model) => model.key === item.speech_model)?.label ?? item.speech_model;
    const transcriptAvailable = item.status.type === "complete" && (item.transcript ?? "").trim().length > 0;
    const canShowTimestamps = !!item.segments && item.segments.length > 0;
    const isTranscribed = item.status.type === "complete";

    const audioUrl = useMemo(() => convertFileSrc(item.audio_path), [item.audio_path]);

    const stopSeekLoop = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    const startSeekLoop = useCallback(() => {
        stopSeekLoop();
        const tick = () => {
            const sound = howlRef.current;
            if (sound) {
                const playing = sound.playing();
                if (playing !== isPlayingRef.current) {
                    isPlayingRef.current = playing;
                    setIsPlaying(playing);
                }
                if (playing && !isScrubbingRef.current) {
                    const pos = sound.seek();
                    if (typeof pos === "number") {
                        setAudioCurrentTime(pos);
                    }
                }
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [stopSeekLoop]);

    useEffect(() => {
        isScrubbingRef.current = isScrubbing;
    }, [isScrubbing]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        setNameDraft(item.name);
        const nextShowTimestamps = item.show_timestamps && canShowTimestamps;
        setShowTimestamps(nextShowTimestamps);
        setFollowTimestamps(nextShowTimestamps);
        setExportOpen(false);
        setCopyConfirmed(false);
        setShowRetranscribe(false);
        setSearchQuery("");
        setActiveSearchIndex(0);
        setAudioDuration(item.duration_seconds || 0);
        setAudioCurrentTime(0);
        setIsPlaying(false);
        setAudioReady(false);
        setAudioError(null);
        setIsScrubbing(false);
        scrubWasPlayingRef.current = false;
        scrubValueRef.current = null;
    }, [item.id, item.name, item.show_timestamps, item.duration_seconds, canShowTimestamps]);

    useEffect(() => {
        if (!showTimestamps || !canShowTimestamps) {
            setFollowTimestamps(false);
        }
    }, [showTimestamps, canShowTimestamps]);

    useEffect(() => {
        stopSeekLoop();
        if (howlRef.current) {
            howlRef.current.unload();
            howlRef.current = null;
        }

        const sound = new Howl({
            src: [audioUrl],
            html5: true,
            preload: true,
            onload: () => {
                const duration = sound.duration();
                setAudioDuration(Number.isFinite(duration) ? duration : 0);
                setAudioReady(true);
            },
            onloaderror: (_id: number | string, err: unknown) => {
                console.error("Audio load error:", err);
                setAudioError("Audio unavailable");
                setAudioReady(false);
            },
            onplayerror: (_id: number | string, err: unknown) => {
                console.error("Audio play error:", err);
                setAudioError("Audio unavailable");
                setAudioReady(false);
                setIsPlaying(false);
                stopSeekLoop();
            },
            onplay: () => {
                setIsPlaying(true);
                startSeekLoop();
            },
            onpause: () => {
                setIsPlaying(false);
                stopSeekLoop();
            },
            onstop: () => {
                setIsPlaying(false);
                stopSeekLoop();
            },
            onend: () => {
                setIsPlaying(false);
                stopSeekLoop();
                const duration = sound.duration();
                if (Number.isFinite(duration)) {
                    setAudioCurrentTime(duration);
                }
            },
            onseek: () => {
                if (isScrubbingRef.current) return;
                const pos = sound.seek();
                if (typeof pos === "number") {
                    setAudioCurrentTime(pos);
                }
            },
        });

        howlRef.current = sound;

        return () => {
            stopSeekLoop();
            sound.unload();
        };
    }, [audioUrl, item.id, startSeekLoop, stopSeekLoop]);

    useEffect(() => {
        setTranscriptDraft(item.transcript ?? "");
    }, [item.id, item.transcript]);

    useEffect(() => {
        setStreamChunks([]);
        streamTranscriptRef.current = item.transcript ?? "";
    }, [item.id]);

    useEffect(() => {
        if (item.status.type !== "transcribing") {
            setStreamChunks([]);
            streamTranscriptRef.current = item.transcript ?? "";
        }
    }, [item.status.type, item.transcript]);

    useEffect(() => {
        if (item.status.type !== "transcribing") {
            setProcessingPulse(false);
            return;
        }
        const timer = window.setInterval(() => {
            setProcessingPulse((prev) => !prev);
        }, 1200);
        return () => window.clearInterval(timer);
    }, [item.id, item.status.type]);

    useEffect(() => {
        if (item.status.type !== "transcribing") return;
        const nextTranscript = item.transcript ?? "";
        const previousTranscript = streamTranscriptRef.current;
        if (!nextTranscript || nextTranscript === previousTranscript) return;

        if (nextTranscript.startsWith(previousTranscript)) {
            const appended = nextTranscript.slice(previousTranscript.length).replace(/^\n+/, "");
            const cleaned = appended.trimStart();
            if (cleaned.trim().length > 0) {
                setStreamChunks((prev) => [...prev, cleaned]);
            }
        } else {
            const cleaned = nextTranscript.trim();
            setStreamChunks(cleaned.length > 0 ? [cleaned] : []);
        }

        streamTranscriptRef.current = nextTranscript;
    }, [item.status.type, item.transcript]);

    useEffect(() => {
        return () => {
            if (copyTimer.current) clearTimeout(copyTimer.current);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            if (showDeleteConfirm) {
                setShowDeleteConfirm(false);
            } else {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, showDeleteConfirm]);

    useEffect(() => {
        if (!transcriptAvailable) return;
        if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
        transcriptTimer.current = setTimeout(() => {
            if (transcriptDraft !== (item.transcript ?? "")) {
                onUpdate({ transcript: transcriptDraft });
            }
        }, 600);
        return () => {
            if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
        };
    }, [transcriptDraft, transcriptAvailable, item.transcript, onUpdate]);

    const handleNameCommit = async () => {
        const value = nameDraft.trim();
        if (!value || value === item.name) {
            setNameDraft(item.name);
            setIsEditingName(false);
            return;
        }
        await onUpdate({ name: value });
        setIsEditingName(false);
    };

    const handleAddTag = async () => {
        const value = tagInput.trim();
        if (!value) return;
        if (item.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
            setTagInput("");
            return;
        }
        await onUpdate({ tags: [...item.tags, value] });
        setTagInput("");
    };

    const handleRemoveTag = async (tag: string) => {
        await onUpdate({ tags: item.tags.filter((entry) => entry !== tag) });
    };

    const handleExport = async (format: ExportFormat) => {
        setIsExporting(true);
        try {
            const ext = format;
            const safeName = sanitizeFileName(item.name || "transcript") || "transcript";
            const suggested = `${safeName}.${ext}`;
            const outputPath = await save({
                title: "Export transcription",
                defaultPath: suggested,
                filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
            });
            if (!outputPath) return;
            const finalPath = outputPath.toLowerCase().endsWith(`.${ext}`)
                ? outputPath
                : `${outputPath}.${ext}`;
            await onExport(format, finalPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("Export failed:", message);
            const lower = message.toLowerCase();
            let toastMessage = message || "Export failed. Try again.";
            if (lower.includes("no timestamp segments")) {
                toastMessage = "This item doesn’t have timestamps. Retranscribe with timestamps to export subtitles.";
            } else if (lower.includes("failed to write export file")) {
                toastMessage = "Couldn't write the export file. Try a different location.";
            } else if (lower.includes("library item not found")) {
                toastMessage = "Couldn't find this library item. Try reopening it.";
            }
            invoke("debug_show_toast", {
                toastType: "error",
                message: toastMessage,
            }).catch(() => { });
        } finally {
            setIsExporting(false);
            setExportOpen(false);
        }
    };

    const handleCopy = async () => {
        if (!transcriptDraft.trim()) return;
        try {
            await navigator.clipboard.writeText(transcriptDraft);
            setCopyConfirmed(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => {
                setCopyConfirmed(false);
            }, 1400);
        } catch (err) {
            console.error("Failed to copy transcript:", err);
        }
    };

    const handleTogglePlayback = () => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        if (sound.playing()) {
            sound.pause();
        } else {
            sound.play();
        }
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== " ") return;
            const target = event.target as HTMLElement | null;
            if (!target) return;
            const tag = target.tagName.toLowerCase();
            if (tag === "input" || tag === "textarea" || target.isContentEditable) {
                return;
            }
            event.preventDefault();
            handleTogglePlayback();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleTogglePlayback]);

    const handleScrubChange = (nextValue: string) => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        const nextTime = Number(nextValue);
        if (!Number.isFinite(nextTime)) return;
        scrubValueRef.current = nextTime;
        if (isScrubbing) {
            setAudioCurrentTime(nextTime);
            sound.seek(nextTime);
            return;
        }
        sound.seek(nextTime);
        setAudioCurrentTime(nextTime);
    };

    const handleScrubStart = () => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        scrubWasPlayingRef.current = sound.playing();
        setIsScrubbing(true);
        sound.pause();
    };

    const handleScrubEnd = async () => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        setIsScrubbing(false);
        if (typeof scrubValueRef.current === "number" && Number.isFinite(scrubValueRef.current)) {
            sound.seek(scrubValueRef.current);
            setAudioCurrentTime(scrubValueRef.current);
        }
        scrubValueRef.current = null;
        if (scrubWasPlayingRef.current) {
            try {
                sound.play();
            } catch (err) {
                console.error("Failed to resume audio:", err);
                setAudioError("Audio unavailable");
            }
        }
        scrubWasPlayingRef.current = false;
    };

    const handleTimestampClick = (startMs: number) => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        const nextTime = Math.max(0, startMs / 1000);
        sound.seek(nextTime);
        setAudioCurrentTime(nextTime);
        if (!sound.playing()) {
            try {
                sound.play();
            } catch (err) {
                console.error("Failed to play audio:", err);
                setAudioError("Audio unavailable");
            }
        }
    };
    const scrubberMax = audioDuration > 0 ? audioDuration : 1;
    const scrubberValue = Math.min(audioCurrentTime, scrubberMax);
    const scrubberPercent = scrubberMax > 0 ? (scrubberValue / scrubberMax) * 100 : 0;
    const showStreaming = item.status.type === "transcribing" && !showTimestamps;
    const showSegmentView = showTimestamps && canShowTimestamps;
    const normalizedSearchQuery = searchQuery.trim();
    const processingTextClass =
        item.status.type === "transcribing"
            ? `transcript-processing-text${processingPulse ? " transcript-processing-dim" : ""}`
            : "";
    const activeSegmentIndex = useMemo(() => {
        if (!showTimestamps || !canShowTimestamps) return -1;
        const targetMs = Math.max(0, Math.round(audioCurrentTime * 1000));
        const segments = item.segments ?? [];
        let match = -1;
        for (let i = 0; i < segments.length; i += 1) {
            if (segments[i].start_ms <= targetMs) {
                match = i;
                continue;
            }
            break;
        }
        return match;
    }, [audioCurrentTime, showTimestamps, canShowTimestamps, item.segments]);

    const segmentMatchIndexes = useMemo(() => {
        if (!normalizedSearchQuery || !showSegmentView) return [];
        const query = normalizedSearchQuery.toLowerCase();
        const segments = item.segments ?? [];
        const matches: number[] = [];
        for (let i = 0; i < segments.length; i += 1) {
            if (segments[i].text.toLowerCase().includes(query)) {
                matches.push(i);
            }
        }
        return matches;
    }, [normalizedSearchQuery, item.segments, showSegmentView]);

    const streamMatchIndexes = useMemo(() => {
        if (!normalizedSearchQuery || !showStreaming) return [];
        const query = normalizedSearchQuery.toLowerCase();
        const matches: number[] = [];
        for (let i = 0; i < streamChunks.length; i += 1) {
            if (streamChunks[i].toLowerCase().includes(query)) {
                matches.push(i);
            }
        }
        return matches;
    }, [normalizedSearchQuery, showStreaming, streamChunks]);

    const textMatchIndex = useMemo(() => {
        if (!normalizedSearchQuery || showSegmentView || showStreaming) return -1;
        const query = normalizedSearchQuery.toLowerCase();
        return transcriptDraft.toLowerCase().indexOf(query);
    }, [normalizedSearchQuery, showSegmentView, showStreaming, transcriptDraft]);

    const activeSegmentMatch = segmentMatchIndexes.length
        ? segmentMatchIndexes[Math.min(activeSearchIndex, segmentMatchIndexes.length - 1)]
        : -1;
    const activeStreamMatch = streamMatchIndexes.length
        ? streamMatchIndexes[Math.min(activeSearchIndex, streamMatchIndexes.length - 1)]
        : -1;

    const renderHighlightedText = useCallback(
        (text: string, isActive: boolean) => {
            if (!normalizedSearchQuery) return text;
            const query = normalizedSearchQuery.toLowerCase();
            const lower = text.toLowerCase();
            const nodes: Array<string | ReactNode> = [];
            let startIndex = 0;
            let matchIndex = lower.indexOf(query);
            let matchCount = 0;
            if (matchIndex === -1) return text;
            while (matchIndex !== -1) {
                if (matchIndex > startIndex) {
                    nodes.push(text.slice(startIndex, matchIndex));
                }
                const matchText = text.slice(matchIndex, matchIndex + query.length);
                nodes.push(
                    <mark
                        key={`${matchIndex}-${matchCount}`}
                        className={`transcript-search-hit${isActive ? " transcript-search-hit-active" : ""}`}
                    >
                        {matchText}
                    </mark>
                );
                startIndex = matchIndex + query.length;
                matchIndex = lower.indexOf(query, startIndex);
                matchCount += 1;
            }
            if (startIndex < text.length) {
                nodes.push(text.slice(startIndex));
            }
            return nodes;
        },
        [normalizedSearchQuery]
    );

    useEffect(() => {
        if (!normalizedSearchQuery) {
            setActiveSearchIndex(0);
            return;
        }
        setActiveSearchIndex(0);
    }, [normalizedSearchQuery]);

    const handleSearchNavigate = useCallback(
        (direction: number) => {
            if (!normalizedSearchQuery) return;
            if (showSegmentView && segmentMatchIndexes.length > 0) {
                setActiveSearchIndex((prev) =>
                    (prev + direction + segmentMatchIndexes.length) % segmentMatchIndexes.length
                );
                return;
            }
            if (showStreaming && streamMatchIndexes.length > 0) {
                setActiveSearchIndex((prev) =>
                    (prev + direction + streamMatchIndexes.length) % streamMatchIndexes.length
                );
            }
        },
        [normalizedSearchQuery, showSegmentView, showStreaming, segmentMatchIndexes, streamMatchIndexes]
    );

    const handleTimestampStep = useCallback(
        (direction: number) => {
            if (!showSegmentView) return;
            const segments = item.segments ?? [];
            if (segments.length === 0) return;
            let nextIndex = activeSegmentIndex;
            if (nextIndex < 0) {
                nextIndex = direction > 0 ? 0 : segments.length - 1;
            } else {
                nextIndex = Math.max(0, Math.min(segments.length - 1, nextIndex + direction));
            }
            if (nextIndex === activeSegmentIndex) return;
            const segment = segments[nextIndex];
            handleTimestampClick(segment.start_ms);
        },
        [activeSegmentIndex, item.segments, showSegmentView, handleTimestampClick]
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            if (!showSegmentView) return;
            const target = event.target as HTMLElement | null;
            if (!target) return;
            const tag = target.tagName.toLowerCase();
            if (tag === "input" || tag === "textarea" || target.isContentEditable) {
                return;
            }
            const now = performance.now();
            if (now - lastTimestampNavRef.current < 140) return;
            lastTimestampNavRef.current = now;
            event.preventDefault();
            handleTimestampStep(event.key === "ArrowDown" ? 1 : -1);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleTimestampStep, showSegmentView]);

    const smoothScrollTo = useCallback((container: HTMLElement, targetTop: number) => {
        if (followScrollRef.current !== null) {
            cancelAnimationFrame(followScrollRef.current);
            followScrollRef.current = null;
        }
        const startTop = container.scrollTop;
        const maxTop = container.scrollHeight - container.clientHeight;
        const clampedTarget = Math.max(0, Math.min(targetTop, maxTop));
        if (Math.abs(clampedTarget - startTop) < 2) return;
        const duration = 220;
        const start = performance.now();
        const step = (now: number) => {
            const elapsed = Math.min(1, (now - start) / duration);
            const ease = 1 - Math.pow(1 - elapsed, 3);
            container.scrollTop = startTop + (clampedTarget - startTop) * ease;
            if (elapsed < 1) {
                followScrollRef.current = requestAnimationFrame(step);
            } else {
                followScrollRef.current = null;
            }
        };
        followScrollRef.current = requestAnimationFrame(step);
    }, []);

    useEffect(() => {
        if (!normalizedSearchQuery) return;
        if (showSegmentView) {
            if (segmentMatchIndexes.length === 0) return;
            const targetIndex =
                segmentMatchIndexes[Math.min(activeSearchIndex, segmentMatchIndexes.length - 1)];
            const container = segmentsRef.current;
            const target = segmentRefs.current[targetIndex];
            if (!container || !target) return;
            const targetTop =
                target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
            smoothScrollTo(container, targetTop);
            return;
        }
        if (showStreaming) {
            if (streamMatchIndexes.length === 0) return;
            const targetIndex =
                streamMatchIndexes[Math.min(activeSearchIndex, streamMatchIndexes.length - 1)];
            const target = streamChunkRefs.current[targetIndex];
            if (target) {
                target.scrollIntoView({ block: "center", behavior: "smooth" });
            }
            return;
        }
        if (textMatchIndex >= 0 && transcriptAreaRef.current) {
            const endIndex = textMatchIndex + normalizedSearchQuery.length;
            transcriptAreaRef.current.focus();
            transcriptAreaRef.current.setSelectionRange(textMatchIndex, endIndex);
        }
    }, [
        normalizedSearchQuery,
        showSegmentView,
        showStreaming,
        segmentMatchIndexes,
        streamMatchIndexes,
        activeSearchIndex,
        textMatchIndex,
        smoothScrollTo,
    ]);

    useEffect(() => {
        if (!followTimestamps || activeSegmentIndex < 0) return;
        const container = segmentsRef.current;
        const target = segmentRefs.current[activeSegmentIndex];
        if (!container || !target) return;
        const targetTop =
            target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
        smoothScrollTo(container, targetTop);
    }, [activeSegmentIndex, followTimestamps, smoothScrollTo]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="flex h-full w-full min-h-0 overflow-hidden rounded-2xl border border-border-secondary bg-surface-overlay shadow-2xl shadow-black/50"
        >
            {/* Sidebar */}
            <aside className="flex w-48 shrink-0 flex-col border-r border-border-primary bg-surface-surface">
                <div className="px-4 pt-5 pb-3">
                    {isEditingName ? (
                        <div className="flex items-center gap-1.5 mt-1">
                            <input
                                value={nameDraft}
                                onChange={(event) => setNameDraft(event.target.value)}
                                onBlur={handleNameCommit}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleNameCommit();
                                    }
                                }}
                                className="flex-1 min-w-0 bg-surface-surface border border-border-primary rounded px-1.5 py-0.5 text-[13px] text-content-primary focus:border-border-hover outline-none"
                                autoFocus
                            />
                            <button onClick={handleNameCommit} className="text-content-muted hover:text-content-primary">
                                <Check size={12} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 mt-1 group">
                            <h2 className="text-[13px] font-semibold text-content-primary truncate">{item.name}</h2>
                            <button
                                onClick={() => setIsEditingName(true)}
                                className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-content-primary transition-opacity"
                            >
                                <Pencil size={10} />
                            </button>
                        </div>
                    )}
                    <p className="text-[10px] text-content-disabled mt-0.5 truncate">{modelLabel}</p>
                </div>

                <nav className="flex-1 px-2 py-2 space-y-3 overflow-y-auto custom-scrollbar scrollbar-gutter">
                    {/* Audio player */}
                    <div className="px-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-disabled mb-1.5">Audio</p>
                        <div className="rounded-lg border border-border-primary bg-surface-surface px-2.5 py-2.5">
                            <div className="flex items-center justify-between">
                                <button
                                    onClick={handleTogglePlayback}
                                    disabled={!audioReady || !!audioError}
                                    className={`flex h-6 w-6 items-center justify-center rounded-md border text-content-primary transition-colors ${
                                        !audioReady || audioError
                                            ? "border-border-primary/60 text-content-disabled"
                                            : "border-border-primary hover:border-border-secondary"
                                    }`}
                                    aria-label={isPlaying ? "Pause audio" : "Play audio"}
                                >
                                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                                </button>
                                <span className="text-[9px] text-content-disabled tabular-nums">
                                    {formatDuration(audioCurrentTime)} / {formatDuration(audioDuration)}
                                </span>
                            </div>
                            <div className="mt-2">
                                <input
                                    type="range"
                                    min={0}
                                    max={scrubberMax}
                                    step={0.01}
                                    value={scrubberValue}
                                    onChange={(event) => handleScrubChange(event.target.value)}
                                    onMouseDown={handleScrubStart}
                                    onTouchStart={handleScrubStart}
                                    onMouseUp={handleScrubEnd}
                                    onTouchEnd={handleScrubEnd}
                                    className="library-scrubber"
                                    disabled={!audioReady || !!audioError}
                                    style={{
                                        background: `linear-gradient(to right, var(--color-cloud) 0%, var(--color-cloud) ${scrubberPercent}%, var(--color-border-secondary) ${scrubberPercent}%, var(--color-border-secondary) 100%)`,
                                    }}
                                    aria-label="Audio scrubber"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Settings section */}
                    <div className="px-2 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-disabled">Settings</p>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[11px] text-content-primary">Timestamps</div>
                                <div className="text-[9px] text-content-disabled">
                                    {isTranscribed ? (canShowTimestamps ? "Supported" : "Not supported") : "Available after transcription"}
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (!canShowTimestamps) return;
                                    const nextValue = !showTimestamps;
                                    setShowTimestamps(nextValue);
                                    if (!nextValue) {
                                        setFollowTimestamps(false);
                                    }
                                    onUpdate({ show_timestamps: nextValue });
                                }}
                                className={`relative w-8 h-4 rounded-full transition-colors ${showTimestamps ? "bg-cloud" : "bg-border-secondary"} ${!canShowTimestamps ? "opacity-40 cursor-not-allowed" : ""}`}
                                role="switch"
                                aria-checked={showTimestamps}
                                disabled={!canShowTimestamps}
                            >
                                <motion.div
                                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm"
                                    animate={{ left: showTimestamps ? "calc(100% - 14px)" : "2px" }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            </button>
                        </div>
                        <div className="flex items-center justify-between pl-3">
                            <div>
                                <div className="flex items-center gap-1.5 text-[10px] text-content-secondary">
                                    <CornerDownRight size={10} className="text-content-disabled" aria-hidden="true" />
                                    <span>Follow timestamp</span>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (!showTimestamps || !canShowTimestamps) return;
                                    setFollowTimestamps((prev) => !prev);
                                }}
                                className={`relative w-7 h-3 rounded-full transition-colors ${
                                    followTimestamps ? "bg-cloud" : "bg-border-secondary"
                                } ${!showTimestamps || !canShowTimestamps ? "opacity-40 cursor-not-allowed" : ""}`}
                                role="switch"
                                aria-checked={followTimestamps}
                                disabled={!showTimestamps || !canShowTimestamps}
                            >
                                <motion.div
                                    className="absolute top-[1px] w-2.5 h-2.5 rounded-full bg-white shadow-sm"
                                    animate={{ left: followTimestamps ? "calc(100% - 10px)" : "2px" }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Tags section */}
                    <div className="px-2 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-disabled">Tags</p>
                        <div className="flex flex-wrap gap-2 max-h-20 overflow-auto custom-scrollbar scrollbar-gutter pr-3">
                            {item.tags.length === 0 && <span className="text-[10px] text-content-disabled italic">None</span>}
                            {item.tags.map((tag, idx) => (
                                <span key={`${tag}-${idx}`} className="group inline-flex items-center pl-3 pr-1.5 py-1.5 rounded text-[10px] text-content-secondary bg-white/5 border border-white/10 hover:border-white/20 transition-colors leading-none">
                                    <span>{tag.length > 12 ? `${tag.slice(0, 12)}...` : tag}</span>
                                    <button onClick={() => handleRemoveTag(tag)} className="ml-1 text-content-disabled hover:text-content-muted transition-colors cursor-pointer shrink-0" aria-label={`Remove ${tag}`}>
                                        <X size={10} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center gap-1">
                            <input
                                value={tagInput}
                                onChange={(event) => setTagInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleAddTag();
                                    }
                                }}
                                placeholder="New tag..."
                                className="flex-1 min-w-0 bg-transparent border-b border-border-primary px-0.5 py-1 text-[10px] text-content-secondary outline-none focus:border-border-hover placeholder:text-content-disabled"
                            />
                        </div>
                    </div>
                </nav>

                {/* Sidebar footer actions */}
                <div className="px-2 py-3 border-t border-border-primary space-y-1.5">
                    {(item.status.type === "transcribing"
                        || item.status.type === "cancelling"
                        || item.status.type === "pending"
                        || item.status.type === "importing") && (
                        <button onClick={onCancel} className="w-full rounded-lg border border-border-primary bg-surface-surface px-2 py-1.5 text-[10px] text-content-primary hover:border-border-secondary">
                            Cancel
                        </button>
                    )}
                    {item.status.type === "error" && (
                        <button onClick={onRetry} className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border-primary bg-surface-surface px-2 py-1.5 text-[10px] text-content-primary hover:border-border-secondary">
                            <RotateCw size={10} />
                            Retry
                        </button>
                    )}
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[10px] text-red-300 hover:bg-red-500/10"
                    >
                        <Trash2 size={10} />
                        Delete
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex flex-1 flex-col min-h-0 min-w-0 bg-surface-overlay">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border-primary shrink-0 bg-surface-surface/40">
                    <button
                        onClick={() => setShowRetranscribe(true)}
                        disabled={item.status.type === "transcribing"
                            || item.status.type === "cancelling"
                            || item.status.type === "pending"
                            || item.status.type === "importing"}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] text-content-secondary hover:text-content-primary hover:bg-surface-surface disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <RotateCw size={11} />
                        Retranscribe
                    </button>
                    <div className="flex-1 flex justify-center">
                        <div className="relative w-full max-w-[240px]">
                            <div className="relative flex items-center gap-2 bg-surface-secondary border border-border-primary rounded-lg px-2.5 py-1.5 focus-within:border-border-secondary transition-colors">
                                <Search size={12} className="text-content-disabled shrink-0" aria-hidden="true" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            handleSearchNavigate(event.shiftKey ? -1 : 1);
                                        }
                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            setSearchQuery("");
                                        }
                                    }}
                                    placeholder="Search transcript..."
                                    aria-label="Search transcript"
                                    className="bg-transparent text-[11px] text-content-secondary placeholder-content-disabled outline-none w-full"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery("")}
                                            aria-label="Clear search"
                                            className="text-content-disabled hover:text-content-muted transition-colors"
                                        >
                                            <X size={12} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            disabled={!transcriptAvailable}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] disabled:opacity-50 transition-colors ${
                                copyConfirmed
                                    ? "text-emerald-200 bg-emerald-400/10"
                                    : "text-content-secondary hover:text-content-primary hover:bg-surface-surface"
                            }`}
                        >
                            {copyConfirmed ? <Check size={10} /> : <Copy size={10} />}
                            {copyConfirmed ? "Copied" : "Copy"}
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setExportOpen(!exportOpen)}
                                disabled={isExporting || !transcriptAvailable}
                                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] text-content-secondary hover:text-content-primary hover:bg-surface-surface disabled:opacity-50"
                            >
                                Export
                                <ChevronDown size={10} />
                            </button>
                            <AnimatePresence>
                                {exportOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 4 }}
                                        transition={{ duration: 0.1 }}
                                        className="absolute right-0 top-full mt-1 w-32 rounded-lg border border-border-primary bg-surface-surface shadow-xl overflow-hidden z-10"
                                    >
                                        {(["txt", "md", "srt", "vtt"] as ExportFormat[]).map((format) => {
                                            const requiresSegments = format === "srt" || format === "vtt";
                                            const disabled = requiresSegments && !(item.segments && item.segments.length);
                                            return (
                                                <button
                                                    key={format}
                                                    onClick={() => handleExport(format)}
                                                    disabled={disabled}
                                                    className="w-full px-3 py-1.5 text-left text-[10px] text-content-secondary hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {format.toUpperCase()}
                                                </button>
                                            );
                                        })}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center rounded-md p-1.5 text-content-muted hover:text-content-primary hover:bg-surface-surface"
                            aria-label="Close"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>

                {/* Transcript area */}
                <div className="flex-1 min-h-0 overflow-hidden p-4">
                    {item.status.type === "error" && (
                        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                            {item.status.message}
                        </div>
                    )}
                    {showSegmentView ? (
                        <div
                            ref={segmentsRef}
                            className="h-full overflow-auto custom-scrollbar text-[13px] text-content-secondary leading-relaxed space-y-1.5 pr-2"
                        >
                            {(item.segments ?? []).map((segment, idx) => {
                                const isActive = idx === activeSegmentIndex;
                                return (
                                    <motion.div
                                        key={`${segment.start_ms}-${idx}`}
                                        ref={(node) => {
                                            segmentRefs.current[idx] = node;
                                        }}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.2, ease: "easeOut" }}
                                        className={`grid w-full grid-cols-[auto_1fr] gap-3 rounded-md border px-2 py-1 transition-colors select-none ${
                                            isActive ? "border-cloud-30 bg-cloud-10" : "border-transparent"
                                        }`}
                                    >
                                        <span
                                            className={`text-content-disabled font-mono text-[11px] pt-0.5 select-none cursor-pointer hover:text-content-primary ${processingTextClass}`}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => handleTimestampClick(segment.start_ms)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    handleTimestampClick(segment.start_ms);
                                                }
                                            }}
                                        >
                                            {formatTimestamp(segment.start_ms)}
                                        </span>
                                        <div className="min-w-0 select-none w-fit">
                                            <span className={`select-text ${processingTextClass}`}>
                                                {renderHighlightedText(segment.text, idx === activeSegmentMatch)}
                                            </span>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    ) : showStreaming ? (
                        <div className="h-full overflow-auto custom-scrollbar text-[13px] text-content-secondary leading-relaxed space-y-2 pr-2">
                            {streamChunks.length === 0 ? (
                                <div className="text-content-disabled text-[12px]">
                                    {item.status.type === "importing"
                                        ? "Converting audio..."
                                        : item.status.type === "pending"
                                            ? "Queued for transcription..."
                                            : "Transcribing..."}
                                </div>
                            ) : (
                                <AnimatePresence initial={false}>
                                    {streamChunks.map((chunk, idx) => (
                                        <motion.p
                                            key={`${item.id}-chunk-${idx}`}
                                            ref={(node) => {
                                                streamChunkRefs.current[idx] = node;
                                            }}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.2, ease: "easeOut" }}
                                            className={`select-text ${processingTextClass}`}
                                        >
                                            {renderHighlightedText(chunk, idx === activeStreamMatch)}
                                        </motion.p>
                                    ))}
                                </AnimatePresence>
                            )}
                        </div>
                    ) : (
                        <textarea
                            ref={transcriptAreaRef}
                            value={transcriptDraft}
                            onChange={(event) => setTranscriptDraft(event.target.value)}
                            disabled={!transcriptAvailable}
                            placeholder={item.status.type === "importing"
                                ? "Converting audio..."
                                : item.status.type === "pending"
                                    ? "Queued for transcription..."
                                    : "Transcript will appear here."}
                            className="h-full w-full resize-none bg-transparent text-[13px] text-content-secondary leading-relaxed outline-none disabled:opacity-60 custom-scrollbar select-text"
                        />
                    )}
                </div>
            </main>

            <AnimatePresence>
                {showDeleteConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowDeleteConfirm(false);
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.96, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
                            onClick={(event) => event.stopPropagation()}
                            role="dialog"
                            aria-modal="true"
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <AlertTriangle size={20} className="text-amber-400 shrink-0" />
                                <div>
                                    <p className="text-[14px] font-semibold text-content-primary">Delete this item?</p>
                                    <p className="text-[11px] text-content-disabled">This removes the transcript and audio from your library.</p>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="rounded-lg border border-border-secondary px-4 py-2 text-[12px] font-medium text-content-secondary hover:border-border-hover transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setShowDeleteConfirm(false);
                                        onDelete();
                                    }}
                                    className="rounded-lg bg-red-500/90 px-4 py-2 text-[12px] font-semibold text-white hover:bg-red-500 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showRetranscribe && (
                    <LibraryRetranscribeModal
                        item={item}
                        models={models}
                        onCancel={() => setShowRetranscribe(false)}
                        onConfirm={async (options) => {
                            try {
                                await onUpdate({
                                    speech_model: options.model_key,
                                    llm_cleanup_enabled: false,
                                    show_timestamps: options.show_timestamps,
                                });
                                await onRetry();
                                setShowRetranscribe(false);
                            } catch (err) {
                                console.error("Failed to retranscribe:", err);
                            }
                        }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const LibraryRetranscribeModal = ({
    item,
    models,
    onCancel,
    onConfirm,
}: {
    item: LibraryItem;
    models: ModelInfo[];
    onCancel: () => void;
    onConfirm: (options: {
        model_key: string;
        show_timestamps: boolean;
    }) => Promise<void>;
}) => {
    const [selectedModelKey, setSelectedModelKey] = useState<string>(item.speech_model);
    const [showTimestamps, setShowTimestamps] = useState(item.show_timestamps);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const modelOptions: DropdownOption<string>[] = useMemo(() => {
        return models.map((model) => ({
            value: model.key,
            label: model.label,
            description: model.description,
        }));
    }, [models]);

    useEffect(() => {
        const installed = new Set(models.map((model) => model.key));
        const fallback = modelOptions[0]?.value ?? "";
        const nextModel = installed.has(item.speech_model) ? item.speech_model : fallback;
        setSelectedModelKey(nextModel);
        setShowTimestamps(item.show_timestamps);
    }, [item.id, item.speech_model, item.show_timestamps, modelOptions, models]);

    const selectedModel = models.find((model) => model.key === selectedModelKey) ?? null;
    const timestampsSupported = isTimestampSupported(selectedModel);

    useEffect(() => {
        if (!timestampsSupported) {
            setShowTimestamps(false);
        }
    }, [timestampsSupported]);

    const handleConfirm = async () => {
        if (!selectedModelKey) return;
        setIsSubmitting(true);
        try {
            await onConfirm({
                model_key: selectedModelKey,
                show_timestamps: timestampsSupported ? showTimestamps : false,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-[420px] max-w-[92vw] bg-surface-overlay border border-border-secondary rounded-2xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-content-disabled">Retranscribe</p>
                        <p className="text-[14px] text-content-primary mt-1 truncate">{item.name}</p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface p-2 text-content-muted hover:text-content-secondary"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {models.length === 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-200">
                            No local models are installed. Download a model in Settings → Models before retranscribing.
                        </div>
                    )}
                    <div>
                        <label className="text-[11px] font-medium text-content-muted ml-1">Model</label>
                        <Dropdown
                            value={selectedModelKey || null}
                            onChange={(value) => setSelectedModelKey(value)}
                            options={modelOptions}
                            placeholder="Select a model"
                            searchable
                            searchPlaceholder="Search installed models..."
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="text-[12px] text-content-primary font-medium">Show timestamps</div>
                            <div className="text-[10px] text-content-disabled">
                                {timestampsSupported ? "Enabled for supported models" : "Not supported by this model"}
                            </div>
                        </div>
                        <button
                            onClick={() => timestampsSupported && setShowTimestamps(!showTimestamps)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${showTimestamps ? "bg-cloud" : "bg-border-secondary"} ${!timestampsSupported ? "opacity-40 cursor-not-allowed" : ""}`}
                            role="switch"
                            aria-checked={showTimestamps}
                            disabled={!timestampsSupported}
                        >
                            <motion.div
                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                                animate={{ left: showTimestamps ? "calc(100% - 18px)" : "2px" }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                </div>

                <div className="px-5 py-3 border-t border-border-primary flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface px-3 py-2 text-[11px] text-content-muted hover:text-content-secondary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isSubmitting || !selectedModelKey}
                        className="rounded-lg border border-border-primary bg-surface-surface px-4 py-2 text-[11px] text-content-primary hover:border-border-secondary disabled:opacity-50"
                    >
                        {isSubmitting ? "Retranscribing..." : "Retranscribe"}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

const LibraryImportModal = ({
    paths,
    models,
    defaultModelKey,
    onCancel,
    onConfirm,
}: {
    paths: string[];
    models: ModelInfo[];
    defaultModelKey?: string;
    onCancel: () => void;
    onConfirm: (paths: string[], options: LibraryImportOptions) => void;
}) => {
    const [storeOriginal, setStoreOriginal] = useState(true);
    const [selectedModelKey, setSelectedModelKey] = useState<string>(defaultModelKey || "");
    const [showTimestamps, setShowTimestamps] = useState(true);
    const [isImporting, setIsImporting] = useState(false);

    const modelOptions: DropdownOption<string>[] = models.map((model) => ({
        value: model.key,
        label: model.label,
        description: model.description,
    }));

    useEffect(() => {
        if (!selectedModelKey && modelOptions.length > 0) {
            setSelectedModelKey(modelOptions[0].value);
        }
    }, [modelOptions, selectedModelKey]);

    const selectedModel = models.find((model) => model.key === selectedModelKey) ?? null;
    const timestampsSupported = isTimestampSupported(selectedModel);

    useEffect(() => {
        if (!timestampsSupported) {
            setShowTimestamps(false);
        }
    }, [timestampsSupported]);

    const importPaths = paths.length > 0 ? paths : [];
    const summary = importPaths.length === 1 ? "1 file" : `${importPaths.length} files`;

    const handleConfirm = async () => {
        if (!selectedModelKey) return;
        setIsImporting(true);
        const options: LibraryImportOptions = {
            store_original: storeOriginal,
            model_key: selectedModelKey,
            llm_cleanup_enabled: false,
            show_timestamps: showTimestamps,
        };
        await onConfirm(importPaths, options);
        setIsImporting(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-[520px] max-w-[92vw] bg-surface-overlay border border-border-secondary rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-content-disabled">Import to Library</p>
                        <p className="text-[14px] text-content-primary mt-1">{summary}</p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface p-2 text-content-muted hover:text-content-secondary"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {models.length === 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-200">
                            No local models are installed. Download a model in Settings → Models before importing.
                        </div>
                    )}
                    <div className="rounded-lg border border-border-primary bg-surface-surface p-3">
                        <div className="text-[11px] text-content-muted mb-2">Files</div>
                        <div className="max-h-28 overflow-auto custom-scrollbar text-[12px] text-content-secondary space-y-1">
                            {importPaths.map((path, idx) => (
                                <div key={`${path}-${idx}`} className="truncate">{path}</div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-medium text-content-muted ml-1">Model</label>
                        <Dropdown
                            value={selectedModelKey || null}
                            onChange={(value) => setSelectedModelKey(value)}
                            options={modelOptions}
                            placeholder="Select a model"
                            searchable
                            searchPlaceholder="Search installed models..."
                        />
                        <div className="mt-2 flex items-start gap-2 text-[10px] text-content-disabled ml-1">
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="text-[12px] text-content-primary font-medium">Store original file</div>
                            <div className="text-[10px] text-content-disabled">Keep a copy inside the library folder</div>
                        </div>
                        <button
                            onClick={() => setStoreOriginal(!storeOriginal)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${storeOriginal ? "bg-cloud" : "bg-border-secondary"}`}
                            role="switch"
                            aria-checked={storeOriginal}
                        >
                            <motion.div
                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                                animate={{ left: storeOriginal ? "calc(100% - 18px)" : "2px" }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="text-[12px] text-content-primary font-medium">Show timestamps</div>
                            <div className="text-[10px] text-content-disabled">
                                {timestampsSupported ? "Enabled for supported models" : "Not supported by this model"}
                            </div>
                        </div>
                        <button
                            onClick={() => timestampsSupported && setShowTimestamps(!showTimestamps)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${showTimestamps ? "bg-cloud" : "bg-border-secondary"} ${!timestampsSupported ? "opacity-40 cursor-not-allowed" : ""}`}
                            role="switch"
                            aria-checked={showTimestamps}
                            disabled={!timestampsSupported}
                        >
                            <motion.div
                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                                animate={{ left: showTimestamps ? "calc(100% - 18px)" : "2px" }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                </div>

                <div className="px-5 py-3 border-t border-border-primary flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface px-3 py-2 text-[11px] text-content-muted hover:text-content-secondary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isImporting || importPaths.length === 0 || !selectedModelKey}
                        className="rounded-lg border border-border-primary bg-surface-surface px-4 py-2 text-[11px] text-content-primary hover:border-border-secondary disabled:opacity-50"
                    >
                        {isImporting ? "Importing..." : "Import"}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default LibraryView;
