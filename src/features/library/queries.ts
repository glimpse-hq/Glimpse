import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as libraryApi from "./api";
import type {
  LibraryFilter,
  LibraryImportOptions,
  LibraryItem,
  LibraryItemPatch,
  LibraryItemStatus,
  LibraryItemsPage,
  LibraryProgressPayload,
  LibraryImportProgressPayload,
  ExportFormat,
} from "../../types";

const PAGE_SIZE = 30;

const LIBRARY_STALE_TIME = 5 * 60 * 1000;

export const libraryKeys = {
  all: ["library"] as const,
  lists: () => [...libraryKeys.all, "list"] as const,
  list: (filter: LibraryFilter) =>
    [...libraryKeys.all, "list", filter] as const,
  tags: () => [...libraryKeys.all, "tags"] as const,
  folders: () => [...libraryKeys.all, "folders"] as const,
  item: (id: string) => [...libraryKeys.all, "item", id] as const,
};

type LibraryInfiniteData = { pages: LibraryItemsPage[]; pageParams: number[] };

function patchItemInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  updater: (item: LibraryItem) => LibraryItem,
) {
  queryClient.setQueriesData<LibraryInfiniteData>(
    { queryKey: libraryKeys.lists() },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => {
            if (item.id !== id) return item;
            return updater(item);
          }),
        })),
      };
    },
  );
  queryClient.setQueryData<LibraryItem | null>(libraryKeys.item(id), (old) =>
    old ? updater(old) : old,
  );
}

export function useLibraryItems(
  filter: LibraryFilter = {},
  enabled: boolean = true,
) {
  const queryClient = useQueryClient();
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  // Progress and completion events aren't heard while the view is hidden, so
  // reload the list on return.
  useEffect(() => {
    if (!enabled) return;
    void queryClient.invalidateQueries(
      { queryKey: libraryKeys.all },
      { cancelRefetch: false },
    );
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const isProgressable = (status: LibraryItemStatus) =>
      status.type === "pending" ||
      status.type === "importing" ||
      status.type === "transcribing";

    // Items created outside this view (e.g. CLI imports) are missing from a
    // cached list; refetch once per unknown id.
    const refetchedIds = new Set<string>();
    const refetchIfMissing = (id: string) => {
      const shown = queryClient
        .getQueryData<LibraryInfiniteData>(libraryKeys.list(filterRef.current))
        ?.pages.some((page) => page.items.some((item) => item.id === id));
      const seen = `${JSON.stringify(filterRef.current)} ${id}`;
      if (shown || refetchedIds.has(seen)) return;
      refetchedIds.add(seen);
      queryClient.invalidateQueries({ queryKey: libraryKeys.lists() });
    };

    listen<LibraryProgressPayload>(
      "library:transcription_progress",
      (event) => {
        if (cancelled) return;
        const {
          id,
          progress,
          chunk_text,
          chunk_segments,
          current_chunk,
          total_chunks,
          detecting_speakers,
        } = event.payload;
        const patchStatus = () =>
          patchItemInCache(queryClient, id, (item) =>
            isProgressable(item.status)
              ? {
                  ...item,
                  status: {
                    type: "transcribing" as const,
                    progress,
                    detecting_speakers,
                  },
                }
              : item,
          );
        patchStatus();
        refetchIfMissing(id);
        const stageStarted = current_chunk === 0 && total_chunks === 0;
        if (!chunk_text && !chunk_segments && !stageStarted) return;
        // A read that started before this update was saved would drop it.
        // Invalidate alone joins a first load that has no data yet.
        const reload = (queryKey: QueryKey) =>
          queryClient
            .cancelQueries({ queryKey })
            .then(() => queryClient.invalidateQueries({ queryKey }));
        const listKey = libraryKeys.lists();
        if (queryClient.isFetching({ queryKey: listKey }) > 0)
          void reload(listKey);
        // Text is read, not appended: the saved item can already hold this chunk.
        void reload(libraryKeys.item(id)).then(() => {
          // The saved status doesn't record speaker detection.
          if (detecting_speakers) patchStatus();
        });
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ id: string }>("library:transcription_complete", (event) => {
      if (cancelled) return;
      const id = event.payload?.id;
      if (!id) {
        queryClient.invalidateQueries({ queryKey: libraryKeys.all });
        return;
      }
      patchItemInCache(queryClient, id, (item) => ({
        ...item,
        status: { type: "complete" as const },
      }));
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ id: string; message: string; cancelled: boolean }>(
      "library:transcription_error",
      (event) => {
        if (cancelled) return;
        const { id, message, cancelled: wasCancelled } = event.payload;
        patchItemInCache(queryClient, id, (item) => ({
          ...item,
          status: wasCancelled
            ? { type: "cancelled" as const }
            : { type: "error" as const, message },
        }));
        queryClient.invalidateQueries({ queryKey: libraryKeys.all });
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("library:item_restored", () => {
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<LibraryImportProgressPayload>("library:import_progress", (event) => {
      if (cancelled) return;
      const { id, progress } = event.payload;
      patchItemInCache(queryClient, id, (item) => {
        if (
          item.status.type === "transcribing" ||
          item.status.type === "complete" ||
          item.status.type === "cancelling" ||
          item.status.type === "cancelled"
        ) {
          return item;
        }
        return { ...item, status: { type: "importing" as const, progress } };
      });
      refetchIfMissing(id);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [enabled, queryClient]);

  return useInfiniteQuery({
    queryKey: libraryKeys.list(filter),
    queryFn: ({ pageParam = 0 }) =>
      libraryApi.getLibraryItemsPage(filter, PAGE_SIZE, pageParam),
    enabled,
    gcTime: 60_000,
    staleTime: LIBRARY_STALE_TIME,
    // Keep the current results on screen while a new search loads.
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.has_more) return undefined;
      return allPages.reduce((acc, p) => acc + p.items.length, 0);
    },
  });
}

// The open item in full; the list leaves out its transcript.
export function useLibraryItem(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: libraryKeys.item(id ?? ""),
    queryFn: () => libraryApi.getLibraryItem(id ?? ""),
    enabled: enabled && id !== null,
  });
}

export function useCreateLibraryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      path,
      options,
    }: {
      path: string;
      options: LibraryImportOptions;
    }) => libraryApi.createLibraryItem(path, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useUpdateLibraryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LibraryItemPatch }) =>
      libraryApi.updateLibraryItem(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(libraryKeys.item(updated.id), updated);
      queryClient.setQueriesData<LibraryInfiniteData>(
        { queryKey: [...libraryKeys.all, "list"] },
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            })),
          },
      );
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useDeleteLibraryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.deleteLibraryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useRestoreDeletedLibraryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.restoreDeletedLibraryItem,
    onSuccess: (id) => {
      if (id) queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useCancelLibraryTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.cancelLibraryTranscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useRetryLibraryTranscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.retryLibraryTranscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useRediarizeLibraryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.rediarizeLibraryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });
}

export function useExportLibraryItem() {
  return useMutation({
    mutationFn: ({
      id,
      format,
      outputPath,
    }: {
      id: string;
      format: ExportFormat;
      outputPath: string;
    }) => libraryApi.exportLibraryItemToPath(id, format, outputPath),
  });
}

export function useLibraryFolders(enabled: boolean = true) {
  return useQuery({
    queryKey: libraryKeys.folders(),
    queryFn: libraryApi.getLibraryFolders,
    enabled,
    gcTime: 60_000,
  });
}

export function useLibraryTags(enabled: boolean = true) {
  return useQuery({
    queryKey: libraryKeys.tags(),
    queryFn: libraryApi.getLibraryTags,
    enabled,
    gcTime: 60_000,
  });
}
