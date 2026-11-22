import { useLingui } from "@lingui/react/macro";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  WarningCircle as AlertCircle,
  BookmarkSimple,
  Check,
  FileAudio,
  DotsThree as MoreHorizontal,
  Trash as Trash2,
  Waveform,
} from "@phosphor-icons/react";
import {
  clampProgress,
  formatDuration,
  getLibraryErrorDetails,
  shouldShowImportProgress,
  describeAudioSources,
  isLibraryItemBusy,
  libraryItemTitle,
} from "./library-utils";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";
import type { LibraryItem } from "../../../types";
import { showErrorToast } from "../../../shared/lib/errorToast";

export type LibraryLayout = "list" | "grid";

const menuRowBase =
  "mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-md px-2 py-1 text-left ui-text-body-sm transition-colors hover:bg-[var(--surface-interactive)] focus-visible:outline-none focus-visible:bg-[var(--surface-interactive)] disabled:pointer-events-none disabled:opacity-40";
const menuItemClass = `${menuRowBase} ui-color-secondary hover:text-content-primary`;

const LibraryCard = ({
  item,
  layout,
  snippet,
  onOpen,
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
  folders,
  onMove,
  onNewFolder,
  shiftHeld,
}: {
  item: LibraryItem;
  layout: LibraryLayout;
  // A passage of the transcript: the opening, or around a search match.
  snippet?: string;
  onOpen: (id: string) => void;
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
  folders: string[];
  onMove: (item: LibraryItem, folder: string | null) => void;
  onNewFolder: (item: LibraryItem) => void;
  shiftHeld: boolean;
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
  const bookmarkCount = item.bookmarks?.length ?? 0;

  const showImportProgress =
    status.type === "importing" && shouldShowImportProgress(status.progress);
  const isTranscribing = status.type === "transcribing" || showImportProgress;
  const isComplete = status.type === "complete";
  const isError = status.type === "error";
  const progress = isTranscribing ? clampProgress(status.progress) : 0;

  const isEditingName = editingNameId === item.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const errorDetails =
    status.type === "error" ? getLibraryErrorDetails(status.message) : null;

  const menuPanelRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);
  useMenuKeyboard(menuPanelRef, menuOpen, () => setMenuOpen(false));

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

  const KindIcon = item.kind === "recording" ? Waveform : FileAudio;
  const kindIcon = (
    <span
      className={`flex h-5 w-4 shrink-0 items-center justify-center ${
        isError
          ? "ui-color-error-strong"
          : isTranscribing
            ? "ui-color-accent"
            : "ui-color-muted"
      }`}
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
      <KindIcon size={16} aria-hidden="true" />
    </span>
  );

  const statusBlock = !isComplete && (
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
            ? t({ id: "library.card.status.failed", message: "Failed" })
            : t({ id: "library.card.status.queued", message: "Queued" })}
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
  );

  const nameField = (className: string) => (
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
      className={`w-full min-w-0 bg-transparent p-0 font-medium ui-color-primary border-0 border-b border-[var(--color-border-primary)] outline-hidden focus:border-[var(--color-border-hover)] ${className}`}
      autoFocus
    />
  );

  const menu = (
    <LibraryCardMenu
      item={item}
      open={menuOpen}
      setOpen={setMenuOpen}
      menuRef={menuRef}
      panelRef={menuPanelRef}
      shiftHeld={shiftHeld}
      folders={folders}
      onQuickDelete={handleQuickDelete}
      onRename={() => onStartNameEdit(item)}
      onMove={(folder) => onMove(item, folder)}
      onNewFolder={() => onNewFolder(item)}
      onCancel={handleCancel}
      onRetry={handleRetry}
      onDelete={handleDelete}
    />
  );

  const rowProps = {
    onClick: () => {
      if (!isEditingName) onOpen(item.id);
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      if (shiftHeld) {
        handleQuickDelete();
      } else {
        setMenuOpen(true);
      }
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      // Keys pressed on the buttons and fields inside belong to them.
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!isEditingName) onOpen(item.id);
      }
    },
    role: "button",
    tabIndex: 0,
  };

  const title = libraryItemTitle(item);

  if (layout === "grid") {
    return (
      <div
        {...rowProps}
        className={`ui-card-liftable group relative z-0 flex min-w-0 flex-col h-[208px] outline-none hover:z-10 ${
          menuOpen ? "z-20" : ""
        } ${
          shiftHeld
            ? "!border-[var(--color-error)]/30 hover:!border-[var(--color-error)]/60 !bg-[var(--color-error)]/5"
            : ""
        }`}
      >
        <div className="px-4 pt-2 pb-2.5 flex flex-col h-full relative w-full min-w-0">
          <div className="mb-1 flex h-6 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {kindIcon}
              {statusBlock}
            </div>
            <div className="-mr-1 flex items-center">{menu}</div>
          </div>

          <div className="flex-1 flex flex-col justify-start gap-1 overflow-hidden w-full">
            {isEditingName ? (
              nameField("ui-text-title-lg leading-snug")
            ) : (
              <h3 className="line-clamp-2 ui-text-title-lg font-medium leading-snug ui-color-primary break-words">
                {title}
              </h3>
            )}
            {snippet && (
              <p className="line-clamp-3 ui-text-body-sm ui-color-muted">
                {snippet}
              </p>
            )}
          </div>

          <div className="mt-auto flex shrink-0 items-center gap-1.5 pt-2.5 border-t border-[var(--color-border-primary)] ui-text-label ui-color-muted tabular-nums">
            <span>{formatDuration(item.duration_seconds)}</span>
            {bookmarkCount > 0 && (
              <>
                <span className="opacity-40">&bull;</span>
                <span className="flex items-center gap-1">
                  <BookmarkSimple size={11} aria-hidden="true" />
                  {bookmarkCount}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...rowProps}
      className={`group relative flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 outline-none transition-colors hover:z-10 focus-visible:bg-surface-interactive ${
        menuOpen ? "z-20" : "z-0"
      } ${
        shiftHeld
          ? "hover:bg-[var(--color-error)]/10"
          : "hover:bg-surface-interactive"
      }`}
    >
      {kindIcon}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            {isEditingName ? (
              nameField("ui-text-body")
            ) : (
              <h3 className="truncate ui-text-body font-medium ui-color-primary">
                {title}
              </h3>
            )}
          </div>
          {statusBlock}
        </div>
        {snippet && (
          <p className="truncate ui-text-label ui-color-muted">{snippet}</p>
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

      <span className="w-14 shrink-0 text-right ui-text-label ui-color-muted tabular-nums">
        {formatDuration(item.duration_seconds)}
      </span>

      {menu}
    </div>
  );
};

type LibraryCardMenuProps = {
  item: LibraryItem;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  menuRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  shiftHeld: boolean;
  folders: string[];
  onQuickDelete: () => void;
  onRename: () => void;
  onMove: (folder: string | null) => void;
  onNewFolder: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
};

const LibraryCardMenu = ({
  item,
  open,
  setOpen,
  menuRef,
  panelRef,
  shiftHeld,
  folders,
  onQuickDelete,
  onRename,
  onMove,
  onNewFolder,
  onCancel,
  onRetry,
  onDelete,
}: LibraryCardMenuProps) => {
  const { t } = useLingui();
  const [view, setView] = useState<"main" | "move">("main");
  const currentFolder = item.folder ?? null;
  const toggle = () => setOpen((prev) => !prev);
  useEffect(() => {
    if (!open) setView("main");
  }, [open]);
  // Swapping views unmounts the focused row, so focus the first new one.
  useEffect(() => {
    if (!open || view === "main") return;
    panelRef.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus();
  }, [open, view, panelRef]);
  return (
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
            onQuickDelete();
          } else {
            toggle();
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (e.repeat) return;
            if (shiftHeld) {
              onQuickDelete();
            } else {
              toggle();
            }
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        className={`p-1 ml-1 rounded transition-colors duration-200 outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-hover)] flex items-center justify-center ${
          shiftHeld
            ? "ui-color-error hover:bg-[var(--color-error)]/10"
            : open
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
        {open && (
          <motion.div
            ref={panelRef}
            role="menu"
            data-no-press
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute right-0 top-full z-[100] mt-1.5 min-w-[180px] max-w-[260px] max-h-[320px] overflow-y-auto py-1 custom-scrollbar"
            onClick={(event) => event.stopPropagation()}
          >
            {view === "move" ? (
              <>
                {folders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    role="menuitemradio"
                    aria-checked={folder === currentFolder}
                    onClick={() => {
                      setOpen(false);
                      if (folder !== currentFolder) onMove(folder);
                    }}
                    className={
                      folder === currentFolder
                        ? `${menuRowBase} ui-color-cloud`
                        : menuItemClass
                    }
                  >
                    <span className="min-w-0 truncate">{folder}</span>
                    <span className="flex w-3 shrink-0 justify-center">
                      {folder === currentFolder && (
                        <Check size={12} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                ))}
                {folders.length > 0 && (
                  <div className="mx-3 my-1 border-t border-border-secondary" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onNewFolder();
                  }}
                  className={menuItemClass}
                >
                  <span>
                    {t({
                      id: "library.folder.new",
                      message: "New Folder...",
                    })}
                  </span>
                </button>
                {currentFolder && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onMove(null);
                    }}
                    className={menuItemClass}
                  >
                    <span>
                      {t({
                        id: "library.folder.remove_item",
                        message: "Remove from Folder",
                      })}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onRename();
                  }}
                  className={menuItemClass}
                >
                  <span>
                    {t({ id: "library.card.rename", message: "Rename" })}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isLibraryItemBusy(item.status)}
                  onClick={() => setView("move")}
                  className={menuItemClass}
                >
                  <span>
                    {t({ id: "library.folder.move_to", message: "Move to..." })}
                  </span>
                </button>

                {isLibraryItemBusy(item.status) ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onCancel}
                    className={menuItemClass}
                  >
                    <span>
                      {t({ id: "library.card.cancel", message: "Cancel" })}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onRetry}
                    className={menuItemClass}
                  >
                    <span>
                      {item.status.type === "error"
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

                <div className="mx-3 my-1 border-t border-border-secondary" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={onDelete}
                  className={`${menuRowBase} ui-color-error-strong`}
                >
                  <span>
                    {t({ id: "library.card.delete", message: "Delete" })}
                  </span>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default memo(LibraryCard);
