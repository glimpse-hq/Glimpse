import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  CircleNotch as Loader2,
  List as ListIcon,
  CaretRight,
  Plus,
  SquaresFour,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import DotMatrix from "../../../shared/ui/DotMatrix";
import ScreenHeader from "../../../shared/ui/ScreenHeader";
import SearchField from "../../../shared/ui/SearchField";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useModelDownloadEvents } from "../../../shared/hooks/useModelDownloadEvents";
import { useSettings } from "../../settings/queries";
import {
  modelKeys as settingsModelKeys,
  useSpeechModels,
} from "../../settings/models-queries";
import LibraryImportModal from "./LibraryImportModal";
import LibraryCard, { type LibraryLayout } from "./LibraryCard";
import LibraryFolderMenu from "./LibraryFolderMenu";
import * as libraryApi from "../api";
import LibraryFolderDialog, {
  type FolderDialogState,
} from "./LibraryFolderDialog";
import { areSameDay, formatDayLabel } from "../../../shared/lib/dayLabel";
import { isFindShortcut } from "../../../shared/lib/shortcuts";
import LibraryDetail from "./LibraryDetail";
import LibraryDeleteDialog from "./LibraryDeleteDialog";
import LibraryRetranscribeModal, {
  type LibraryRetranscribeOptions,
} from "./LibraryRetranscribeModal";
import {
  useLibraryItems as useLibraryItemsQuery,
  useLibraryItem,
  useCreateLibraryItem,
  useUpdateLibraryItem,
  useDeleteLibraryItem,
  useRestoreDeletedLibraryItem,
  useCancelLibraryTranscription,
  useRediarizeLibraryItem,
  useRetryLibraryTranscription,
  useExportLibraryItem,
  useLibraryFolders,
  libraryKeys,
} from "../queries";
import {
  formatDeleteErrorMessage,
  formatImportErrorMessage,
  getFileExtension,
  SUPPORTED_EXTENSIONS,
  uniquePaths,
} from "./library-utils";
import HoverTip from "../../../shared/ui/HoverTip";
import type {
  LibraryFilter,
  LibraryItem,
  LibraryItemPatch,
} from "../../../types";
import {
  showErrorToast,
  showWarningToast,
} from "../../../shared/lib/errorToast";

type LibraryViewProps = {
  pendingImportPaths: string[] | null;
  openItemId?: string | null;
  onOpenItemHandled?: () => void;
  onSetImportPaths: (paths: string[] | null) => void;
  isActive: boolean;
};

const LAYOUT_KEY = "glimpse.library.layout";
const NO_TAGS: string[] = [];

const LibraryView = ({
  pendingImportPaths,
  openItemId = null,
  onOpenItemHandled,
  onSetImportPaths,
  isActive,
}: LibraryViewProps) => {
  const { t, i18n } = useLingui();
  const libraryTitle = t({ id: "library.view.title", message: "Library" });
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useState<LibraryLayout>(() =>
    localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list",
  );
  const changeLayout = (next: LibraryLayout) => {
    setLayout(next);
    localStorage.setItem(LAYOUT_KEY, next);
  };
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [retranscribeItem, setRetranscribeItem] = useState<LibraryItem | null>(
    null,
  );
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(
    null,
  );
  const shiftHeld = useShiftHeld(isActive);
  const filter = useMemo<LibraryFilter>(() => {
    return {
      search: searchQuery || null,
      status: null,
      tag: null,
      folder,
      since_days: null,
    };
  }, [searchQuery, folder]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: queryError,
  } = useLibraryItemsQuery(filter, isActive);

  const { data: folders = NO_TAGS } = useLibraryFolders(isActive);
  const { data: speechModels = [] } = useSpeechModels(isActive);
  const { data: defaultModelKey = "" } = useSettings(
    (settings) => settings.local_model,
    isActive,
  );

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );
  // The open item loads in full by id, so it stays open when it stops
  // matching the filter or search.
  const lastSelectedItem = useRef<LibraryItem | null>(null);
  const { data: loadedItem } = useLibraryItem(
    selectedItemId,
    selectedItemId !== null,
  );
  if (loadedItem && loadedItem.id === selectedItemId)
    lastSelectedItem.current = loadedItem;
  const selectedItem =
    lastSelectedItem.current?.id === selectedItemId
      ? lastSelectedItem.current
      : null;
  useEffect(() => {
    if (!selectedItemId) return;
    void invoke("track_feature_used_command", { feature: "library" }).catch(
      () => {},
    );
  }, [selectedItemId]);
  useEffect(() => {
    if (!isActive || selectedItemId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFindShortcut(event)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, selectedItemId]);
  useEffect(() => {
    if (!openItemId) return;
    setSearchQuery("");
    setFolder(null);
    setSelectedItemId(openItemId);
    onOpenItemHandled?.();
  }, [openItemId, onOpenItemHandled]);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  const createItemMutation = useCreateLibraryItem();
  const { mutateAsync: updateItem } = useUpdateLibraryItem();
  const { mutateAsync: deleteItem, isPending: deletePending } =
    useDeleteLibraryItem();
  const { mutate: restoreDeleted } = useRestoreDeletedLibraryItem();
  const { mutateAsync: cancelItem } = useCancelLibraryTranscription();
  const { mutateAsync: retryItem } = useRetryLibraryTranscription();
  const rediarizeMutation = useRediarizeLibraryItem();
  const exportMutation = useExportLibraryItem();

  const invalidateTags = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: libraryKeys.tags() });
  }, [queryClient]);

  const updateItemWithTags = useCallback(
    async (id: string, patch: LibraryItemPatch) => {
      const updated = await updateItem({ id, patch });
      if (patch.tags != null) invalidateTags();
      return updated;
    },
    [updateItem, invalidateTags],
  );

  const deleteItemAndRefreshTags = useCallback(
    async (id: string) => {
      try {
        await deleteItem(id);
        invalidateTags();
      } catch (err) {
        console.error("Failed to delete library item:", err);
        const message = err instanceof Error ? err.message : String(err);
        showErrorToast(formatDeleteErrorMessage(message));
        throw err;
      }
    },
    [deleteItem, invalidateTags],
  );

  const retranscribe = useCallback(
    async (id: string, options: LibraryRetranscribeOptions) => {
      await updateItemWithTags(id, {
        speech_model: options.model_key,
        llm_cleanup_enabled: false,
        show_timestamps: options.show_timestamps,
        detect_speakers: options.detect_speakers,
      });
      await retryItem(id);
    },
    [updateItemWithTags, retryItem],
  );
  useEffect(() => {
    // A delete still waiting on its job would be skipped over.
    if (!isActive || selectedItemId || pendingDeleteId || deletePending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.repeat ||
        event.key.toLowerCase() !== "z"
      )
        return;
      // Text fields keep their own undo.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select")
      )
        return;
      event.preventDefault();
      restoreDeleted(undefined, {
        onSuccess: (id) => {
          if (!id) return;
          invalidateTags();
          setSearchQuery("");
          setFolder(null);
          setRestoredId(id);
        },
        onError: (err) => console.error("Failed to restore library item:", err),
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    selectedItemId,
    pendingDeleteId,
    deletePending,
    restoreDeleted,
    invalidateTags,
  ]);
  useEffect(() => {
    if (!restoredId) return;
    document
      .querySelector(`[data-library-item="${CSS.escape(restoredId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [restoredId, items]);
  const closeDeleteDialog = useCallback(() => setPendingDeleteId(null), []);
  const closeRetranscribe = useCallback(() => setRetranscribeItem(null), []);

  const rediarizeItem = useCallback(
    async (id: string) => {
      try {
        await rediarizeMutation.mutateAsync(id);
      } catch (err) {
        console.error("Failed to detect speakers:", err);
        showErrorToast(
          t({
            id: "library.view.rediarize_error",
            message: "Couldn't detect speakers.",
          }),
        );
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
      showErrorToast(
        t({
          id: "library.view.import_dialog_error",
          message: "Could not open the import dialog.",
        }),
      );
    }
  };

  const startNameEdit = useCallback((item: LibraryItem) => {
    setEditingNameId(item.id);
    setEditingNameDraft(item.name);
  }, []);

  const cancelNameEdit = useCallback(() => {
    setEditingNameId(null);
    setEditingNameDraft("");
  }, []);

  const commitNameEdit = useCallback(
    async (item: LibraryItem, draft: string) => {
      const nextName = draft.trim();
      setEditingNameId(null);
      setEditingNameDraft("");
      if (!nextName || nextName === item.name) return;
      try {
        await updateItemWithTags(item.id, { name: nextName });
      } catch (err) {
        console.error("Failed to rename library item:", err);
        showErrorToast(
          t({
            id: "library.detail.rename_failed",
            message: "Couldn't rename this item.",
          }),
        );
      }
    },
    [updateItemWithTags, t],
  );

  const folderAction = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        return true;
      } catch (err) {
        console.error("Library folder change failed:", err);
        showErrorToast(
          t({
            id: "library.folder.change_failed",
            message: "Couldn't change the folder.",
          }),
        );
        return false;
      } finally {
        void queryClient.invalidateQueries({ queryKey: libraryKeys.all });
      }
    },
    [queryClient, t],
  );

  const moveToFolder = useCallback(
    (item: LibraryItem, next: string | null) => {
      void folderAction(() => libraryApi.moveLibraryItem(item.id, next));
    },
    [folderAction],
  );

  const startNewFolder = useCallback(
    (item?: LibraryItem) => setFolderDialog({ mode: "new", itemId: item?.id }),
    [],
  );

  const submitFolderDialog = (name: string) => {
    const dialog = folderDialog;
    setFolderDialog(null);
    if (!dialog) return;
    if (dialog.mode === "rename") {
      if (name === dialog.folder) return;
      const from = dialog.folder;
      void folderAction(async () => {
        const renamed = await libraryApi.renameLibraryFolder(from, name);
        setFolder((current) => (current === from ? renamed : current));
      });
      return;
    }
    const itemId = dialog.itemId;
    void folderAction(async () => {
      const created = await libraryApi.createLibraryFolder(name);
      if (itemId) await libraryApi.moveLibraryItem(itemId, created);
    });
  };

  const deleteFolder = (name: string) => {
    void folderAction(async () => {
      await libraryApi.deleteLibraryFolder(name);
      setFolder((current) => (current === name ? null : current));
    });
  };

  const snippets = useMemo(
    () =>
      Object.assign(
        {},
        ...(data?.pages.map((page) => page.snippets ?? {}) ?? []),
      ) as Record<string, string>,
    [data],
  );

  // Rows show a passage only for a word search; cards always show one.
  const searchHasText = searchQuery
    .split(/\s+/)
    .some((word) => word && !word.startsWith("#"));

  // Consecutive items from the same day, newest first like the list.
  const daySections = useMemo(() => {
    const sections: { key: string; label: string; items: LibraryItem[] }[] = [];
    for (const item of items) {
      const created = new Date(item.created_at);
      const last = sections[sections.length - 1];
      const lastDate = last ? new Date(last.items[0].created_at) : null;
      if (last && lastDate && areSameDay(lastDate, created)) {
        last.items.push(item);
      } else {
        sections.push({
          key: created.toDateString(),
          label: formatDayLabel(created, i18n),
          items: [item],
        });
      }
    }
    return sections;
  }, [items, i18n]);

  const defaultSpeechModelKey =
    installedModels.find((model) => model.remote)?.id ??
    installedModels.find((model) => model.key === defaultModelKey)?.id ??
    installedModels[0]?.id;
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {selectedItem ? (
        <div
          key={selectedItem.id || "selected-library-item"}
          className="flex h-full min-h-0 flex-col"
        >
          <LibraryDetail
            item={selectedItem}
            models={installedModels}
            onClose={() => setSelectedItemId(null)}
            onDelete={async () => {
              await deleteItemAndRefreshTags(selectedItem.id);
              setSelectedItemId(null);
            }}
            onRetry={() => retryItem(selectedItem.id)}
            onRetranscribe={(options) => retranscribe(selectedItem.id, options)}
            onRediarize={() => rediarizeItem(selectedItem.id)}
            rediarizing={
              rediarizeMutation.isPending &&
              rediarizeMutation.variables === selectedItem.id
            }
            onCancel={() => cancelItem(selectedItem.id)}
            onUpdate={(patch) => updateItemWithTags(selectedItem.id, patch)}
            onExport={(format, outputPath) =>
              exportMutation.mutateAsync({
                id: selectedItem.id,
                format,
                outputPath,
              })
            }
            folders={folders}
            onMove={(next) => moveToFolder(selectedItem, next)}
            onNewFolder={() =>
              setFolderDialog({ mode: "new", itemId: selectedItem.id })
            }
            onOpenFolder={(name) => {
              setFolder(name);
              setSelectedItemId(null);
            }}
          />
        </div>
      ) : (
        <>
          <div className="mx-auto flex w-full max-w-column-wide min-w-0 flex-col text-left">
            <ScreenHeader
              title={
                folder ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFolder(null)}
                      className="shrink-0 ui-color-muted transition-colors hover:text-content-primary"
                    >
                      {libraryTitle}
                    </button>
                    <CaretRight
                      size={14}
                      className="shrink-0 ui-color-muted"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">{folder}</span>
                  </span>
                ) : (
                  libraryTitle
                )
              }
              titleAdornment={
                <LibraryFolderMenu
                  folders={folders}
                  folder={folder}
                  onSelect={setFolder}
                  onRename={(name) =>
                    setFolderDialog({ mode: "rename", folder: name })
                  }
                  onDelete={deleteFolder}
                  onNew={() => startNewFolder()}
                />
              }
              trailing={
                <>
                  <SearchField
                    inputRef={searchInputRef}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t({
                      id: "library.view.search_placeholder",
                      message: "Search library...",
                    })}
                  />

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
                        <ListIcon size={15} aria-hidden="true" />
                      ) : (
                        <SquaresFour size={15} aria-hidden="true" />
                      )}
                    </button>
                  </HoverTip>

                  <button
                    onClick={handleImportClick}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] px-3 ui-text-body-sm ui-color-primary hover:border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-overlay)] transition-colors shrink-0"
                  >
                    <Plus size={13} aria-hidden="true" />
                    {t({ id: "library.view.import_button", message: "Import" })}
                  </button>
                </>
              }
            />

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-3 ui-text-body-sm ui-color-error-tint mx-4 mb-2"
              >
                {error}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-x-hidden custom-scrollbar column-scroll pb-6 pt-6 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]">
            <div key="library-list" className="flex flex-col gap-6 w-full">
              <div className="mx-auto flex w-full max-w-column-wide min-w-0 flex-col gap-6">
                <div className="flex min-w-0 flex-col gap-6">
                  {isLoading && items.length === 0 && (
                    <div
                      role="status"
                      aria-label={t({
                        id: "library.view.loading_more",
                        message: "Loading...",
                      })}
                      className="py-12 flex items-center justify-center"
                    >
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

                  {daySections.map((section) => (
                    <section key={section.key} className="min-w-0">
                      <div className="flex items-center gap-3 pb-2">
                        <h3 className="shrink-0 ui-text-body-sm-strong ui-color-secondary">
                          {section.label}
                        </h3>
                        <div
                          className="ui-divider-trailing flex-1"
                          aria-hidden="true"
                        />
                      </div>
                      <div
                        role="list"
                        aria-label={section.label}
                        className={
                          layout === "grid"
                            ? "grid min-w-0 gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]"
                            : "flex min-w-0 flex-col divide-y divide-border-primary"
                        }
                      >
                        {section.items.map((item, index) => (
                          <div
                            key={item.id || `library-item-${index}`}
                            role="listitem"
                            data-library-item={item.id}
                            className="relative min-w-0"
                          >
                            {item.id === restoredId && (
                              <motion.div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 z-30 rounded-[var(--radius-lg)] bg-[var(--color-cloud-20)]"
                                initial={{ opacity: 1 }}
                                animate={{ opacity: 0 }}
                                transition={{
                                  duration: 1.2,
                                  delay: 0.4,
                                  ease: "easeOut",
                                }}
                                onAnimationComplete={() => setRestoredId(null)}
                              />
                            )}
                            <LibraryCard
                              item={item}
                              layout={layout}
                              snippet={
                                layout === "grid" || searchHasText
                                  ? snippets[item.id]
                                  : undefined
                              }
                              onOpen={setSelectedItemId}
                              editingNameId={editingNameId}
                              // Only the card being edited re-renders while typing.
                              editingNameDraft={
                                editingNameId === item.id
                                  ? editingNameDraft
                                  : ""
                              }
                              onStartNameEdit={startNameEdit}
                              onChangeNameDraft={setEditingNameDraft}
                              onCommitNameEdit={commitNameEdit}
                              onCancelNameEdit={cancelNameEdit}
                              onRetry={retryItem}
                              onRetranscribe={setRetranscribeItem}
                              onCancel={cancelItem}
                              onDelete={setPendingDeleteId}
                              onQuickDelete={deleteItemAndRefreshTags}
                              folders={folders}
                              onMove={moveToFolder}
                              onNewFolder={startNewFolder}
                              shiftHeld={shiftHeld}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                {items.length > 0 && hasNextPage && (
                  <div className="flex items-center justify-center">
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
        </>
      )}

      <LibraryFolderDialog
        state={folderDialog}
        onCancel={() => setFolderDialog(null)}
        onSubmit={submitFolderDialog}
      />

      <LibraryDeleteDialog
        open={pendingDeleteId !== null}
        onCancel={closeDeleteDialog}
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (id) void deleteItemAndRefreshTags(id).catch(() => {});
        }}
      />

      <AnimatePresence>
        {retranscribeItem && (
          <LibraryRetranscribeModal
            item={retranscribeItem}
            models={installedModels}
            onCancel={closeRetranscribe}
            onConfirm={async (options) => {
              await retranscribe(retranscribeItem.id, options);
              setRetranscribeItem(null);
            }}
          />
        )}
      </AnimatePresence>

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
                showWarningToast(
                  t({
                    id: "library.view.unsupported_files_skipped",
                    message: plural(unsupported.length, {
                      one: "Skipped # file in an unsupported format.",
                      other: "Skipped # files in an unsupported format.",
                    }),
                  }),
                );
              }

              for (const path of supported) {
                try {
                  await createItemMutation.mutateAsync({ path, options });
                } catch (err) {
                  console.error("Failed to import file:", err);
                  const message =
                    err instanceof Error ? err.message : String(err);
                  showErrorToast(formatImportErrorMessage(message));
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
