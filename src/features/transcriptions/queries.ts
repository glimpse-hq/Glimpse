import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as transcriptionsApi from "./api";

export const transcriptionKeys = {
  all: ["transcriptions"] as const,
  list: (search: string) => [...transcriptionKeys.all, "list", search] as const,
};

export function useTranscriptionList(
  searchQuery: string = "",
  enabled: boolean = true,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    };

    listen("transcription:complete", () => {
      if (!cancelled) invalidate();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("transcription:error", () => {
      if (!cancelled) invalidate();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [enabled, queryClient]);

  return useQuery({
    queryKey: transcriptionKeys.list(searchQuery),
    queryFn: () =>
      transcriptionsApi.getTranscriptions(searchQuery || null),
    enabled,
    gcTime: 60_000,
  });
}

export function useDeleteTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transcriptionsApi.deleteTranscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    },
  });
}

export function useRetryTranscription(enabled: boolean = true) {
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const retryingIdsRef = useRef<string[]>([]);
  const queryClient = useQueryClient();
  const shouldListen = enabled || retryingIds.length > 0;

  useEffect(() => {
    retryingIdsRef.current = retryingIds;
  }, [retryingIds]);

  useEffect(() => {
    if (!shouldListen) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const clearRetrying = () => {
      if (retryingIdsRef.current.length > 0) {
        setRetryingIds([]);
      }
    };

    listen("transcription:complete", () => {
      if (!cancelled) clearRetrying();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("transcription:error", () => {
      if (!cancelled) clearRetrying();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [shouldListen]);

  const mutation = useMutation({
    mutationFn: transcriptionsApi.retryTranscription,
    onMutate: (id) => {
      setRetryingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    onError: (_error, id) => {
      setRetryingIds((prev) => prev.filter((entry) => entry !== id));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    },
  });

  const cancelRetry = useMutation({
    mutationFn: transcriptionsApi.cancelRetryTranscription,
    onSettled: (_data, _error, id) => {
      setRetryingIds((prev) => prev.filter((entry) => entry !== id));
    },
  });

  return { retry: mutation, cancelRetry, retryingIds };
}

export function useRetryLlmCleanup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transcriptionsApi.retryLlmCleanup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    },
  });
}

export function useUndoLlmCleanup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transcriptionsApi.undoLlmCleanup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    },
  });
}

export function useDeleteAllTranscriptions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transcriptionsApi.deleteAllTranscriptions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    },
  });
}
