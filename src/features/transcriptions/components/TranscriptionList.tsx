import { useLingui } from "@lingui/react/macro";
import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MagnifyingGlass as Search,
  X,
  Trash,
  Warning as AlertTriangle,
} from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import {
  useTranscriptionList,
  useDeleteTranscription,
  useDeleteTranscriptionsForDay,
  useRetryTranscription,
  useRetryLlmCleanup,
  useUndoLlmCleanup,
} from "../queries";
import TranscriptionItem from "./TranscriptionItem";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { useDebouncedValue } from "../../../shared/hooks/useDebouncedValue";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import FilterMenu from "../../../shared/ui/FilterMenu";
import type { TranscriptionRecord } from "../../../types";
import {
  parseTranscriptionSearch,
  withSortToken,
  withTimePreset,
  currentTimePreset,
  type TranscriptionSort,
  type TimePreset,
} from "../searchQuery";

interface TranscriptionListProps {
  showLlmButtons?: boolean;
  isActive?: boolean;
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const areSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const dayRange = (date: Date) => {
  const start = startOfDay(date);
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 1,
  );
  return { startMs: start.getTime(), endMs: end.getTime() };
};

type DayDeletion = ReturnType<typeof dayRange> & { label: string };

const VirtualListHeader = () => <div className="h-3" />;
const VirtualListFooter = () => <div className="h-3" />;
const virtuosoComponents = {
  Header: VirtualListHeader,
  Footer: VirtualListFooter,
};

const TranscriptionList: React.FC<TranscriptionListProps> = ({
  showLlmButtons = false,
  isActive = true,
}) => {
  const { i18n, t } = useLingui();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dayToDelete, setDayToDelete] = useState<DayDeletion | null>(null);
  const [deleteDayError, setDeleteDayError] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const shiftHeld = useShiftHeld(isActive);

  useClickOutside(
    searchRef,
    () => {
      if (!searchQuery.trim()) setSearchOpen(false);
    },
    searchOpen,
  );

  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  const parsed = useMemo(
    () => parseTranscriptionSearch(searchQuery),
    [searchQuery],
  );
  const debouncedText = useMemo(
    () => parseTranscriptionSearch(debouncedSearchQuery).text,
    [debouncedSearchQuery],
  );
  const filter = useMemo(
    () => ({
      search: debouncedText.trim() || undefined,
      afterMs: parsed.after?.getTime(),
      beforeMs: parsed.before?.getTime(),
      sort: parsed.sort,
    }),
    [debouncedText, parsed.after, parsed.before, parsed.sort],
  );

  const {
    records,
    totalCount,
    recordAt,
    previousTimestampAt,
    requestRange,
    isLoading,
    isFetched,
  } = useTranscriptionList(filter, isActive);
  const deleteMutation = useDeleteTranscription();
  const deleteDayMutation = useDeleteTranscriptionsForDay();
  const {
    retry: retryMutation,
    cancelRetry: cancelRetryMutation,
    retryingIds,
  } = useRetryTranscription(isActive);
  const { retryLlm: retryLlmMutation, cleaningIds } = useRetryLlmCleanup();
  const undoLlmMutation = useUndoLlmCleanup();
  const retryingIdSet = useMemo(() => new Set(retryingIds), [retryingIds]);
  const cleaningIdSet = useMemo(() => new Set(cleaningIds), [cleaningIds]);
  const overflowByIdRef = useRef(new Map<string, boolean>());
  const rememberOverflow = useCallback((id: string, overflowing: boolean) => {
    overflowByIdRef.current.set(id, overflowing);
  }, []);

  const freshIdsRef = useRef<{
    data: TranscriptionRecord[] | null;
    seen: Set<string>;
  }>({ data: null, seen: new Set() });

  const freshIds = useMemo(() => {
    if (!isFetched) return new Set<string>();
    const cache = freshIdsRef.current;
    if (cache.data === records) return new Set<string>();
    const fresh = new Set<string>();
    for (const record of records) {
      if (cache.data !== null && !cache.seen.has(record.id)) {
        fresh.add(record.id);
      }
      cache.seen.add(record.id);
    }
    cache.data = records;
    return fresh;
  }, [records, isFetched]);

  useEffect(() => {
    if (freshIds.size === 0) return;
    const timer = setTimeout(() => freshIds.clear(), 600);
    return () => clearTimeout(timer);
  }, [freshIds]);

  const isTimeSorted = parsed.sort === "recent" || parsed.sort === "oldest";

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
        return target.toLocaleDateString(i18n.locale, { weekday: "long" });
      }
      if (target.getFullYear() === now.getFullYear()) {
        return target.toLocaleDateString(i18n.locale, {
          month: "long",
          day: "numeric",
        });
      }
      return target.toLocaleDateString(i18n.locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [i18n.locale, t],
  );

  const deleteTranscription = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  const requestDeleteDay = useCallback(
    (date: Date) => {
      setDeleteDayError(false);
      setDayToDelete({
        ...dayRange(date),
        label: formatGroupLabel(date),
      });
    },
    [formatGroupLabel],
  );

  const confirmDeleteDay = useCallback(async () => {
    if (!dayToDelete || deleteDayMutation.isPending) return;
    setDeleteDayError(false);
    try {
      await deleteDayMutation.mutateAsync({
        startMs: dayToDelete.startMs,
        endMs: dayToDelete.endMs,
      });
      setDayToDelete(null);
    } catch (error) {
      console.error("Failed to delete the day's transcriptions:", error);
      setDeleteDayError(true);
    }
  }, [dayToDelete, deleteDayMutation]);

  const retryTranscription = useCallback(
    async (id: string) => {
      await retryMutation.mutateAsync(id);
    },
    [retryMutation],
  );

  const cancelRetryTranscription = useCallback(
    async (id: string) => {
      await cancelRetryMutation.mutateAsync(id);
    },
    [cancelRetryMutation],
  );

  const retryLlmCleanup = useCallback(
    async (id: string) => {
      await retryLlmMutation.mutateAsync(id);
    },
    [retryLlmMutation],
  );

  const undoLlmCleanup = useCallback(
    async (id: string) => {
      await undoLlmMutation.mutateAsync(id);
    },
    [undoLlmMutation],
  );

  const sortOptions: { value: TranscriptionSort; label: string }[] = [
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

  const timeOptions: { value: TimePreset; label: string }[] = [
    {
      value: "any",
      label: t({ id: "transcriptions.time.any", message: "Any time" }),
    },
    {
      value: "today",
      label: t({ id: "transcriptions.time.today", message: "Today" }),
    },
    {
      value: "7d",
      label: t({ id: "transcriptions.time.7d", message: "Past 7 days" }),
    },
  ];

  const activeTimePreset = currentTimePreset(parsed.after, parsed.before);

  const renderEntry = useCallback(
    (index: number) => {
      const record = recordAt(index);
      if (!record) {
        return <div className="h-[124px]" aria-hidden="true" />;
      }
      const timestamp = new Date(record.timestamp);
      const previousTimestamp = previousTimestampAt(index);
      const startsGroup =
        isTimeSorted &&
        (!previousTimestamp ||
          !areSameDay(timestamp, new Date(previousTimestamp)));

      return (
        <div
          className={
            freshIds.has(record.id)
              ? "transcription-entry transcription-entry-fade"
              : "transcription-entry"
          }
        >
          {startsGroup && (
            <div
              className={`group/day flex items-center gap-3 pb-2 px-1 ${index === 0 ? "pt-1" : "pt-6"}`}
            >
              <span className="ui-text-body-sm-strong ui-color-secondary shrink-0">
                {formatGroupLabel(timestamp)}
              </span>
              <div className="ui-divider-trailing flex-1" aria-hidden="true" />
              <button
                type="button"
                onClick={() => requestDeleteDay(timestamp)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md ui-color-muted opacity-0 transition-[opacity,color,background-color] group-hover/day:opacity-100 hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100"
                aria-label={t({
                  id: "transcriptions.group.delete_day_aria",
                  message: "Delete all transcriptions for this day",
                })}
              >
                <Trash size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          <TranscriptionItem
            record={record}
            initialOverflowing={overflowByIdRef.current.get(record.id)}
            onOverflowChange={rememberOverflow}
            isRetrying={retryingIdSet.has(record.id)}
            isCleaning={cleaningIdSet.has(record.id)}
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
      freshIds,
      formatGroupLabel,
      requestDeleteDay,
      t,
      isTimeSorted,
      previousTimestampAt,
      recordAt,
      retryingIdSet,
      cleaningIdSet,
      rememberOverflow,
      deleteTranscription,
      retryTranscription,
      cancelRetryTranscription,
      retryLlmCleanup,
      undoLlmCleanup,
      showLlmButtons,
      shiftHeld,
    ],
  );

  const hasQuery = searchQuery.trim().length > 0;
  const resultSearchText = parsed.text.trim();
  const showInitialLoading = isLoading && !isFetched;
  const hasAnyResults = totalCount > 0;
  const showEmptyState = isFetched && totalCount === 0 && !hasQuery;
  const showNoResults = isFetched && !hasAnyResults && hasQuery;

  return (
    <div className="w-full flex-1 min-h-0 h-0 flex flex-col">
      <div className="mb-2 h-8 shrink-0 flex justify-end" ref={searchRef}>
        <AnimatePresence initial={false} mode="wait">
          {searchOpen ? (
            <motion.div
              key="search-input"
              initial={{ opacity: 0, width: 32 }}
              animate={{ opacity: 1, width: 272 }}
              exit={{ opacity: 0, width: 32 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center gap-2 h-8 px-0.5 border-b border-border-secondary bg-transparent transition-colors focus-within:border-content-primary"
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
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
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
              {hasQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label={t({
                    id: "transcriptions.list.search.clear",
                    message: "Clear search",
                  })}
                  className="p-0.5 rounded text-content-disabled hover:text-content-muted transition-colors shrink-0"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
              <FilterMenu
                ariaLabel={t({
                  id: "transcriptions.list.filter.aria",
                  message: "Sort and filter transcriptions",
                })}
                active={parsed.sort !== "recent" || activeTimePreset !== "any"}
                onClear={() =>
                  setSearchQuery((q) =>
                    withTimePreset(withSortToken(q, "recent"), "any"),
                  )
                }
                sections={[
                  {
                    key: "sort",
                    title: t({
                      id: "transcriptions.filter.sort",
                      message: "Sort",
                    }),
                    items: sortOptions.map((opt) => ({
                      key: opt.value,
                      label: opt.label,
                      selected: opt.value === parsed.sort,
                      onSelect: () =>
                        setSearchQuery((q) => withSortToken(q, opt.value)),
                    })),
                  },
                  {
                    key: "when",
                    title: t({
                      id: "transcriptions.filter.when",
                      message: "When",
                    }),
                    items: timeOptions.map((opt) => ({
                      key: opt.value,
                      label: opt.label,
                      selected: opt.value === activeTimePreset,
                      onSelect: () =>
                        setSearchQuery((q) => withTimePreset(q, opt.value)),
                    })),
                  },
                ]}
              />
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
                message: "Your recent transcriptions will appear here",
              })}
            </p>
          </div>
        ) : showNoResults ? (
          <div className="h-full flex flex-col items-center justify-center">
            <Search
              size={18}
              className="text-content-disabled mb-2"
              aria-hidden="true"
            />
            <p className="ui-text-body-sm ui-color-muted">
              {resultSearchText
                ? t({
                    id: "transcriptions.list.no_results",
                    message: `No results for "${resultSearchText}"`,
                  })
                : t({
                    id: "transcriptions.list.no_results_filters",
                    message: "No results for selected filters",
                  })}
            </p>
          </div>
        ) : (
          <>
            {showInitialLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
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
            <Virtuoso
              style={{ height: "100%" }}
              totalCount={showInitialLoading ? 0 : totalCount}
              defaultItemHeight={124}
              overscan={400}
              increaseViewportBy={400}
              computeItemKey={(index) =>
                recordAt(index)?.id ?? `loading-${index}`
              }
              components={virtuosoComponents}
              itemContent={renderEntry}
              rangeChanged={requestRange}
              className="custom-scrollbar scrollbar-gutter"
            />
          </>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {dayToDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
              onClick={() => {
                if (!deleteDayMutation.isPending) setDayToDelete(null);
              }}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-day-title"
              >
                <div className="mb-3 flex items-start gap-3">
                  <AlertTriangle
                    size={20}
                    className="ui-color-warning-strong mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p
                      id="delete-day-title"
                      className="ui-text-body-lg font-semibold text-content-primary"
                    >
                      {t({
                        id: "transcriptions.group.delete_confirm.title",
                        message: "Delete this day's transcriptions?",
                      })}
                    </p>
                    <p className="ui-text-label text-content-disabled">
                      {t({
                        id: "transcriptions.group.delete_confirm.description",
                        message:
                          "This permanently removes every transcription and its audio for this day.",
                      })}
                    </p>
                    <p className="mt-1 ui-text-label font-medium text-content-secondary">
                      {dayToDelete.label}
                    </p>
                    {deleteDayError && (
                      <p className="mt-2 ui-text-label ui-color-error-strong">
                        {t({
                          id: "transcriptions.group.delete_confirm.error",
                          message:
                            "Couldn't delete the transcriptions. Try again.",
                        })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={deleteDayMutation.isPending}
                    onClick={() => setDayToDelete(null)}
                    className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary transition-colors hover:border-border-hover disabled:opacity-50"
                  >
                    {t({ id: "library.modal.cancel", message: "Cancel" })}
                  </button>
                  <button
                    type="button"
                    disabled={deleteDayMutation.isPending}
                    onClick={() => void confirmDeleteDay()}
                    className="rounded-lg bg-red-500/90 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-solid transition-colors hover:bg-red-500 disabled:opacity-50"
                  >
                    {deleteDayMutation.isPending
                      ? t({
                          id: "transcriptions.group.delete_confirm.deleting",
                          message: "Deleting...",
                        })
                      : t({
                          id: "transcriptions.group.delete_confirm.action",
                          message: "Delete all",
                        })}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export default React.memo(TranscriptionList);
