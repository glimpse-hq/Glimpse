import { useLingui } from "@lingui/react/macro";
import { memo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  WarningCircle as AlertCircle,
  CaretDown as ChevronDown,
  BookmarkSimple,
  DotsThree as MoreHorizontal,
  PencilSimple as Pencil,
  ArrowClockwise as RotateCw,
  Trash as Trash2,
  X,
} from "@phosphor-icons/react";
import {
  clampProgress,
  formatDuration,
  getLibraryErrorDetails,
  shouldShowImportProgress,
  formatLibraryName,
  describeAudioSources,
} from "./library-utils";
import { formatBytes } from "../../../shared/lib/format";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";
import { IntelligencePixel } from "../../../shared/ui/IntelligencePixel";
import type { LibraryItem } from "../../../types";
import { showErrorToast } from "../../../shared/lib/errorToast";

export type LibraryLayout = "list" | "grid";

const LibraryCard = ({
  item,
  layout,
  onOpen,
  onRemoveTag,
  onClickTag,
  editingNameId,
  editingNameDraft,
  onStartNameEdit,
  onChangeNameDraft,
  onCommitNameEdit,
  onCancelNameEdit,
  onRetry,
  onRetranscribe,
  onCancel,
  onDelete,
  onQuickDelete,
  editingTagId,
  tagDraft,
  onStartTagEdit,
  onChangeTagDraft,
  onCommitTagAdd,
  onCancelTagEdit,
  shiftHeld,
  availableTags,
}: {
  item: LibraryItem;
  layout: LibraryLayout;
  onOpen: (id: string) => void;
  onRemoveTag: (item: LibraryItem, tag: string) => Promise<void>;
  onClickTag?: (tag: string) => void;
  editingNameId: string | null;
  editingNameDraft: string;
  onStartNameEdit: (item: LibraryItem) => void;
  onChangeNameDraft: (value: string) => void;
  onCommitNameEdit: (item: LibraryItem, draft: string) => void;
  onCancelNameEdit: () => void;
  onRetry: (id: string) => Promise<void>;
  onRetranscribe: (item: LibraryItem) => void;
  onCancel: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  // Shift-click deletes without asking.
  onQuickDelete: (id: string) => Promise<void>;
  editingTagId: string | null;
  tagDraft: string;
  onStartTagEdit: (id: string) => void;
  onChangeTagDraft: (value: string) => void;
  onCommitTagAdd: (item: LibraryItem, value: string) => void;
  onCancelTagEdit: () => void;
  shiftHeld: boolean;
  availableTags: string[];
}) => {
  const { t } = useLingui();
  const sourcesLabel = describeAudioSources(item.sources, {
    microphone: t({ id: "library.sources.microphone", message: "Microphone" }),
    systemAudio: t({
      id: "library.sources.system_audio",
      message: "System Audio",
    }),
  });
  const status = item.status;
  const createdAt = new Date(item.created_at);
  const createdAtLabel = Number.isNaN(createdAt.getTime())
    ? null
    : createdAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year:
          createdAt.getFullYear() === new Date().getFullYear()
            ? undefined
            : "numeric",
      });
  const bookmarkCount = item.bookmarks?.length ?? 0;

  const showImportProgress =
    status.type === "importing" && shouldShowImportProgress(status.progress);
  const isTranscribing = status.type === "transcribing" || showImportProgress;
  const isComplete = status.type === "complete";
  const isError = status.type === "error";

  const showProgressBar = isTranscribing;
  const progress = showProgressBar ? clampProgress(status.progress) : 0;

  const isEditingName = editingNameId === item.id;
  const isAddingTag = editingTagId === item.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const errorDetails =
    status.type === "error" ? getLibraryErrorDetails(status.message) : null;

  const normalizedDraft = tagDraft.trim().toLowerCase();
  const filteredTagOptions = availableTags.filter((tag) => {
    const tagLower = tag.toLowerCase();
    if (item.tags.some((existing) => existing.toLowerCase() === tagLower)) {
      return false;
    }
    if (!normalizedDraft) return true;
    return tagLower.includes(normalizedDraft);
  });

  const menuPanelRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);
  useMenuKeyboard(menuPanelRef, menuOpen, () => setMenuOpen(false));
  useClickOutside(tagMenuRef, () => setTagMenuOpen(false), tagMenuOpen);

  const handleDelete = () => {
    setMenuOpen(false);
    onDelete(item.id);
  };

  // Failures already raise a toast from the view.
  const handleQuickDelete = () => {
    void onQuickDelete(item.id).catch(() => {});
  };

  const handleRetry = async () => {
    setMenuOpen(false);
    if (status.type !== "error") {
      onRetranscribe(item);
      return;
    }
    try {
      await onRetry(item.id);
    } catch (err) {
      console.error("Failed to retry library transcription:", err);
      showErrorToast(
        t({
          id: "library.detail.retry_failed",
          message: "Couldn't start the transcription again.",
        }),
      );
    }
  };

  const handleCancel = async () => {
    setMenuOpen(false);
    try {
      await onCancel(item.id);
    } catch (err) {
      console.error("Failed to cancel library transcription:", err);
      showErrorToast(
        t({
          id: "library.card.cancel_failed",
          message: "Couldn't stop the transcription.",
        }),
      );
    }
  };

  if (layout === "grid") {
    return (
      <div
        onClick={() => {
          if (!isEditingName && !isAddingTag) {
            onOpen(item.id);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (shiftHeld) {
            handleQuickDelete();
          } else {
            setMenuOpen(true);
          }
        }}
        onKeyDown={(event) => {
          // Keys pressed on the buttons and fields inside belong to them.
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!isEditingName && !isAddingTag) {
              onOpen(item.id);
            }
          }
        }}
        role="button"
        tabIndex={0}
        className={`ui-card-liftable group relative z-0 flex min-w-0 flex-col h-[220px] outline-none hover:z-10 ${
          shiftHeld
            ? "!border-[var(--color-error)]/30 hover:!border-[var(--color-error)]/60 !bg-[var(--color-error)]/5"
            : ""
        }`}
      >
        <div className="px-4 pt-2 pb-2.5 flex flex-col h-full relative w-full min-w-0">
          <div className="mb-0.5 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <IntelligencePixel
                active={isTranscribing}
                statusType={item.status.type}
              />

              <div className="flex min-w-0 flex-col gap-1 pt-[1px] min-h-[24px]">
                <div className="flex items-center gap-1.5 h-3">
                  <span
                    className={`ui-text-label-strong ${
                      isError
                        ? "ui-color-error-strong font-semibold"
                        : isTranscribing
                          ? "ui-color-accent font-semibold"
                          : isComplete
                            ? "ui-color-secondary"
                            : "ui-color-muted"
                    }`}
                  >
                    {isTranscribing
                      ? status.type === "importing"
                        ? t({
                            id: "library.card.status.converting",
                            message: `Converting ${(progress * 100).toFixed(0)}%`,
                          })
                        : status.type === "transcribing" &&
                            status.detecting_speakers
                          ? t({
                              id: "library.card.status.detecting_speakers",
                              message: "Detecting speakers",
                            })
                          : t({
                              id: "library.card.status.transcribing",
                              message: `Transcribing ${(progress * 100).toFixed(0)}%`,
                            })
                      : isError
                        ? t({
                            id: "library.card.status.failed",
                            message: "Failed",
                          })
                        : isComplete
                          ? (createdAtLabel ??
                            t({
                              id: "library.card.status.ready",
                              message: "Ready",
                            }))
                          : t({
                              id: "library.card.status.queued",
                              message: "Queued",
                            })}
                  </span>

                  {isError && errorDetails && (
                    <div
                      className="relative group/tooltip flex items-center cursor-default min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertCircle
                        size={12}
                        className="ui-color-error-strong"
                        aria-hidden="true"
                      />
                      <span className="sr-only">{errorDetails.message}</span>
                      <div className="absolute top-0 left-[calc(100%+8px)] w-56 p-3 bg-[var(--color-bg-overlay)] border border-[var(--color-border-hover)] rounded-lg shadow-xl opacity-0 -translate-x-2 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-x-0 transition-all duration-150 ease-out pointer-events-none z-[100]">
                        <p className="ui-text-body-sm ui-color-primary normal-case tracking-normal">
                          {errorDetails.message}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {isTranscribing && (
                  <div className="w-16 h-[2px] bg-[var(--color-border-hover)] rounded-full overflow-hidden flex">
                    <motion.div
                      className="h-full bg-[var(--color-accent)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress * 100}%` }}
                      transition={{ ease: "linear", duration: 0.5 }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center -mr-1 -mt-1 overflow-visible h-6">
              <div
                ref={menuRef}
                data-no-press
                className="flex relative items-center justify-center"
              >
                <button
                  data-no-press
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (shiftHeld) {
                      handleQuickDelete();
                    } else {
                      setMenuOpen((prev) => !prev);
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (e.repeat) return;
                      if (shiftHeld) {
                        handleQuickDelete();
                      } else {
                        setMenuOpen((prev) => !prev);
                      }
                    }
                  }}
                  onKeyUp={(e) => e.stopPropagation()}
                  className={`p-1 ml-1 rounded transition-colors duration-200 outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-hover)] flex items-center justify-center ${
                    shiftHeld
                      ? "ui-color-error hover:bg-[var(--color-error)]/10"
                      : menuOpen
                        ? "ui-color-primary bg-[var(--color-bg-elevated)]"
                        : "ui-color-muted hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
                  }`}
                  aria-label={t({
                    id: "library.card.more_options",
                    message: "More options",
                  })}
                >
                  {shiftHeld ? (
                    <Trash2 size={14} className="shrink-0 transform-gpu" />
                  ) : (
                    <MoreHorizontal
                      size={14}
                      className="shrink-0 transform-gpu"
                    />
                  )}
                </button>
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      ref={menuPanelRef}
                      role="menu"
                      data-no-press
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 top-full mt-2 z-[100] min-w-[160px] rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-overlay)] shadow-xl shadow-[var(--color-shadow-soft-50)] overflow-hidden"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onStartNameEdit(item);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
                      >
                        <Pencil size={12} className="ui-color-muted" />
                        <span>
                          {t({ id: "library.card.rename", message: "Rename" })}
                        </span>
                      </button>

                      {status.type === "transcribing" ||
                      status.type === "cancelling" ||
                      status.type === "pending" ||
                      status.type === "importing" ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleCancel}
                          className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
                        >
                          <X size={12} className="ui-color-warning" />
                          <span>
                            {t({
                              id: "library.card.cancel",
                              message: "Cancel",
                            })}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleRetry}
                          className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
                        >
                          <RotateCw size={12} className="ui-color-cloud" />
                          <span>
                            {status.type === "error"
                              ? t({
                                  id: "library.card.retry",
                                  message: "Retry",
                                })
                              : t({
                                  id: "library.card.retranscribe",
                                  message: "Retranscribe",
                                })}
                          </span>
                        </button>
                      )}

                      <div className="h-px bg-[var(--color-border-secondary)] mx-2 my-1" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleDelete}
                        className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-error-strong hover:bg-[var(--color-error)]/10 transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-error)]/10"
                      >
                        <Trash2 size={12} />
                        <span>
                          {t({ id: "library.card.delete", message: "Delete" })}
                        </span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-start overflow-hidden w-full relative">
            {isEditingName ? (
              <input
                value={editingNameDraft}
                onChange={(event) => onChangeNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCommitNameEdit(item, editingNameDraft);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelNameEdit();
                  }
                }}
                onBlur={() => onCommitNameEdit(item, editingNameDraft)}
                onClick={(event) => event.stopPropagation()}
                aria-label={t({ id: "library.card.rename", message: "Rename" })}
                className="w-full min-w-0 bg-transparent p-0 ui-text-title-lg font-medium leading-snug ui-color-primary border-0 border-b border-[var(--color-border-primary)] outline-hidden focus:border-[var(--color-border-hover)]"
                autoFocus
              />
            ) : (
              <h3 className="ui-text-title-lg font-medium leading-snug ui-color-primary line-clamp-3 break-words">
                {formatLibraryName(item.name)}
              </h3>
            )}
          </div>

          <div className="mt-auto shrink-0 flex flex-col gap-2 pt-2.5 border-t border-[var(--color-border-primary)]">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 ui-text-label ui-color-muted">
              <span>{formatDuration(item.duration_seconds)}</span>
              <span className="opacity-40">&bull;</span>
              {item.kind === "recording" && (
                <>
                  <span title={sourcesLabel ?? undefined}>
                    {t({ id: "library.card.recording", message: "Recording" })}
                  </span>
                  <span className="opacity-40">&bull;</span>
                </>
              )}
              <span>{formatBytes(item.file_size_bytes)}</span>
              {bookmarkCount > 0 && (
                <>
                  <span className="opacity-40">&bull;</span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <BookmarkSimple size={11} aria-hidden="true" />
                    {bookmarkCount}
                  </span>
                </>
              )}
              {item.source_path && (
                <>
                  <span className="opacity-40">&bull;</span>
                  <span>
                    {t({ id: "library.card.imported", message: "Imported" })}
                  </span>
                </>
              )}
            </div>

            <div className="relative w-full h-6 overflow-visible">
              {isAddingTag ? (
                <div
                  className="flex items-center gap-1.5 h-6"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div ref={tagMenuRef} className="relative flex items-center">
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setTagMenuOpen((prev) => !prev)}
                      className="flex items-center justify-center w-[16px] h-[16px] shrink-0 ui-color-primary hover:text-[var(--color-text-secondary)] transition-colors"
                      aria-label={t({
                        id: "library.card.select_existing_tag",
                        message: "Select existing tag",
                      })}
                      title={t({
                        id: "library.card.select_existing_tag",
                        message: "Select existing tag",
                      })}
                    >
                      <ChevronDown
                        size={12}
                        className={`translate-y-[1px] transition-transform duration-150 ${tagMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    <AnimatePresence>
                      {tagMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute left-0 top-full mt-1 z-[120] w-36 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-overlay)] shadow-lg shadow-[var(--color-shadow-soft-40)] overflow-hidden"
                        >
                          <div className="max-h-36 overflow-y-auto custom-scrollbar">
                            {filteredTagOptions.length > 0 ? (
                              filteredTagOptions.map((tag, index) => (
                                <button
                                  key={`tag-option-${index}-${tag || "empty"}`}
                                  type="button"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() => {
                                    onCommitTagAdd(item, tag);
                                    setTagMenuOpen(false);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 ui-text-button-sm ui-color-secondary hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
                                >
                                  {tag}
                                </button>
                              ))
                            ) : (
                              <div className="px-2.5 py-2 ui-text-micro ui-color-muted">
                                {availableTags.length === 0
                                  ? t({
                                      id: "library.card.no_tags_yet",
                                      message: "No tags yet",
                                    })
                                  : t({
                                      id: "library.card.no_other_tags",
                                      message: "No other tags",
                                    })}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <input
                    value={tagDraft}
                    onChange={(event) => onChangeTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitTagAdd(item, tagDraft);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelTagEdit();
                      }
                    }}
                    onBlur={onCancelTagEdit}
                    aria-label={t({
                      id: "library.card.add_tag",
                      message: "Add tag",
                    })}
                    placeholder={t({
                      id: "library.card.new_tag",
                      message: "New tag...",
                    })}
                    className="tag-input-intro flex-1 min-w-0 h-6 box-border bg-transparent border-b border-[var(--color-border-primary)] px-0.5 py-0 ui-text-meta leading-none ui-color-secondary outline-hidden focus:border-[var(--color-border-hover)] placeholder:text-[var(--color-text-disabled)]"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 absolute inset-0 mask-fade-right w-[95%]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartTagEdit(item.id);
                    }}
                    aria-label={t({
                      id: "library.card.add_tag",
                      message: "Add tag",
                    })}
                    className="flex items-center justify-center w-[16px] h-[16px] shrink-0 ui-color-primary hover:text-[var(--color-text-secondary)] transition-colors text-[14px] leading-none"
                  >
                    +
                  </button>
                  {item.tags.map((tag, index) => (
                    <button
                      type="button"
                      key={`tag-${index}-${tag || "empty"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (shiftHeld) {
                          void onRemoveTag(item, tag);
                        } else if (onClickTag) {
                          onClickTag(tag);
                        }
                      }}
                      className={`ui-color-secondary hover:text-[var(--color-text-primary)] cursor-pointer ui-text-meta transition-colors duration-100 ease-out whitespace-nowrap ${
                        shiftHeld
                          ? "hover:!text-[var(--color-error)] hover:line-through"
                          : ""
                      }`}
                      title={
                        shiftHeld
                          ? t({
                              id: "library.card.remove_tag",
                              message: `Remove ${tag}`,
                            })
                          : undefined
                      }
                    >
                      <span className="opacity-40 mr-[1px]">#</span>
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => {
        if (!isEditingName && !isAddingTag) {
          onOpen(item.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (shiftHeld) {
          handleQuickDelete();
        } else {
          setMenuOpen(true);
        }
      }}
      onKeyDown={(event) => {
        // Keys pressed on the buttons and fields inside belong to them.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!isEditingName && !isAddingTag) {
            onOpen(item.id);
          }
        }
      }}
      role="button"
      tabIndex={0}
      className={`group relative flex h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 outline-none transition-colors hover:z-10 focus-visible:bg-surface-interactive ${
        isAddingTag || menuOpen ? "z-20" : "z-0"
      } ${
        shiftHeld
          ? "hover:bg-[var(--color-error)]/10"
          : "hover:bg-surface-interactive"
      }`}
    >
      <IntelligencePixel
        active={isTranscribing}
        statusType={item.status.type}
      />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          {isEditingName ? (
            <input
              value={editingNameDraft}
              onChange={(event) => onChangeNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitNameEdit(item, editingNameDraft);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelNameEdit();
                }
              }}
              onBlur={() => onCommitNameEdit(item, editingNameDraft)}
              onClick={(event) => event.stopPropagation()}
              aria-label={t({ id: "library.card.rename", message: "Rename" })}
              className="w-full min-w-0 bg-transparent p-0 ui-text-body font-medium ui-color-primary border-0 border-b border-[var(--color-border-primary)] outline-hidden focus:border-[var(--color-border-hover)]"
              autoFocus
            />
          ) : (
            <h3 className="truncate ui-text-body font-medium ui-color-primary">
              {formatLibraryName(item.name)}
            </h3>
          )}
        </div>
        {!isComplete && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`ui-text-label-strong ${
                isError
                  ? "ui-color-error-strong"
                  : isTranscribing
                    ? "ui-color-accent"
                    : "ui-color-muted"
              }`}
            >
              {isTranscribing
                ? status.type === "importing"
                  ? t({
                      id: "library.card.status.converting",
                      message: `Converting ${(progress * 100).toFixed(0)}%`,
                    })
                  : status.type === "transcribing" && status.detecting_speakers
                    ? t({
                        id: "library.card.status.detecting_speakers",
                        message: "Detecting speakers",
                      })
                    : t({
                        id: "library.card.status.transcribing",
                        message: `Transcribing ${(progress * 100).toFixed(0)}%`,
                      })
                : isError
                  ? t({
                      id: "library.card.status.failed",
                      message: "Failed",
                    })
                  : isComplete
                    ? t({
                        id: "library.card.status.ready",
                        message: "Ready",
                      })
                    : t({
                        id: "library.card.status.queued",
                        message: "Queued",
                      })}
            </span>
            {isError && errorDetails && (
              <div
                className="relative group/tooltip flex items-center cursor-default min-w-0"
                onClick={(e) => e.stopPropagation()}
              >
                <AlertCircle
                  size={12}
                  className="ui-color-error-strong"
                  aria-hidden="true"
                />
                <span className="sr-only">{errorDetails.message}</span>
                <div className="absolute top-0 left-[calc(100%+8px)] w-56 p-3 bg-[var(--color-bg-overlay)] border border-[var(--color-border-hover)] rounded-lg shadow-xl opacity-0 -translate-x-2 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-x-0 transition-all duration-150 ease-out pointer-events-none z-[100]">
                  <p className="ui-text-body-sm ui-color-primary normal-case tracking-normal">
                    {errorDetails.message}
                  </p>
                </div>
              </div>
            )}
            {isTranscribing && (
              <div className="w-16 h-[2px] bg-[var(--color-border-hover)] rounded-full overflow-hidden flex">
                <motion.div
                  className="h-full bg-[var(--color-accent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress * 100}%` }}
                  transition={{ ease: "linear", duration: 0.5 }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative hidden h-6 w-44 shrink-0 overflow-visible lg:block">
        {isAddingTag ? (
          <div
            className="flex items-center gap-1.5 h-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div ref={tagMenuRef} className="relative flex items-center">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTagMenuOpen((prev) => !prev)}
                className="flex items-center justify-center w-[16px] h-[16px] shrink-0 ui-color-primary hover:text-[var(--color-text-secondary)] transition-colors"
                aria-label={t({
                  id: "library.card.select_existing_tag",
                  message: "Select existing tag",
                })}
                title={t({
                  id: "library.card.select_existing_tag",
                  message: "Select existing tag",
                })}
              >
                <ChevronDown
                  size={12}
                  className={`translate-y-[1px] transition-transform duration-150 ${tagMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {tagMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-full mt-1 z-[120] w-36 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-overlay)] shadow-lg shadow-[var(--color-shadow-soft-40)] overflow-hidden"
                  >
                    <div className="max-h-36 overflow-y-auto custom-scrollbar">
                      {filteredTagOptions.length > 0 ? (
                        filteredTagOptions.map((tag, index) => (
                          <button
                            key={`tag-option-${index}-${tag || "empty"}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onCommitTagAdd(item, tag);
                              setTagMenuOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 ui-text-button-sm ui-color-secondary hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            {tag}
                          </button>
                        ))
                      ) : (
                        <div className="px-2.5 py-2 ui-text-micro ui-color-muted">
                          {availableTags.length === 0
                            ? t({
                                id: "library.card.no_tags_yet",
                                message: "No tags yet",
                              })
                            : t({
                                id: "library.card.no_other_tags",
                                message: "No other tags",
                              })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <input
              value={tagDraft}
              onChange={(event) => onChangeTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitTagAdd(item, tagDraft);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelTagEdit();
                }
              }}
              onBlur={onCancelTagEdit}
              aria-label={t({ id: "library.card.add_tag", message: "Add tag" })}
              placeholder={t({
                id: "library.card.new_tag",
                message: "New tag...",
              })}
              className="tag-input-intro flex-1 min-w-0 h-6 box-border bg-transparent border-b border-[var(--color-border-primary)] px-0.5 py-0 ui-text-meta leading-none ui-color-secondary outline-hidden focus:border-[var(--color-border-hover)] placeholder:text-[var(--color-text-disabled)]"
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 absolute inset-0 mask-fade-right w-[95%]">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStartTagEdit(item.id);
              }}
              aria-label={t({
                id: "library.card.add_tag",
                message: "Add tag",
              })}
              className="flex items-center justify-center w-[16px] h-[16px] shrink-0 ui-color-primary hover:text-[var(--color-text-secondary)] transition-colors text-[14px] leading-none"
            >
              +
            </button>
            {item.tags.map((tag, index) => (
              <button
                type="button"
                key={`tag-${index}-${tag || "empty"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (shiftHeld) {
                    void onRemoveTag(item, tag);
                  } else if (onClickTag) {
                    onClickTag(tag);
                  }
                }}
                className={`ui-color-secondary hover:text-[var(--color-text-primary)] cursor-pointer ui-text-meta transition-colors duration-100 ease-out whitespace-nowrap ${
                  shiftHeld
                    ? "hover:!text-[var(--color-error)] hover:line-through"
                    : ""
                }`}
                title={
                  shiftHeld
                    ? t({
                        id: "library.card.remove_tag",
                        message: `Remove ${tag}`,
                      })
                    : undefined
                }
              >
                <span className="opacity-40 mr-[1px]">#</span>
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="flex w-9 shrink-0 items-center gap-1 ui-text-label ui-color-muted tabular-nums">
        {bookmarkCount > 0 && (
          <>
            <BookmarkSimple size={11} aria-hidden="true" />
            {bookmarkCount}
          </>
        )}
      </span>

      <span
        className="w-20 shrink-0 truncate ui-text-label ui-color-muted"
        title={
          item.kind === "recording"
            ? [
                t({ id: "library.card.recording", message: "Recording" }),
                sourcesLabel,
              ]
                .filter(Boolean)
                .join(": ")
            : (sourcesLabel ?? undefined)
        }
      >
        {item.kind === "recording"
          ? formatBytes(item.file_size_bytes)
          : item.source_path
            ? t({ id: "library.card.imported", message: "Imported" })
            : formatBytes(item.file_size_bytes)}
      </span>

      <span className="w-14 shrink-0 text-right ui-text-label ui-color-muted tabular-nums">
        {formatDuration(item.duration_seconds)}
      </span>

      <span className="w-16 shrink-0 text-right ui-text-label ui-color-muted">
        {createdAtLabel}
      </span>

      <div
        ref={menuRef}
        data-no-press
        className="flex relative items-center justify-center"
      >
        <button
          data-no-press
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (shiftHeld) {
              handleQuickDelete();
            } else {
              setMenuOpen((prev) => !prev);
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (e.repeat) return;
              if (shiftHeld) {
                handleQuickDelete();
              } else {
                setMenuOpen((prev) => !prev);
              }
            }
          }}
          onKeyUp={(e) => e.stopPropagation()}
          className={`p-1 ml-1 rounded transition-colors duration-200 outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-hover)] flex items-center justify-center ${
            shiftHeld
              ? "ui-color-error hover:bg-[var(--color-error)]/10"
              : menuOpen
                ? "ui-color-primary bg-[var(--color-bg-elevated)]"
                : "ui-color-muted hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
          }`}
          aria-label={t({
            id: "library.card.more_options",
            message: "More options",
          })}
        >
          {shiftHeld ? (
            <Trash2 size={14} className="shrink-0 transform-gpu" />
          ) : (
            <MoreHorizontal size={14} className="shrink-0 transform-gpu" />
          )}
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuPanelRef}
              role="menu"
              data-no-press
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full mt-2 z-[100] min-w-[160px] rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-overlay)] shadow-xl shadow-[var(--color-shadow-soft-50)] overflow-hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onStartNameEdit(item);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
              >
                <Pencil size={12} className="ui-color-muted" />
                <span>
                  {t({ id: "library.card.rename", message: "Rename" })}
                </span>
              </button>

              {status.type === "transcribing" ||
              status.type === "cancelling" ||
              status.type === "pending" ||
              status.type === "importing" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleCancel}
                  className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
                >
                  <X size={12} className="ui-color-warning" />
                  <span>
                    {t({ id: "library.card.cancel", message: "Cancel" })}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRetry}
                  className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-[var(--color-bg-elevated)] transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-bg-elevated)]"
                >
                  <RotateCw size={12} className="ui-color-cloud" />
                  <span>
                    {status.type === "error"
                      ? t({
                          id: "library.card.retry",
                          message: "Retry",
                        })
                      : t({
                          id: "library.card.retranscribe",
                          message: "Retranscribe",
                        })}
                  </span>
                </button>
              )}

              <div className="h-px bg-[var(--color-border-secondary)] mx-2 my-1" />

              <button
                type="button"
                role="menuitem"
                onClick={handleDelete}
                className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-error-strong hover:bg-[var(--color-error)]/10 transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-error)]/10"
              >
                <Trash2 size={12} />
                <span>
                  {t({ id: "library.card.delete", message: "Delete" })}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default memo(LibraryCard);
