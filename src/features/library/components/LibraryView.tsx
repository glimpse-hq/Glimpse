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
  Plus,
  Record as RecordIcon,
  Stop,
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
import ActiveMeetingCard from "./ActiveMeetingCard";
import LibraryDeleteDialog from "./LibraryDeleteDialog";
import LibraryRetranscribeModal, {
  type LibraryRetranscribeOptions,
} from "./LibraryRetranscribeModal";
import {
  useLibraryItems as useLibraryItemsQuery,
  useLibraryItem,
  useLibraryMetadataProcessing,
  useCreateLibraryItem,
  useUpdateLibraryItem,
  useGenerateLibraryItemTitle,
  useDeleteLibraryItem,
  useCancelLibraryTranscription,
  useRediarizeLibraryItem,
  useRetryLibraryTranscription,
  useExportLibraryItem,
  useLibraryTags,
  libraryKeys,
  useMeetingState,
  useStartMeetingRecording,
  useStopMeetingRecording,
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
import { showErrorToast } from "../../../shared/lib/errorToast";

type LibraryViewProps = {
  pendingImportPaths: string[] | null;
  openItemId?: string | null;
  onOpenItemHandled?: () => void;
  onSetImportPaths: (paths: string[] | null) => void;
  isActive: boolean;
  scope: "files" | "meetings";
};

const LAYOUT_KEY = "glimpse.library.layout";

const LibraryView = ({
  pendingImportPaths,
  openItemId = null,
  onOpenItemHandled,
  onSetImportPaths,
  isActive,
  scope,
}: LibraryViewProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const [followTimestamps, setFollowTimestamps] = useState(
    () => localStorage.getItem("glimpse.library.follow_playback") !== "false",
  );
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [retranscribeItem, setRetranscribeItem] = useState<LibraryItem | null>(
    null,
  );
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const shiftHeld = useShiftHeld(isActive);
  const { data: meetingState } = useMeetingState(
    isActive && scope === "meetings",
  );
  const startMeetingMutation = useStartMeetingRecording();
  const stopMeetingMutation = useStopMeetingRecording();
  const filter = useMemo<LibraryFilter>(() => {
    return {
      search: searchQuery || null,
      status: statusFilter === "all" ? null : statusFilter,
      kind: scope,
      tag: null,
      since_days: null,
    };
  }, [searchQuery, scope, statusFilter]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: queryError,
  } = useLibraryItemsQuery(filter, isActive);

  const { data: availableTags = [] } = useLibraryTags(isActive);
  const automaticallyOrganizingIds = useLibraryMetadataProcessing(isActive);
  const { data: speechModels = [] } = useSpeechModels(isActive);
  const { data: defaultModelKey = "" } = useSettings(
    (settings) => settings.local_model,
    isActive,
  );

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );
  // An open item that stops matching the filter or search stays open and
  // is loaded by id, showing its last listed state until that arrives.
  const listedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const lastSelectedItem = useRef<LibraryItem | null>(null);
  const { data: unlistedItem } = useLibraryItem(
    selectedItemId,
    selectedItemId !== null && !listedItem,
  );
  if (listedItem) lastSelectedItem.current = listedItem;
  const selectedItem =
    listedItem ??
    (unlistedItem?.id === selectedItemId ? unlistedItem : null) ??
    (lastSelectedItem.current?.id === selectedItemId
      ? lastSelectedItem.current
      : null);
  useEffect(() => {
    if (!selectedItemId) return;
    void invoke("track_feature_used_command", { feature: "library" }).catch(
      () => {},
    );
  }, [selectedItemId]);
  useEffect(() => {
    if (!isActive || selectedItemId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f")
        return;
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
  const generateTitleMutation = useGenerateLibraryItemTitle();
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

  const generateItemTitle = useCallback(
    async (id: string) => {
      try {
        await generateTitleMutation.mutateAsync(id);
      } catch (err) {
        console.error("Failed to generate library item title and tags:", err);
        const code = err instanceof Error ? err.message : String(err);
        const message = code.includes("title_model_not_configured")
          ? t({
              id: "library.card.title.error.not_configured",
              message: "Configure a writing model before generating a title.",
            })
          : code.includes("title_rate_limited")
            ? t({
                id: "library.card.title.error.rate_limited",
                message:
                  "The writing provider has reached its rate or usage limit. Try again later.",
              })
            : code.includes("title_unauthorized")
              ? t({
                  id: "library.card.title.error.unauthorized",
                  message:
                    "The writing provider rejected its API key. Check it in Settings.",
                })
              : code.includes("title_model_not_found")
                ? t({
                    id: "library.card.title.error.not_found",
                    message:
                      "The configured writing model could not be found. Check it in Settings.",
                  })
                : code.includes("title_request_rejected")
                  ? t({
                      id: "library.card.title.error.rejected",
                      message:
                        "The writing provider rejected the title request.",
                    })
                  : code.includes("title_unreachable")
                    ? t({
                        id: "library.card.title.error.unreachable",
                        message:
                          "Could not reach the writing provider. Check your connection and try again.",
                      })
                    : code.includes("title_invalid_response")
                      ? t({
                          id: "library.card.title.error.invalid_response",
                          message:
                            "The writing model responded, but could not organize this item. Try again.",
                        })
                      : t({
                          id: "library.card.title.error",
                          message:
                            "Could not generate a title and tags. Try again.",
                        });
        invoke("debug_show_toast", {
          toastType: "error",
          message,
        }).catch(() => {});
        throw err;
      }
    },
    [generateTitleMutation, t],
  );

  const retranscribe = useCallback(
    async (id: string, options: LibraryRetranscribeOptions) => {
      await updateItemWithTags(id, {
        speech_model: options.model_key,
        llm_cleanup_enabled: false,
        show_timestamps: options.show_timestamps,
        detect_speakers: options.detect_speakers,
      });
      await retryMutation.mutateAsync(id);
    },
    [updateItemWithTags, retryMutation],
  );
  const closeDeleteDialog = useCallback(() => setPendingDeleteId(null), []);
  const closeRetranscribe = useCallback(() => setRetranscribeItem(null), []);

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
    try {
      await updateItemWithTags(itemId, { name: nextName });
    } catch (err) {
      console.error("Failed to rename library item:", err);
      showErrorToast(
        t({
          id: "library.detail.rename_failed",
          message: "Couldn't rename this item.",
        }),
      );
    }
  };

  const saveTags = async (itemId: string, tags: string[]) => {
    try {
      await updateItemWithTags(itemId, { tags });
      return true;
    } catch (err) {
      console.error("Failed to save library tags:", err);
      showErrorToast(
        t({
          id: "library.detail.tags_failed",
          message: "Couldn't save the tags.",
        }),
      );
      return false;
    }
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
    // A failed save keeps the editor open with what was typed.
    if (!(await saveTags(itemId, [...item.tags, nextTag]))) return;
    setTagDraft("");
    setEditingTagId(null);
  };

  const defaultSpeechModelKey =
    installedModels.find((model) => model.remote)?.id ??
    installedModels.find((model) => model.key === defaultModelKey)?.id ??
    installedModels[0]?.id;
  const meetingBusy =
    startMeetingMutation.isPending || stopMeetingMutation.isPending;
  const handleMeetingClick = async () => {
    try {
      if (meetingState?.recording) {
        await stopMeetingMutation.mutateAsync();
        return;
      }
      if (!defaultSpeechModelKey) {
        invoke("debug_show_toast", {
          toastType: "error",
          message: t({
            id: "library.meeting.model_required",
            message: "Install or configure a speech model first.",
          }),
        }).catch(() => {});
        return;
      }
      await startMeetingMutation.mutateAsync({
        store_original: false,
        model_key: defaultSpeechModelKey,
        llm_cleanup_enabled: false,
        show_timestamps: true,
        detect_speakers: true,
      });
    } catch (err) {
      console.error("Meeting recording failed:", err);
      invoke("debug_show_toast", {
        toastType: "error",
        message: t({
          id: "library.meeting.error",
          message: "Meeting recording failed. Check permissions and try again.",
        }),
      }).catch(() => {});
    }
  };
  const statusFilterOptions = useMemo(
    () => [
      {
        value: "all" as const,
        label: t({ id: "library.filter.all", message: "All" }),
      },
      {
        value: "active" as const,
        label: t({ id: "library.filter.active", message: "Active" }),
      },
      {
        value: "complete" as const,
        label: t({ id: "library.filter.done", message: "Done" }),
      },
      {
        value: "error" as const,
        label: t({ id: "library.filter.failed", message: "Failed" }),
      },
    ],
    [t],
  );
  const headerAction =
    scope === "files" ? (
      <button
        type="button"
        onClick={handleImportClick}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-content-primary px-3.5 py-1.5 text-sm leading-5 font-semibold text-surface-secondary transition-all hover:bg-content-secondary shadow-[0_3px_0_-1px_rgba(255,255,255,0.25),inset_0_1px_0_0_rgba(255,255,255,0.1)] active:translate-y-[1px] active:shadow-none"
      >
        <Plus size={14} aria-hidden="true" />
        {t({ id: "library.view.import_button", message: "Import" })}
      </button>
    ) : (
      <button
        type="button"
        onClick={handleMeetingClick}
        disabled={
          meetingBusy || (!meetingState?.recording && !defaultSpeechModelKey)
        }
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm leading-5 font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-[1px] active:shadow-none ${
          meetingState?.recording
            ? "bg-[var(--color-error)] text-white hover:opacity-90 shadow-[0_3px_0_-1px_rgba(255,255,255,0.2)]"
            : "bg-content-primary text-surface-secondary hover:bg-content-secondary shadow-[0_3px_0_-1px_rgba(255,255,255,0.25),inset_0_1px_0_0_rgba(255,255,255,0.1)]"
        }`}
      >
        {meetingBusy ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : meetingState?.recording ? (
          <Stop size={14} weight="fill" aria-hidden="true" />
        ) : (
          <RecordIcon size={14} weight="fill" aria-hidden="true" />
        )}
        {meetingState?.recording
          ? t({ id: "library.meeting.stop", message: "Stop recording" })
          : t({ id: "library.meeting.start", message: "Record meeting" })}
      </button>
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
            followTimestamps={followTimestamps}
            onFollowTimestampsChange={setFollowTimestamps}
            shiftHeld={shiftHeld}
            onClose={() => setSelectedItemId(null)}
            onDelete={async () => {
              await deleteItemAndRefreshTags(selectedItem.id);
              setSelectedItemId(null);
            }}
            onRetry={() => retryMutation.mutateAsync(selectedItem.id)}
            onRetranscribe={(options) => retranscribe(selectedItem.id, options)}
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
            onGenerateTitle={() => generateItemTitle(selectedItem.id)}
            isGeneratingTitle={
              automaticallyOrganizingIds.has(selectedItem.id) ||
              (generateTitleMutation.isPending &&
                generateTitleMutation.variables === selectedItem.id)
            }
            backLabel={
              scope === "meetings"
                ? t({
                    id: "meeting.detail.back",
                    message: "Back to meetings",
                  })
                : t({
                    id: "library.detail.back",
                    message: "Back to library",
                  })
            }
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
              title={
                scope === "meetings"
                  ? t({ id: "meeting.view.title", message: "Meetings" })
                  : t({ id: "library.view.title", message: "Library" })
              }
              description={t({
                id: "library.view.description",
                message: "Import audio and video files for transcription.",
              })}
              trailing={
                <>
                  {headerAction}
                  <div className="relative w-56 min-w-0">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 ui-color-muted"
                    />
                    <input
                      ref={searchInputRef}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      {...{ writingsuggestions: "false" }}
                      placeholder={t({
                        id: "library.view.search_placeholder",
                        message: "Search library...",
                      })}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return;
                        if (searchQuery) setSearchQuery("");
                        else e.currentTarget.blur();
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
                    active={statusFilter !== "all"}
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
                          selected: statusFilter === option.value,
                          onSelect: () => setStatusFilter(option.value),
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
                {scope === "meetings" && meetingState?.recording && (
                  <ActiveMeetingCard
                    meeting={meetingState}
                    stopping={stopMeetingMutation.isPending}
                    onStop={() => void handleMeetingClick()}
                  />
                )}
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

                  {!isLoading &&
                    items.length === 0 &&
                    !(scope === "meetings" && meetingState?.recording) && (
                      <button
                        type="button"
                        onClick={
                          scope === "meetings"
                            ? handleMeetingClick
                            : handleImportClick
                        }
                        className="col-span-full rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-8 flex flex-col items-center justify-center text-center hover:text-content-secondary hover:border-border-hover transition-colors"
                      >
                        {scope === "meetings" ? (
                          <RecordIcon
                            size={20}
                            className="text-content-disabled"
                            weight="fill"
                          />
                        ) : (
                          <FolderOpen
                            size={20}
                            className="text-content-disabled"
                          />
                        )}
                        <p className="mt-3 ui-text-body ui-color-muted">
                          {scope === "meetings"
                            ? t({
                                id: "meeting.view.empty_state",
                                message: "Record your first meeting.",
                              })
                            : t({
                                id: "library.view.empty_state",
                                message:
                                  "Drag files here to build your Library.",
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
                        await saveTags(
                          item.id,
                          item.tags.filter((entry) => entry !== tag),
                        );
                      }}
                      onClickTag={(tag) => setSearchQuery(`#${tag}`)}
                      editingNameId={editingNameId}
                      editingNameDraft={editingNameDraft}
                      onStartNameEdit={() => startNameEdit(item)}
                      onChangeNameDraft={setEditingNameDraft}
                      onCommitNameEdit={() => commitNameEdit(item.id)}
                      onCancelNameEdit={cancelNameEdit}
                      onRetry={() => retryMutation.mutateAsync(item.id)}
                      onRetranscribe={() => setRetranscribeItem(item)}
                      onCancel={() => cancelMutation.mutateAsync(item.id)}
                      onDelete={() => setPendingDeleteId(item.id)}
                      onQuickDelete={() => deleteItemAndRefreshTags(item.id)}
                      onGenerateTitle={() => generateItemTitle(item.id)}
                      isGeneratingTitle={
                        automaticallyOrganizingIds.has(item.id) ||
                        (generateTitleMutation.isPending &&
                          generateTitleMutation.variables === item.id)
                      }
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

                  {scope === "files" && items.length > 0 && (
                    <button
                      onClick={handleImportClick}
                      className="rounded-xl border border-dashed border-border-secondary bg-surface-secondary p-4 flex flex-col items-center justify-center text-center ui-color-muted hover:text-content-secondary hover:border-border-hover transition-colors"
                    >
                      <FolderOpen size={18} />
                      <span className="mt-2 ui-text-body-sm">
                        {t({
                          id: "library.view.dropzone",
                          message: "Drop files to import",
                        })}
                      </span>
                    </button>
                  )}

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
        {scope === "files" && pendingImportPaths !== null && (
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
                    id: "library.view.unsupported_files_skipped",
                    message: plural(unsupported.length, {
                      one: "Skipped # file in an unsupported format.",
                      other: "Skipped # files in an unsupported format.",
                    }),
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
