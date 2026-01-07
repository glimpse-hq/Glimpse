import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    syncLocalTranscription,
    batchSyncTranscriptions,
    listTranscriptions,
    deleteCloudTranscription,
    findByLocalOrDocumentId
} from "../lib";
import { useAuth } from "./useAuth";

export type TranscriptionRecord = {
    id: string;
    timestamp: string;
    text: string;
    raw_text?: string | null;
    audio_path: string;
    status: "success" | "error";
    error_message?: string;
    llm_cleaned: boolean;
    speech_model: string;
    llm_model?: string | null;
    word_count: number;
    audio_duration_seconds: number;
    synced: boolean;
};

interface UseTranscriptionsOptions {
    cloudSyncEnabled?: boolean;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = MAX_RETRY_ATTEMPTS,
    delayMs: number = RETRY_DELAY_MS
): Promise<T> {
    let lastError: Error | unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                const backoff = delayMs * Math.pow(2, attempt - 1);
                console.warn(`Attempt ${attempt} failed, retrying in ${backoff}ms...`, err);
                await sleep(backoff);
            }
        }
    }
    throw lastError;
}

export function useTranscriptions(options: UseTranscriptionsOptions = {}) {
    const getCloudSyncEnabled = useCallback(() => {
        if (typeof options.cloudSyncEnabled === "boolean") {
            return options.cloudSyncEnabled;
        }
        try {
            if (typeof localStorage === "undefined") {
                return false;
            }
            const stored = localStorage.getItem("glimpse_cloud_sync_enabled");
            return stored === "true";
        } catch {
            return false;
        }
    }, [options.cloudSyncEnabled]);

    const [resolvedCloudSyncEnabled, setResolvedCloudSyncEnabled] = useState(getCloudSyncEnabled);

    useEffect(() => {
        setResolvedCloudSyncEnabled(getCloudSyncEnabled());

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === "glimpse_cloud_sync_enabled") {
                setResolvedCloudSyncEnabled(e.newValue === "true");
            }
        };
        window.addEventListener("storage", handleStorageChange);

        let unlisten: (() => void) | null = null;
        listen("auth:changed", () => {
            setResolvedCloudSyncEnabled(getCloudSyncEnabled());
        }).then(fn => {
            unlisten = fn;
        });

        return () => {
            window.removeEventListener("storage", handleStorageChange);
            unlisten?.();
        };
    }, [getCloudSyncEnabled]);

    const { user } = useAuth();

    const [transcriptions, setTranscriptions] = useState<TranscriptionRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [retryingIds, setRetryingIds] = useState<string[]>([]);
    const retryingIdsRef = useRef<string[]>([]);

    useEffect(() => {
        retryingIdsRef.current = retryingIds;
    }, [retryingIds]);

    const [userId, setUserId] = useState<string | null>(null);
    const [isSubscriber, setIsSubscriber] = useState(false);
    const initialSyncDoneRef = useRef(false);

    useEffect(() => {
        setUserId(user?.$id ?? null);
        setIsSubscriber(user?.labels?.includes("subscriber") ?? false);
    }, [user]);

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

    // Initial load
    useEffect(() => {
        loadTranscriptions("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const syncToCloud = useCallback(async (record: TranscriptionRecord) => {
        if (!userId || !resolvedCloudSyncEnabled || !isSubscriber) return null;

        try {
            const cloudDoc = await withRetry(() => syncLocalTranscription(userId, record));
            await invoke("mark_transcription_synced", { id: record.id });
            setTranscriptions(prev => prev.map(t =>
                t.id === record.id ? { ...t, synced: true } : t
            ));
            return cloudDoc;
        } catch (err) {
            console.error("Failed to sync to cloud:", err);
            return null;
        }
    }, [resolvedCloudSyncEnabled, userId, isSubscriber]);

    const syncAllToCloud = useCallback(async () => {
        if (!userId || !resolvedCloudSyncEnabled || !isSubscriber) return;

        setIsSyncing(true);
        try {
            const unsyncedRecords = transcriptions.filter(r => !r.synced);
            if (unsyncedRecords.length === 0) return;

            console.log(`Batch syncing ${unsyncedRecords.length} records to cloud...`);
            const { synced, failed } = await batchSyncTranscriptions(userId, unsyncedRecords);

            for (const id of synced) {
                await invoke("mark_transcription_synced", { id });
            }

            if (synced.length > 0) {
                setTranscriptions(prev => prev.map(t =>
                    synced.includes(t.id) ? { ...t, synced: true } : t
                ));
            }

            if (failed.length > 0) {
                console.warn(`Failed to sync ${failed.length} records`);
            }
        } catch (err) {
            console.error("Failed to sync all to cloud:", err);
        } finally {
            setIsSyncing(false);
        }
    }, [resolvedCloudSyncEnabled, userId, isSubscriber, transcriptions]);

    const syncFromCloud = useCallback(async () => {
        if (!userId || !resolvedCloudSyncEnabled || !isSubscriber) return;

        setIsSyncing(true);
        try {
            const localRecords = transcriptions;

            // Fetch all cloud documents
            const PAGE_SIZE = 100;
            let offset = 0;
            let allCloudDocs: Awaited<ReturnType<typeof listTranscriptions>> = [];

            while (true) {
                const batch = await listTranscriptions(userId, PAGE_SIZE, offset);
                allCloudDocs = allCloudDocs.concat(batch);
                if (batch.length < PAGE_SIZE) break;
                offset += PAGE_SIZE;
            }

            let importedCount = 0;
            const normalizeModel = (m: string) => m?.replace(/^cloud-/, '') ?? '';

            for (const doc of allCloudDocs) {
                if (doc.is_deleted) continue;
                if (!doc.text || !doc.status) continue;

                const targetId = doc.local_id || doc.$id;
                const existsById = localRecords.some(r => r.id === targetId);
                const existsByTimestamp = doc.timestamp
                    ? localRecords.some(r => r.timestamp === doc.timestamp)
                    : false;
                const existsByContent = localRecords.some(r =>
                    r.text === doc.text &&
                    normalizeModel(r.speech_model) === normalizeModel(doc.speech_model) &&
                    Math.abs(r.audio_duration_seconds - doc.audio_duration_seconds) < 0.5
                );

                if (existsById || existsByTimestamp || existsByContent) continue;

                const localRecord: TranscriptionRecord = {
                    id: targetId,
                    timestamp: doc.timestamp || doc.$createdAt,
                    text: doc.text,
                    raw_text: doc.raw_text,
                    audio_path: "cloud_synced_placeholder",
                    status: doc.status === "success" ? "success" : "error",
                    error_message: doc.error_message || undefined,
                    llm_cleaned: doc.llm_cleaned,
                    speech_model: doc.speech_model,
                    llm_model: doc.llm_model,
                    word_count: doc.word_count,
                    audio_duration_seconds: doc.audio_duration_seconds,
                    synced: true,
                };

                const wasImported = await invoke<boolean>("import_transcription_from_cloud", { record: localRecord });
                if (wasImported) importedCount++;
            }

            if (importedCount > 0) {
                await loadTranscriptions();
            }
        } catch (err) {
            console.error("Failed to sync from cloud:", err);
        } finally {
            setIsSyncing(false);
        }
    }, [resolvedCloudSyncEnabled, userId, isSubscriber, transcriptions, loadTranscriptions]);

    const deleteTranscription = useCallback(async (id: string) => {
        try {
            await invoke("delete_transcription", { id });
            setTranscriptions(prev => prev.filter(t => t.id !== id));

            if (resolvedCloudSyncEnabled && userId && isSubscriber) {
                const cloudDoc = await findByLocalOrDocumentId(userId, id);
                if (cloudDoc) {
                    await deleteCloudTranscription(cloudDoc.$id);
                }
            }
        } catch (err) {
            console.error("Failed to delete transcription:", err);
            throw err;
        }
    }, [resolvedCloudSyncEnabled, userId, isSubscriber]);

    const retryTranscription = useCallback(async (id: string) => {
        try {
            await invoke("retry_transcription", { id });
            setRetryingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
        } catch (err) {
            const errStr = typeof err === "string" ? err : String(err);
            if (errStr && !errStr.includes("quota")) {
                console.error("Failed to retry transcription:", err);
            }
            throw err;
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
            const recordsToDelete = [...transcriptions];

            await invoke("delete_all_transcriptions");
            setTranscriptions([]);

            if (resolvedCloudSyncEnabled && userId && isSubscriber && recordsToDelete.length > 0) {
                await Promise.all(recordsToDelete.map(async (record) => {
                    try {
                        const cloudDoc = await findByLocalOrDocumentId(userId, record.id);
                        if (cloudDoc) {
                            await deleteCloudTranscription(cloudDoc.$id);
                        }
                    } catch (e) {
                        console.error(`Failed to soft delete cloud doc for ${record.id}:`, e);
                    }
                }));
            }
        } catch (err) {
            console.error("Failed to clear all transcriptions:", err);
            throw err;
        }
    }, [transcriptions, resolvedCloudSyncEnabled, userId, isSubscriber]);

    // Cloud sync on auth ready
    useEffect(() => {
        if (resolvedCloudSyncEnabled && userId && isSubscriber && !initialSyncDoneRef.current) {
            initialSyncDoneRef.current = true;
            (async () => {
                await syncFromCloud();
                await syncAllToCloud();
            })();
        }
    }, [resolvedCloudSyncEnabled, userId, isSubscriber, syncFromCloud, syncAllToCloud]);

    // Event listeners for transcription updates
    useEffect(() => {
        let isCancelled = false;
        const unlisteners: (() => void)[] = [];

        listen<{ id: string }>("transcription:complete", async (event) => {
            if (isCancelled) return;
            await loadTranscriptions();
            if (retryingIdsRef.current.length > 0) {
                setRetryingIds([]);
            }

            // Background sync to cloud
            if (resolvedCloudSyncEnabled && userId && isSubscriber) {
                const records = await invoke<TranscriptionRecord[]>("get_transcriptions", { searchQuery: null });
                const newRecord = records.find(r => r.id === event.payload?.id) || records[0];

                if (newRecord && !newRecord.synced) {
                    withRetry(() => syncLocalTranscription(userId, newRecord)).then(async () => {
                        if (isCancelled) return;
                        await invoke("mark_transcription_synced", { id: newRecord.id });
                        setTranscriptions(prev => prev.map(t =>
                            t.id === newRecord.id ? { ...t, synced: true } : t
                        ));
                    }).catch(err => {
                        console.error("Background sync failed after retries:", err);
                    });
                }
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
    }, [loadTranscriptions, resolvedCloudSyncEnabled, userId, isSubscriber]);

    return {
        transcriptions,
        totalCount: transcriptions.length,
        isLoading,
        error,
        isSyncing,
        deleteTranscription,
        retryTranscription,
        retryingIds,
        retryLlmCleanup,
        undoLlmCleanup,
        clearAllTranscriptions,
        refresh: loadTranscriptions,
        searchTranscriptions,
        syncToCloud,
        syncAllToCloud,
        syncFromCloud,
    };
}
