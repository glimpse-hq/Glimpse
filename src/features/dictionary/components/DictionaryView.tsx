import { useQueryClient } from "@tanstack/react-query";
import { useLingui } from "@lingui/react/macro";
import {
  useState,
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Warning as AlertTriangle, ArrowRight, X } from "@phosphor-icons/react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import HoverTip from "../../../shared/ui/HoverTip";
import ScreenHeader from "../../../shared/ui/ScreenHeader";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
} from "../../../shared/lib/modelCapabilities";
import { isRemoteSpeechConfigured } from "../../../shared/lib/speechProviders";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useModelCatalog } from "../../settings/models-queries";
import { useSettings } from "../../settings/queries";
import * as dictionaryApi from "../api";
import {
  setDictionaryEntriesCache,
  setDictionaryReplacementsCache,
  useReplacements,
} from "../queries";
import type { Replacement } from "../../../types";

const normalizeEntry = (value: string) => value.trim();
const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const DICTIONARY_ENTRY_LIMIT = 64;

type QueuedPersistOptions<T> = {
  value: T;
  persist: (next: T) => Promise<T>;
  setError: Dispatch<SetStateAction<string | null>>;
  setValue: (next: T) => void;
};

function useQueuedPersist<T>({
  value,
  persist,
  setError,
  setValue,
}: QueuedPersistOptions<T>) {
  const [pending, setPending] = useState(false);
  const currentRef = useRef(value);
  const persistedRef = useRef(value);
  const queuedRef = useRef<T | null>(null);
  const isPersistingRef = useRef(false);

  if (!isPersistingRef.current && queuedRef.current === null) {
    currentRef.current = value;
    persistedRef.current = value;
  }

  const persistNext = useCallback(
    async (next: T) => {
      queuedRef.current = next;
      currentRef.current = next;
      setValue(next);

      if (isPersistingRef.current) return;

      isPersistingRef.current = true;
      setPending(true);
      setError(null);

      try {
        while (queuedRef.current !== null) {
          const queuedValue = queuedRef.current;
          queuedRef.current = null;
          const cleaned = await persist(queuedValue);
          if (
            queuedRef.current === null ||
            Object.is(queuedRef.current, queuedValue)
          ) {
            currentRef.current = cleaned;
            persistedRef.current = cleaned;
            setValue(cleaned);
          }
        }
      } catch (error) {
        console.error(error);
        queuedRef.current = null;
        const fallbackValue = persistedRef.current;
        currentRef.current = fallbackValue;
        setValue(fallbackValue);
        setError(toErrorMessage(error));
      } finally {
        isPersistingRef.current = false;
        setPending(false);
      }
    },
    [persist, setError, setValue],
  );

  return { currentRef, pending, persistNext };
}

const DictionaryView = ({ isActive = true }: { isActive?: boolean }) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const shiftHeld = useShiftHeld(isActive);
  const settingsQuery = useSettings(undefined, isActive);
  const modelsQuery = useModelCatalog(isActive);
  const replacementsQuery = useReplacements(isActive);

  const [newEntry, setNewEntry] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [editingReplacementIndex, setEditingReplacementIndex] = useState<
    number | null
  >(null);
  const [editingFrom, setEditingFrom] = useState("");
  const [editingTo, setEditingTo] = useState("");

  const [error, setError] = useState<string | null>(null);

  const settings = settingsQuery.data ?? null;
  const models = modelsQuery.data ?? [];
  const entries = settings?.dictionary ?? [];
  const replacements = replacementsQuery.data ?? [];
  const bootstrapError =
    settingsQuery.error ?? modelsQuery.error ?? replacementsQuery.error;
  const loading =
    isActive &&
    (settingsQuery.isLoading ||
      modelsQuery.isLoading ||
      replacementsQuery.isLoading);

  const {
    currentRef: entriesRef,
    pending: entriesPending,
    persistNext: persistEntriesNext,
  } = useQueuedPersist({
    value: entries,
    persist: dictionaryApi.setDictionary,
    setError,
    setValue: (next) => setDictionaryEntriesCache(queryClient, next),
  });
  const {
    currentRef: replacementsRef,
    pending: replacementsPending,
    persistNext: persistReplacementsNext,
  } = useQueuedPersist({
    value: replacements,
    persist: dictionaryApi.setReplacements,
    setError,
    setValue: (next) => setDictionaryReplacementsCache(queryClient, next),
  });

  const searchQuery = newEntry.trim().toLowerCase();
  const filteredEntries = searchQuery
    ? entries.filter((entry) => entry.toLowerCase().includes(searchQuery))
    : entries;
  const isSearching = searchQuery.length > 0;

  const persistEntries = useCallback(
    async (next: string[]) => {
      setEditingIndex(null);
      setEditingValue("");
      setNewEntry("");
      await persistEntriesNext(next);
    },
    [persistEntriesNext],
  );

  const persistReplacements = useCallback(
    async (next: Replacement[]) => {
      setEditingReplacementIndex(null);
      setEditingFrom("");
      setEditingTo("");
      setNewFrom("");
      setNewTo("");
      await persistReplacementsNext(next);
    },
    [persistReplacementsNext],
  );

  const handleAdd = async () => {
    const value = normalizeEntry(newEntry);
    const currentEntries = entriesRef.current;
    if (
      !value ||
      currentEntries.length >= DICTIONARY_ENTRY_LIMIT ||
      currentEntries.includes(value)
    )
      return;
    await persistEntries([...currentEntries, value]);
  };

  const handleEditCommit = async () => {
    if (editingIndex === null) return;
    const currentEntries = entriesRef.current;
    const value = normalizeEntry(editingValue);
    if (!value) {
      const next = currentEntries.filter((_, idx) => idx !== editingIndex);
      await persistEntries(next);
      return;
    }
    const next = currentEntries.map((entry, idx) =>
      idx === editingIndex ? value : entry,
    );
    await persistEntries(next);
  };

  const handleDelete = async (idx: number) => {
    const next = entriesRef.current.filter((_, i) => i !== idx);
    await persistEntries(next);
  };

  const startEditing = (idx: number) => {
    const currentEntries = entriesRef.current;
    setEditingIndex(idx);
    setEditingValue(currentEntries[idx] ?? "");
  };

  const handleAddReplacement = async () => {
    const currentReplacements = replacementsRef.current;
    const from = normalizeEntry(newFrom);
    const to = normalizeEntry(newTo);
    if (!from) return;
    const exists = currentReplacements.some(
      (r) => r.from.toLowerCase() === from.toLowerCase(),
    );
    if (exists) return;
    await persistReplacements([...currentReplacements, { from, to }]);
  };

  const handleEditReplacementCommit = async () => {
    if (editingReplacementIndex === null) return;
    const currentReplacements = replacementsRef.current;
    const from = normalizeEntry(editingFrom);
    const to = normalizeEntry(editingTo);
    if (!from) {
      const next = currentReplacements.filter(
        (_, idx) => idx !== editingReplacementIndex,
      );
      await persistReplacements(next);
      return;
    }
    const next = currentReplacements.map((r, idx) =>
      idx === editingReplacementIndex ? { from, to } : r,
    );
    await persistReplacements(next);
  };

  const handleDeleteReplacement = async (idx: number) => {
    const next = replacementsRef.current.filter((_, i) => i !== idx);
    await persistReplacements(next);
  };

  const startEditingReplacement = (idx: number) => {
    const currentReplacements = replacementsRef.current;
    setEditingReplacementIndex(idx);
    setEditingFrom(currentReplacements[idx]?.from ?? "");
    setEditingTo(currentReplacements[idx]?.to ?? "");
  };

  const currentModel = models.find((m) => m.key === settings?.local_model);
  const isLocal = settings?.transcription_mode === "local";
  const remoteSpeechActive = isRemoteSpeechConfigured({
    enabled: Boolean(settings?.remote_speech_enabled),
    provider: settings?.remote_speech_provider ?? "custom",
    endpoint: settings?.remote_speech_endpoint ?? "",
    model: settings?.remote_speech_model ?? "",
    apiKey: settings?.remote_speech_api_key ?? "",
  });
  const supportsDictionary = hasModelCapability(
    currentModel,
    MODEL_CAPABILITY_DICTIONARY,
  );
  const showWarning = Boolean(
    isLocal && !remoteSpeechActive && currentModel && !supportsDictionary,
  );
  const dictionaryCountLabel =
    isSearching && entries.length > 0
      ? t({
          id: "dictionary.search_matches",
          message: `${filteredEntries.length} of ${entries.length} matches`,
        })
      : t({
          id: "dictionary.entry_count.of_limit",
          message: `${entries.length} of ${DICTIONARY_ENTRY_LIMIT}`,
        });
  const isDictionaryFull = entries.length >= DICTIONARY_ENTRY_LIMIT;
  const dictionaryInputPlaceholder = isDictionaryFull
    ? t({
        id: "dictionary.search_only",
        message: "Search dictionary...",
      })
    : t({
        id: "dictionary.search_or_add",
        message: "Search or add a word...",
      });
  const resolvedError =
    error ?? (bootstrapError ? toErrorMessage(bootstrapError) : null);
  const panelBodyClassName =
    "mt-4 -mr-4 max-h-[calc(100vh-320px)] md:max-h-none md:min-h-0 md:flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar pr-[10px] pb-8 [scrollbar-gutter:stable] [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]";
  const deleteHoverClassName = shiftHeld
    ? "text-error"
    : "text-content-disabled hover:text-error";
  const deleteTextClassName = shiftHeld
    ? "group-hover:!text-error group-hover:line-through"
    : "";
  const loadingIndicator = (
    <div className="flex items-center py-10">
      <DotMatrix
        rows={2}
        cols={6}
        activeDots={[0, 1, 2, 3, 4, 5]}
        dotSize={3}
        gap={3}
        color="var(--color-content-muted)"
        animated
        className="opacity-60"
      />
    </div>
  );

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto px-0 text-left">
      <ScreenHeader
        icon={
          <DotMatrix
            rows={2}
            cols={3}
            activeDots={[0, 1, 2, 3]}
            dotSize={3}
            gap={3}
            color="var(--color-section-marker)"
          />
        }
        title={t({
          id: "dictionary.combined.title",
          message: "Dictionary & Replacements",
        })}
        description={t({
          id: "dictionary.header.description",
          message:
            "Add words Glimpse should recognize and phrases to replace after transcription.",
        })}
      />

      <div className="grid w-full min-w-0 grid-cols-1 gap-x-14 gap-y-10 md:h-[calc(100vh-200px)] md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center gap-3">
            <h3 className="shrink-0 ui-text-section-label-sm ui-color-muted">
              {t({
                id: "dictionary.section.dictionary_title",
                message: "Dictionary",
              })}
            </h3>
            {showWarning && (
              <HoverTip
                label={t({
                  id: "dictionary.warning.ignored_by",
                  message: `Ignored by ${currentModel?.label ?? settings?.local_model}`,
                })}
                detail={t({
                  id: "dictionary.warning.switch_model",
                  message:
                    "Choose a model with dictionary support to use these words.",
                })}
                className="flex shrink-0 items-center ui-color-warning"
              >
                <AlertTriangle
                  size={13}
                  tabIndex={0}
                  aria-label={t({
                    id: "dictionary.warning.ignored_by",
                    message: `Ignored by ${currentModel?.label ?? settings?.local_model}`,
                  })}
                  className="outline-hidden"
                />
              </HoverTip>
            )}
            <span
              className="ml-auto shrink-0 ui-text-meta ui-color-disabled tabular-nums"
              role={isSearching && entries.length > 0 ? "status" : undefined}
            >
              {dictionaryCountLabel}
            </span>
          </div>

          <div className="mt-3 border-b border-border-primary pb-2 transition-colors focus-within:border-border-hover">
            <input
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={dictionaryInputPlaceholder}
              aria-label={t({
                id: "dictionary.search_or_add_aria",
                message: "Add or search dictionary entry",
              })}
              className="h-8 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
            />
          </div>

          <div aria-busy={entriesPending} className={panelBodyClassName}>
            {loading ? (
              loadingIndicator
            ) : filteredEntries.length === 0 ? (
              <p className="ui-text-meta ui-color-disabled text-pretty">
                {isSearching
                  ? isDictionaryFull
                    ? t({
                        id: "dictionary.full_add_prompt",
                        message: "Delete an entry before adding another.",
                      })
                    : t({
                        id: "dictionary.add_prompt",
                        message: `Press Enter to add "${newEntry.trim()}" as a new entry.`,
                      })
                  : t({
                      id: "dictionary.empty_hint",
                      message: "Type a word above and press Enter to add it.",
                    })}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filteredEntries.map((entry, filteredIndex) => {
                  const originalIndex = entries.indexOf(entry);
                  const key = `${entry}-${originalIndex}-${filteredIndex}`;
                  if (editingIndex === originalIndex) {
                    return (
                      <input
                        key={key}
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        size={Math.max(editingValue.length, 1)}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleEditCommit();
                          }
                          if (e.key === "Escape") {
                            setEditingIndex(null);
                            setEditingValue("");
                          }
                        }}
                        onBlur={() => handleEditCommit()}
                        aria-label={t({
                          id: "dictionary.edit_entry",
                          message: `Edit ${entry}`,
                        })}
                        className="h-7 min-w-12 rounded-md border border-border-hover bg-transparent px-2.5 ui-text-body-sm ui-color-primary outline-hidden"
                      />
                    );
                  }
                  return (
                    <span
                      key={key}
                      className="group inline-flex h-7 max-w-full items-center rounded-md bg-[var(--surface-interactive)] transition-colors"
                    >
                      <button
                        onClick={() =>
                          shiftHeld
                            ? handleDelete(originalIndex)
                            : startEditing(originalIndex)
                        }
                        className={`min-w-0 truncate pl-2.5 pr-0.5 ui-text-body-sm ui-color-primary transition-colors duration-100 ${deleteTextClassName}`}
                        title={
                          shiftHeld
                            ? t({
                                id: "dictionary.delete_entry",
                                message: `Delete ${entry}`,
                              })
                            : undefined
                        }
                      >
                        {entry}
                      </button>
                      <button
                        onClick={() => handleDelete(originalIndex)}
                        className={`mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${deleteHoverClassName}`}
                        aria-label={t({
                          id: "dictionary.delete_entry",
                          message: `Delete ${entry}`,
                        })}
                      >
                        <X size={11} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <h3 className="ui-text-section-label-sm ui-color-muted">
              {t({
                id: "dictionary.section.replacements_title",
                message: "Replacements",
              })}
            </h3>
            <span className="ui-text-meta ui-color-disabled tabular-nums">
              {replacements.length}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)_24px] sm:items-end">
            <div className="border-b border-border-primary pb-2 transition-colors focus-within:border-border-hover">
              <input
                value={newFrom}
                onChange={(e) => setNewFrom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddReplacement();
                  }
                }}
                placeholder={t({
                  id: "dictionary.replacements.find",
                  message: "Find word...",
                })}
                aria-label={t({
                  id: "dictionary.replacements.find_aria",
                  message: "Find word to replace",
                })}
                className="h-8 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
              />
            </div>
            <div className="mb-2 hidden h-8 items-center text-content-muted sm:flex">
              <ArrowRight size={14} aria-hidden="true" />
            </div>
            <div className="border-b border-border-primary pb-2 transition-colors focus-within:border-border-hover sm:col-span-2">
              <input
                value={newTo}
                onChange={(e) => setNewTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddReplacement();
                  }
                }}
                placeholder={t({
                  id: "dictionary.replacements.replace_with",
                  message: "Replace with...",
                })}
                aria-label={t({
                  id: "dictionary.replacements.replace_with_aria",
                  message: "Replace with",
                })}
                className="h-8 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
              />
            </div>
          </div>

          <div aria-busy={replacementsPending} className={panelBodyClassName}>
            {loading ? (
              loadingIndicator
            ) : replacements.length === 0 ? (
              <p className="ui-text-meta ui-color-disabled text-pretty">
                {t({
                  id: "dictionary.replacements.empty_hint",
                  message:
                    "Press Enter in either field to add. Matches ignore capitalization.",
                })}
              </p>
            ) : (
              <ul className="divide-y divide-border-primary">
                {replacements.map((replacement, idx) => {
                  const key = `${replacement.from}-${idx}`;
                  if (editingReplacementIndex === idx) {
                    const editKeyDown = (
                      e: React.KeyboardEvent<HTMLInputElement>,
                    ) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleEditReplacementCommit();
                      }
                      if (e.key === "Escape") {
                        setEditingReplacementIndex(null);
                        setEditingFrom("");
                        setEditingTo("");
                      }
                    };
                    const editBlur = (
                      e: React.FocusEvent<HTMLInputElement>,
                    ) => {
                      const container = e.currentTarget.closest(
                        "[data-replacement-edit]",
                      );
                      if (!container?.contains(e.relatedTarget as Node)) {
                        handleEditReplacementCommit();
                      }
                    };
                    return (
                      <li
                        key={key}
                        className="grid min-h-10 grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)_24px] items-center gap-x-4"
                        data-replacement-edit
                      >
                        <input
                          value={editingFrom}
                          onChange={(e) => setEditingFrom(e.target.value)}
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onKeyDown={editKeyDown}
                          onBlur={editBlur}
                          className="min-w-0 border-b border-border-hover bg-transparent py-0.5 ui-text-body ui-color-primary outline-hidden"
                        />
                        <ArrowRight
                          size={14}
                          className="shrink-0 text-content-muted"
                          aria-hidden="true"
                        />
                        <input
                          value={editingTo}
                          onChange={(e) => setEditingTo(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={editKeyDown}
                          onBlur={editBlur}
                          placeholder={t({
                            id: "dictionary.replacements.replace_with",
                            message: "Replace with...",
                          })}
                          className="min-w-0 border-b border-border-hover bg-transparent py-0.5 ui-text-body ui-color-primary placeholder-content-disabled outline-hidden"
                        />
                      </li>
                    );
                  }
                  return (
                    <li
                      key={key}
                      className="group grid min-h-10 grid-cols-[minmax(0,1fr)_24px] items-center gap-x-4"
                    >
                      <button
                        onClick={() =>
                          shiftHeld
                            ? handleDeleteReplacement(idx)
                            : startEditingReplacement(idx)
                        }
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-x-4 py-2 text-left"
                        title={
                          shiftHeld
                            ? t({
                                id: "dictionary.replacements.delete",
                                message: `Delete replacement for ${replacement.from}`,
                              })
                            : undefined
                        }
                      >
                        <span
                          className={`min-w-0 truncate ui-text-body ui-color-primary transition-colors duration-100 ${deleteTextClassName}`}
                        >
                          {replacement.from}
                        </span>
                        <ArrowRight
                          size={14}
                          className={`shrink-0 text-content-muted transition-colors duration-100 ${
                            shiftHeld ? "group-hover:!text-error" : ""
                          }`}
                          aria-hidden="true"
                        />
                        <span
                          className={`min-w-0 truncate ui-text-body ui-color-muted transition-colors duration-100 ${deleteTextClassName}`}
                        >
                          {replacement.to || (
                            <span className="text-content-muted italic">
                              {t({
                                id: "dictionary.replacements.remove_value",
                                message: "remove",
                              })}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={() => handleDeleteReplacement(idx)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 ${deleteHoverClassName}`}
                        aria-label={t({
                          id: "dictionary.replacements.delete",
                          message: `Delete replacement for ${replacement.from}`,
                        })}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {resolvedError && (
        <div className="mt-3 border-t border-border-primary pt-3 ui-text-body-sm ui-color-error-soft">
          {resolvedError}
        </div>
      )}
    </div>
  );
};

export default DictionaryView;
