import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TranscriptionRecord } from "../types";

export type { TranscriptionRecord };

export function useTranscriptions() {
    const [transcriptions, setTranscriptions] = useState<TranscriptionRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retryingIds, setRetryingIds] = useState<string[]>([]);
    const retryingIdsRef = useRef<string[]>([]);

    useEffect(() => {
        retryingIdsRef.current = retryingIds;
    }, [retryingIds]);

    const loadTranscriptions = useCallback(async (query?: string) => {
        const searchFor = query ?? searchQuery;
        setIsLoading(true);
        setError(null);
        try {
            const records = await invoke<TranscriptionRecord[]>("get_transcriptions", {
                searchQuery: searchFor || null,
            });
            setTranscriptions(records);
        } catch (err) {
            console.error("Failed to load transcriptions:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsLoading(false);
        }
    }, [searchQuery]);

    const searchTranscriptions = useCallback(async (query: string) => {
        setSearchQuery(query);
        await loadTranscriptions(query);
    }, [loadTranscriptions]);

    useEffect(() => {
        loadTranscriptions("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const deleteTranscription = useCallback(async (id: string) => {
        try {
            await invoke("delete_transcription", { id });
            setTranscriptions(prev => prev.filter(t => t.id !== id));
        } catch (err) {
            console.error("Failed to delete transcription:", err);
            throw err;
        }
    }, []);

    const retryTranscription = useCallback(async (id: string) => {
        try {
            await invoke("retry_transcription", { id });
            setRetryingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
        } catch (err) {
            console.error("Failed to retry transcription:", err);
            throw err;
        }
    }, []);

    const cancelRetryTranscription = useCallback(async (id: string) => {
        try {
            await invoke("cancel_retry_transcription", { id });
        } catch (err) {
            console.error("Failed to cancel retry transcription:", err);
        } finally {
            setRetryingIds(prev => prev.filter(entry => entry !== id));
        }
    }, []);

    const retryLlmCleanup = useCallback(async (id: string) => {
        try {
            await invoke("retry_llm_cleanup", { id });
        } catch (err) {
            console.error("Failed to retry LLM cleanup:", err);
        }
    }, []);

    const undoLlmCleanup = useCallback(async (id: string) => {
        try {
            await invoke("undo_llm_cleanup", { id });
        } catch (err) {
            console.error("Failed to undo LLM cleanup:", err);
        }
    }, []);

    const clearAllTranscriptions = useCallback(async () => {
        try {
            await invoke("delete_all_transcriptions");
            setTranscriptions([]);
        } catch (err) {
            console.error("Failed to clear all transcriptions:", err);
            throw err;
        }
    }, []);

    useEffect(() => {
        let isCancelled = false;
        const unlisteners: (() => void)[] = [];

        listen("transcription:complete", async () => {
            if (isCancelled) return;
            await loadTranscriptions();
            if (retryingIdsRef.current.length > 0) {
                setRetryingIds([]);
            }
        }).then(fn => {
            if (!isCancelled) unlisteners.push(fn);
            else fn();
        });

        listen("transcription:error", () => {
            if (isCancelled) return;
            loadTranscriptions();
            if (retryingIdsRef.current.length > 0) {
                setRetryingIds([]);
            }
        }).then(fn => {
            if (!isCancelled) unlisteners.push(fn);
            else fn();
        });

        return () => {
            isCancelled = true;
            unlisteners.forEach(fn => fn());
        };
    }, [loadTranscriptions]);

    return {
        transcriptions,
        totalCount: transcriptions.length,
        isLoading,
        error,
        deleteTranscription,
        retryTranscription,
        cancelRetryTranscription,
        retryingIds,
        retryLlmCleanup,
        undoLlmCleanup,
        clearAllTranscriptions,
        refresh: loadTranscriptions,
        searchTranscriptions,
    };
}
