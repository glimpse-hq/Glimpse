import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Howl } from "howler";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
    AlertTriangle,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Copy,
    CornerDownRight,
    Pause,
    Pencil,
    Play,
    RotateCw,
    Search,
    Trash2,
    X,
} from "lucide-react";
import LibraryRetranscribeModal from "./LibraryRetranscribeModal";
import {
    clampProgress,
    formatDuration,
    formatPlaybackRate,
    formatTimestamp,
    getLibraryErrorDetails,
    PLAYBACK_RATES,
    sanitizeFileName,
    shouldShowImportProgress,
} from "./library-utils";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import type {
    ExportFormat,
    LibraryItem,
    LibraryItemPatch,
    ModelInfo,
    TranscriptSegment,
} from "../../../types";

const LibraryModal = ({
    item,
    models,
    shiftHeld,
    followTimestamps,
    onFollowTimestampsChange,
    onClose,
    onDelete,
    onRetry,
    onCancel,
    onUpdate,
    onExport,
    availableTags,
}: {
    item: LibraryItem;
    models: ModelInfo[];
    shiftHeld: boolean;
    followTimestamps: boolean;
    onFollowTimestampsChange: (value: boolean | ((prev: boolean) => boolean)) => void;
    onClose: () => void;
    onDelete: () => void;
    onRetry: () => Promise<void>;
    onCancel: () => void;
    onUpdate: (patch: LibraryItemPatch) => Promise<LibraryItem>;
    onExport: (format: ExportFormat, outputPath: string) => Promise<void>;
    availableTags: string[];
}) => {
    const [nameDraft, setNameDraft] = useState(item.name);
    const [isEditingName, setIsEditingName] = useState(false);
    const [transcriptDraft, setTranscriptDraft] = useState(item.transcript ?? "");
    const [tagInput, setTagInput] = useState("");
    const [tagMenuOpen, setTagMenuOpen] = useState(false);
    const [showTimestamps, setShowTimestamps] = useState(
        item.show_timestamps && Boolean(item.segments?.length),
    );
    const [exportOpen, setExportOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [copyConfirmed, setCopyConfirmed] = useState(false);
    const [audioDuration, setAudioDuration] = useState(item.duration_seconds || 0);
    const [audioCurrentTime, setAudioCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioReady, setAudioReady] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [streamChunks, setStreamChunks] = useState<string[]>([]);
    const [showRetranscribe, setShowRetranscribe] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSearchIndex, setActiveSearchIndex] = useState(0);
    const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const howlRef = useRef<Howl | null>(null);
    const tagMenuRef = useRef<HTMLDivElement>(null);
    const playbackRateRef = useRef(1);
    const streamTranscriptRef = useRef(item.transcript ?? "");
    const scrubWasPlayingRef = useRef(false);
    const scrubValueRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);
    const isScrubbingRef = useRef(false);
    const isPlayingRef = useRef(false);
    const lastTimestampNavRef = useRef(0);
    const transcriptAreaRef = useRef<HTMLTextAreaElement | null>(null);
    const segmentsVirtuosoRef = useRef<VirtuosoHandle | null>(null);
    const streamVirtuosoRef = useRef<VirtuosoHandle | null>(null);

    const modelLabel = models.find((model) => model.key === item.speech_model)?.label ?? item.speech_model;
    const transcriptAvailable = item.status.type === "complete" && (item.transcript ?? "").trim().length > 0;
    const canShowTimestamps = !!item.segments && item.segments.length > 0;
    const isTranscribed = item.status.type === "complete";
    const importStatusText =
        item.status.type === "importing"
            ? (shouldShowImportProgress(item.status.progress)
                ? `Converting audio... ${Math.round(clampProgress(item.status.progress) * 100)}%`
                : "Converting audio...")
            : "Queued for transcription...";

    const audioUrl = useMemo(() => convertFileSrc(item.audio_path), [item.audio_path]);

    const stopSeekLoop = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    const updateIsPlaying = useCallback((value: boolean) => {
        isPlayingRef.current = value;
        setIsPlaying(value);
    }, []);

    const updateIsScrubbing = useCallback((value: boolean) => {
        isScrubbingRef.current = value;
        setIsScrubbing(value);
    }, []);

    const setPlaybackRateValue = useCallback((value: number) => {
        playbackRateRef.current = value;
        setPlaybackRate(value);
        howlRef.current?.rate(value);
    }, []);

    const startSeekLoop = useCallback(() => {
        stopSeekLoop();
        const tick = () => {
            const sound = howlRef.current;
            if (sound) {
                const playing = sound.playing();
                if (playing !== isPlayingRef.current) {
                    isPlayingRef.current = playing;
                    setIsPlaying(playing);
                }
                if (playing && !isScrubbingRef.current) {
                    const pos = sound.seek();
                    if (typeof pos === "number") {
                        setAudioCurrentTime(pos);
                    }
                }
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [stopSeekLoop]);

    useEffect(() => {
        if (!isEditingName) {
            setNameDraft(item.name);
        }
    }, [isEditingName, item.name]);

    useEffect(() => {
        setShowTimestamps(item.show_timestamps && canShowTimestamps);
    }, [item.show_timestamps, canShowTimestamps]);

    useEffect(() => {
        stopSeekLoop();
        if (howlRef.current) {
            howlRef.current.unload();
            howlRef.current = null;
        }
        updateIsPlaying(false);
        updateIsScrubbing(false);
        setAudioReady(false);
        setAudioError(null);
        setAudioCurrentTime(0);
        setAudioDuration(item.duration_seconds || 0);
        scrubWasPlayingRef.current = false;
        scrubValueRef.current = null;

        const sound = new Howl({
            src: [audioUrl],
            html5: true,
            preload: true,
            onload: () => {
                const duration = sound.duration();
                setAudioDuration(Number.isFinite(duration) ? duration : 0);
                setAudioReady(true);
            },
            onloaderror: (_id: number | string, err: unknown) => {
                console.error("Audio load error:", err);
                setAudioError("Audio unavailable");
                setAudioReady(false);
            },
            onplayerror: (_id: number | string, err: unknown) => {
                console.error("Audio play error:", err);
                setAudioError("Audio unavailable");
                setAudioReady(false);
                updateIsPlaying(false);
                stopSeekLoop();
            },
            onplay: () => {
                updateIsPlaying(true);
                startSeekLoop();
            },
            onpause: () => {
                updateIsPlaying(false);
                stopSeekLoop();
            },
            onstop: () => {
                updateIsPlaying(false);
                stopSeekLoop();
            },
            onend: () => {
                updateIsPlaying(false);
                stopSeekLoop();
                const duration = sound.duration();
                if (Number.isFinite(duration)) {
                    setAudioCurrentTime(duration);
                }
            },
            onseek: () => {
                if (isScrubbingRef.current) return;
                const pos = sound.seek();
                if (typeof pos === "number") {
                    setAudioCurrentTime(pos);
                }
            },
        });

        sound.rate(playbackRateRef.current);
        howlRef.current = sound;

        return () => {
            stopSeekLoop();
            sound.unload();
        };
    }, [audioUrl, item.duration_seconds, startSeekLoop, stopSeekLoop, updateIsPlaying, updateIsScrubbing]);

    const handlePlaybackRateStep = useCallback((direction: -1 | 1) => {
        const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
        const safeIndex = currentIndex === -1 ? PLAYBACK_RATES.indexOf(1) : currentIndex;
        const nextIndex = Math.min(
            PLAYBACK_RATES.length - 1,
            Math.max(0, safeIndex + direction),
        );
        setPlaybackRateValue(PLAYBACK_RATES[nextIndex]);
    }, [playbackRate, setPlaybackRateValue]);

    useEffect(() => {
        setTranscriptDraft(item.transcript ?? "");
    }, [item.transcript]);

    useEffect(() => {
        if (item.status.type !== "transcribing") {
            setStreamChunks([]);
            streamTranscriptRef.current = item.transcript ?? "";
        }
    }, [item.status.type, item.transcript]);

    useEffect(() => {
        if (item.status.type !== "transcribing") return;
        const nextTranscript = item.transcript ?? "";
        const previousTranscript = streamTranscriptRef.current;
        if (!nextTranscript || nextTranscript === previousTranscript) return;

        if (nextTranscript.startsWith(previousTranscript)) {
            const appended = nextTranscript.slice(previousTranscript.length).replace(/^\n+/, "");
            const cleaned = appended.trimStart();
            if (cleaned.trim().length > 0) {
                setStreamChunks((prev) => [...prev, cleaned]);
            }
        } else {
            const cleaned = nextTranscript.trim();
            setStreamChunks(cleaned.length > 0 ? [cleaned] : []);
        }

        streamTranscriptRef.current = nextTranscript;
    }, [item.status.type, item.transcript]);

    useEffect(() => {
        return () => {
            if (copyTimer.current) clearTimeout(copyTimer.current);
        };
    }, []);

    useEffect(() => {
        if (!transcriptAvailable) return;
        if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
        transcriptTimer.current = setTimeout(() => {
            if (transcriptDraft !== (item.transcript ?? "")) {
                onUpdate({ transcript: transcriptDraft });
            }
        }, 600);
        return () => {
            if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
        };
    }, [transcriptDraft, transcriptAvailable, item.transcript, onUpdate]);
    useClickOutside(tagMenuRef, () => setTagMenuOpen(false), tagMenuOpen);

    const handleNameCommit = async () => {
        const value = nameDraft.trim();
        if (!value || value === item.name) {
            setNameDraft(item.name);
            setIsEditingName(false);
            return;
        }
        await onUpdate({ name: value });
        setIsEditingName(false);
    };

    const handleAddTag = async (overrideTag?: string) => {
        const value = (overrideTag ?? tagInput).trim();
        if (!value) return;
        if (item.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
            setTagInput("");
            return;
        }
        await onUpdate({ tags: [...item.tags, value] });
        setTagInput("");
    };

    const normalizedTagInput = tagInput.trim().toLowerCase();
    const filteredTagOptions = availableTags.filter((tag) => {
        const tagLower = tag.toLowerCase();
        if (item.tags.some((existing) => existing.toLowerCase() === tagLower)) {
            return false;
        }
        if (!normalizedTagInput) return true;
        return tagLower.includes(normalizedTagInput);
    });

    const handleRemoveTag = async (tag: string) => {
        await onUpdate({ tags: item.tags.filter((entry) => entry !== tag) });
    };

    const handleExport = async (format: ExportFormat) => {
        setIsExporting(true);
        try {
            const ext = format;
            const safeName = sanitizeFileName(item.name || "transcript") || "transcript";
            const suggested = `${safeName}.${ext}`;
            const outputPath = await save({
                title: "Export transcription",
                defaultPath: suggested,
                filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
            });
            if (!outputPath) return;
            const finalPath = outputPath.toLowerCase().endsWith(`.${ext}`)
                ? outputPath
                : `${outputPath}.${ext}`;
            await onExport(format, finalPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("Export failed:", message);
            const lower = message.toLowerCase();
            let toastMessage = message || "Export failed. Try again.";
            if (lower.includes("no timestamp segments")) {
                toastMessage = "This item doesn't have timestamps. Retranscribe with timestamps to export subtitles.";
            } else if (lower.includes("failed to write export file")) {
                toastMessage = "Couldn't write the export file. Try a different location.";
            } else if (lower.includes("library item not found")) {
                toastMessage = "Couldn't find this library item. Try reopening it.";
            }
            invoke("debug_show_toast", {
                toastType: "error",
                message: toastMessage,
            }).catch(() => { });
        } finally {
            setIsExporting(false);
            setExportOpen(false);
        }
    };

    const handleCopy = async () => {
        if (!transcriptDraft.trim()) return;
        try {
            await navigator.clipboard.writeText(transcriptDraft);
            setCopyConfirmed(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => {
                setCopyConfirmed(false);
            }, 1400);
        } catch (err) {
            console.error("Failed to copy transcript:", err);
        }
    };

    const handleTogglePlayback = useCallback(() => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        if (sound.playing()) {
            sound.pause();
        } else {
            sound.play();
        }
    }, [audioError, audioReady]);

    const handleScrubChange = (nextValue: string) => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        const nextTime = Number(nextValue);
        if (!Number.isFinite(nextTime)) return;
        scrubValueRef.current = nextTime;
        if (isScrubbing) {
            setAudioCurrentTime(nextTime);
            sound.seek(nextTime);
            return;
        }
        sound.seek(nextTime);
        setAudioCurrentTime(nextTime);
    };

    const handleScrubStart = () => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        scrubWasPlayingRef.current = sound.playing();
        updateIsScrubbing(true);
        sound.pause();
    };

    const handleScrubEnd = () => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        updateIsScrubbing(false);
        if (typeof scrubValueRef.current === "number" && Number.isFinite(scrubValueRef.current)) {
            sound.seek(scrubValueRef.current);
            setAudioCurrentTime(scrubValueRef.current);
        }
        scrubValueRef.current = null;
        if (scrubWasPlayingRef.current) {
            try {
                sound.play();
            } catch (err) {
                console.error("Failed to resume audio:", err);
                setAudioError("Audio unavailable");
            }
        }
        scrubWasPlayingRef.current = false;
    };

    const handleTimestampClick = (startMs: number) => {
        const sound = howlRef.current;
        if (!sound || audioError || !audioReady) return;
        const nextTime = Math.max(0, startMs / 1000);
        sound.seek(nextTime);
        setAudioCurrentTime(nextTime);
        if (!sound.playing()) {
            try {
                sound.play();
            } catch (err) {
                console.error("Failed to play audio:", err);
                setAudioError("Audio unavailable");
            }
        }
    };
    const scrubberMax = audioDuration > 0 ? audioDuration : 1;
    const scrubberValue = Math.min(audioCurrentTime, scrubberMax);
    const scrubberPercent = scrubberMax > 0 ? (scrubberValue / scrubberMax) * 100 : 0;
    const minPlaybackRate = PLAYBACK_RATES[0];
    const maxPlaybackRate = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
    const canDecreasePlaybackRate = playbackRate > minPlaybackRate;
    const canIncreasePlaybackRate = playbackRate < maxPlaybackRate;
    const showStreaming = item.status.type === "transcribing" && !showTimestamps;
    const showSegmentView = showTimestamps && canShowTimestamps;
    const followTimestampsActive = followTimestamps && showSegmentView;
    const normalizedSearchQuery = searchQuery.trim();
    const activeSegmentIndex = useMemo(() => {
        if (!showTimestamps || !canShowTimestamps) return -1;
        const targetMs = Math.max(0, Math.round(audioCurrentTime * 1000));
        const segments = item.segments ?? [];
        let match = -1;
        for (let i = 0; i < segments.length; i += 1) {
            if (segments[i].start_ms <= targetMs) {
                match = i;
                continue;
            }
            break;
        }
        return match;
    }, [audioCurrentTime, showTimestamps, canShowTimestamps, item.segments]);

    const segmentMatchIndexes = useMemo(() => {
        if (!normalizedSearchQuery || !showSegmentView) return [];
        const query = normalizedSearchQuery.toLowerCase();
        const segments = item.segments ?? [];
        const matches: number[] = [];
        for (let i = 0; i < segments.length; i += 1) {
            if (segments[i].text.toLowerCase().includes(query)) {
                matches.push(i);
            }
        }
        return matches;
    }, [normalizedSearchQuery, item.segments, showSegmentView]);

    const streamMatchIndexes = useMemo(() => {
        if (!normalizedSearchQuery || !showStreaming) return [];
        const query = normalizedSearchQuery.toLowerCase();
        const matches: number[] = [];
        for (let i = 0; i < streamChunks.length; i += 1) {
            if (streamChunks[i].toLowerCase().includes(query)) {
                matches.push(i);
            }
        }
        return matches;
    }, [normalizedSearchQuery, showStreaming, streamChunks]);

    const textMatchIndex = useMemo(() => {
        if (!normalizedSearchQuery || showSegmentView || showStreaming) return -1;
        const query = normalizedSearchQuery.toLowerCase();
        return transcriptDraft.toLowerCase().indexOf(query);
    }, [normalizedSearchQuery, showSegmentView, showStreaming, transcriptDraft]);

    const activeSegmentMatch = segmentMatchIndexes.length
        ? segmentMatchIndexes[Math.min(activeSearchIndex, segmentMatchIndexes.length - 1)]
        : -1;
    const activeStreamMatch = streamMatchIndexes.length
        ? streamMatchIndexes[Math.min(activeSearchIndex, streamMatchIndexes.length - 1)]
        : -1;

    const renderHighlightedText = useCallback(
        (text: string, isActive: boolean) => {
            if (!normalizedSearchQuery) return text;
            const query = normalizedSearchQuery.toLowerCase();
            const lower = text.toLowerCase();
            const nodes: Array<string | ReactNode> = [];
            let startIndex = 0;
            let matchIndex = lower.indexOf(query);
            let matchCount = 0;
            if (matchIndex === -1) return text;
            while (matchIndex !== -1) {
                if (matchIndex > startIndex) {
                    nodes.push(text.slice(startIndex, matchIndex));
                }
                const matchText = text.slice(matchIndex, matchIndex + query.length);
                nodes.push(
                    <mark
                        key={`${matchIndex}-${matchCount}`}
                        className={`transcript-search-hit${isActive ? " transcript-search-hit-active" : ""}`}
                    >
                        {matchText}
                    </mark>
                );
                startIndex = matchIndex + query.length;
                matchIndex = lower.indexOf(query, startIndex);
                matchCount += 1;
            }
            if (startIndex < text.length) {
                nodes.push(text.slice(startIndex));
            }
            return nodes;
        },
        [normalizedSearchQuery]
    );

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setActiveSearchIndex(0);
    };

    const handleSearchNavigate = useCallback(
        (direction: number) => {
            if (!normalizedSearchQuery) return;
            if (showSegmentView && segmentMatchIndexes.length > 0) {
                setActiveSearchIndex((prev) =>
                    (prev + direction + segmentMatchIndexes.length) % segmentMatchIndexes.length
                );
                return;
            }
            if (showStreaming && streamMatchIndexes.length > 0) {
                setActiveSearchIndex((prev) =>
                    (prev + direction + streamMatchIndexes.length) % streamMatchIndexes.length
                );
            }
        },
        [normalizedSearchQuery, showSegmentView, showStreaming, segmentMatchIndexes, streamMatchIndexes]
    );

    const handleTimestampStep = useCallback(
        (direction: number) => {
            if (!showSegmentView) return;
            const segments = item.segments ?? [];
            if (segments.length === 0) return;
            let nextIndex = activeSegmentIndex;
            if (nextIndex < 0) {
                nextIndex = direction > 0 ? 0 : segments.length - 1;
            } else {
                nextIndex = Math.max(0, Math.min(segments.length - 1, nextIndex + direction));
            }
            if (nextIndex === activeSegmentIndex) return;
            const segment = segments[nextIndex];
            handleTimestampClick(segment.start_ms);
        },
        [activeSegmentIndex, item.segments, showSegmentView, handleTimestampClick]
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;

            const target = event.target as HTMLElement | null;
            const tag = target?.tagName.toLowerCase();
            const isTextInput =
                tag === "input" || tag === "textarea" || target?.isContentEditable;

            if (event.key === "Escape") {
                event.preventDefault();
                if (showDeleteConfirm) {
                    setShowDeleteConfirm(false);
                } else {
                    onClose();
                }
                return;
            }

            if (event.key === " ") {
                if (isTextInput) return;
                event.preventDefault();
                handleTogglePlayback();
                return;
            }

            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            if (!showSegmentView || isTextInput) return;
            const now = performance.now();
            if (now - lastTimestampNavRef.current < 140) return;
            lastTimestampNavRef.current = now;
            event.preventDefault();
            handleTimestampStep(event.key === "ArrowDown" ? 1 : -1);
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleTimestampStep, handleTogglePlayback, onClose, showDeleteConfirm, showSegmentView]);

    useEffect(() => {
        if (!normalizedSearchQuery) return;
        if (showSegmentView) {
            if (segmentMatchIndexes.length === 0) return;
            const targetIndex =
                segmentMatchIndexes[Math.min(activeSearchIndex, segmentMatchIndexes.length - 1)];
            segmentsVirtuosoRef.current?.scrollToIndex({
                index: targetIndex,
                align: "center",
                behavior: "smooth",
            });
            return;
        }
        if (showStreaming) {
            if (streamMatchIndexes.length === 0) return;
            const targetIndex =
                streamMatchIndexes[Math.min(activeSearchIndex, streamMatchIndexes.length - 1)];
            streamVirtuosoRef.current?.scrollToIndex({
                index: targetIndex,
                align: "center",
                behavior: "smooth",
            });
            return;
        }
        if (textMatchIndex >= 0 && transcriptAreaRef.current) {
            const endIndex = textMatchIndex + normalizedSearchQuery.length;
            transcriptAreaRef.current.focus();
            transcriptAreaRef.current.setSelectionRange(textMatchIndex, endIndex);
        }
    }, [
        normalizedSearchQuery,
        showSegmentView,
        showStreaming,
        segmentMatchIndexes,
        streamMatchIndexes,
        activeSearchIndex,
        textMatchIndex,
    ]);

    useEffect(() => {
        if (!followTimestampsActive || activeSegmentIndex < 0) return;
        segmentsVirtuosoRef.current?.scrollToIndex({
            index: activeSegmentIndex,
            align: "center",
            behavior: "smooth",
        });
    }, [activeSegmentIndex, followTimestampsActive]);

    return (
        <div className="flex h-full w-full min-h-0 overflow-hidden rounded-2xl border border-border-secondary bg-surface-overlay shadow-2xl shadow-black/50">
            {/* Sidebar */}
            <aside className="flex w-48 shrink-0 flex-col border-r border-border-primary bg-surface-surface">
                <div className="px-4 pt-5 pb-3">
                    {isEditingName ? (
                        <div className="flex items-center gap-1.5 mt-1">
                            <input
                                value={nameDraft}
                                onChange={(event) => setNameDraft(event.target.value)}
                                onBlur={handleNameCommit}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleNameCommit();
                                    }
                                }}
                                className="flex-1 min-w-0 bg-surface-surface border border-border-primary rounded-sm px-1.5 py-0.5 ui-text-body text-content-primary focus:border-border-hover outline-hidden"
                                autoFocus
                            />
                            <button onClick={handleNameCommit} className="text-content-muted hover:text-content-primary">
                                <Check size={12} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 mt-1 group">
                            <h2 className="ui-text-body font-semibold text-content-primary truncate">{item.name}</h2>
                            <button
                                onClick={() => setIsEditingName(true)}
                                className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-content-primary transition-opacity"
                            >
                                <Pencil size={10} />
                            </button>
                        </div>
                    )}
                    <p className="ui-text-meta text-content-disabled mt-0.5 truncate">{modelLabel}</p>
                </div>

                <nav className="flex-1 px-2 py-2 space-y-3 overflow-y-auto custom-scrollbar scrollbar-gutter">
                    {/* Audio player */}
                    <div className="px-2">
                        <p className="ui-text-meta font-semibold uppercase tracking-wider text-content-disabled mb-1.5">Audio</p>
                        <div className="rounded-lg border border-border-primary bg-surface-surface px-2.5 py-2.5">
                            <div className="flex items-center justify-between">
                                <button
                                    onClick={handleTogglePlayback}
                                    disabled={!audioReady || !!audioError}
                                    className={`flex h-6 w-6 items-center justify-center rounded-md border text-content-primary transition-colors ${
                                        !audioReady || audioError
                                            ? "border-border-primary/60 text-content-disabled"
                                            : "border-border-primary hover:border-border-secondary"
                                    }`}
                                    aria-label={isPlaying ? "Pause audio" : "Play audio"}
                                >
                                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                                </button>
                                <div className="flex flex-col items-center justify-center">
                                    <span className="ui-text-micro text-content-disabled tabular-nums leading-none">
                                        {formatDuration(audioCurrentTime)} / {formatDuration(audioDuration)}
                                    </span>
                                    <div className="mt-1.5 flex items-center justify-center gap-0.25 ui-text-nano leading-none">
                                        <button
                                            type="button"
                                            onClick={() => handlePlaybackRateStep(-1)}
                                            disabled={!audioReady || !!audioError || !canDecreasePlaybackRate}
                                            aria-label="Decrease playback speed"
                                            className={`flex h-3 w-3 items-center justify-center rounded-sm transition-colors ${
                                                !audioReady || audioError || !canDecreasePlaybackRate
                                                    ? "text-content-disabled"
                                                    : "text-content-muted hover:text-content-primary"
                                            }`}
                                        >
                                            <ChevronLeft size={9} />
                                        </button>
                                        <AnimatePresence mode="popLayout" initial={false}>
                                            <motion.span
                                                key={playbackRate}
                                                initial={{ opacity: 0, y: -2, scale: 0.92 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 2, scale: 0.92 }}
                                                transition={{ duration: 0.16, ease: "easeOut" }}
                                                className="w-[28px] text-center ui-text-nano font-medium text-content-secondary tabular-nums"
                                            >
                                                {formatPlaybackRate(playbackRate)}x
                                            </motion.span>
                                        </AnimatePresence>
                                        <button
                                            type="button"
                                            onClick={() => handlePlaybackRateStep(1)}
                                            disabled={!audioReady || !!audioError || !canIncreasePlaybackRate}
                                            aria-label="Increase playback speed"
                                            className={`flex h-3 w-3 items-center justify-center rounded-sm transition-colors ${
                                                !audioReady || audioError || !canIncreasePlaybackRate
                                                    ? "text-content-disabled"
                                                    : "text-content-muted hover:text-content-primary"
                                            }`}
                                        >
                                            <ChevronRight size={9} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2">
                                <input
                                    type="range"
                                    min={0}
                                    max={scrubberMax}
                                    step={0.01}
                                    value={scrubberValue}
                                    onChange={(event) => handleScrubChange(event.target.value)}
                                    onMouseDown={handleScrubStart}
                                    onTouchStart={handleScrubStart}
                                    onMouseUp={handleScrubEnd}
                                    onTouchEnd={handleScrubEnd}
                                    className="library-scrubber"
                                    disabled={!audioReady || !!audioError}
                                    style={{
                                        background: `linear-gradient(to right, var(--color-cloud) 0%, var(--color-cloud) ${scrubberPercent}%, var(--color-border-secondary) ${scrubberPercent}%, var(--color-border-secondary) 100%)`,
                                    }}
                                    aria-label="Audio scrubber"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Settings section */}
                    <div className="px-2 space-y-2">
                        <p className="ui-text-meta font-semibold uppercase tracking-wider text-content-disabled">Settings</p>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="ui-text-label text-content-primary">Timestamps</div>
                                <div className="ui-text-micro text-content-disabled">
                                    {isTranscribed ? (canShowTimestamps ? "Supported" : "Not supported") : "Available after transcription"}
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (!canShowTimestamps) return;
                                    const nextValue = !showTimestamps;
                                    setShowTimestamps(nextValue);
                                    if (!nextValue) {
                                        onFollowTimestampsChange(false);
                                    }
                                    onUpdate({ show_timestamps: nextValue });
                                }}
                                className={`relative w-8 h-4 rounded-full transition-colors ${showTimestamps ? "bg-cloud" : "bg-border-secondary"} ${!canShowTimestamps ? "opacity-40 cursor-not-allowed" : ""}`}
                                role="switch"
                                aria-checked={showTimestamps}
                                disabled={!canShowTimestamps}
                            >
                                <motion.div
                                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-xs"
                                    initial={false}
                                    animate={{ left: showTimestamps ? "calc(100% - 14px)" : "2px" }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            </button>
                        </div>
                        <div className="flex items-center justify-between pl-3">
                            <div>
                                <div className="flex items-center gap-1.5 ui-text-meta text-content-secondary">
                                    <CornerDownRight size={10} className="text-content-disabled" aria-hidden="true" />
                                    <span>Follow timestamp</span>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (!showSegmentView) return;
                                    onFollowTimestampsChange((prev) => !prev);
                                }}
                                className={`relative w-7 h-3 rounded-full transition-colors ${
                                    followTimestampsActive ? "bg-cloud" : "bg-border-secondary"
                                } ${!showSegmentView ? "opacity-40 cursor-not-allowed" : ""}`}
                                role="switch"
                                aria-checked={followTimestampsActive}
                                disabled={!showSegmentView}
                            >
                                <motion.div
                                    className="absolute top-[1px] w-2.5 h-2.5 rounded-full bg-white shadow-xs"
                                    initial={false}
                                    animate={{ left: followTimestampsActive ? "calc(100% - 10px)" : "2px" }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Tags section */}
                    <div className="px-2 space-y-1.5">
                        <p className="ui-text-meta font-semibold uppercase tracking-wider text-content-disabled">Tags</p>
                        <div className="flex flex-wrap gap-2 max-h-20 overflow-auto custom-scrollbar scrollbar-gutter pr-3">
                            {item.tags.length === 0 && <span className="ui-text-meta text-content-disabled italic">None</span>}
                            {item.tags.map((tag, idx) => (
                                <span
                                    key={`${tag}-${idx}`}
                                    onClick={() => {
                                        if (shiftHeld) {
                                            handleRemoveTag(tag);
                                        }
                                    }}
                                    className={`inline-flex items-center pl-3 pr-1.5 py-1.5 rounded-sm ui-text-meta bg-white/5 border transition-colors leading-none text-content-secondary border-white/10 ${
                                        shiftHeld ? "cursor-pointer ui-hover-error-tint hover:border-red-500/60" : ""
                                    }`}
                                >
                                    <span>{tag.length > 12 ? `${tag.slice(0, 12)}...` : tag}</span>
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleRemoveTag(tag);
                                        }}
                                        className="ml-1 text-content-disabled ui-hover-error-soft transition-colors cursor-pointer shrink-0"
                                        aria-label={`Remove ${tag}`}
                                    >
                                        <X size={10} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5 min-h-[24px]">
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
                                                                handleAddTag(tag);
                                                                setTagMenuOpen(false);
                                                            }}
                                                            className="w-full text-left px-2.5 py-1.5 ui-text-meta font-medium text-content-secondary hover:bg-surface-elevated/70 hover:text-content-primary transition-colors"
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))
                                                ) : (
                                                    <div className="px-2.5 py-2 ui-text-micro text-content-muted">
                                                        {availableTags.length === 0 ? "No tags yet" : "No other tags"}
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <input
                                value={tagInput}
                                onChange={(event) => setTagInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleAddTag();
                                    }
                                }}
                                placeholder="New tag..."
                                className="flex-1 min-w-0 h-6 bg-transparent border-b border-border-primary px-0.5 py-0 ui-text-meta text-content-secondary outline-hidden focus:border-border-hover placeholder:text-content-disabled"
                            />
                        </div>
                    </div>
                </nav>

                {/* Sidebar footer actions */}
                <div className="px-2 py-3 border-t border-border-primary space-y-1.5">
                    {(item.status.type === "transcribing"
                        || item.status.type === "cancelling"
                        || item.status.type === "pending"
                        || item.status.type === "importing") && (
                        <button onClick={onCancel} className="w-full rounded-lg border border-border-primary bg-surface-surface px-2 py-1.5 ui-text-meta text-content-primary hover:border-border-secondary">
                            Cancel
                        </button>
                    )}
                    {item.status.type === "error" && (
                        <button onClick={onRetry} className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border-primary bg-surface-surface px-2 py-1.5 ui-text-meta text-content-primary hover:border-border-secondary">
                            <RotateCw size={10} />
                            Retry
                        </button>
                    )}
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-2 py-1.5 ui-text-meta ui-color-error-soft hover:bg-red-500/10"
                    >
                        <Trash2 size={10} />
                        Delete
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex flex-1 flex-col min-h-0 min-w-0 bg-surface-overlay">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border-primary shrink-0 bg-surface-surface/40">
                    <button
                        onClick={() => setShowRetranscribe(true)}
                        disabled={item.status.type === "transcribing"
                            || item.status.type === "cancelling"
                            || item.status.type === "pending"
                            || item.status.type === "importing"}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 ui-text-meta text-content-secondary hover:text-content-primary hover:bg-surface-surface disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <RotateCw size={11} />
                        Retranscribe
                    </button>
                    <div className="flex-1 flex justify-center">
                        <div className="relative w-full max-w-[240px]">
                            <div className="relative flex items-center gap-2 bg-surface-secondary border border-border-primary rounded-lg px-2.5 py-1.5 focus-within:border-border-secondary transition-colors">
                                <Search size={12} className="text-content-disabled shrink-0" aria-hidden="true" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => handleSearchChange(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            handleSearchNavigate(event.shiftKey ? -1 : 1);
                                        }
                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            handleSearchChange("");
                                        }
                                    }}
                                    placeholder="Search transcript..."
                                    aria-label="Search transcript"
                                    className="bg-transparent ui-text-label text-content-secondary placeholder-content-disabled outline-hidden w-full"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                                    {searchQuery && (
                                        <button
                                            onClick={() => handleSearchChange("")}
                                            aria-label="Clear search"
                                            className="text-content-disabled hover:text-content-muted transition-colors"
                                        >
                                            <X size={12} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            disabled={!transcriptAvailable}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ui-text-meta disabled:opacity-50 transition-colors ${
                                copyConfirmed
                                    ? "ui-color-success-subtle bg-emerald-400/10"
                                    : "text-content-secondary hover:text-content-primary hover:bg-surface-surface"
                            }`}
                        >
                            {copyConfirmed ? <Check size={10} /> : <Copy size={10} />}
                            {copyConfirmed ? "Copied" : "Copy"}
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setExportOpen(!exportOpen)}
                                disabled={isExporting || !transcriptAvailable}
                                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 ui-text-meta text-content-secondary hover:text-content-primary hover:bg-surface-surface disabled:opacity-50"
                            >
                                Export
                                <ChevronDown size={10} />
                            </button>
                            <AnimatePresence>
                                {exportOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 4 }}
                                        transition={{ duration: 0.1 }}
                                        className="absolute right-0 top-full mt-1 w-32 rounded-lg border border-border-primary bg-surface-surface shadow-xl overflow-hidden z-10"
                                    >
                                        {(["txt", "md", "srt", "vtt"] as ExportFormat[]).map((format) => {
                                            const requiresSegments = format === "srt" || format === "vtt";
                                            const disabled = requiresSegments && !(item.segments && item.segments.length);
                                            return (
                                                <button
                                                    key={format}
                                                    onClick={() => handleExport(format)}
                                                    disabled={disabled}
                                                    className="w-full px-3 py-1.5 text-left ui-text-meta text-content-secondary hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {format.toUpperCase()}
                                                </button>
                                            );
                                        })}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center rounded-md p-1.5 text-content-muted hover:text-content-primary hover:bg-surface-surface"
                            aria-label="Close"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>

                {/* Transcript area */}
                <div className="flex-1 min-h-0 overflow-hidden px-4 pb-0 pt-0 flex flex-col gap-3">
                    {(item.status.type === "importing" || item.status.type === "pending") && (
                        <div className="ui-text-label text-content-muted tabular-nums">
                            {importStatusText}
                        </div>
                    )}
                    {item.status.type === "error" ? (
                        <div className="flex-1 min-h-0 flex items-center justify-center">
                            {(() => {
                                const details = getLibraryErrorDetails(item.status.message);
                                return (
                                    <div className="max-w-[240px] rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2 ui-color-error-tint">
                                            <AlertTriangle size={14} />
                                            <span className="ui-text-label font-medium">Import failed</span>
                                        </div>
                                        <p className="mt-2 ui-text-meta leading-[14px] ui-color-error-tint select-text cursor-text">
                                            {details.message}
                                        </p>
                                        {details.showFfmpegHelp && (
                                            <button
                                                type="button"
                                                onClick={() => invoke("open_ffmpeg_install").catch(() => {})}
                                                className="mt-2 ui-text-meta ui-color-error-faint underline decoration-red-400/60 ui-hover-error-50"
                                            >
                                                FFmpeg Help
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="relative flex-1 min-h-0">
                            {showSegmentView ? (
                                <Virtuoso
                                    ref={segmentsVirtuosoRef}
                                    style={{ height: "100%" }}
                                    data={item.segments ?? []}
                                    overscan={200}
                                    className="custom-scrollbar ui-text-body text-content-secondary leading-relaxed"
                                    computeItemKey={(index: number, segment: TranscriptSegment) =>
                                        `${segment.start_ms}-${index}`
                                    }
                                    components={{
                                        Header: () => <div className="h-3" />,
                                        Footer: () => <div className="h-3" />,
                                    }}
                                    itemContent={(idx, segment) => {
                                        const isActive = idx === activeSegmentIndex;
                                        return (
                                            <div className="pb-1.5 pr-4">
                                                <motion.div
                                                    initial={{ opacity: 0, y: 6 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                                    className={`grid w-full grid-cols-[auto_1fr] gap-3 rounded-md border px-2 py-1 transition-colors select-none ${
                                                        isActive ? "border-cloud-30 bg-cloud-10" : "border-transparent"
                                                    }`}
                                                >
                                                    <span
                                                        className="text-content-disabled font-mono ui-text-label pt-0.5 select-none cursor-pointer hover:text-content-primary"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => handleTimestampClick(segment.start_ms)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter" || event.key === " ") {
                                                                event.preventDefault();
                                                                handleTimestampClick(segment.start_ms);
                                                            }
                                                        }}
                                                    >
                                                        {formatTimestamp(segment.start_ms)}
                                                    </span>
                                                    <div className="min-w-0 select-none w-fit">
                                                        <span className="select-text">
                                                            {renderHighlightedText(segment.text, idx === activeSegmentMatch)}
                                                        </span>
                                                    </div>
                                                </motion.div>
                                            </div>
                                        );
                                    }}
                                />
                            ) : showStreaming ? (
                                streamChunks.length === 0 ? (
                                    item.status.type === "transcribing" ? (
                                        <div className="text-content-disabled ui-text-body-sm">
                                            Transcribing...
                                        </div>
                                    ) : null
                                ) : (
                                    <Virtuoso
                                    ref={streamVirtuosoRef}
                                    style={{ height: "100%" }}
                                    data={streamChunks}
                                    overscan={200}
                                    className="custom-scrollbar ui-text-body text-content-secondary leading-relaxed"
                                    computeItemKey={(index: number) => `${item.id}-chunk-${index}`}
                                    components={{
                                        Header: () => <div className="h-3" />,
                                        Footer: () => <div className="h-3" />,
                                    }}
                                    itemContent={(idx, chunk) => (
                                        <div className="pb-2 pr-4">
                                            <motion.p
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.2, ease: "easeOut" }}
                                                    className="select-text"
                                                >
                                                    {renderHighlightedText(chunk, idx === activeStreamMatch)}
                                                </motion.p>
                                            </div>
                                        )}
                                    />
                                )
                            ) : (
                                <textarea
                                    ref={transcriptAreaRef}
                                    value={transcriptDraft}
                                    onChange={(event) => setTranscriptDraft(event.target.value)}
                                    disabled={!transcriptAvailable}
                                    placeholder={item.status.type === "importing" || item.status.type === "pending"
                                        ? ""
                                        : "Transcript will appear here."}
                                    className="h-full w-full resize-none bg-transparent ui-text-body text-content-secondary leading-relaxed outline-hidden disabled:opacity-60 custom-scrollbar select-text pr-4 pt-3 pb-3"
                                />
                            )}
                            <div className="scroll-fade-top" style={{ zIndex: 5 }} aria-hidden="true" />
                            <div className="scroll-fade-bottom" style={{ zIndex: 5 }} aria-hidden="true" />
                        </div>
                    )}
                </div>
            </main>

            <AnimatePresence>
                {showDeleteConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowDeleteConfirm(false);
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
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <AlertTriangle size={20} className="ui-color-warning-strong shrink-0" />
                                <div>
                                    <p className="ui-text-body-lg font-semibold text-content-primary">Delete this item?</p>
                                    <p className="ui-text-label text-content-disabled">This removes the transcript and audio from your library.</p>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary hover:border-border-hover transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setShowDeleteConfirm(false);
                                        onDelete();
                                    }}
                                    className="rounded-lg bg-red-500/90 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-solid hover:bg-red-500 transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showRetranscribe && (
                    <LibraryRetranscribeModal
                        item={item}
                        models={models}
                        onCancel={() => setShowRetranscribe(false)}
                        onConfirm={async (options) => {
                            try {
                                await onUpdate({
                                    speech_model: options.model_key,
                                    llm_cleanup_enabled: false,
                                    show_timestamps: options.show_timestamps,
                                });
                                await onRetry();
                                setShowRetranscribe(false);
                            } catch (err) {
                                console.error("Failed to retranscribe:", err);
                            }
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default LibraryModal;
