import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useLingui } from "@lingui/react/macro";
import * as transcriptionsApi from "./api";
import { showErrorToast } from "../../shared/lib/errorToast";
import type {
  TranscriptionFilter,
  TranscriptionPage,
  TranscriptionRecord,
} from "../../types";

type CompletePayload = { record?: TranscriptionRecord | null };
type ErrorPayload = { stage: string; id?: string };

const PAGE_SIZE = 50;
const FIRST_PAGE = [0];

type VisibleRange = { startIndex: number; endIndex: number };
type PageRequest = { filterKey: string; pages: number[] };

const getFilterKey = (filter: TranscriptionFilter) =>
  [
    filter.search ?? "",
    filter.afterMs ?? "",
    filter.beforeMs ?? "",
    filter.sort,
  ].join("\0");

const getPagesForRange = (
  { startIndex, endIndex }: VisibleRange,
  totalCount: number,
) => {
  const pageCount = Math.ceil(totalCount / PAGE_SIZE);
  const first = Math.max(0, Math.floor(startIndex / PAGE_SIZE) - 1);
  const last = Math.min(pageCount - 1, Math.floor(endIndex / PAGE_SIZE) + 1);
  const pages = [0];
  for (let page = first; page <= last; page += 1) {
    if (page !== 0) pages.push(page);
  }
  return pages;
};

const hasSamePages = (request: PageRequest, pages: number[]) =>
  request.pages.length === pages.length &&
  request.pages.every((page, index) => page === pages[index]);

export const transcriptionKeys = {
  all: ["transcriptions"] as const,
  lists: () => [...transcriptionKeys.all, "list"] as const,
  page: (filter: TranscriptionFilter, page: number) =>
    [...transcriptionKeys.lists(), filter, page] as const,
  today: (dayKey: string) =>
    [...transcriptionKeys.all, "today", dayKey] as const,
};

export function useTranscriptionList(
  filter: TranscriptionFilter,
  enabled: boolean = true,
) {
  const filterKey = getFilterKey(filter);
  const [pageRequest, setPageRequest] = useState<PageRequest>(() => ({
    filterKey,
    pages: FIRST_PAGE,
  }));
  const requestedPages =
    pageRequest.filterKey === filterKey ? pageRequest.pages : FIRST_PAGE;
  const pageQueries = useQueries({
    queries: requestedPages.map((page) => ({
      queryKey: transcriptionKeys.page(filter, page),
      queryFn: () =>
        transcriptionsApi.getTranscriptionsPage(
          filter,
          PAGE_SIZE,
          page * PAGE_SIZE,
        ),
      enabled,
      staleTime: Infinity,
      gcTime: 60_000,
    })),
  });
  const pageByIndex = useMemo(() => {
    const pages = new Map<number, TranscriptionPage>();
    requestedPages.forEach((page, index) => {
      const data = pageQueries[index]?.data;
      if (data) pages.set(page, data);
    });
    return pages;
  }, [pageQueries, requestedPages]);
  const totalCount = pageByIndex.get(0)?.totalCount ?? 0;

  const requestRange = useCallback(
    (range: VisibleRange) => {
      const pages = getPagesForRange(range, totalCount);
      setPageRequest((current) => {
        if (current.filterKey === filterKey && hasSamePages(current, pages)) {
          return current;
        }
        return { filterKey, pages };
      });
    },
    [filterKey, totalCount],
  );

  const recordAt = useCallback(
    (index: number) => {
      const page = Math.floor(index / PAGE_SIZE);
      return pageByIndex.get(page)?.items[index % PAGE_SIZE];
    },
    [pageByIndex],
  );
  const previousTimestampAt = useCallback(
    (index: number) => {
      const page = Math.floor(index / PAGE_SIZE);
      const localIndex = index % PAGE_SIZE;
      const data = pageByIndex.get(page);
      if (!data) return undefined;
      return localIndex === 0
        ? data.previousTimestamp
        : data.items[localIndex - 1]?.timestamp;
    },
    [pageByIndex],
  );

  return {
    records: [...pageByIndex.values()].flatMap((page) => page.items),
    totalCount,
    recordAt,
    previousTimestampAt,
    requestRange,
    isLoading: pageQueries[0]?.isLoading ?? enabled,
    isFetched: pageQueries[0]?.isFetched ?? false,
  };
}

export function useTodayDictationStats(enabled: boolean = true) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dayKey = start.toDateString();

  return useQuery({
    queryKey: transcriptionKeys.today(dayKey),
    queryFn: () =>
      transcriptionsApi.getTodayDictationStats(start.getTime(), end.getTime()),
    enabled,
    staleTime: Infinity,
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

export function useDeleteTranscriptionsForDay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ startMs, endMs }: { startMs: number; endMs: number }) =>
      transcriptionsApi.deleteTranscriptionsForDay(startMs, endMs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
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

    const clearRetrying = (id?: string) => {
      setRetryingIds((current) => {
        if (current.length === 0) return current;
        if (!id) return [];
        return current.includes(id)
          ? current.filter((entry) => entry !== id)
          : current;
      });
    };

    // Errors carry no record id, so they end every retry.
    listen<CompletePayload>("transcription:complete", (event) => {
      if (!cancelled) clearRetrying(event.payload?.record?.id);
    }).then((fn) => {
      if (cancelled) void Promise.resolve(fn()).catch(() => {});
      else unlisteners.push(fn);
    });

    listen("transcription:error", () => {
      if (!cancelled) clearRetrying();
    }).then((fn) => {
      if (cancelled) void Promise.resolve(fn()).catch(() => {});
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => void Promise.resolve(fn()).catch(() => {}));
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

// Cleanup runs in the background; an id stays busy until its event arrives.
// Listens while mounted, since a cleanup can finish before a lazy listener is ready.
export function useRetryLlmCleanup() {
  const { t } = useLingui();
  const [cleaningIds, setCleaningIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    listen<CompletePayload>("transcription:complete", (event) => {
      const id = event.payload?.record?.id;
      if (cancelled || !id) return;
      setCleaningIds((prev) => prev.filter((entry) => entry !== id));
    }).then((fn) => {
      if (cancelled) void Promise.resolve(fn()).catch(() => {});
      else unlisteners.push(fn);
    });

    listen<ErrorPayload>("transcription:error", (event) => {
      if (cancelled || event.payload?.stage !== "llm_cleanup") return;
      const failedId = event.payload.id;
      setCleaningIds((prev) =>
        failedId ? prev.filter((entry) => entry !== failedId) : [],
      );
      showErrorToast(
        t({
          id: "transcriptions.cleanup_retry_failed",
          message: "Couldn't clean up the transcription.",
        }),
      );
    }).then((fn) => {
      if (cancelled) void Promise.resolve(fn()).catch(() => {});
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => void Promise.resolve(fn()).catch(() => {}));
    };
  }, [t]);

  const mutation = useMutation({
    mutationFn: transcriptionsApi.retryLlmCleanup,
    onMutate: (id) => {
      setCleaningIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    onError: (_error, id) => {
      setCleaningIds((prev) => prev.filter((entry) => entry !== id));
    },
  });

  return { retryLlm: mutation, cleaningIds };
}

export function useUndoLlmCleanup() {
  return useMutation({
    mutationFn: transcriptionsApi.undoLlmCleanup,
  });
}
