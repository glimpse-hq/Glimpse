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
import SegmentedControl from "../../../shared/ui/SegmentedControl";
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
        return {
            search: debouncedSearchQuery || null,
            status: statusFilter === "all" ? null : statusFilter,
            tag: null,
            since_days: null,
        };
    }, [debouncedSearchQuery, statusFilter]);

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
    const statusFilterValue = useMemo(() => {
        if (["transcribing", "importing", "pending"].includes(statusFilter)) {
            return "active";
        }
        if (statusFilter === "complete") return "complete";
        if (statusFilter === "error") return "error";
        return "all";
    }, [statusFilter]);
    const statusFilterOptions = useMemo(() => [
        { value: "all", label: t({ id: "library.filter.all", message: "All" }) },
        { value: "active", label: t({ id: "library.filter.active", message: "Active" }) },
        { value: "complete", label: t({ id: "library.filter.done", message: "Done" }) },
        { value: "error", label: t({ id: "library.filter.failed", message: "Failed" }) },
    ], [t]);

    return (
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-4 pb-4 px-0 text-left">
                <header className="flex flex-col gap-4 mb-4 mt-2 md:-mt-6">
                    <div className="flex min-w-0 items-start gap-3">
                        <DotMatrix
                            rows={2}
                            cols={3}
                            activeDots={[0, 1, 2, 4]}
                            dotSize={3}
                            gap={3}
                            color="var(--color-section-marker-alt)"
                        />
                        <div className="min-w-0 flex-1">
                            <h2 className="ui-text-screen-title ui-color-primary tracking-tight">
                                {t({ id: "library.view.title", message: "Library" })}
                            </h2>
                            <p className="mt-1 ui-text-body-sm ui-color-secondary">
                                {t({
                                    id: "library.view.description",
                                    message: "Manage and search your transcribed audio and documents.",
                                })}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_minmax(14rem,1fr)_auto] md:items-center">
                        <button
                            onClick={handleImportClick}
                            className="flex items-center gap-2 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] px-3 py-1.5 ui-text-body-sm ui-color-primary hover:border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-overlay)] transition-colors shrink-0"
                        >
                            <Plus size={14} />
                            {t({ id: "library.view.import_button", message: "Import" })}
                        </button>

                        <div className="relative min-w-0 w-full group">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 ui-color-muted transition-colors" />
                            <input
                                type="text"
                                placeholder={t({
                                    id: "library.view.search_placeholder",
                                    message: "Search library... or use #tag",
                                })}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] rounded-lg focus:border-[var(--color-border-hover)] pl-9 pr-4 py-1.5 ui-text-input ui-color-primary placeholder-[var(--color-text-muted)] outline-none transition-all duration-100 ease-out"
                            />
                        </div>

                        <SegmentedControl
                            value={statusFilterValue}
                            options={statusFilterOptions}
                            onChange={(value) =>
                                setStatusFilter(value === "active" ? "transcribing" : value)
                            }
                            ariaLabel={t({
                                id: "library.filter.aria_label",
                                message: "Filter library by status",
                            })}
                            className="relative flex w-full items-center rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] p-1 md:w-auto"
                            activeIndicatorLayoutId="library-status-filter"
                        />

                    </div>
                </header>

                {error && (
                    <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-3 ui-text-body-sm ui-color-error-tint mx-4 mb-2">
                        {error}
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden custom-scrollbar scrollbar-gutter pb-6 pr-3 pt-1">
                <div key="library-list" className="flex flex-col gap-6 w-full">
                    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
                        <div className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]">
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
                            <button
                                type="button"
                                onClick={handleImportClick}
                                className="col-span-full rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-8 flex flex-col items-center justify-center text-center hover:text-content-secondary hover:border-border-hover transition-colors"
                            >
                                <FolderOpen size={20} className="text-content-disabled" />
                                <p className="mt-3 ui-text-body ui-color-muted">
                                    {t({
                                        id: "library.view.empty_state",
                                        message: "Click to import files and build your Library.",
                                    })}
                                </p>
                            </button>
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
                                onClickTag={(tag) => setSearchQuery(`#${tag}`)}
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
                                        message: "Click to import files",
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
