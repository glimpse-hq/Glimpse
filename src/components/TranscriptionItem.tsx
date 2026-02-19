import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown, { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Copy, Trash2, RotateCw, Check, ChevronDown, ChevronUp, MoreVertical, Wand2, AlertTriangle, Undo2, Cloud, X } from "lucide-react";
import { TranscriptionRecord } from "../hooks/useTranscriptions";
import DotMatrix from "./DotMatrix";

const markdownComponents: Components = {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-content-primary">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => (
        <code className="px-1 py-0.5 rounded bg-surface-elevated ui-text-body-sm font-mono ui-color-primary">{children}</code>
    ),
    ul: ({ children }) => <ul className="list-disc list-inside mb-2 last:mb-0 space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside mb-2 last:mb-0 space-y-0.5">{children}</ol>,
    li: ({ children }) => <li className="ui-text-body">{children}</li>,
};

interface TranscriptionItemProps {
    record: TranscriptionRecord;
    onDelete: (id: string) => Promise<void>;
    onRetry: (id: string) => Promise<void>;
    onCancelRetry?: (id: string) => Promise<void>;
    onRetryLlm?: (id: string) => Promise<void>;
    onUndoLlm?: (id: string) => Promise<void>;
    isRetrying?: boolean;
    showLlmButtons?: boolean;
    skipAnimation?: boolean;
    shiftHeld?: boolean;
}

const TranscriptionItem: React.FC<TranscriptionItemProps> = ({ record, onDelete, onRetry, onCancelRetry, onRetryLlm, onUndoLlm, isRetrying = false, showLlmButtons = false, skipAnimation = false, shiftHeld = false }) => {
    const [copied, setCopied] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRetryingLlm, setIsRetryingLlm] = useState(false);
    const [isUndoingLlm, setIsUndoingLlm] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [selectionText, setSelectionText] = useState("");
    const menuRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (textRef.current && !isExpanded) {
            setIsOverflowing(textRef.current.scrollHeight > textRef.current.clientHeight);
        }
    }, [record.text, isExpanded]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
                setSelectionText("");
            }
        };

        if (menuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuOpen]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(record.text);
            setCopied(true);
            setMenuOpen(false);
            setSelectionText("");
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleCopySelection = async () => {
        if (!selectionText.trim()) return;
        try {
            await navigator.clipboard.writeText(selectionText);
            setMenuOpen(false);
            setSelectionText("");
        } catch (err) {
            console.error("Failed to copy selection:", err);
        }
    };

    const handleDelete = () => {
        if (isDeleting) return;
        setIsDeleting(true);
        setMenuOpen(false);
        setSelectionText("");
        onDelete(record.id).catch(err => {
            console.error("Failed to delete:", err);
            setIsDeleting(false);
        });
    };

    const handleRetry = async () => {
        if (isRetrying) return;
        setMenuOpen(false);
        setSelectionText("");
        try {
            await onRetry(record.id);
        } catch {
            // Errors are handled by the hook (quota toast, etc.)
        }
    };

    const handleRetryLlm = async () => {
        if (isRetryingLlm || !onRetryLlm) return;
        setIsRetryingLlm(true);
        setMenuOpen(false);
        setSelectionText("");
        try {
            await onRetryLlm(record.id);
        } catch (err) {
            console.error("Failed to retry LLM cleanup:", err);
        } finally {
            setIsRetryingLlm(false);
        }
    };

    const handleUndoLlm = async () => {
        if (isUndoingLlm || !onUndoLlm) return;
        setIsUndoingLlm(true);
        setMenuOpen(false);
        setSelectionText("");
        try {
            await onUndoLlm(record.id);
        } catch (err) {
            console.error("Failed to undo LLM cleanup:", err);
        } finally {
            setIsUndoingLlm(false);
        }
    };

    const timestamp = new Date(record.timestamp);
    const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const isError = record.status === "error";
    const errorMessage = record.error_message || "Transcription failed";
    const displayText = isError ? null : record.text;
    const speechModelLabel = record.speech_model?.trim() 
        ? (record.speech_model.startsWith("cloud-") ? record.speech_model.slice(6) : record.speech_model)
        : "Unknown model";
    const isCloudModel = record.speech_model?.startsWith("cloud-") ?? false;
    const llmModelLabel = record.llm_model?.trim() || null;
    const modeLabel = record.mode_name?.trim() || null;
    const wordCountLabel = `${record.word_count || 0} ${record.word_count === 1 ? "word" : "words"}`;
    const formatDuration = (seconds: number) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return "0s audio";
        if (seconds < 60) {
            return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)}s audio`;
        }
        const minutes = Math.floor(seconds / 60);
        const remaining = Math.round(seconds % 60);
        return remaining === 0 ? `${minutes}m audio` : `${minutes}m ${remaining}s audio`;
    };
    const allowContextMenu = !isRetryingLlm && !isUndoingLlm;

    const captureSelectionText = () => {
        const selection = window.getSelection();
        if (!selection) return "";
        const text = selection.toString();
        if (!text.trim()) return "";
        const anchor = selection.anchorNode;
        const focus = selection.focusNode;
        if (
            textRef.current &&
            ((anchor && textRef.current.contains(anchor)) ||
                (focus && textRef.current.contains(focus)))
        ) {
            return text;
        }
        return "";
    };

    const openMenu = () => {
        setSelectionText(captureSelectionText());
        setMenuOpen(true);
    };

    return (
        <motion.div
            initial={skipAnimation ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="group relative snap-start"
            onContextMenu={(event) => {
                if (!allowContextMenu) return;
                event.preventDefault();
                if (shiftHeld) {
                    handleDelete();
                } else {
                    openMenu();
                }
            }}
        >
            <div className={`flex items-start gap-3 py-3 px-4 rounded-lg transition-colors ${isError ? "bg-red-500/[0.03]" : "hover:bg-surface-surface"}`}>
                {/* Status Indicator */}
                <div className="mt-1.5 shrink-0">
                    {isRetrying ? (
                        <button
                            onClick={(event) => {
                                event.stopPropagation();
                                onCancelRetry?.(record.id);
                            }}
                            className="relative flex items-center justify-center group/stop"
                            aria-label="Stop transcription"
                            title="Stop transcription"
                        >
                            <DotMatrix
                                rows={1}
                                cols={1}
                                activeDots={[0]}
                                dotSize={4}
                                gap={1}
                                color="var(--color-warning)"
                                className="opacity-70 transition-opacity group-hover/stop:opacity-20"
                            />
                            <X
                                size={10}
                                className="absolute text-cloud opacity-0 transition-opacity group-hover/stop:opacity-100"
                            />
                        </button>
                    ) : isError ? (
                        <AlertTriangle size={14} className="text-red-400/70" />
                    ) : (
                        <DotMatrix
                            rows={1}
                            cols={1}
                            activeDots={[0]}
                            dotSize={4}
                            gap={1}
                            color="var(--color-success)"
                            className="opacity-70"
                        />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="ui-text-uppercase-meta font-medium ui-color-muted">
                            {dateStr}
                        </span>
                        <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" />
                        <span className="ui-text-kbd ui-color-disabled">
                            {timeStr}
                        </span>
                        {isError && (
                            <>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" />
                                <span className="ui-text-uppercase-meta font-medium ui-color-error-strong">
                                    Failed
                                </span>
                            </>
                        )}
                        {isCloudModel && !isError && (
                            <>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" />
                                <span className="flex items-center gap-1 ui-text-meta ui-color-cloud">
                                    <Cloud size={9} />
                                    Cloud
                                </span>
                            </>
                        )}
                        {record.llm_cleaned && !isError && !isCloudModel && (
                            <>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" />
                                <span className="flex items-center gap-1 ui-text-meta ui-color-local">
                                    <Wand2 size={9} />
                                    Cleaned
                                </span>
                            </>
                        )}
                        {isRetrying && (
                            <>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" />
                                <span className="ui-text-uppercase-meta font-medium ui-color-cloud">
                                    Retrying...
                                </span>
                            </>
                        )}
                    </div>

                    {isError ? (
                        <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/[0.06] px-2.5 py-2">
                            <p className="ui-text-body-sm ui-color-error-soft">
                                {errorMessage}
                            </p>
                        </div>
                    ) : (
                        <div 
                            ref={textRef}
                            className={`ui-text-body ui-color-secondary leading-relaxed select-text cursor-text ${!isExpanded ? "line-clamp-6" : ""}`}
                            onMouseUp={() => setSelectionText(captureSelectionText())}
                            onKeyUp={() => setSelectionText(captureSelectionText())}
                        >
                            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkBreaks]}>
                                {displayText || ""}
                            </ReactMarkdown>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-1 ui-text-meta ui-color-disabled">
                        {!isError && (
                            <>
                                <span>{wordCountLabel}</span>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" aria-hidden="true" />
                                <span>{formatDuration(record.audio_duration_seconds ?? 0)}</span>
                                <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" aria-hidden="true" />
                                <span>Speech: {speechModelLabel}</span>
                                {llmModelLabel && (
                                    <>
                                        <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" aria-hidden="true" />
                                        <span>LLM: {llmModelLabel}</span>
                                    </>
                                )}
                                {modeLabel && (
                                    <>
                                        <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-border-hover)" aria-hidden="true" />
                                        <span>Mode: {modeLabel}</span>
                                    </>
                                )}
                            </>
                        )}

                        {(isOverflowing || isExpanded) && (
                            <button
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="flex items-center gap-1 p-1 -ml-1 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
                                aria-label={isExpanded ? "Show less" : "Show more"}
                            >
                                {isExpanded ? (
                                    <>
                                        <ChevronUp size={12} aria-hidden="true" />
                                        <span>Show less</span>
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown size={12} aria-hidden="true" />
                                        <span>Show more</span>
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Actions - Copy and menu buttons */}
                {!isRetrying && !isRetryingLlm && !isUndoingLlm && (
                    <div className="relative shrink-0 flex items-center gap-1" ref={menuRef}>
                        {!isError && (
                            <motion.button
                                onClick={handleCopy}
                                whileTap={{ scale: 0.95 }}
                                className={`p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 hover:bg-surface-elevated ${copied ? "bg-surface-elevated" : ""
                                    }`}
                                title={copied ? "Copied" : "Copy transcription"}
                                aria-label={copied ? "Copied" : "Copy transcription"}
                            >
                                {copied ? (
                                    <Check size={14} className="text-success" aria-hidden="true" />
                                ) : (
                                    <Copy size={14} className="text-content-secondary" aria-hidden="true" />
                                )}
                            </motion.button>
                        )}

                        <motion.button
                            onClick={() => {
                                if (shiftHeld) {
                                    handleDelete();
                                } else {
                                    if (menuOpen) {
                                        setMenuOpen(false);
                                        setSelectionText("");
                                    } else {
                                        openMenu();
                                    }
                                }
                            }}
                            whileTap={{ scale: 0.95 }}
                            className={`p-1.5 rounded-md transition-colors ${shiftHeld ? "hover:bg-red-500/10" : "hover:bg-surface-elevated"
                                }`}
                            title={shiftHeld ? "Delete" : "More options"}
                            aria-label={shiftHeld ? "Delete" : "More options"}
                            aria-haspopup="true"
                            aria-expanded={menuOpen}
                        >
                            {shiftHeld ? (
                                <Trash2 size={14} className="text-red-400" aria-hidden="true" />
                            ) : (
                                <MoreVertical size={14} className="text-content-muted" aria-hidden="true" />
                            )}
                        </motion.button>

                        <AnimatePresence>
                            {menuOpen && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                    transition={{ duration: 0.12 }}
                                    className="fixed z-[100] min-w-[160px] rounded-lg border border-border-secondary bg-surface-overlay shadow-xl shadow-black/50"
                                    style={{
                                        top: menuRef.current ? menuRef.current.getBoundingClientRect().bottom + 4 : 0,
                                        right: menuRef.current ? window.innerWidth - menuRef.current.getBoundingClientRect().right : 0,
                                    }}
                                >
                                    {selectionText.trim().length > 0 && (
                                        <>
                                            <button
                                                onClick={handleCopySelection}
                                                className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors"
                                            >
                                                <Copy size={12} className="text-content-muted" />
                                                <span>Copy selection</span>
                                            </button>
                                            <div className="h-px bg-border-secondary mx-2" />
                                        </>
                                    )}
                                    <button
                                        onClick={handleRetry}
                                        disabled={isRetrying}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                                    >
                                        <RotateCw size={12} className="text-cloud" />
                                        <span>Retry</span>
                                    </button>

                                    {!isError && onRetryLlm && showLlmButtons && !isCloudModel && (
                                        <button
                                            onClick={handleRetryLlm}
                                            disabled={isRetryingLlm}
                                            className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                                        >
                                            <RotateCw size={12} className="text-local" />
                                            <span>{record.llm_cleaned ? "Retry AI cleanup" : "Run AI cleanup"}</span>
                                        </button>
                                    )}

                                    {!isError && record.llm_cleaned && record.raw_text && onUndoLlm && showLlmButtons && !isCloudModel && (
                                        <button
                                            onClick={handleUndoLlm}
                                            disabled={isUndoingLlm}
                                            className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                                        >
                                            <Undo2 size={12} className="text-warning" />
                                            <span>Undo AI cleanup</span>
                                        </button>
                                    )}

                                    <div className="h-px bg-border-secondary mx-2" />

                                    <button
                                        onClick={handleDelete}
                                        disabled={isDeleting}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-error-strong hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 size={12} />
                                        <span>Delete</span>
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

                {/* Loading state indicators */}
                {isRetryingLlm && (
                    <div className="flex items-center gap-1.5 ui-text-meta ui-color-local">
                        <RotateCw size={12} className="animate-spin" />
                        <span>Cleaning...</span>
                    </div>
                )}
                {isUndoingLlm && (
                    <div className="flex items-center gap-1.5 ui-text-meta ui-color-warning">
                        <Undo2 size={12} className="animate-pulse" />
                        <span>Reverting...</span>
                    </div>
                )}
            </div>

            {/* Subtle divider */}
            <div className="h-px ui-gradient-divider mx-4" />
        </motion.div>
    );
};

export default React.memo(TranscriptionItem);
