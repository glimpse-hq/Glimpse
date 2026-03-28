import { useLingui } from "@lingui/react/macro";
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
    FolderOpen,
    Loader2,
    Plus,
    Search,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { useDebouncedValue } from "../../../shared/hooks/useDebouncedValue";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useModelDownloadEvents } from "../../../shared/hooks/useModelDownloadEvents";
import { Dropdown } from "../../../shared/ui/Dropdown";
import { useSettings } from "../../settings/queries";
import { useModelCatalog } from "../../settings/models-queries";
import LibraryImportModal from "./LibraryImportModal";
import LibraryCard from "./LibraryCard";
import LibraryModal from "./LibraryModal";
import {
    useLibraryItems as useLibraryItemsQuery,
    useCreateLibraryItem,
    useUpdateLibraryItem,
    useDeleteLibraryItem,
    useCancelLibraryTranscription,
    useRetryLibraryTranscription,
    useExportLibraryItem,
    useLibraryTags,
    libraryKeys,
} from "../queries";
import {
    formatDeleteErrorMessage,
    formatImportErrorMessage,
    getFileExtension,
    SUPPORTED_EXTENSIONS,
    uniquePaths,
} from "./library-utils";
import type {
    LibraryFilter,
    LibraryItem,
    LibraryItemPatch,
    ModelStatus,
} from "../../../types";

type LibraryViewProps = {
    pendingImportPaths: string[] | null;
    onSetImportPaths: (paths: string[] | null) => void;
    sidebarWidth: number;
    isActive: boolean;
};

const LibraryView = ({
    pendingImportPaths,
    onSetImportPaths,
    sidebarWidth,
    isActive,
}: LibraryViewProps) => {
    const { t } = useLingui();
    const queryClient = useQueryClient();

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [dateFilter, setDateFilter] = useState<string>("all");
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({});
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingNameDraft, setEditingNameDraft] = useState("");
    const [editingTagId, setEditingTagId] = useState<string | null>(null);
    const [tagDraft, setTagDraft] = useState("");
    const [followTimestamps, setFollowTimestamps] = useState(true);
    const shiftHeld = useShiftHeld(isActive);
    const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
    const filter = useMemo<LibraryFilter>(() => {
        const sinceDays =
            dateFilter === "last7" ? 7 : dateFilter === "last30" ? 30 : null;
        return {
            search: debouncedSearchQuery || null,
            status: statusFilter === "all" ? null : statusFilter,
            tag: tagFilter === "all" ? null : tagFilter,
            since_days: sinceDays,
        };
    }, [dateFilter, debouncedSearchQuery, statusFilter, tagFilter]);

    const {
        data,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        error: queryError,
    } = useLibraryItemsQuery(filter, isActive);

    const { data: availableTags = [] } = useLibraryTags(isActive);
    const { data: modelCatalog = [] } = useModelCatalog(isActive);
    const { data: defaultModelKey = "" } = useSettings(
        (settings) => settings.local_model,
        isActive,
    );

    const items = useMemo(
        () => data?.pages.flatMap((page) => page.items) ?? [],
        [data],
    );
    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

    const createItemMutation = useCreateLibraryItem();
    const updateItemMutation = useUpdateLibraryItem();
    const deleteItemMutation = useDeleteLibraryItem();
    const cancelMutation = useCancelLibraryTranscription();
    const retryMutation = useRetryLibraryTranscription();
    const exportMutation = useExportLibraryItem();

    const invalidateTags = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
    }, [queryClient]);

    const updateItemWithTags = useCallback(async (id: string, patch: LibraryItemPatch) => {
        const updated = await updateItemMutation.mutateAsync({ id, patch });
        if (patch.tags != null) invalidateTags();
        return updated;
    }, [updateItemMutation, invalidateTags]);

    const deleteItemAndRefreshTags = useCallback(async (id: string) => {
        try {
            await deleteItemMutation.mutateAsync(id);
            invalidateTags();
        } catch (err) {
            console.error("Failed to delete library item:", err);
            const message = err instanceof Error ? err.message : String(err);
            invoke("debug_show_toast", {
                toastType: "error",
                message: formatDeleteErrorMessage(message),
            }).catch(() => { });
        }
    }, [deleteItemMutation, invalidateTags]);

    const installedModels = useMemo(() => {
        return modelCatalog.filter((model) => modelStatus[model.key]?.installed);
    }, [modelCatalog, modelStatus]);

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
        if (!isActive || modelCatalog.length === 0) return;

        modelCatalog.forEach((model) => refreshModelStatus(model.key));
    }, [isActive, modelCatalog, refreshModelStatus]);

    useModelDownloadEvents({
        enabled: isActive,
        onComplete: ({ model }) => {
            refreshModelStatus(model);
        },
        onError: ({ model }) => {
            refreshModelStatus(model);
        },
    });

    useEffect(() => {
        if (!selectedItem) return;

        const handleSidebarClick = (event: MouseEvent) => {
            const sidebar = document.querySelector("[data-app-sidebar]");
            if (sidebar && sidebar.contains(event.target as Node)) {
                setSelectedItemId(null);
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
                        name: t({
                            id: "library.view.file_filter",
                            message: "Audio & Video",
                        }),
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
                message: t({
                    id: "library.view.import_dialog_error",
                    message: "Could not open the import dialog.",
                }),
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

    const commitTagAdd = async (itemId: string, overrideTag?: string) => {
        const nextTag = (overrideTag ?? tagDraft).trim();
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
                        <p className="ui-text-screen-title ui-color-primary tracking-tight">
                            {t({
                                id: "library.view.title",
                                message: "Library",
                            })}
                        </p>
                        <p className="mt-1 ui-text-body-sm ui-color-secondary">
                            {t({
                                id: "library.view.description",
                                message: "Import audio and video files for transcription.",
                            })}
                        </p>
                    </div>
                </header>
                <div className="grid w-full max-w-5xl min-w-0 grid-cols-[auto_minmax(0,1fr)_132px_132px_120px] items-center gap-2">
                    <button
                        onClick={handleImportClick}
                        className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-2 ui-text-body-sm ui-color-primary hover:border-border-secondary hover:bg-surface-overlay transition-colors shrink-0"
                    >
                        <Plus size={14} />
                        {t({
                            id: "library.view.import_button",
                            message: "Import",
                        })}
                    </button>
                    <div className="relative min-w-0">
                        <div className="relative flex items-center gap-2 bg-surface-secondary border border-border-primary rounded-lg px-2.5 py-2 focus-within:border-border-secondary transition-colors">
                            <Search size={12} className="text-content-disabled shrink-0" aria-hidden="true" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t({
                                    id: "library.view.search_placeholder",
                                    message: "Search library...",
                                })}
                                aria-label={t({
                                    id: "library.view.search_aria",
                                    message: "Search library",
                                })}
                                className="w-full min-w-0 bg-transparent ui-text-input-sm ui-color-secondary placeholder-content-disabled outline-hidden"
                            />
                        </div>
                    </div>
                    <Dropdown
                        value={statusFilter}
                        onChange={(value) => setStatusFilter(value)}
                        options={[
                            {
                                value: "all",
                                label: t({
                                    id: "library.view.filter.status.all",
                                    message: "All",
                                }),
                            },
                            {
                                value: "importing",
                                label: t({
                                    id: "library.view.filter.status.converting",
                                    message: "Converting",
                                }),
                            },
                            {
                                value: "pending",
                                label: t({
                                    id: "library.view.filter.status.queued",
                                    message: "Queued",
                                }),
                            },
                            {
                                value: "transcribing",
                                label: t({
                                    id: "library.view.filter.status.transcribing",
                                    message: "Transcribing",
                                }),
                            },
                            {
                                value: "complete",
                                label: t({
                                    id: "library.view.filter.status.done",
                                    message: "Done",
                                }),
                            },
                            {
                                value: "error",
                                label: t({
                                    id: "library.view.filter.status.failed",
                                    message: "Failed",
                                }),
                            },
                        ]}
                        className="w-full min-w-0"
                        menuClassName="right-auto min-w-full w-max max-w-[20rem]"
                    />
                    <Dropdown
                        value={dateFilter}
                        onChange={(value) => setDateFilter(value)}
                        options={[
                            {
                                value: "all",
                                label: t({
                                    id: "library.view.filter.date.all_time",
                                    message: "All time",
                                }),
                            },
                            {
                                value: "last7",
                                label: t({
                                    id: "library.view.filter.date.last7",
                                    message: "Last 7 days",
                                }),
                            },
                            {
                                value: "last30",
                                label: t({
                                    id: "library.view.filter.date.last30",
                                    message: "Last 30 days",
                                }),
                            },
                        ]}
                        className="w-full min-w-0"
                        menuClassName="right-auto min-w-full w-max max-w-[20rem]"
                    />
                    <Dropdown
                        value={tagFilter}
                        onChange={(value) => setTagFilter(value)}
                        options={[
                            {
                                value: "all",
                                label: t({
                                    id: "library.view.filter.tags.all",
                                    message: "All tags",
                                }),
                            },
                            ...availableTags.map((tag) => ({ value: tag, label: tag })),
                        ]}
                        className="w-full min-w-0"
                        menuClassName="right-auto min-w-full w-max max-w-[20rem]"
                    />
                </div>

                {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 ui-text-body-sm ui-color-error-tint">
                        {error}
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden custom-scrollbar scrollbar-gutter pb-6 pr-3 pt-1">
                <div key="library-list" className="flex flex-col gap-6 w-full">
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
                                <p className="mt-3 ui-text-body ui-color-muted">
                                    {t({
                                        id: "library.view.empty_state",
                                        message: "Drag files here to build your Library.",
                                    })}
                                </p>
                            </div>
                        )}

                        {items.map((item, index) => (
                            <LibraryCard
                                key={item.id || `library-item-${index}`}
                                item={item}
                                onOpen={() => setSelectedItemId(item.id)}
                                onRemoveTag={async (tag) => {
                                    const nextTags = item.tags.filter((entry) => entry !== tag);
                                    await updateItemWithTags(item.id, { tags: nextTags });
                                }}
                                editingNameId={editingNameId}
                                editingNameDraft={editingNameDraft}
                                onStartNameEdit={() => startNameEdit(item)}
                                onChangeNameDraft={setEditingNameDraft}
                                onCommitNameEdit={() => commitNameEdit(item.id)}
                                onCancelNameEdit={cancelNameEdit}
                                onRetry={() => retryMutation.mutateAsync(item.id)}
                                onCancel={() => cancelMutation.mutateAsync(item.id)}
                                onDelete={async () => {
                                    await deleteItemAndRefreshTags(item.id);
                                    if (selectedItem?.id === item.id) {
                                        setSelectedItemId(null);
                                    }
                                }}
                                editingTagId={editingTagId}
                                tagDraft={tagDraft}
                                onStartTagEdit={() => startTagEdit(item)}
                                onChangeTagDraft={setTagDraft}
                                onCommitTagAdd={(value) => commitTagAdd(item.id, value)}
                                onCancelTagEdit={cancelTagEdit}
                                shiftHeld={shiftHeld}
                                availableTags={availableTags}
                            />
                        ))}

                        {items.length > 0 && (
                            <button
                                onClick={handleImportClick}
                                className="rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-4 flex flex-col items-center justify-center text-center ui-color-muted hover:text-content-secondary hover:border-border-hover transition-colors"
                            >
                                <FolderOpen size={18} />
                                <span className="mt-2 ui-text-body-sm">
                                    {t({
                                        id: "library.view.dropzone",
                                        message: "Drop files to import",
                                    })}
                                </span>
                            </button>
                        )}

                            {items.length > 0 && hasNextPage && (
                                <div className="col-span-full flex items-center justify-center pt-2">
                                    <button
                                        onClick={() => fetchNextPage()}
                                        disabled={isFetchingNextPage}
                                        className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-4 py-2 ui-text-body-sm ui-color-secondary hover:text-content-primary hover:border-border-secondary hover:bg-surface-overlay transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isFetchingNextPage ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                <span>
                                                    {t({
                                                        id: "library.view.loading_more",
                                                        message: "Loading...",
                                                    })}
                                                </span>
                                            </>
                                        ) : (
                                            <span>
                                                {t({
                                                    id: "library.view.load_more",
                                                    message: "Load more",
                                                })}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {selectedItem && (
                    <div
                        key="library-detail"
                        className="fixed top-0 right-0 bottom-0 z-20 flex items-center justify-center p-6 transition-[left] duration-200 ease-out"
                        style={{ left: sidebarWidth, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
                        onClick={() => setSelectedItemId(null)}
                    >
                        <div className="w-full h-full min-h-0" onClick={(e) => e.stopPropagation()}>
                            <LibraryModal
                                key={selectedItem.id || "selected-library-item"}
                                item={selectedItem}
                                models={installedModels}
                                shiftHeld={shiftHeld}
                                followTimestamps={followTimestamps}
                                onFollowTimestampsChange={setFollowTimestamps}
                                onClose={() => setSelectedItemId(null)}
                                onDelete={async () => {
                                    await deleteItemAndRefreshTags(selectedItem.id);
                                    setSelectedItemId(null);
                                }}
                                onRetry={() => retryMutation.mutateAsync(selectedItem.id)}
                                onCancel={() => cancelMutation.mutateAsync(selectedItem.id)}
                                onUpdate={(patch) => updateItemWithTags(selectedItem.id, patch)}
                                onExport={(format, outputPath) => exportMutation.mutateAsync({ id: selectedItem.id, format, outputPath })}
                                availableTags={availableTags}
                            />
                        </div>
                    </div>
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
                                    message: t({
                                        id: "library.view.unsupported_files",
                                        message: `${unsupported.length} file(s) skipped due to unsupported format.`,
                                    }),
                                }).catch(() => { });
                            }

                            for (const path of supported) {
                                try {
                                    await createItemMutation.mutateAsync({ path, options });
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

                            onSetImportPaths(null);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default LibraryView;
