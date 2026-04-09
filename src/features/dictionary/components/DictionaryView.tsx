import { useLingui } from "@lingui/react/macro";
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, ArrowRight, Edit3, Trash2 } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
} from "../../../shared/lib/modelCapabilities";
import type { StoredSettings, ModelInfo, Replacement } from "../../../types";

const normalizeEntry = (value: string) => value.trim();

const DictionaryView = ({ isActive = true }: { isActive?: boolean }) => {
  const { t } = useLingui();

  const [entries, setEntries] = useState<string[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [editingReplacementIndex, setEditingReplacementIndex] = useState<
    number | null
  >(null);
  const [editingFrom, setEditingFrom] = useState("");
  const [editingTo, setEditingTo] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const searchQuery = newEntry.trim().toLowerCase();
  const filteredEntries = searchQuery
    ? entries.filter((entry) => entry.toLowerCase().includes(searchQuery))
    : entries;
  const isSearching = searchQuery.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResp, modelsResp, replacementsResp] = await Promise.all([
        invoke<StoredSettings>("get_settings"),
        invoke<ModelInfo[]>("list_models"),
        invoke<Replacement[]>("get_replacements"),
      ]);
      setSettings(settingsResp);
      setEntries(settingsResp.dictionary ?? []);
      setModels(modelsResp ?? []);
      setReplacements(replacementsResp ?? []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    load();
  }, [isActive, load]);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    let unlistenSettings: UnlistenFn | null = null;

    listen<StoredSettings>("settings:changed", (event) => {
      const nextSettings = event.payload;
      if (!nextSettings) return;
      setSettings(nextSettings);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenSettings = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenSettings?.();
    };
  }, [isActive]);

  const persistEntries = useCallback(async (next: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await invoke<string[]>("set_dictionary", {
        entries: next,
      });
      setEntries(cleaned);
      setEditingIndex(null);
      setEditingValue("");
      setNewEntry("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const persistReplacements = useCallback(async (next: Replacement[]) => {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await invoke<Replacement[]>("set_replacements", {
        replacements: next,
      });
      setReplacements(cleaned);
      setEditingReplacementIndex(null);
      setEditingFrom("");
      setEditingTo("");
      setNewFrom("");
      setNewTo("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleAdd = async () => {
    const value = normalizeEntry(newEntry);
    if (!value || entries.includes(value)) return;
    await persistEntries([...entries, value]);
  };

  const handleEditCommit = async () => {
    if (editingIndex === null) return;
    const value = normalizeEntry(editingValue);
    if (!value) {
      const next = entries.filter((_, idx) => idx !== editingIndex);
      await persistEntries(next);
      return;
    }
    const next = entries.map((entry, idx) =>
      idx === editingIndex ? value : entry,
    );
    await persistEntries(next);
  };

  const handleDelete = async (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    await persistEntries(next);
  };

  const startEditing = (idx: number) => {
    setEditingIndex(idx);
    setEditingValue(entries[idx]);
  };

  const handleAddReplacement = async () => {
    const from = normalizeEntry(newFrom);
    const to = normalizeEntry(newTo);
    if (!from) return;
    const exists = replacements.some(
      (r) => r.from.toLowerCase() === from.toLowerCase(),
    );
    if (exists) return;
    await persistReplacements([...replacements, { from, to }]);
  };

  const handleEditReplacementCommit = async () => {
    if (editingReplacementIndex === null) return;
    const from = normalizeEntry(editingFrom);
    const to = normalizeEntry(editingTo);
    if (!from) {
      const next = replacements.filter(
        (_, idx) => idx !== editingReplacementIndex,
      );
      await persistReplacements(next);
      return;
    }
    const next = replacements.map((r, idx) =>
      idx === editingReplacementIndex ? { from, to } : r,
    );
    await persistReplacements(next);
  };

  const handleDeleteReplacement = async (idx: number) => {
    const next = replacements.filter((_, i) => i !== idx);
    await persistReplacements(next);
  };

  const startEditingReplacement = (idx: number) => {
    setEditingReplacementIndex(idx);
    setEditingFrom(replacements[idx].from);
    setEditingTo(replacements[idx].to);
  };

  const currentModel = models.find((m) => m.key === settings?.local_model);
  const isLocal = settings?.transcription_mode === "local";
  const supportsDictionary = hasModelCapability(
    currentModel,
    MODEL_CAPABILITY_DICTIONARY,
  );
  const showWarning = Boolean(isLocal && currentModel && !supportsDictionary);
  const entryCountLabel =
    entries.length === 1
      ? t({
          id: "dictionary.entry_count.single",
          message: "1 entry",
        })
      : t({
          id: "dictionary.entry_count.multiple",
          message: `${entries.length} entries`,
        });
  const replacementCountLabel =
    replacements.length === 1
      ? t({
          id: "dictionary.replacements.count.single",
          message: "1 replacement",
        })
      : t({
          id: "dictionary.replacements.count.multiple",
          message: `${replacements.length} replacements`,
        });
  const dictionaryMetaLabel =
    isSearching && entries.length > 0
      ? t({
          id: "dictionary.search_matches",
          message: `${filteredEntries.length} of ${entries.length} matches`,
        })
      : entryCountLabel;
  const dictionaryHintLabel =
    isSearching && entries.length > 0
      ? t({
          id: "dictionary.press_enter_to_add_match",
          message: "Press Enter to add this word",
        })
      : t({
          id: "dictionary.press_enter_to_add",
          message: "Press Enter to add",
        });
  const panelBodyClassName =
    "mt-4 min-h-[16rem] max-h-[calc(100vh-330px)] overflow-x-hidden overflow-y-auto custom-scrollbar";
  const panelBodyFadeClassName =
    "pb-20";
  const itemRowClassName =
    "group flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-surface";
  const FADE_ITEM_THRESHOLD = 6;

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto pl-2 pr-6 text-left">
      <div className="mb-6 mt-2 flex min-w-0 items-start gap-3 md:-mt-6">
        <DotMatrix
          rows={2}
          cols={3}
          activeDots={[0, 1, 2, 3]}
          dotSize={3}
          gap={3}
          color="var(--color-cloud)"
        />
        <div className="min-w-0 flex-1">
          <p className="ui-text-screen-title ui-color-primary tracking-tight text-balance">
            {t({
              id: "dictionary.combined.title",
              message: "Dictionary & Replacements",
            })}
          </p>
          <p className="mt-1 ui-text-body-sm ui-color-secondary text-pretty">
            {t({
              id: "dictionary.combined.description",
              message:
                "Add custom words the system should recognize, and set automatic word replacements.",
            })}
          </p>
        </div>
      </div>

      {showWarning && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="ui-text-body leading-relaxed">
            {t({
              id: "dictionary.warning",
              message: `Dictionary works only for models with dictionary support. Current model ${currentModel?.label ?? settings?.local_model} will ignore these entries until you switch to a compatible model.`,
            })}
          </div>
        </div>
      )}

      <div className="grid w-full min-w-0 grid-cols-1 gap-0 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* Dictionary Column */}
        <div className="min-w-0 pb-6 md:pr-6 md:pb-0 lg:pr-8">
          <div className="min-w-0">
            <p className="ui-text-title-strong ui-color-primary text-balance">
              {t({
                id: "dictionary.section.dictionary_title",
                message: "Dictionary",
              })}
            </p>
            <p className="mt-1 ui-text-body-sm ui-color-muted text-pretty">
              {t({
                id: "dictionary.section.dictionary_description",
                message: "Add custom words Glimpse should recognize.",
              })}
            </p>
          </div>

          <div className="mt-4 border-b border-border-primary pb-3 transition-colors focus-within:border-border-hover">
            <div className="ui-text-section-label-sm ui-color-muted">
              {t({
                id: "dictionary.search_or_add_label",
                message: "Search Or Add",
              })}
            </div>
            <input
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={t({
                id: "dictionary.search_or_add",
                message: "Search or add a word...",
              })}
              aria-label={t({
                id: "dictionary.search_or_add_aria",
                message: "Add or search dictionary entry",
              })}
              className="mt-2 h-7 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ui-text-meta ui-color-muted">
            <span
              className="tabular-nums"
              role={isSearching && entries.length > 0 ? "status" : undefined}
            >
              {dictionaryMetaLabel}
            </span>
            <span>{dictionaryHintLabel}</span>
            {saving && (
              <span className="ui-color-secondary">
                {t({
                  id: "dictionary.saving",
                  message: "Saving...",
                })}
              </span>
            )}
          </div>

          <div className="relative">
            <div className={`${panelBodyClassName}${filteredEntries.length > FADE_ITEM_THRESHOLD ? ` ${panelBodyFadeClassName}` : ""}`}>
              {loading ? (
                <div className="flex items-center justify-center py-10">
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
              ) : filteredEntries.length === 0 ? (
                <div className="flex flex-col items-start gap-2 py-6 text-content-muted">
                  {isSearching ? (
                    <>
                      <p className="ui-text-body-lg-strong">
                        {t({
                          id: "dictionary.no_matches",
                          message: "No matches found",
                        })}
                      </p>
                      <p className="ui-text-body-sm ui-color-muted">
                        {t({
                          id: "dictionary.add_prompt",
                          message: `Press Enter to add "${newEntry.trim()}" as a new entry.`,
                        })}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="ui-text-body-lg-strong">
                        {t({
                          id: "dictionary.no_entries",
                          message: "No entries yet",
                        })}
                      </p>
                      <p className="ui-text-body-sm ui-color-muted text-pretty">
                        {t({
                          id: "dictionary.no_entries.description",
                          message:
                            "Add words, phrases, or names above and press Enter to save them here.",
                        })}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {filteredEntries.map((entry, filteredIndex) => {
                    const originalIndex = entries.indexOf(entry);
                    return (
                      <div
                        key={`${entry}-${originalIndex}-${filteredIndex}`}
                        className={itemRowClassName}
                      >
                        {editingIndex === originalIndex ? (
                          <input
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
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
                            className="flex-1 min-w-0 bg-transparent leading-tight border-0 border-b border-[var(--color-accent)] px-0 py-0 rounded-none ui-text-body-lg ui-color-primary font-medium outline-hidden focus:ring-0"
                          />
                        ) : (
                          <button
                            onClick={() => startEditing(originalIndex)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="flex flex-col">
                              <p className="ui-text-body-lg ui-color-primary leading-tight font-medium truncate">
                                {entry}
                              </p>
                            </div>
                          </button>
                        )}

                        <div className="flex items-center gap-1">
                          {editingIndex === originalIndex ? (
                            <div className="ui-text-nano ui-color-muted pr-1">
                              {t({
                                id: "dictionary.press_enter_to_save",
                                message: "Press Enter to save",
                              })}
                            </div>
                          ) : (
                            <>
                              <div
                                className="ui-text-nano ui-color-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 pr-1"
                                aria-hidden="true"
                              >
                                {t({
                                  id: "dictionary.click_to_edit",
                                  message: "Click to edit",
                                })}
                              </div>
                              <button
                                onClick={() => startEditing(originalIndex)}
                                className="rounded bg-transparent p-1 text-content-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--color-bg-elevated)] hover:text-content-primary"
                                title={t({
                                  id: "dictionary.edit",
                                  message: "Edit",
                                })}
                                aria-label={t({
                                  id: "dictionary.edit_entry",
                                  message: `Edit ${entry}`,
                                })}
                              >
                                <Edit3 size={14} aria-hidden="true" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDelete(originalIndex)}
                            className="rounded bg-transparent p-1 text-content-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10 hover:text-error"
                            title={t({
                              id: "dictionary.delete",
                              message: "Delete",
                            })}
                            aria-label={t({
                              id: "dictionary.delete_entry",
                              message: `Delete ${entry}`,
                            })}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            {filteredEntries.length > FADE_ITEM_THRESHOLD && (
              <div
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-20"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, var(--color-bg-tertiary))",
                }}
              />
            )}
          </div>

          {error && (
            <div className="mt-3 border-t border-border-primary pt-3 ui-text-body-sm ui-color-error-soft">
              {error}
            </div>
          )}
        </div>

        {/* Replacements Column */}
        <div className="min-w-0 border-t border-border-primary pt-6 md:border-t-0 md:border-l md:pl-6 md:pt-0 lg:pl-8">
          <div className="min-w-0">
            <p className="ui-text-title-strong ui-color-primary text-balance">
              {t({
                id: "dictionary.section.replacements_title",
                message: "Replacements",
              })}
            </p>
            <p className="mt-1 ui-text-body-sm ui-color-muted text-pretty">
              {t({
                id: "dictionary.section.replacements_description",
                message:
                  "Swap common phrases automatically after transcription.",
              })}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
            <div className="border-b border-border-primary pb-3 transition-colors focus-within:border-border-hover">
              <div className="ui-text-section-label-sm ui-color-muted">
                {t({
                  id: "dictionary.replacements.find_label",
                  message: "Find",
                })}
              </div>
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
                className="mt-2 h-7 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
              />
            </div>
            <div className="hidden sm:flex items-center justify-center pb-3 text-content-muted">
              <ArrowRight size={14} aria-hidden="true" />
            </div>
            <div className="border-b border-border-primary pb-3 transition-colors focus-within:border-border-hover">
              <div className="ui-text-section-label-sm ui-color-muted">
                {t({
                  id: "dictionary.replacements.replace_with_label",
                  message: "Replace With",
                })}
              </div>
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
                className="mt-2 h-7 w-full min-w-0 bg-transparent ui-text-body-lg ui-color-primary placeholder-content-disabled outline-hidden"
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ui-text-meta ui-color-muted">
            <span className="tabular-nums">{replacementCountLabel}</span>
            <span>
              {t({
                id: "dictionary.replacements.press_enter_to_add",
                message: "Press Enter in either field to add",
              })}
            </span>
            {saving && (
              <span className="ui-color-secondary">
                {t({
                  id: "dictionary.saving",
                  message: "Saving...",
                })}
              </span>
            )}
          </div>

          <div className="relative">
            <div className={`${panelBodyClassName}${replacements.length > FADE_ITEM_THRESHOLD ? ` ${panelBodyFadeClassName}` : ""}`}>
              {loading ? (
                <div className="flex items-center justify-center py-10">
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
              ) : replacements.length === 0 ? (
                <div className="flex flex-col items-start gap-2 py-6 text-content-muted">
                  <p className="ui-text-body-lg-strong">
                    {t({
                      id: "dictionary.replacements.none",
                      message: "No replacements yet",
                    })}
                  </p>
                  <p className="ui-text-body-sm ui-color-muted text-pretty">
                    {t({
                      id: "dictionary.replacements.none_description",
                      message:
                        "Add a find and replace pair above, then press Enter to save it here.",
                    })}
                  </p>
                </div>
              ) : (
                <>
                  {replacements.map((replacement, idx) => (
                    <div
                      key={`${replacement.from}-${idx}`}
                      className={itemRowClassName}
                    >
                      {editingReplacementIndex === idx ? (
                        <div
                          className="flex flex-1 items-center"
                          data-replacement-edit
                        >
                          <input
                            value={editingFrom}
                            onChange={(e) => setEditingFrom(e.target.value)}
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleEditReplacementCommit();
                              }
                              if (e.key === "Escape") {
                                setEditingReplacementIndex(null);
                                setEditingFrom("");
                                setEditingTo("");
                              }
                            }}
                            onBlur={(e) => {
                              const container = e.currentTarget.closest(
                                "[data-replacement-edit]",
                              );
                              if (
                                !container?.contains(e.relatedTarget as Node)
                              ) {
                                handleEditReplacementCommit();
                              }
                            }}
                            className="flex-1 min-w-0 bg-transparent border-0 border-b border-[var(--color-accent)] px-0 py-0 rounded-none ui-text-body-lg ui-color-primary font-medium outline-hidden focus:ring-0"
                          />
                          <ArrowRight
                            size={14}
                            className="text-content-disabled shrink-0 mx-2"
                          />
                          <input
                            value={editingTo}
                            onChange={(e) => setEditingTo(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleEditReplacementCommit();
                              }
                              if (e.key === "Escape") {
                                setEditingReplacementIndex(null);
                                setEditingFrom("");
                                setEditingTo("");
                              }
                            }}
                            onBlur={(e) => {
                              const container = e.currentTarget.closest(
                                "[data-replacement-edit]",
                              );
                              if (
                                !container?.contains(e.relatedTarget as Node)
                              ) {
                                handleEditReplacementCommit();
                              }
                            }}
                            className="flex-1 min-w-0 bg-transparent border-0 border-b border-[var(--color-accent)] px-0 py-0 rounded-none ui-text-body-lg ui-color-primary font-medium outline-hidden focus:ring-0"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditingReplacement(idx)}
                          className="flex flex-1 items-center text-left min-w-0"
                        >
                          <span className="ui-text-body-lg ui-color-primary font-medium truncate">
                            {replacement.from}
                          </span>
                          <ArrowRight
                            size={14}
                            className="text-content-muted shrink-0 mx-2"
                          />
                          <span
                            className="ui-text-body-lg truncate"
                            style={{ color: "var(--color-accent)" }}
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
                      )}

                      <div className="flex items-center gap-1">
                        {editingReplacementIndex === idx ? (
                          <div className="ui-text-nano ui-color-muted pr-1">
                            {t({
                              id: "dictionary.press_enter_to_save",
                              message: "Press Enter to save",
                            })}
                          </div>
                        ) : (
                          <>
                            <div
                              className="ui-text-nano ui-color-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 pr-1"
                              aria-hidden="true"
                            >
                              {t({
                                id: "dictionary.click_to_edit",
                                message: "Click to edit",
                              })}
                            </div>
                            <button
                              onClick={() => startEditingReplacement(idx)}
                              className="rounded bg-transparent p-1 text-content-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--color-bg-elevated)] hover:text-content-primary"
                              title={t({
                                id: "dictionary.edit",
                                message: "Edit",
                              })}
                              aria-label={t({
                                id: "dictionary.replacements.edit",
                                message: `Edit replacement for ${replacement.from}`,
                              })}
                            >
                              <Edit3 size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteReplacement(idx)}
                          className="rounded bg-transparent p-1 text-content-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10 hover:text-error"
                          title={t({
                            id: "dictionary.delete",
                            message: "Delete",
                          })}
                          aria-label={t({
                            id: "dictionary.replacements.delete",
                            message: `Delete replacement for ${replacement.from}`,
                          })}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            {replacements.length > FADE_ITEM_THRESHOLD && (
              <div
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-20"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, var(--color-bg-tertiary))",
                }}
              />
            )}
          </div>

          {error && (
            <div className="mt-3 border-t border-border-primary pt-3 ui-text-body-sm ui-color-error-soft">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DictionaryView;
