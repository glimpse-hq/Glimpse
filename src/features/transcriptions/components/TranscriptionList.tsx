import { useLingui } from "@lingui/react/macro";
import React, {
    useState,
    useCallback,
    useMemo,
    useRef,
    useEffect,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowDownUp, Check } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import {
    useTranscriptionList,
    useDeleteTranscription,
    useRetryTranscription,
    useRetryLlmCleanup,
    useUndoLlmCleanup,
} from "../queries";
import TranscriptionItem from "./TranscriptionItem";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { useDebouncedValue } from "../../../shared/hooks/useDebouncedValue";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import type { TranscriptionRecord } from "../../../types";

interface TranscriptionListProps {
    showLlmButtons?: boolean;
    isActive?: boolean;
}

type SortKey = "recent" | "oldest" | "longest" | "shortest";

type ListEntry =
    | { type: "header"; id: string; label: string }
    | { type: "item"; record: TranscriptionRecord };

const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

const TranscriptionList: React.FC<TranscriptionListProps> = ({
    showLlmButtons = false,
    isActive = true,
}) => {
    const { t } = useLingui();
    const [searchQuery, setSearchQuery] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>("recent");
    const [sortOpen, setSortOpen] = useState(false);
    const sortRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
    const shiftHeld = useShiftHeld(isActive);

    useClickOutside(sortRef, () => setSortOpen(false), sortOpen);

    useEffect(() => {
        if (!searchOpen) return;
        const id = requestAnimationFrame(() => {
            searchInputRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [searchOpen]);

    const {
        data: transcriptions = [],
        isLoading,
        isFetched,
    } = useTranscriptionList(debouncedSearchQuery, isActive);
    const totalCount = transcriptions.length;
    const deleteMutation = useDeleteTranscription();
    const { retry: retryMutation, cancelRetry: cancelRetryMutation, retryingIds } = useRetryTranscription(isActive);
    const retryLlmMutation = useRetryLlmCleanup();
    const undoLlmMutation = useUndoLlmCleanup();
    const retryingIdSet = useMemo(() => new Set(retryingIds), [retryingIds]);

    const sortedTranscriptions = useMemo(() => {
        if (sortKey === "recent") return transcriptions;
        const copy = [...transcriptions];
        switch (sortKey) {
            case "oldest":
                copy.sort(
                    (a, b) =>
                        new Date(a.timestamp).getTime() -
                        new Date(b.timestamp).getTime(),
                );
                break;
            case "longest":
                copy.sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0));
                break;
            case "shortest":
                copy.sort((a, b) => (a.word_count ?? 0) - (b.word_count ?? 0));
                break;
        }
        return copy;
    }, [transcriptions, sortKey]);

    const isTimeSorted = sortKey === "recent" || sortKey === "oldest";

    const formatGroupLabel = useCallback(
        (date: Date) => {
            const now = new Date();
            const today = startOfDay(now);
            const target = startOfDay(date);
            const diffDays = Math.round(
                (today.getTime() - target.getTime()) / 86400000,
            );
            if (diffDays === 0)
                return t({ id: "transcriptions.group.today", message: "Today" });
            if (diffDays === 1)
                return t({
                    id: "transcriptions.group.yesterday",
                    message: "Yesterday",
                });
            if (diffDays > 1 && diffDays < 7) {
                return target.toLocaleDateString([], { weekday: "long" });
            }
            if (target.getFullYear() === now.getFullYear()) {
                return target.toLocaleDateString([], {
                    month: "long",
                    day: "numeric",
                });
            }
            return target.toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
            });
        },
        [t],
    );

    const entries: ListEntry[] = useMemo(() => {
        if (!isTimeSorted) {
            return sortedTranscriptions.map((record) => ({
                type: "item" as const,
                record,
            }));
        }
        const result: ListEntry[] = [];
        let currentLabel: string | null = null;
        for (const record of sortedTranscriptions) {
            const label = formatGroupLabel(new Date(record.timestamp));
            if (label !== currentLabel) {
                result.push({
                    type: "header",
                    id: `h-${label}-${record.id}`,
                    label,
                });
                currentLabel = label;
            }
            result.push({ type: "item", record });
        }
        return result;
    }, [sortedTranscriptions, isTimeSorted, formatGroupLabel]);

    const deleteTranscription = useCallback(async (id: string) => {
        await deleteMutation.mutateAsync(id);
    }, [deleteMutation]);

    const retryTranscription = useCallback(async (id: string) => {
        await retryMutation.mutateAsync(id);
    }, [retryMutation]);

    const cancelRetryTranscription = useCallback(async (id: string) => {
        await cancelRetryMutation.mutateAsync(id);
    }, [cancelRetryMutation]);

    const retryLlmCleanup = useCallback(async (id: string) => {
        await retryLlmMutation.mutateAsync(id);
    }, [retryLlmMutation]);

    const undoLlmCleanup = useCallback(async (id: string) => {
        await undoLlmMutation.mutateAsync(id);
    }, [undoLlmMutation]);

    const sortOptions: { value: SortKey; label: string }[] = [
        {
            value: "recent",
            label: t({
                id: "transcriptions.sort.recent",
                message: "Newest first",
            }),
        },
        {
            value: "oldest",
            label: t({
                id: "transcriptions.sort.oldest",
                message: "Oldest first",
            }),
        },
        {
            value: "longest",
            label: t({
                id: "transcriptions.sort.longest",
                message: "Longest",
            }),
        },
        {
            value: "shortest",
            label: t({
                id: "transcriptions.sort.shortest",
                message: "Shortest",
            }),
        },
    ];

    const renderEntry = useCallback(
        (_index: number, entry: ListEntry) => {
            if (entry.type === "header") {
                return (
                    <div className="transcription-entry-fade flex items-center gap-3 pt-6 pb-2 px-1 first:pt-1">
                        <span className="ui-text-body-sm-strong ui-color-secondary shrink-0">
                            {entry.label}
                        </span>
                        <div
                            className="ui-divider-trailing flex-1"
                            aria-hidden="true"
                        />
                    </div>
                );
            }

            const record = entry.record;
            return (
                <div className="transcription-entry-fade">
                    <TranscriptionItem
                        record={record}
                        isRetrying={retryingIdSet.has(record.id)}
                        onDelete={deleteTranscription}
                        onRetry={retryTranscription}
                        onCancelRetry={cancelRetryTranscription}
                        onRetryLlm={retryLlmCleanup}
                        onUndoLlm={undoLlmCleanup}
                        showLlmButtons={showLlmButtons}
                        shiftHeld={shiftHeld}
                        showDate={!isTimeSorted}
                    />
                </div>
            );
        },
        [
            retryingIdSet,
            deleteTranscription,
            retryTranscription,
            cancelRetryTranscription,
            retryLlmCleanup,
            undoLlmCleanup,
            showLlmButtons,
            shiftHeld,
            isTimeSorted,
        ],
    );

    const virtuosoComponents = useMemo(
        () => ({
            Header: () => <div className="h-1" />,
            Footer: () => <div className="h-6" />,
        }),
        [],
    );

    const closeSearch = () => {
        setSearchOpen(false);
        setSearchQuery("");
    };

    if (isLoading && transcriptions.length === 0 && !debouncedSearchQuery && !isFetched) {
        return (
            <div className="flex items-center justify-center py-12">
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
        );
    }

    const hasAnyResults = sortedTranscriptions.length > 0;
    const showEmptyState = totalCount === 0 && !debouncedSearchQuery && !isLoading;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full flex-1 min-h-0 flex flex-col"
        >
            <div className="flex items-center justify-end gap-1 mb-3 h-8 shrink-0">
                <AnimatePresence initial={false} mode="wait">
                    {searchOpen ? (
                        <motion.div
                            key="search-input"
                            initial={{ opacity: 0, width: 32 }}
                            animate={{ opacity: 1, width: 240 }}
                            exit={{ opacity: 0, width: 32 }}
                            transition={{ duration: 0.16, ease: "easeOut" }}
                            className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-primary bg-surface-secondary/60 overflow-hidden"
                        >
                            <Search
                                size={12}
                                className="text-content-disabled shrink-0"
                                aria-hidden="true"
                            />
                            <input
                                ref={searchInputRef}
                                type="text"
                                autoFocus
                                value={searchQuery}
                                onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") closeSearch();
                                }}
                                placeholder={t({
                                    id: "transcriptions.list.search.placeholder_short",
                                    message: "Search",
                                })}
                                aria-label={t({
                                    id: "transcriptions.list.search.aria",
                                    message: "Search transcriptions",
                                })}
                                className="bg-transparent ui-text-body-sm ui-color-secondary placeholder-content-disabled outline-hidden flex-1 min-w-0"
                            />
                            <button
                                onClick={closeSearch}
                                aria-label={t({
                                    id: "transcriptions.list.search.close",
                                    message: "Close search",
                                })}
                                className="p-0.5 rounded text-content-disabled hover:text-content-muted transition-colors shrink-0"
                            >
                                <X size={12} aria-hidden="true" />
                            </button>
                        </motion.div>
                    ) : (
                        <motion.button
                            key="search-button"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12 }}
                            onClick={() => setSearchOpen(true)}
                            aria-label={t({
                                id: "transcriptions.list.search.open",
                                message: "Search transcriptions",
                            })}
                            className="ui-button-ghost h-8 w-8"
                        >
                            <Search size={13} aria-hidden="true" />
                        </motion.button>
                    )}
                </AnimatePresence>

                <div className="relative" ref={sortRef}>
                    <button
                        type="button"
                        onClick={() => setSortOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={sortOpen}
                        aria-label={t({
                            id: "transcriptions.list.sort.aria",
                            message: "Sort transcriptions",
                        })}
                        className="ui-button-ghost h-8 w-8"
                    >
                        <ArrowDownUp size={13} aria-hidden="true" />
                    </button>
                    <AnimatePresence>
                        {sortOpen && (
                            <motion.div
                                role="menu"
                                initial={{ opacity: 0, scale: 0.98, y: -2 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.98, y: -2 }}
                                transition={{ duration: 0.12 }}
                                className="ui-surface-menu absolute right-0 top-full mt-1 z-30 min-w-[160px]"
                            >
                                {sortOptions.map((opt) => {
                                    const selected = opt.value === sortKey;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            role="menuitemradio"
                                            aria-checked={selected}
                                            onClick={() => {
                                                setSortKey(opt.value);
                                                setSortOpen(false);
                                            }}
                                            className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 ui-text-body-sm transition-colors ${
                                                selected
                                                    ? "ui-color-primary bg-[var(--surface-interactive-strong)]"
                                                    : "ui-color-secondary hover:bg-[var(--surface-interactive)] hover:text-content-primary"
                                            }`}
                                        >
                                            <span>{opt.label}</span>
                                            <span className="w-3 flex items-center justify-center shrink-0">
                                                {selected && (
                                                    <Check
                                                        size={12}
                                                        aria-hidden="true"
                                                    />
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
                <div
                    className="pointer-events-none absolute left-0 right-3 top-0 h-6 z-10"
                    style={{
                        background:
                            "linear-gradient(to bottom, var(--color-bg-tertiary), transparent)",
                    }}
                    aria-hidden="true"
                />
                <div
                    className="pointer-events-none absolute left-0 right-3 bottom-0 h-8 z-10"
                    style={{
                        background:
                            "linear-gradient(to top, var(--color-bg-tertiary), transparent)",
                    }}
                    aria-hidden="true"
                />
                {showEmptyState ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                        <DotMatrix
                            rows={4}
                            cols={4}
                            activeDots={[0, 3, 5, 6, 9, 10, 12, 15]}
                            dotSize={4}
                            gap={4}
                            color="var(--color-text-disabled)"
                            className="opacity-40 mb-4"
                            aria-hidden="true"
                        />
                        <p className="ui-text-body ui-color-muted max-w-xs">
                            {t({
                                id: "transcriptions.list.empty",
                                message:
                                    "Your recent transcriptions will appear here",
                            })}
                        </p>
                    </div>
                ) : hasAnyResults || isLoading ? (
                    <Virtuoso
                        style={{ height: "100%" }}
                        data={entries}
                        defaultItemHeight={90}
                        overscan={400}
                        increaseViewportBy={200}
                        computeItemKey={(_index, entry) =>
                            entry.type === "header"
                                ? entry.id
                                : entry.record.id
                        }
                        components={virtuosoComponents}
                        itemContent={renderEntry}
                        className="custom-scrollbar scrollbar-gutter"
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center">
                        <Search
                            size={18}
                            className="text-content-disabled mb-2"
                            aria-hidden="true"
                        />
                        <p className="ui-text-body-sm ui-color-muted">
                            {t({
                                id: "transcriptions.list.no_results",
                                message: `No results for "${debouncedSearchQuery}"`,
                            })}
                        </p>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default React.memo(TranscriptionList);
