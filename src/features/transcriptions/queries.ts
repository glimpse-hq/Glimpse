import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as transcriptionsApi from "./api";
import { deriveTodayStats } from "./todayStats";
import type { TranscriptionRecord } from "../../types";

export const transcriptionKeys = {
  all: ["transcriptions"] as const,
  list: () => [...transcriptionKeys.all, "list"] as const,
};

export function useTranscriptionList(enabled: boolean = true) {
  return useQuery({
    queryKey: transcriptionKeys.list(),
    queryFn: transcriptionsApi.getTranscriptions,
    enabled,
    staleTime: Infinity,
  });
}

export function useTodayDictationStats(
  enabled: boolean = true,
  dayTick: number = 0,
) {
  const select = useCallback(
    (records: TranscriptionRecord[]) => deriveTodayStats(records),
    [dayTick],
  );

  return useQuery({
    queryKey: transcriptionKeys.list(),
    queryFn: transcriptionsApi.getTranscriptions,
    enabled,
    staleTime: Infinity,
    select,
  });
}

export function useDeleteTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transcriptionsApi.deleteTranscription,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: transcriptionKeys.list() });
      const previous = queryClient.getQueryData<TranscriptionRecord[]>(
        transcriptionKeys.list(),
      );
      queryClient.setQueryData<TranscriptionRecord[]>(
        transcriptionKeys.list(),
        (old) => old?.filter((record) => record.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(transcriptionKeys.list(), context.previous);
      }
    },
  });
}

export function useRetryTranscription(enabled: boolean = true) {
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const shouldListen = enabled || retryingIds.length > 0;

  useEffect(() => {
    if (!shouldListen) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const clearRetrying = () => {
      setRetryingIds((current) => (current.length > 0 ? [] : current));
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
  return useMutation({
    mutationFn: transcriptionsApi.retryLlmCleanup,
  });
}

export function useUndoLlmCleanup() {
  return useMutation({
    mutationFn: transcriptionsApi.undoLlmCleanup,
  });
}
