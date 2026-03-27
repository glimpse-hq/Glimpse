import React, {
    useState,
    useCallback,
} from "react";
import { motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import {
    useTranscriptionList,
    useDeleteTranscription,
    useRetryTranscription,
    useRetryLlmCleanup,
    useUndoLlmCleanup,
    useDeleteAllTranscriptions,
} from "../queries";
import TranscriptionItem from "./TranscriptionItem";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { useDebouncedValue } from "../../../shared/hooks/useDebouncedValue";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";

interface TranscriptionListProps {
    showLlmButtons?: boolean;
    isActive?: boolean;
}

const TranscriptionList: React.FC<TranscriptionListProps> = ({
    showLlmButtons = false,
    isActive = true,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [isClearing, setIsClearing] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
    const shiftHeld = useShiftHeld(isActive);

    // TanStack Query hooks
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
    const deleteAllMutation = useDeleteAllTranscriptions();

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
    const confirmClearAll = async () => {
        setIsClearing(true);
        try {
            await deleteAllMutation.mutateAsync();
            setShowConfirm(false);
        } catch (err) {
            console.error("Failed to clear all transcriptions:", err);
        } finally {
            setIsClearing(false);
        }
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

    const showEmptyState = totalCount === 0 && !debouncedSearchQuery && !isLoading;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-2xl"
        >
            <div className="flex items-center justify-between px-4 pb-3 mb-2">
                <div className="flex items-center gap-2">
                    <DotMatrix
                        rows={1}
                        cols={3}
                        activeDots={[0, 1, 2]}
                        dotSize={3}
                        gap={2}
                        color="var(--color-cloud)"
                        className="opacity-60"
                        aria-hidden="true"
                    />
                    <h2 className="ui-text-section-label ui-color-muted">
                        Recent Transcriptions
                    </h2>
                </div>

                <div className="relative">
                    <div className="relative flex items-center gap-2 bg-surface-secondary border border-border-primary rounded-lg px-2.5 py-1.5 focus-within:border-border-secondary transition-colors">
                        <Search size={12} className="text-content-disabled shrink-0" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search..."
                            aria-label="Search transcriptions"
                            className="bg-transparent ui-text-input-sm ui-color-secondary placeholder-content-disabled outline-hidden w-28 focus:w-36 transition-all pr-4"
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

            <div className="bg-surface-secondary rounded-xl border border-border-primary overflow-hidden relative" style={{ height: 460 }}>

                {showEmptyState ? (
                    <div className="h-full flex flex-col items-center justify-center">
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
                        <p className="ui-text-body ui-color-muted text-center max-w-xs">
                            Your recent transcriptions will appear here
                        </p>
                    </div>
                ) : transcriptions.length > 0 || isLoading ? (
                    <>
                        <div className="scroll-fade-top-dark" />
                        <Virtuoso
                            style={{ height: '100%' }}
                            data={transcriptions}
                            overscan={200}
                            components={{
                                Header: () => <div className="h-1.5" />,
                            }}
                            itemContent={(_index, record) => {
                                const isRetrying = retryingIds.includes(record.id);
                                return (
                                    <div className="pb-1 pl-1.5">
                                        <TranscriptionItem
                                            key={record.id}
                                            record={record}
                                            isRetrying={isRetrying}
                                            onDelete={deleteTranscription}
                                            onRetry={retryTranscription}
                                            onCancelRetry={cancelRetryTranscription}
                                            onRetryLlm={retryLlmCleanup}
                                            onUndoLlm={undoLlmCleanup}
                                            showLlmButtons={showLlmButtons}
                                            skipAnimation={!!debouncedSearchQuery}
                                            shiftHeld={shiftHeld}
                                        />
                                    </div>
                                );
                            }}
                            className="custom-scrollbar scrollbar-gutter"
                        />
                        <div className="scroll-fade-bottom-dark" />
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center">
                        <div className="flex flex-col items-center justify-center py-8 px-4">
                            <Search size={20} className="text-border-hover mb-2" />
                            <p className="ui-text-body-sm ui-color-disabled text-center">
                                No results for "{searchQuery}"
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between px-4 pt-2">
                <span className="ui-text-uppercase-meta text-border-hover">
                    {searchQuery ? (
                        `${transcriptions.length} result${transcriptions.length === 1 ? '' : 's'}`
                    ) : (
                        `${totalCount} ${totalCount === 1 ? 'transcription' : 'transcriptions'}`
                    )}
                </span>
                {transcriptions.length > 0 && (
                    showConfirm ? (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={confirmClearAll}
                                disabled={isClearing}
                                className="ui-text-uppercase-meta ui-color-error-soft hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isClearing ? 'Clearing...' : 'Confirm'}
                            </button>
                            <button
                                onClick={() => setShowConfirm(false)}
                                disabled={isClearing}
                                className="ui-text-uppercase-meta ui-color-muted hover:text-content-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowConfirm(true)}
                            className="ui-text-uppercase-meta ui-color-muted hover:text-red-400 transition-colors"
                        >
                            Clear All
                        </button>
                    )
                )}
            </div>

        </motion.div>
    );
};

export default React.memo(TranscriptionList);
