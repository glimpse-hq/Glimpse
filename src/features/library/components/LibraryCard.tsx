import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
    Check,
    ChevronDown,
    MoreVertical,
    Pencil,
    RotateCw,
    Trash2,
    X,
} from "lucide-react";
import LibraryProgressDots from "./LibraryProgressDots";
import {
    clampProgress,
    formatDuration,
    getLibraryErrorDetails,
    shouldShowImportProgress,
    statusLabel,
} from "./library-utils";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import type { LibraryItem } from "../../../types";

const LibraryCard = ({
    item,
    onOpen,
    onRemoveTag,
    editingNameId,
    editingNameDraft,
    onStartNameEdit,
    onChangeNameDraft,
    onCommitNameEdit,
    onCancelNameEdit,
    onRetry,
    onCancel,
    onDelete,
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
    onOpen: () => void;
    onRemoveTag: (tag: string) => Promise<void>;
    editingNameId: string | null;
    editingNameDraft: string;
    onStartNameEdit: () => void;
    onChangeNameDraft: (value: string) => void;
    onCommitNameEdit: () => void;
    onCancelNameEdit: () => void;
    onRetry: () => Promise<void>;
    onCancel: () => Promise<void>;
    onDelete: () => Promise<void>;
    editingTagId: string | null;
    tagDraft: string;
    onStartTagEdit: () => void;
    onChangeTagDraft: (value: string) => void;
    onCommitTagAdd: (value?: string) => void;
    onCancelTagEdit: () => void;
    shiftHeld: boolean;
    availableTags: string[];
}) => {
    const status = item.status;
    const tagPreview = item.tags.slice(0, 2);
    const showImportProgress = status.type === "importing" && shouldShowImportProgress(status.progress);
    const showProgressBar = status.type === "transcribing" || showImportProgress;
    const progress = showProgressBar ? clampProgress(status.progress) : 0;
    const isEditingName = editingNameId === item.id;
    const isAddingTag = editingTagId === item.id;
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [tagMenuOpen, setTagMenuOpen] = useState(false);
    const tagMenuRef = useRef<HTMLDivElement>(null);
    const statusText = statusLabel(status);
    const errorDetails = status.type === "error" ? getLibraryErrorDetails(status.message) : null;
    const normalizedDraft = tagDraft.trim().toLowerCase();
    const filteredTagOptions = availableTags.filter((tag) => {
        const tagLower = tag.toLowerCase();
        if (item.tags.some((existing) => existing.toLowerCase() === tagLower)) {
            return false;
        }
        if (!normalizedDraft) return true;
        return tagLower.includes(normalizedDraft);
    });

    useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);
    useClickOutside(tagMenuRef, () => setTagMenuOpen(false), tagMenuOpen);

    const handleDelete = async () => {
        setMenuOpen(false);
        try {
            await onDelete();
        } catch (err) {
            console.error("Failed to delete library item:", err);
        }
    };

    const handleRetry = async () => {
        setMenuOpen(false);
        try {
            await onRetry();
        } catch (err) {
            console.error("Failed to retry library transcription:", err);
        }
    };

    const handleCancel = async () => {
        setMenuOpen(false);
        try {
            await onCancel();
        } catch (err) {
            console.error("Failed to cancel library transcription:", err);
        }
    };


    const renderStatusControl = () => (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                if (shiftHeld) {
                    handleDelete();
                } else {
                    setMenuOpen((prev) => !prev);
                }
            }}
            className={`p-1.5 rounded-md transition-colors ${
                shiftHeld
                    ? "ui-color-error-strong ui-hover-error-soft hover:bg-red-500/10"
                    : "text-content-muted hover:text-content-primary hover:bg-surface-elevated"
            }`}
            aria-label={shiftHeld ? "Delete" : "More options"}
            title={shiftHeld ? "Delete" : "More options"}
        >
            {shiftHeld ? <Trash2 size={14} /> : <MoreVertical size={14} />}
        </button>
    );

    useEffect(() => {
        if (!isAddingTag) {
            setTagMenuOpen(false);
        }
    }, [isAddingTag]);

    return (
        <div
            onClick={() => {
                if (!isEditingName && !isAddingTag) {
                    onOpen();
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                if (shiftHeld) {
                    void handleDelete();
                } else {
                    setMenuOpen(true);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!isEditingName && !isAddingTag) {
                        onOpen();
                    }
                }
            }}
            role="button"
            tabIndex={0}
            className="group text-left rounded-xl border border-border-primary bg-surface-secondary p-4 hover:bg-surface-surface transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-border-hover"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {isEditingName ? (
                            <input
                                value={editingNameDraft}
                                onChange={(event) => onChangeNameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        onCommitNameEdit();
                                    }
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        onCancelNameEdit();
                                    }
                                }}
                                onBlur={onCommitNameEdit}
                                onClick={(event) => event.stopPropagation()}
                                className="w-full min-w-0 rounded-md border border-border-primary bg-surface-surface px-2 py-1 ui-text-body font-medium ui-color-primary outline-hidden focus:border-border-hover"
                                autoFocus
                            />
                        ) : (
                            <h3 className="ui-text-body font-medium ui-color-primary truncate">{item.name}</h3>
                        )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 ui-text-label ui-color-muted tabular-nums">
                        <span>{formatDuration(item.duration_seconds)}</span>
                        <span className="opacity-50">&bull;</span>
                        {status.type === "complete" ? (
                            <Check size={12} className="ui-color-success-strong" aria-label="Done" />
                        ) : (
                            <span className="shrink-0 whitespace-nowrap">{statusText}</span>
                        )}
                    </div>
                    <div className="mt-2 min-h-[24px] w-full">
                        {status.type === "error" ? (
                            <span className="block w-full ui-text-micro leading-[12px] ui-color-error-soft line-clamp-2 break-words">
                                {errorDetails?.message}{" "}
                                {errorDetails?.showFfmpegHelp && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            invoke("open_ffmpeg_install").catch(() => {});
                                        }}
                                        className="underline decoration-red-400/60 ui-hover-error-tint"
                                    >
                                        FFmpeg Help
                                    </button>
                                )}
                            </span>
                        ) : showProgressBar ? (
                            <LibraryProgressDots
                                progress={progress}
                                status={status.type === "importing" ? "importing" : "transcribing"}
                            />
                        ) : null}
                    </div>
                </div>
                <div ref={menuRef}>{renderStatusControl()}</div>
            </div>
            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className="fixed z-[100] min-w-[160px] rounded-lg border border-border-secondary bg-surface-overlay shadow-xl shadow-black/50"
                        onClick={(event) => event.stopPropagation()}
                        style={{
                            top: menuRef.current ? menuRef.current.getBoundingClientRect().bottom + 4 : 0,
                            right: menuRef.current ? window.innerWidth - menuRef.current.getBoundingClientRect().right : 0,
                        }}
                    >
                        <button
                            onClick={() => {
                                setMenuOpen(false);
                                onStartNameEdit();
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors"
                        >
                            <Pencil size={12} className="text-content-muted" />
                            <span>Rename</span>
                        </button>

                        {status.type === "transcribing"
                            || status.type === "cancelling"
                            || status.type === "pending"
                            || status.type === "importing" ? (
                            <button
                                onClick={handleCancel}
                                className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors"
                            >
                                <X size={12} className="text-warning" />
                                <span>Cancel</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleRetry}
                                className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors"
                            >
                                <RotateCw size={12} className="text-cloud" />
                                <span>{status.type === "error" ? "Retry" : "Retranscribe"}</span>
                            </button>
                        )}

                        <div className="h-px bg-border-secondary mx-2" />

                        <button
                            onClick={handleDelete}
                            className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-error-strong hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={12} />
                            <span>Delete</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="mt-3 min-h-[24px]">
                {isAddingTag ? (
                    <div
                        className="flex items-center gap-1.5 min-h-[24px]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div ref={tagMenuRef} className="relative flex items-center">
                            <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => setTagMenuOpen((prev) => !prev)}
                                className="flex items-center justify-center w-6 h-6 rounded-sm text-content-muted hover:text-content-secondary hover:bg-surface-elevated transition-colors"
                                aria-label="Select existing tag"
                                title="Select existing tag"
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
                                        className="absolute left-0 top-full mt-1 z-[120] w-36 rounded-md border border-border-secondary/80 bg-surface-overlay shadow-lg shadow-black/40 overflow-hidden"
                                    >
                                        <div className="max-h-36 overflow-y-auto">
                                            {filteredTagOptions.length > 0 ? (
                                                filteredTagOptions.map((tag, index) => (
                                                    <button
                                                        key={`tag-option-${index}-${tag || "empty"}`}
                                                        type="button"
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => {
                                                            onCommitTagAdd(tag);
                                                            setTagMenuOpen(false);
                                                        }}
                                                        className="w-full text-left px-2.5 py-1.5 ui-text-button-sm ui-color-secondary hover:bg-surface-elevated/70 hover:text-content-primary transition-colors"
                                                    >
                                                        {tag}
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="px-2.5 py-2 ui-text-micro ui-color-muted">
                                                    {availableTags.length === 0 ? "No tags yet" : "No other tags"}
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
                                    onCommitTagAdd();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    onCancelTagEdit();
                                }
                            }}
                            onBlur={onCancelTagEdit}
                            placeholder="New tag..."
                            className="tag-input-intro flex-1 min-w-0 h-6 box-border bg-transparent border-b border-border-primary px-0.5 py-0 ui-text-meta leading-none ui-color-secondary outline-hidden focus:border-border-hover placeholder:text-content-disabled"
                            autoFocus
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 flex-wrap gap-y-2">
                        {tagPreview.map((tag, idx) => (
                            <span
                                key={`${tag}-${idx}`}
                                onClick={(event) => {
                                    if (!shiftHeld) return;
                                    event.stopPropagation();
                                    void onRemoveTag(tag);
                                }}
                                className={`inline-flex items-center px-2 py-1 rounded-sm ui-text-meta ui-color-muted bg-white/5 border border-white/10 leading-none ${
                                    shiftHeld ? "cursor-pointer hover:border-red-500/60 ui-hover-error-tint" : ""
                                }`}
                                title={shiftHeld ? `Remove ${tag}` : undefined}
                            >
                                <span>{tag.length > 12 ? `${tag.slice(0, 12)}...` : tag}</span>
                            </span>
                        ))}
                        {item.tags.length > 2 && (
                            <span className="ui-text-micro ui-color-disabled">+{item.tags.length - 2}</span>
                        )}
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onStartTagEdit();
                            }}
                            className="flex items-center justify-center w-6 h-6 rounded-md bg-transparent ui-text-body-lg ui-color-disabled hover:text-content-muted hover:bg-surface-elevated transition-colors border-0 outline-hidden focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-border-hover focus-visible:ring-offset-0"
                        >
                            +
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LibraryCard;
