import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
    LibraryFilter,
    LibraryImportOptions,
    LibraryItem,
    LibraryItemPatch,
    LibraryItemStatus,
    LibraryProgressPayload,
    LibraryImportProgressPayload,
    ExportFormat,
    LibraryItemsPage,
} from "../types";

type LibraryCompletePayload = { id: string };
type LibraryErrorPayload = { id: string; message: string };

export function useLibraryItems(initialFilter: LibraryFilter = {}) {
    const PAGE_SIZE = 30;
    const [items, setItems] = useState<LibraryItem[]>([]);
    const [filter, setFilter] = useState<LibraryFilter>(initialFilter);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const isMountedRef = useRef(true);
    const itemsLengthRef = useRef(0);

    useEffect(() => {
        itemsLengthRef.current = items.length;
    }, [items.length]);

    const loadPage = useCallback(async ({
        nextFilter,
        offset,
        limit,
        append,
    }: {
        nextFilter?: LibraryFilter;
        offset: number;
        limit: number;
        append: boolean;
    }) => {
        const filterPayload = nextFilter ?? filter;
        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }
        setError(null);
        try {
            const result = await invoke<LibraryItemsPage>("get_library_items_page", {
                filter: filterPayload,
                limit,
                offset,
            });
            if (isMountedRef.current) {
                setItems(prev => (append ? [...prev, ...result.items] : result.items));
                setHasMore(result.has_more);
            }
        } catch (err) {
            console.error("Failed to load library items:", err);
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    }, [filter]);

    const loadItems = useCallback(async (nextFilter?: LibraryFilter, limitOverride?: number) => {
        const limit = Math.max(limitOverride ?? PAGE_SIZE, 1);
        await loadPage({ nextFilter, offset: 0, limit, append: false });
    }, [loadPage]);

    const setFilterAndReload = useCallback((next: LibraryFilter) => {
        setFilter(next);
        setItems([]);
        setHasMore(true);
    }, []);

    const createItem = useCallback(async (path: string, options: LibraryImportOptions) => {
        const item = await invoke<LibraryItem>("create_library_item", { path, options });
        setItems(prev => [item, ...prev]);
        return item;
    }, []);

    const updateItem = useCallback(async (id: string, patch: LibraryItemPatch) => {
        const updated = await invoke<LibraryItem>("update_library_item", { id, patch });
        setItems(prev => prev.map(item => (item.id === id ? updated : item)));
        return updated;
    }, []);

    const deleteItem = useCallback(async (id: string) => {
        await invoke("delete_library_item", { id });
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const cancelTranscription = useCallback(async (id: string) => {
        setItems(prev =>
            prev.map(item =>
                item.id === id
                    ? { ...item, status: { type: "cancelling" } }
                    : item
            )
        );
        await invoke("cancel_library_transcription", { id });
    }, []);

    const retryTranscription = useCallback(async (id: string) => {
        setItems(prev =>
            prev.map(item =>
                item.id === id
                    ? { ...item, status: { type: "pending" } }
                    : item
            )
        );
        await invoke("retry_library_transcription", { id });
    }, []);

    const exportItem = useCallback(async (id: string, format: ExportFormat, outputPath: string) => {
        await invoke("export_library_item_to_path", { id, format, outputPath });
    }, []);

    const refresh = useCallback(async () => {
        const target = Math.max(itemsLengthRef.current, PAGE_SIZE);
        const pages = Math.ceil(target / PAGE_SIZE);
        let merged: LibraryItem[] = [];
        let hasMoreResult = true;
        setIsLoading(true);
        setError(null);
        try {
            for (let page = 0; page < pages; page += 1) {
                const result = await invoke<LibraryItemsPage>("get_library_items_page", {
                    filter,
                    limit: PAGE_SIZE,
                    offset: page * PAGE_SIZE,
                });
                merged = [...merged, ...result.items];
                hasMoreResult = result.has_more;
                if (!hasMoreResult) break;
            }
            if (isMountedRef.current) {
                setItems(merged);
                setHasMore(hasMoreResult);
            }
        } catch (err) {
            console.error("Failed to refresh library items:", err);
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    }, [filter]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const unlisteners: UnlistenFn[] = [];

        const isProgressable = (status: LibraryItemStatus) =>
            status.type === "pending"
            || status.type === "importing"
            || status.type === "transcribing";

        const setupListeners = async () => {
            const [
                unlistenProgress,
                unlistenComplete,
                unlistenError,
                unlistenImportProgress,
            ] = await Promise.all([
                listen<LibraryProgressPayload>("library:transcription_progress", (event) => {
                    const { id, progress, chunk_text, chunk_segments, current_chunk, total_chunks } = event.payload;
                    setItems(prev =>
                        prev.map(item => {
                            if (item.id !== id) return item;
                            if (!isProgressable(item.status)) return item;
                            let nextTranscript = item.transcript;
                            let updateTranscript = false;
                            const isReset = current_chunk === 0 && total_chunks === 0;
                            if (isReset) {
                                nextTranscript = "";
                                updateTranscript = true;
                            }
                            if (chunk_text && chunk_text.trim().length > 0) {
                                const base = isReset ? "" : item.transcript ?? "";
                                const separator = base.trim().length > 0 ? "\n" : "";
                                nextTranscript = `${base}${separator}${chunk_text}`;
                                updateTranscript = true;
                            }
                            let nextSegments = item.segments;
                            let updateSegments = false;
                            if (isReset) {
                                nextSegments = [];
                                updateSegments = true;
                            }
                            if (chunk_segments && chunk_segments.length > 0) {
                                const base = isReset ? [] : item.segments ?? [];
                                nextSegments = [...base, ...chunk_segments];
                                updateSegments = true;
                            }
                            return {
                                ...item,
                                status: { type: "transcribing", progress },
                                ...(updateTranscript ? { transcript: nextTranscript } : {}),
                                ...(updateSegments ? { segments: nextSegments } : {}),
                            };
                        })
                    );
                }),
                listen<LibraryCompletePayload>("library:transcription_complete", (event) => {
                    const id = event.payload?.id;
                    if (!id) {
                        loadItems();
                        return;
                    }
                    setItems(prev =>
                        prev.map(item =>
                            item.id === id ? { ...item, status: { type: "complete" } } : item
                        )
                    );
                    refresh();
                }),
                listen<LibraryErrorPayload>("library:transcription_error", (event) => {
                    const { id, message } = event.payload;
                    const isCancelled = message.toLowerCase().includes("cancelled")
                        || message.toLowerCase().includes("canceled");
                    setItems(prev =>
                        prev.map(item =>
                            item.id === id
                                ? {
                                    ...item,
                                    status: isCancelled ? { type: "cancelled" } : { type: "error", message },
                                }
                                : item
                        )
                    );
                    refresh();
                }),
                listen<LibraryImportProgressPayload>("library:import_progress", (event) => {
                    const { id, progress } = event.payload;
                    setItems(prev =>
                        prev.map(item =>
                            item.id === id
                                ? (item.status.type === "transcribing"
                                    || item.status.type === "complete"
                                    || item.status.type === "cancelling"
                                    || item.status.type === "cancelled"
                                    ? item
                                    : { ...item, status: { type: "importing", progress } })
                                : item
                        )
                    );
                }),
            ]);

            if (cancelled) {
                unlistenProgress();
                unlistenComplete();
                unlistenError();
                unlistenImportProgress();
                return;
            }

            unlisteners.push(
                unlistenProgress,
                unlistenComplete,
                unlistenError,
                unlistenImportProgress,
            );
        };

        setupListeners();

        return () => {
            cancelled = true;
            unlisteners.forEach(fn => fn());
        };
    }, [loadItems, refresh]);

    const loadMore = useCallback(async () => {
        if (isLoading || isLoadingMore || !hasMore) return;
        await loadPage({ offset: items.length, limit: PAGE_SIZE, append: true });
    }, [hasMore, isLoading, isLoadingMore, items.length, loadPage]);

    return {
        items,
        filter,
        isLoading,
        isLoadingMore,
        error,
        hasMore,
        loadItems,
        setFilter: setFilterAndReload,
        createItem,
        updateItem,
        deleteItem,
        cancelTranscription,
        retryTranscription,
        exportItem,
        loadMore,
        refresh,
    };
}
