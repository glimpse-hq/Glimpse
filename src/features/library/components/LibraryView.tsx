import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  CircleNotch as Loader2,
  List as ListIcon,
  Plus,
  MagnifyingGlass as Search,
  SquaresFour,
  X,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import DotMatrix from "../../../shared/ui/DotMatrix";
import ScreenHeader from "../../../shared/ui/ScreenHeader";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useModelDownloadEvents } from "../../../shared/hooks/useModelDownloadEvents";
import { useSettings } from "../../settings/queries";
import {
  modelKeys as settingsModelKeys,
  useSpeechModels,
} from "../../settings/models-queries";
import LibraryImportModal from "./LibraryImportModal";
import LibraryCard, { type LibraryLayout } from "./LibraryCard";
import LibraryDetail from "./LibraryDetail";
import {
  useLibraryItems as useLibraryItemsQuery,
  useCreateLibraryItem,
  useUpdateLibraryItem,
  useDeleteLibraryItem,
  useCancelLibraryTranscription,
  useRediarizeLibraryItem,
  useRetryLibraryTranscription,
  useExportLibraryItem,
  useLibraryTags,
  libraryKeys,
} from "../queries";
import {
  formatDeleteErrorMessage,
  formatImportErrorMessage,
  getFileExtension,
  SUPPORTED_EXTENSIONS,
  uniquePaths,
} from "./library-utils";
import FilterMenu from "../../../shared/ui/FilterMenu";
import HoverTip from "../../../shared/ui/HoverTip";
import type {
  LibraryFilter,
  LibraryItem,
  LibraryItemPatch,
} from "../../../types";

type LibraryViewProps = {
  pendingImportPaths: string[] | null;
  openItemId?: string | null;
  onOpenItemHandled?: () => void;
  onSetImportPaths: (paths: string[] | null) => void;
  isActive: boolean;
};

const LAYOUT_KEY = "glimpse.library.layout";

const LibraryView = ({
  pendingImportPaths,
  openItemId = null,
  onOpenItemHandled,
  onSetImportPaths,
  isActive,
}: LibraryViewProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [layout, setLayout] = useState<LibraryLayout>(() =>
    localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list",
  );
  const changeLayout = (next: LibraryLayout) => {
    setLayout(next);
    localStorage.setItem(LAYOUT_KEY, next);
  };
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const shiftHeld = useShiftHeld(isActive);
  const filter = useMemo<LibraryFilter>(() => {
    return {
      search: searchQuery || null,
      status: statusFilter === "all" ? null : statusFilter,
      tag: null,
      since_days: null,
    };
  }, [searchQuery, statusFilter]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: queryError,
  } = useLibraryItemsQuery(filter, isActive);

  const { data: availableTags = [] } = useLibraryTags(isActive);
  const { data: speechModels = [] } = useSpeechModels(isActive);
  const { data: defaultModelKey = "" } = useSettings(
    (settings) => settings.local_model,
    isActive,
  );

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  useEffect(() => {
    if (!selectedItemId) return;
    void invoke("track_feature_used_command", { feature: "library" }).catch(
      () => {},
    );
  }, [selectedItemId]);
  useEffect(() => {
    if (!openItemId) return;
    setSearchQuery("");
    setStatusFilter("all");
    setSelectedItemId(openItemId);
    onOpenItemHandled?.();
  }, [openItemId, onOpenItemHandled]);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  const createItemMutation = useCreateLibraryItem();
  const updateItemMutation = useUpdateLibraryItem();
  const deleteItemMutation = useDeleteLibraryItem();
  const cancelMutation = useCancelLibraryTranscription();
  const retryMutation = useRetryLibraryTranscription();
  const rediarizeMutation = useRediarizeLibraryItem();
  const exportMutation = useExportLibraryItem();

  const invalidateTags = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
  }, [queryClient]);

  const updateItemWithTags = useCallback(
    async (id: string, patch: LibraryItemPatch) => {
      const updated = await updateItemMutation.mutateAsync({ id, patch });
      if (patch.tags != null) invalidateTags();
      return updated;
    },
    [updateItemMutation, invalidateTags],
  );

  const deleteItemAndRefreshTags = useCallback(
    async (id: string) => {
      try {
        await deleteItemMutation.mutateAsync(id);
        invalidateTags();
      } catch (err) {
        console.error("Failed to delete library item:", err);
        const message = err instanceof Error ? err.message : String(err);
        invoke("debug_show_toast", {
          toastType: "error",
          message: formatDeleteErrorMessage(message),
        }).catch(() => {});
        throw err;
      }
    },
    [deleteItemMutation, invalidateTags],
  );

  const rediarizeItem = useCallback(
    async (id: string) => {
      try {
        await rediarizeMutation.mutateAsync(id);
      } catch (err) {
        console.error("Failed to detect speakers:", err);
        invoke("debug_show_toast", {
          toastType: "error",
          message: t({
            id: "library.view.rediarize_error",
            message: "Couldn't detect speakers.",
          }),
        }).catch(() => {});
      }
    },
    [rediarizeMutation, t],
  );

  const installedModels = useMemo(
    () => speechModels.filter((model) => model.installed),
    [speechModels],
  );

  const refreshSpeechModels = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: settingsModelKeys.speech(),
    });
  }, [queryClient]);

  useModelDownloadEvents({
    enabled: isActive,
    onComplete: refreshSpeechModels,
    onError: refreshSpeechModels,
  });

  const handleImportClick = async () => {
    try {
      const selection = await open({
        multiple: true,
        filters: [
          {
            name: t({
              id: "library.view.file_filter",
              message: "Audio & Video",
            }),
            extensions: SUPPORTED_EXTENSIONS,
          },
        ],
      });

      if (!selection) return;

      const paths = Array.isArray(selection) ? selection : [selection];
      if (paths.length > 0) {
        onSetImportPaths(uniquePaths(paths));
      }
    } catch (err) {
      console.error("Failed to open import dialog:", err);
      invoke("debug_show_toast", {
        toastType: "error",
        message: t({
          id: "library.view.import_dialog_error",
          message: "Could not open the import dialog.",
        }),
      }).catch(() => {});
    }
  };

  const startTagEdit = (item: LibraryItem) => {
    setEditingTagId(item.id);
    setTagDraft("");
  };

  const startNameEdit = (item: LibraryItem) => {
    setEditingNameId(item.id);
    setEditingNameDraft(item.name);
  };

  const cancelNameEdit = () => {
    setEditingNameId(null);
    setEditingNameDraft("");
  };

  const commitNameEdit = async (itemId: string) => {
    const nextName = editingNameDraft.trim();
    const original = items.find((entry) => entry.id === itemId)?.name ?? "";
    setEditingNameId(null);
    setEditingNameDraft("");
    if (!nextName || nextName === original) return;
    await updateItemWithTags(itemId, { name: nextName });
  };

  const cancelTagEdit = () => {
    setEditingTagId(null);
    setTagDraft("");
  };

  const commitTagAdd = async (itemId: string, overrideTag?: string) => {
    const nextTag = (overrideTag ?? tagDraft).trim();
    if (!nextTag) {
      setEditingTagId(null);
      setTagDraft("");
      return;
    }
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    if (item.tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      setTagDraft("");
      setEditingTagId(null);
      return;
    }
    await updateItemWithTags(itemId, { tags: [...item.tags, nextTag] });
    setTagDraft("");
    setEditingTagId(null);
  };

  const defaultSpeechModelKey =
    installedModels.find((model) => model.remote)?.id ??
    installedModels.find((model) => model.key === defaultModelKey)?.id ??
    installedModels[0]?.id;
  const statusFilterValue = useMemo(() => {
    if (["transcribing", "importing", "pending"].includes(statusFilter)) {
      return "active";
    }
    if (statusFilter === "complete") return "complete";
    if (statusFilter === "error") return "error";
    return "all";
  }, [statusFilter]);
  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: t({ id: "library.filter.all", message: "All" }) },
      {
        value: "active",
        label: t({ id: "library.filter.active", message: "Active" }),
      },
      {
        value: "complete",
        label: t({ id: "library.filter.done", message: "Done" }),
      },
      {
        value: "error",
        label: t({ id: "library.filter.failed", message: "Failed" }),
      },
    ],
    [t],
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {selectedItem ? (
        <motion.div
          key={selectedItem.id || "selected-library-item"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex h-full min-h-0 flex-col"
        >
          <LibraryDetail
            item={selectedItem}
            models={installedModels}
            shiftHeld={shiftHeld}
            onClose={() => setSelectedItemId(null)}
            onDelete={async () => {
              await deleteItemAndRefreshTags(selectedItem.id);
              setSelectedItemId(null);
            }}
            onRetry={() => retryMutation.mutateAsync(selectedItem.id)}
            onRediarize={() => rediarizeItem(selectedItem.id)}
            rediarizing={
              rediarizeMutation.isPending &&
              rediarizeMutation.variables === selectedItem.id
            }
            onCancel={() => cancelMutation.mutateAsync(selectedItem.id)}
            onUpdate={(patch) => updateItemWithTags(selectedItem.id, patch)}
            onExport={(format, outputPath) =>
              exportMutation.mutateAsync({
                id: selectedItem.id,
                format,
                outputPath,
              })
            }
            availableTags={availableTags}
          />
        </motion.div>
      ) : (
        <>
          <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col pt-8 px-0 text-left">
            <ScreenHeader
              icon={
                <DotMatrix
                  rows={2}
                  cols={3}
                  activeDots={[0, 1, 2, 4]}
                  dotSize={3}
                  gap={3}
                  color="var(--color-section-marker-alt)"
                />
              }
              title={t({ id: "library.view.title", message: "Library" })}
              description={t({
                id: "library.view.description",
                message: "Import audio and video files for transcription.",
              })}
              trailing={
                <>
                  <div className="relative w-56 min-w-0">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 ui-color-muted"
                    />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder={t({
                        id: "library.view.search_placeholder",
                        message: "Search library...",
                      })}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setSearchQuery("");
                      }}
                      className="h-8 w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] rounded-lg focus:border-[var(--color-border-hover)] pl-8 pr-7 ui-text-body-sm ui-color-primary placeholder-[var(--color-text-muted)] outline-none transition-colors duration-100 ease-out"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          searchInputRef.current?.focus();
                        }}
                        aria-label={t({
                          id: "library.view.search_clear",
                          message: "Clear search",
                        })}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-content-disabled hover:text-content-muted transition-colors"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <HoverTip
                    label={
                      layout === "list"
                        ? t({
                            id: "library.view.layout.list_view",
                            message: "List view",
                          })
                        : t({
                            id: "library.view.layout.grid_view",
                            message: "Grid view",
                          })
                    }
                    detail={
                      layout === "list"
                        ? t({
                            id: "library.view.layout.to_grid",
                            message: "Click to show cards",
                          })
                        : t({
                            id: "library.view.layout.to_list",
                            message: "Click to show rows",
                          })
                    }
                    className="inline-flex shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        changeLayout(layout === "list" ? "grid" : "list")
                      }
                      aria-label={t({
                        id: "library.view.layout",
                        message: "Layout",
                      })}
                      className="ui-button-ghost h-8 w-8"
                    >
                      {layout === "list" ? (
                        <ListIcon size={15} />
                      ) : (
                        <SquaresFour size={15} />
                      )}
                    </button>
                  </HoverTip>

                  <FilterMenu
                    ariaLabel={t({
                      id: "library.filter.aria_label",
                      message: "Filter library by status",
                    })}
                    active={statusFilterValue !== "all"}
                    onClear={() => setStatusFilter("all")}
                    triggerClassName="h-8 w-8"
                    sections={[
                      {
                        key: "status",
                        title: t({
                          id: "library.filter.status",
                          message: "Status",
                        }),
                        items: statusFilterOptions.map((option) => ({
                          key: option.value,
                          label: option.label,
                          selected: statusFilterValue === option.value,
                          onSelect: () =>
                            setStatusFilter(
                              option.value === "active"
                                ? "transcribing"
                                : option.value,
                            ),
                        })),
                      },
                    ]}
                  />

                  <button
                    onClick={handleImportClick}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] px-3 ui-text-body-sm ui-color-primary hover:border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-overlay)] transition-colors shrink-0"
                  >
                    <Plus size={13} />
                    {t({ id: "library.view.import_button", message: "Import" })}
                  </button>
                </>
              }
            />

            {error && (
              <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-3 ui-text-body-sm ui-color-error-tint mx-4 mb-2">
                {error}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden custom-scrollbar scrollbar-gutter pb-6 pr-3 pt-1">
            <div key="library-list" className="flex flex-col gap-6 w-full">
              <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
                <div
                  className={
                    layout === "grid"
                      ? "grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]"
                      : "flex min-w-0 flex-col divide-y divide-border-primary"
                  }
                >
                  {isLoading && items.length === 0 && (
                    <div className="py-12 flex items-center justify-center">
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

                  {!isLoading && items.length === 0 && (
                    <button
                      type="button"
                      onClick={handleImportClick}
                      className="flex flex-col items-center justify-center py-16 text-center transition-colors hover:text-content-secondary"
                    >
                      <FolderOpen size={20} className="text-content-disabled" />
                      <p className="mt-3 ui-text-body ui-color-muted">
                        {t({
                          id: "library.view.empty_state",
                          message: "Drag files here to build your Library.",
                        })}
                      </p>
                    </button>
                  )}

                  {items.map((item, index) => (
                    <LibraryCard
                      key={item.id || `library-item-${index}`}
                      item={item}
                      layout={layout}
                      onOpen={() => setSelectedItemId(item.id)}
                      onRemoveTag={async (tag) => {
                        const nextTags = item.tags.filter(
                          (entry) => entry !== tag,
                        );
                        await updateItemWithTags(item.id, { tags: nextTags });
                      }}
                      onClickTag={(tag) => setSearchQuery(`#${tag}`)}
                      editingNameId={editingNameId}
                      editingNameDraft={editingNameDraft}
                      onStartNameEdit={() => startNameEdit(item)}
                      onChangeNameDraft={setEditingNameDraft}
                      onCommitNameEdit={() => commitNameEdit(item.id)}
                      onCancelNameEdit={cancelNameEdit}
                      onRetry={() => retryMutation.mutateAsync(item.id)}
                      onCancel={() => cancelMutation.mutateAsync(item.id)}
                      onDelete={async () => {
                        await deleteItemAndRefreshTags(item.id);
                      }}
                      editingTagId={editingTagId}
                      tagDraft={tagDraft}
                      onStartTagEdit={() => startTagEdit(item)}
                      onChangeTagDraft={setTagDraft}
                      onCommitTagAdd={(value) => commitTagAdd(item.id, value)}
                      onCancelTagEdit={cancelTagEdit}
                      shiftHeld={shiftHeld}
                      availableTags={availableTags}
                    />
                  ))}

                  {items.length > 0 && hasNextPage && (
                    <div className="flex items-center justify-center pt-4">
                      <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-4 py-2 ui-text-body-sm ui-color-secondary hover:text-content-primary hover:border-border-secondary hover:bg-surface-overlay transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isFetchingNextPage ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>
                              {t({
                                id: "library.view.loading_more",
                                message: "Loading...",
                              })}
                            </span>
                          </>
                        ) : (
                          <span>
                            {t({
                              id: "library.view.load_more",
                              message: "Load more",
                            })}
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {pendingImportPaths !== null && (
          <LibraryImportModal
            paths={pendingImportPaths}
            models={installedModels}
            defaultModelKey={defaultSpeechModelKey}
            onCancel={() => onSetImportPaths(null)}
            onConfirm={async (paths, options) => {
              const supported = paths.filter((path) =>
                SUPPORTED_EXTENSIONS.includes(getFileExtension(path)),
              );
              const unsupported = paths.filter(
                (path) =>
                  !SUPPORTED_EXTENSIONS.includes(getFileExtension(path)),
              );

              if (unsupported.length > 0) {
                invoke("debug_show_toast", {
                  toastType: "warning",
                  message: t({
                    id: "library.view.unsupported_files",
                    message: `${unsupported.length} file(s) skipped due to unsupported format.`,
                  }),
                }).catch(() => {});
              }

              for (const path of supported) {
                try {
                  await createItemMutation.mutateAsync({ path, options });
                } catch (err) {
                  console.error("Failed to import file:", err);
                  const message =
                    err instanceof Error ? err.message : String(err);
                  const toastMessage = formatImportErrorMessage(message);
                  invoke("debug_show_toast", {
                    toastType: "error",
                    message: toastMessage,
                  }).catch(() => {});
                }
              }

              onSetImportPaths(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LibraryView;
