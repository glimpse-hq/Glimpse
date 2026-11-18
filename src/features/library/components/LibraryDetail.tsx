import { useLingui } from "@lingui/react/macro";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  Warning as AlertTriangle,
  Eye,
  EyeSlash,
  BookmarkSimple,
  Check,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  DotsThree,
  GearSix,
  Microphone,
  MicrophoneSlash,
  Pause,
  PencilSimple as Pencil,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  UserPlus,
  Users,
  X,
} from "@phosphor-icons/react";
import AudioScrubber from "./AudioScrubber";
import SpeakerContextMenu, { SpeakerMenuItem } from "./SpeakerContextMenu";
import LibraryRetranscribeModal, {
  type LibraryRetranscribeOptions,
} from "./LibraryRetranscribeModal";
import LibraryDeleteDialog from "./LibraryDeleteDialog";
import {
  clampProgress,
  formatDuration,
  formatPlaybackRate,
  formatTimestamp,
  getLibraryErrorDetails,
  PLAYBACK_RATES,
  sanitizeFileName,
  shouldShowImportProgress,
  isLibraryItemBusy,
  describeAudioSources,
  libraryItemTitle,
} from "./library-utils";
import {
  resolveSpeechModelLabel,
  useDiarizerInstalled,
} from "../../settings/models-queries";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";
import { ScreenHeaderRule } from "../../../shared/ui/ScreenHeader";
import SearchField from "../../../shared/ui/SearchField";
import { useCopyToClipboard } from "../../../shared/hooks/useCopyToClipboard";
import { IntelligencePixel } from "../../../shared/ui/IntelligencePixel";
import type {
  Bookmark,
  ExportFormat,
  LibraryItem,
  LibraryItemPatch,
  Speaker,
  SpeechModel,
  TranscriptSegment,
} from "../../../types";
import { SPEAKER_COLORS, withSpeakerColors } from "../speakerColors";
import { showErrorToast } from "../../../shared/lib/errorToast";
import { hapticTick, startDragStep } from "../../settings/dragStep";

const MAX_SPEAKERS = 16;
const FOLLOW_PLAYBACK_KEY = "glimpse.library.follow_playback";
// Starts on the header's left edge, at reading width.
const CONTENT_COLUMN = "mx-auto w-full max-w-column-wide [&>*]:max-w-column";
const EXPORT_FORMATS: Array<{ value: ExportFormat; needsSegments?: boolean }> =
  [
    { value: "txt" },
    { value: "md" },
    { value: "srt", needsSegments: true },
    { value: "vtt", needsSegments: true },
  ];

type SpeakerTurn = {
  key: number;
  speaker: Speaker | null;
  text: string;
  start_ms: number;
  // A later paragraph of the same turn, shown without the speaker label.
  continues: boolean;
};

const PARAGRAPH_MIN_CHARS = 400;

type RowMatch = { row: number; occurrence: number };

const findRowMatches = (rows: string[], query: string): RowMatch[] => {
  const needle = query.toLowerCase();
  const matches: RowMatch[] = [];
  rows.forEach((text, row) => {
    const lower = text.toLowerCase();
    let cursor = lower.indexOf(needle);
    for (let occurrence = 0; cursor !== -1; occurrence += 1) {
      matches.push({ row, occurrence });
      cursor = lower.indexOf(needle, cursor + needle.length);
    }
  });
  return matches;
};

// Same-speaker segments merge into one turn, split into paragraphs at long sentence ends.
const buildSpeakerTurns = (
  segments: TranscriptSegment[],
  speakerById: Map<string, Speaker>,
) => {
  const turns: SpeakerTurn[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index].text.trim();
    if (!text) continue;
    const id = segments[index].speaker_id;
    const speaker = (id && speakerById.get(id)) || null;
    const last = turns[turns.length - 1];
    const sameSpeaker = !!last && last.speaker === speaker;
    const continues =
      sameSpeaker &&
      last.text.length >= PARAGRAPH_MIN_CHARS &&
      /[.!?…]["')\]]*$/.test(last.text);
    if (sameSpeaker && !continues) {
      last.text += ` ${text}`;
    } else {
      turns.push({
        key: index,
        speaker,
        text,
        start_ms: segments[index].start_ms,
        continues,
      });
    }
  }
  return turns;
};

const SegmentWordsRow = ({
  tokens,
  activePosition,
}: {
  tokens: string[];
  activePosition: number;
}) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [underline, setUnderline] = useState<{
    x: number;
    y: number;
    width: number;
    // Slides only from one word to the next, never into place.
    slide: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Hidden text (another screen is showing) measures at 0, so wait for it.
    const place = (slide: boolean) => {
      const active = container.querySelector<HTMLElement>(
        '[data-word-active="true"]',
      );
      if (!active || active.offsetParent === null) return;
      setUnderline((previous) => ({
        x: active.offsetLeft,
        y: active.offsetTop + active.offsetHeight - 2,
        width: active.offsetWidth,
        slide: slide && previous !== null,
      }));
    };
    place(true);
    // It also fires once on start; only a real size change (shown again,
    // rewrapped) should move the underline.
    let width = container.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (container.offsetWidth === width) return;
      width = container.offsetWidth;
      place(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [activePosition, tokens]);

  return (
    <span ref={containerRef} className="transcript-words select-text">
      {tokens.map((token, position) => (
        <Fragment key={position}>
          {position > 0 ? " " : null}
          <span
            data-word-active={position === activePosition || undefined}
            className={`transcript-word${
              position === activePosition ? " transcript-word-active" : ""
            }`}
          >
            {token}
          </span>
        </Fragment>
      ))}
      {underline ? (
        <span
          className="transcript-word-underline"
          aria-hidden="true"
          style={{
            transform: `translate(${underline.x}px, ${underline.y}px)`,
            width: underline.width,
            opacity: activePosition >= 0 ? 1 : 0,
            ...(underline.slide ? {} : { transition: "none" }),
          }}
        />
      ) : null}
    </span>
  );
};

// A saved moment: click the time to jump there, click the label to name it.
const BookmarkRow = ({
  bookmark,
  timeWidth,
  onSeek,
  onRename,
  onRemove,
}: {
  bookmark: Bookmark;
  timeWidth: string;
  onSeek: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) => {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bookmark.label ?? "");

  const commit = () => {
    setEditing(false);
    const value = draft.trim();
    if (value !== (bookmark.label ?? "")) onRename(value);
  };

  return (
    <div
      className="group/bookmark -mx-2 grid grid-cols-[auto_1fr] items-center gap-3 rounded-md px-2 py-1"
      title={`${formatTimestamp(bookmark.at_ms)}${bookmark.label ? ` · ${bookmark.label}` : ""}`}
    >
      <button
        type="button"
        onClick={onSeek}
        className="flex items-center gap-1.5 font-mono ui-text-label tabular-nums ui-color-cloud transition-opacity hover:opacity-75"
      >
        <span className={`${timeWidth} shrink-0 text-right`}>
          {formatTimestamp(bookmark.at_ms)}
        </span>
        {/* Sits in the speaker dot's slot so both row kinds share columns. */}
        <span className="flex w-2 shrink-0 justify-center">
          <BookmarkSimple size={11} weight="fill" aria-hidden="true" />
        </span>
      </button>
      <div className="flex min-w-0 items-center gap-2 ui-text-body">
        {editing ? (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(bookmark.label ?? "");
                setEditing(false);
              }
            }}
            placeholder={t({
              id: "library.bookmark.label_placeholder",
              message: "Add a note",
            })}
            className="min-w-0 flex-1 bg-transparent border-b border-[var(--color-border-primary)] px-0.5 text-content-primary outline-hidden focus:border-[var(--color-border-hover)] placeholder:text-content-disabled"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(bookmark.label ?? "");
              setEditing(true);
            }}
            className={`min-w-0 flex-1 truncate text-left transition-colors hover:text-content-primary ${
              bookmark.label
                ? "text-content-secondary"
                : "text-content-disabled"
            }`}
          >
            {bookmark.label ||
              t({ id: "library.bookmark.unnamed", message: "Bookmark" })}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t({
            id: "library.bookmark.remove",
            message: "Remove bookmark",
          })}
          className="shrink-0 text-content-disabled opacity-0 transition-opacity hover:text-red-500 group-hover/bookmark:opacity-100 focus-visible:opacity-100"
        >
          <X size={10} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

const menuRowBase =
  "mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-md px-2 py-1 text-left ui-text-body-sm transition-colors hover:bg-[var(--surface-interactive)] disabled:pointer-events-none disabled:opacity-40";
const menuRowClass = `${menuRowBase} ui-color-secondary hover:text-content-primary`;

const MenuSection = ({ title }: { title: string }) => (
  <>
    <div className="mx-3 my-1 border-t border-border-secondary" />
    <div className="px-3 pb-1 pt-1 ui-text-uppercase-micro ui-color-muted">
      {title}
    </div>
  </>
);

const LibraryDetail = ({
  item,
  models,
  onClose,
  onDelete,
  onRetry,
  onRetranscribe,
  onRediarize,
  rediarizing,
  onCancel,
  onUpdate,
  onExport,
  folders,
  onMove,
  onNewFolder,
  onOpenFolder,
}: {
  item: LibraryItem;
  models: SpeechModel[];
  onClose: () => void;
  onDelete: () => Promise<void>;
  onRetry: () => Promise<void>;
  onRetranscribe: (options: LibraryRetranscribeOptions) => Promise<void>;
  onRediarize: () => Promise<void>;
  rediarizing: boolean;
  onCancel: () => void;
  onUpdate: (patch: LibraryItemPatch) => Promise<LibraryItem>;
  onExport: (format: ExportFormat, outputPath: string) => Promise<void>;
  folders: string[];
  onMove: (folder: string | null) => void;
  onNewFolder: () => void;
  onOpenFolder: (folder: string) => void;
}) => {
  const { t } = useLingui();
  const [nameDraft, setNameDraft] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const nameEditCancelled = useRef(false);
  const [transcriptDraft, setTranscriptDraft] = useState(item.transcript ?? "");
  const [showTimestamps, setShowTimestamps] = useState(
    item.show_timestamps && Boolean(item.segments?.length),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const closeDeleteConfirm = useCallback(() => setShowDeleteConfirm(false), []);
  const [audioDuration, setAudioDuration] = useState(
    item.duration_seconds || 0,
  );
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [followPaused, setFollowPaused] = useState(false);
  const [followPlayback, setFollowPlayback] = useState(
    () => localStorage.getItem(FOLLOW_PLAYBACK_KEY) !== "off",
  );
  const playbackMenuRef = useRef<HTMLDivElement>(null);
  const playbackMenuPanelRef = useRef<HTMLDivElement>(null);
  const [playbackMenuOpen, setPlaybackMenuOpen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [trackMuted, setTrackMuted] = useState({
    primary: false,
    secondary: false,
  });
  const [streamChunks, setStreamChunks] = useState<string[]>([]);
  const [showRetranscribe, setShowRetranscribe] = useState(false);
  const diarizerInstalled = useDiarizerInstalled();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [renamingSpeakerId, setRenamingSpeakerId] = useState<string | null>(
    null,
  );
  const [speakerNameDraft, setSpeakerNameDraft] = useState("");
  const [speakerMenuSegment, setSpeakerMenuSegment] = useState<number | null>(
    null,
  );
  const [speakersMenuOpen, setSpeakersMenuOpen] = useState(false);
  const [speakerContext, setSpeakerContext] = useState<{
    speakerId: string;
    segmentIndex?: number;
    x: number;
    y: number;
  } | null>(null);
  const [hiddenSpeakerIds, setHiddenSpeakerIds] = useState<string[]>([]);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptPending = useRef<string | null>(null);
  const transcriptSent = useRef<string | null>(null);
  const transcriptSaves = useRef(0);
  const transcriptSaveFailed = useRef(false);
  const transcriptChain = useRef<Promise<unknown>>(Promise.resolve());
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackMutedRef = useRef(trackMuted);
  trackMutedRef.current = trackMuted;
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuPanelRef = useRef<HTMLDivElement>(null);
  const speakerMenuRef = useRef<HTMLDivElement>(null);
  const speakersMenuRef = useRef<HTMLDivElement>(null);
  const speakersMenuPanelRef = useRef<HTMLDivElement>(null);
  const playbackRateRef = useRef(1);
  const streamTranscriptRef = useRef(item.transcript ?? "");
  const scrubWasPlayingRef = useRef(false);
  const scrubValueRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const lastTimestampNavRef = useRef(0);
  const transcriptAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptHighlightsRef = useRef<HTMLDivElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const segmentsVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const turnsVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const streamVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const segmentsScrollerRef = useRef<HTMLElement | null>(null);
  const followScrollRafRef = useRef<number | null>(null);

  const modelLabel =
    resolveSpeechModelLabel(models, item.speech_model) ?? item.speech_model;
  const microphoneLabel = t({
    id: "library.sources.microphone",
    message: "Microphone",
  });
  const systemAudioLabel = t({
    id: "library.sources.system_audio",
    message: "System Audio",
  });
  const bookmarks = useMemo(
    () => [...(item.bookmarks ?? [])].sort((a, b) => a.at_ms - b.at_ms),
    [item.bookmarks],
  );
  const transcriptEditable = item.status.type === "complete";
  const transcriptAvailable =
    transcriptEditable && (item.transcript ?? "").trim().length > 0;
  const canShowTimestamps = !!item.segments && item.segments.length > 0;
  const speakers = useMemo(
    () => withSpeakerColors(item.speakers ?? []),
    [item.speakers],
  );
  const canAddSpeaker = speakers.length < MAX_SPEAKERS;
  const isBusy = isLibraryItemBusy(item.status);
  const detectingSpeakersLabel = t({
    id: "library.modal.detecting_speakers",
    message: "Detecting speakers",
  });
  const transcribingLabel =
    item.status.type !== "transcribing"
      ? null
      : item.status.detecting_speakers
        ? detectingSpeakersLabel
        : t({
            id: "library.modal.transcribing_progress",
            message: `Transcribing ${(clampProgress(item.status.progress) * 100).toFixed(0)}%`,
          });
  const importStatusText =
    item.status.type === "importing"
      ? shouldShowImportProgress(item.status.progress)
        ? t({
            id: "library.modal.import_status.converting_progress",
            message: `Converting audio... ${Math.round(clampProgress(item.status.progress) * 100)}%`,
          })
        : t({
            id: "library.modal.import_status.converting",
            message: "Converting audio...",
          })
      : t({
          id: "library.modal.import_status.queued",
          message: "Queued for transcription...",
        });

  const createdAtLabel = useMemo(() => {
    const date = new Date(item.created_at);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [item.created_at]);

  // What isn't on screen: when it was made, the model, and what it recorded.
  const infoLine = [
    createdAtLabel,
    modelLabel,
    describeAudioSources(item.sources, {
      microphone: microphoneLabel,
      systemAudio: systemAudioLabel,
    }),
  ]
    .filter(Boolean)
    .join(" · ");

  const hasTracks = Boolean(item.secondary_audio_path);
  // Recorded tracks are mixed into one stream so they share a clock.
  const audioUrlFor = useCallback(
    (muted: { primary: boolean; secondary: boolean }) => {
      if (!item.secondary_audio_path) return convertFileSrc(item.audio_path);
      const params = new URLSearchParams();
      params.append("track", item.audio_path);
      params.append("track", item.secondary_audio_path);
      if (muted.primary) params.append("mute", "0");
      if (muted.secondary) params.append("mute", "1");
      return `${convertFileSrc("", "playback")}?${params}`;
    },
    [item.audio_path, item.secondary_audio_path],
  );

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
  }, []);

  const releaseAudioSource = useCallback(() => {
    stopSeekLoop();
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    updateIsPlaying(false);
    return audio;
  }, [stopSeekLoop, updateIsPlaying]);

  const setPlaybackRateValue = useCallback((value: number) => {
    playbackRateRef.current = value;
    setPlaybackRate(value);
    const audio = audioRef.current;
    if (audio) {
      // A reload resets the rate to the default one.
      audio.defaultPlaybackRate = value;
      audio.playbackRate = value;
    }
  }, []);

  const playAudio = useCallback(
    (audio: HTMLAudioElement) => {
      void audio.play().catch((err) => {
        console.error("Audio play error:", err);
        setAudioError(
          t({
            id: "library.modal.audio_unavailable",
            message: "Audio unavailable",
          }),
        );
        setAudioReady(false);
        updateIsPlaying(false);
        stopSeekLoop();
      });
    },
    [stopSeekLoop, t, updateIsPlaying],
  );

  const startSeekLoop = useCallback(() => {
    stopSeekLoop();
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const playing = !audio.paused && !audio.ended;
        if (playing !== isPlayingRef.current) {
          isPlayingRef.current = playing;
          setIsPlaying(playing);
        }
        if (playing && !isScrubbingRef.current) {
          setAudioCurrentTime(audio.currentTime);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopSeekLoop]);

  useEffect(() => {
    setShowTimestamps(item.show_timestamps && canShowTimestamps);
  }, [item.show_timestamps, canShowTimestamps]);

  useEffect(() => {
    stopSeekLoop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    updateIsPlaying(false);
    updateIsScrubbing(false);
    setAudioReady(false);
    setAudioError(null);
    setAudioCurrentTime(0);
    setAudioDuration(item.duration_seconds || 0);
    scrubWasPlayingRef.current = false;
    scrubValueRef.current = null;

    const audio = new Audio(audioUrlFor(trackMutedRef.current));
    audio.preload = "auto";
    audio.defaultPlaybackRate = playbackRateRef.current;
    audio.playbackRate = playbackRateRef.current;

    const handleReady = () => {
      setAudioDuration(
        Number.isFinite(audio.duration)
          ? audio.duration
          : item.duration_seconds || 0,
      );
      setAudioReady(true);
    };
    const handleLoadError = () => {
      console.error("Audio load error:", audio.error);
      setAudioError(
        t({
          id: "library.modal.audio_unavailable",
          message: "Audio unavailable",
        }),
      );
      setAudioReady(false);
    };
    const handlePlay = () => {
      updateIsPlaying(true);
      startSeekLoop();
    };
    const handlePause = () => {
      updateIsPlaying(false);
      stopSeekLoop();
    };
    const handleEnded = () => {
      updateIsPlaying(false);
      stopSeekLoop();
      if (Number.isFinite(audio.duration)) {
        setAudioCurrentTime(audio.duration);
      }
    };
    const handleSeeked = () => {
      if (!isScrubbingRef.current) setAudioCurrentTime(audio.currentTime);
    };

    audio.addEventListener("canplay", handleReady);
    audio.addEventListener("error", handleLoadError);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("seeked", handleSeeked);
    audioRef.current = audio;
    audio.load();

    return () => {
      stopSeekLoop();
      audio.removeEventListener("canplay", handleReady);
      audio.removeEventListener("error", handleLoadError);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("seeked", handleSeeked);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [
    audioUrlFor,
    item.duration_seconds,
    startSeekLoop,
    stopSeekLoop,
    updateIsPlaying,
    updateIsScrubbing,
  ]);

  const handlePlaybackRateStep = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
      const safeIndex =
        currentIndex === -1 ? PLAYBACK_RATES.indexOf(1) : currentIndex;
      const nextIndex = Math.min(
        PLAYBACK_RATES.length - 1,
        Math.max(0, safeIndex + direction),
      );
      setPlaybackRateValue(PLAYBACK_RATES[nextIndex]);
    },
    [playbackRate, setPlaybackRateValue],
  );

  const handleRateScrubStart = useCallback(
    (
      event:
        React.MouseEvent<HTMLSpanElement> | React.TouchEvent<HTMLSpanElement>,
    ) => {
      const startIndex = PLAYBACK_RATES.indexOf(playbackRateRef.current);
      startDragStep(
        event,
        startIndex === -1 ? PLAYBACK_RATES.indexOf(1) : startIndex,
        PLAYBACK_RATES.length,
        (index) => setPlaybackRateValue(PLAYBACK_RATES[index]),
      );
    },
    [setPlaybackRateValue],
  );

  useEffect(() => {
    if (transcriptPending.current !== null || transcriptSaves.current > 0)
      return;
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
      const appended = nextTranscript
        .slice(previousTranscript.length)
        .replace(/^\n+/, "");
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

  const writeTranscript = useCallback(() => {
    const written = transcriptPending.current;
    if (written === null) return;
    transcriptPending.current = null;
    transcriptSent.current = written;
    transcriptSaves.current += 1;
    transcriptChain.current = transcriptChain.current
      .then(() =>
        onUpdateRef.current({ transcript: written, transcript_edited: true }),
      )
      .then(() => {
        transcriptSaveFailed.current = false;
      })
      .catch((err) => {
        console.error("failed to save transcript:", err);
        if (
          transcriptPending.current === null &&
          transcriptSent.current === written
        ) {
          transcriptPending.current = written;
        }
        if (transcriptSaveFailed.current) return;
        transcriptSaveFailed.current = true;
        showErrorToast(
          t({
            id: "library.detail.transcript.save_failed",
            message:
              "Couldn't save this transcript. Your changes are still here.",
          }),
        );
      })
      .finally(() => {
        transcriptSaves.current -= 1;
        if (transcriptSaves.current === 0) transcriptSent.current = null;
      });
  }, []);

  useEffect(() => {
    if (!transcriptEditable) {
      transcriptPending.current = null;
      return;
    }
    const stored =
      transcriptSaves.current > 0 && transcriptSent.current !== null
        ? transcriptSent.current
        : (item.transcript ?? "");
    if (transcriptDraft === stored) {
      transcriptPending.current = null;
      return;
    }
    transcriptPending.current = transcriptDraft;
    transcriptTimer.current = setTimeout(() => {
      transcriptTimer.current = null;
      writeTranscript();
    }, 600);
    return () => {
      if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
    };
  }, [transcriptDraft, transcriptEditable, item.transcript, writeTranscript]);

  useEffect(() => writeTranscript, [writeTranscript]);
  useClickOutside(overflowMenuRef, () => setOverflowOpen(false), overflowOpen);
  useClickOutside(
    playbackMenuRef,
    () => setPlaybackMenuOpen(false),
    playbackMenuOpen,
  );
  useClickOutside(
    speakerMenuRef,
    () => setSpeakerMenuSegment(null),
    speakerMenuSegment !== null,
  );
  useClickOutside(
    speakersMenuRef,
    () => {
      setSpeakersMenuOpen(false);
      setRenamingSpeakerId(null);
      setSpeakerNameDraft("");
    },
    speakersMenuOpen && !speakerContext,
  );
  useMenuKeyboard(overflowMenuPanelRef, overflowOpen, () =>
    setOverflowOpen(false),
  );
  useMenuKeyboard(playbackMenuPanelRef, playbackMenuOpen, () =>
    setPlaybackMenuOpen(false),
  );
  useMenuKeyboard(speakerMenuRef, speakerMenuSegment !== null, () =>
    setSpeakerMenuSegment(null),
  );
  useMenuKeyboard(
    speakersMenuPanelRef,
    speakersMenuOpen && !speakerContext,
    () => {
      setSpeakersMenuOpen(false);
      setRenamingSpeakerId(null);
      setSpeakerNameDraft("");
    },
  );

  // Returns false after telling the user the save failed.
  const saveOrToast = async (patch: LibraryItemPatch, failure: string) => {
    try {
      await onUpdate(patch);
      return true;
    } catch (err) {
      console.error("failed to save library item:", err);
      showErrorToast(failure);
      return false;
    }
  };
  const retryFailedMessage = t({
    id: "library.detail.retry_failed",
    message: "Couldn't start the transcription again.",
  });
  const speakersFailedMessage = t({
    id: "library.detail.speakers_failed",
    message: "Couldn't save the speakers.",
  });
  const bookmarksFailedMessage = t({
    id: "library.detail.bookmarks_failed",
    message: "Couldn't save the bookmark.",
  });

  const handleNameCommit = async () => {
    // Escape already closed the editor; a trailing blur shouldn't save.
    if (nameEditCancelled.current) {
      nameEditCancelled.current = false;
      return;
    }
    const value = nameDraft.trim();
    if (value && value !== item.name) {
      const saved = await saveOrToast(
        { name: value },
        t({
          id: "library.detail.rename_failed",
          message: "Couldn't rename this item.",
        }),
      );
      // Keeps the typed name so it can be saved again.
      if (!saved) return;
    }
    setIsEditingName(false);
  };

  const cancelNameEdit = () => {
    nameEditCancelled.current = true;
    setIsEditingName(false);
  };

  const currentFolder = item.folder ?? null;
  const moveToFolder = onMove;

  const handleAddSpeaker = async () => {
    if (!canAddSpeaker) return null;
    const nextIndex = speakers.length + 1;
    const speaker: Speaker = {
      id: crypto.randomUUID(),
      name: t({
        id: "library.detail.speaker_default_name",
        message: `Speaker ${nextIndex}`,
      }),
      color: SPEAKER_COLORS[speakers.length % SPEAKER_COLORS.length],
    };
    const saved = await saveOrToast(
      { speakers: [...speakers, speaker] },
      speakersFailedMessage,
    );
    return saved ? speaker : null;
  };

  const handleUpdateSpeaker = async (
    speakerId: string,
    changes: Partial<Omit<Speaker, "id">>,
  ) => {
    const next = speakers.map((speaker) =>
      speaker.id === speakerId ? { ...speaker, ...changes } : speaker,
    );
    await saveOrToast({ speakers: next }, speakersFailedMessage);
  };

  const handleRenameSpeaker = async (speakerId: string) => {
    const value = speakerNameDraft.trim();
    setRenamingSpeakerId(null);
    setSpeakerNameDraft("");
    if (!value) return;
    await handleUpdateSpeaker(speakerId, { name: value });
  };

  const handleMergeSpeaker = async (fromId: string, intoId: string) => {
    setHiddenSpeakerIds((ids) => ids.filter((id) => id !== fromId));
    const patch: LibraryItemPatch = {
      speakers: speakers.filter((entry) => entry.id !== fromId),
    };
    if (item.segments?.some((segment) => segment.speaker_id === fromId)) {
      patch.segments = item.segments.map((segment) =>
        segment.speaker_id === fromId
          ? { ...segment, speaker_id: intoId }
          : segment,
      );
    }
    await saveOrToast(patch, speakersFailedMessage);
  };

  const openSpeakerContext = (
    speakerId: string,
    event: React.MouseEvent,
    segmentIndex?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSpeakerMenuSegment(null);
    setRenamingSpeakerId(null);
    setSpeakerContext({
      speakerId,
      segmentIndex,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const closeSpeakerContext = useCallback(() => setSpeakerContext(null), []);

  const handleRemoveSpeaker = async (speakerId: string) => {
    setHiddenSpeakerIds((ids) => ids.filter((id) => id !== speakerId));
    const nextSpeakers = speakers.filter((entry) => entry.id !== speakerId);
    const patch: LibraryItemPatch = { speakers: nextSpeakers };
    if (item.segments?.some((segment) => segment.speaker_id === speakerId)) {
      patch.segments = item.segments.map((segment) =>
        segment.speaker_id === speakerId
          ? { ...segment, speaker_id: null }
          : segment,
      );
    }
    await saveOrToast(patch, speakersFailedMessage);
  };

  const handleAssignSpeaker = async (
    segmentIndex: number,
    speakerId: string | null,
  ) => {
    setSpeakerMenuSegment(null);
    const segments = item.segments ?? [];
    if (!segments[segmentIndex]) return;
    const next = segments.map((segment, idx) =>
      idx === segmentIndex ? { ...segment, speaker_id: speakerId } : segment,
    );
    await saveOrToast({ segments: next }, speakersFailedMessage);
  };

  const speakerById = useMemo(() => {
    const map = new Map<string, Speaker>();
    for (const speaker of speakers) map.set(speaker.id, speaker);
    return map;
  }, [speakers]);
  const hiddenSpeakers = useMemo(
    () => new Set(hiddenSpeakerIds.filter((id) => speakerById.has(id))),
    [hiddenSpeakerIds, speakerById],
  );
  const toggleSpeakerHidden = (speakerId: string) =>
    setHiddenSpeakerIds((ids) =>
      ids.includes(speakerId)
        ? ids.filter((id) => id !== speakerId)
        : [...ids, speakerId],
    );
  const contextSpeaker = speakerContext
    ? (speakerById.get(speakerContext.speakerId) ?? null)
    : null;
  const lineIndex = speakerContext?.segmentIndex;

  const visibleSegments = useMemo(() => {
    const entries = (item.segments ?? []).map((segment, index) => ({
      segment,
      index,
    }));
    if (hiddenSpeakers.size === 0) return entries;
    return entries.filter(
      (entry) =>
        !entry.segment.speaker_id ||
        !hiddenSpeakers.has(entry.segment.speaker_id),
    );
  }, [item.segments, hiddenSpeakers]);

  const speakerTurns = useMemo(
    () => buildSpeakerTurns(item.segments ?? [], speakerById),
    [item.segments, speakerById],
  );
  const speakersUsed = useMemo(
    () =>
      new Set(speakerTurns.map((turn) => turn.speaker).filter(Boolean)).size,
    [speakerTurns],
  );
  // Edits and AI cleanup change the transcript but not the segments, so those items keep the text box.
  const transcriptEdited = item.transcript_edited || item.llm_cleanup_enabled;
  const visibleTurns = useMemo(
    () =>
      hiddenSpeakers.size > 0
        ? speakerTurns.filter(
            (turn) => !turn.speaker || !hiddenSpeakers.has(turn.speaker.id),
          )
        : speakerTurns,
    [speakerTurns, hiddenSpeakers],
  );

  // Each bookmark sits under the segment that was playing when it was set.
  const bookmarksBySegment = useMemo(() => {
    const map = new Map<number, Bookmark[]>();
    const segments = item.segments ?? [];
    if (!segments.length) return map;
    for (const bookmark of bookmarks) {
      // -1: set before the first sentence started, shown above it.
      let index = -1;
      for (let i = 0; i < segments.length; i += 1) {
        if (segments[i].start_ms <= bookmark.at_ms) index = i;
        else break;
      }
      const list = map.get(index) ?? [];
      list.push(bookmark);
      map.set(index, list);
    }
    return map;
  }, [bookmarks, item.segments]);

  const renderBookmarkRow = (bookmark: Bookmark) => (
    <BookmarkRow
      key={bookmark.id}
      bookmark={bookmark}
      timeWidth={timestampWidth}
      onSeek={() => handleTimestampClick(bookmark.at_ms)}
      onRename={(label) => void handleRenameBookmark(bookmark.id, label)}
      onRemove={() => void handleRemoveBookmark(bookmark.id)}
    />
  );

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    try {
      const ext = format;
      const safeName =
        sanitizeFileName(item.name || "transcript") || "transcript";
      const suggested = `${safeName}.${ext}`;
      const outputPath = await save({
        title: t({
          id: "library.modal.export.title",
          message: "Export transcription",
        }),
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
      let toastMessage = t({
        id: "library.modal.export.failed",
        message: "Export failed. Try again.",
      });
      if (lower.includes("no timestamp segments")) {
        toastMessage = t({
          id: "library.modal.export.no_timestamps",
          message:
            "This item doesn't have timestamps. Retranscribe with timestamps to export subtitles.",
        });
      } else if (lower.includes("failed to write export file")) {
        toastMessage = t({
          id: "library.modal.export.write_failed",
          message: "Couldn't write the export file. Try a different location.",
        });
      } else if (lower.includes("library item not found")) {
        toastMessage = t({
          id: "library.modal.export.item_not_found",
          message: "Couldn't find this library item. Try reopening it.",
        });
      }
      showErrorToast(toastMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const handleToggleTimestamps = () => {
    if (!canShowTimestamps) return;
    const nextValue = !showTimestamps;
    setShowTimestamps(nextValue);
    void saveOrToast(
      { show_timestamps: nextValue },
      t({
        id: "toast.action_failed",
        message: "That didn't work. Try again.",
      }),
    ).then((saved) => {
      if (!saved) setShowTimestamps(!nextValue);
    });
  };

  const { copy: copyTranscript } = useCopyToClipboard();
  const copyText = () =>
    showSpeakerText
      ? visibleTurns
          .map((turn) =>
            turn.speaker && !turn.continues
              ? `${turn.speaker.name}: ${turn.text}`
              : turn.text,
          )
          .join("\n\n")
      : transcriptDraft;

  const handleTogglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioError || !audioReady) return;
    if (!audio.paused) {
      audio.pause();
    } else {
      setFollowPaused(false);
      playAudio(audio);
    }
  }, [audioError, audioReady, playAudio]);

  // Dragging near a bookmark lands on it.
  const snappedAtRef = useRef<number | null | undefined>(undefined);
  const snapToBookmark = (time: number) => {
    const window = Math.max(0.35, audioDuration * 0.012);
    let best: number | null = null;
    for (const bookmark of bookmarks) {
      const at = bookmark.at_ms / 1000;
      if (
        Math.abs(at - time) <= window &&
        (best === null || Math.abs(at - time) < Math.abs(best - time))
      ) {
        best = at;
      }
    }
    return best ?? time;
  };

  const handleScrubChange = (nextValue: string) => {
    const audio = audioRef.current;
    if (!audio || audioError || !audioReady) return;
    const raw = Number(nextValue);
    if (!Number.isFinite(raw)) return;
    const scrubbing = isScrubbingRef.current;
    const nextTime = scrubbing ? snapToBookmark(raw) : raw;
    scrubValueRef.current = nextTime;
    if (scrubbing) {
      // A tap when the thumb catches a bookmark, not on the press that starts the drag.
      const caught = nextTime !== raw ? nextTime : null;
      if (
        snappedAtRef.current !== undefined &&
        caught !== null &&
        caught !== snappedAtRef.current
      ) {
        hapticTick();
      }
      snappedAtRef.current = caught;
      setAudioCurrentTime(nextTime);
      audio.currentTime = nextTime;
      return;
    }
    audio.currentTime = nextTime;
    setAudioCurrentTime(nextTime);
  };

  const handleScrubStart = () => {
    const audio = audioRef.current;
    if (!audio || audioError || !audioReady) return;
    snappedAtRef.current = undefined;
    scrubWasPlayingRef.current = !audio.paused;
    updateIsScrubbing(true);
    audio.pause();
  };

  const handleScrubEnd = () => {
    const audio = audioRef.current;
    if (!audio || audioError || !audioReady) return;
    updateIsScrubbing(false);
    setFollowPaused(false);
    if (
      typeof scrubValueRef.current === "number" &&
      Number.isFinite(scrubValueRef.current)
    ) {
      audio.currentTime = scrubValueRef.current;
      setAudioCurrentTime(scrubValueRef.current);
    }
    scrubValueRef.current = null;
    if (scrubWasPlayingRef.current) {
      playAudio(audio);
    }
    scrubWasPlayingRef.current = false;
  };

  const handleToggleTrackMute = (track: "primary" | "secondary") => {
    const next = { ...trackMuted, [track]: !trackMuted[track] };
    setTrackMuted(next);
    const audio = audioRef.current;
    if (!audio) return;
    // The new mix reloads the stream at the same position.
    const time = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.src = audioUrlFor(next);
    audio.currentTime = time;
    if (wasPlaying) playAudio(audio);
  };

  const handleRenameBookmark = async (id: string, label: string) => {
    await saveOrToast(
      {
        bookmarks: bookmarks.map((bookmark) =>
          bookmark.id === id ? { ...bookmark, label: label || null } : bookmark,
        ),
      },
      bookmarksFailedMessage,
    );
  };

  const handleRemoveBookmark = async (id: string) => {
    await saveOrToast(
      { bookmarks: bookmarks.filter((bookmark) => bookmark.id !== id) },
      bookmarksFailedMessage,
    );
  };

  const handleTimestampClick = (startMs: number) => {
    const audio = audioRef.current;
    if (!audio || audioError || !audioReady) return;
    const nextTime = Math.max(0, startMs / 1000);
    audio.currentTime = nextTime;
    setAudioCurrentTime(nextTime);
    setFollowPaused(false);
    if (audio.paused) {
      playAudio(audio);
    }
  };
  const timestampWidth = audioDuration >= 3600 ? "w-14" : "w-10";
  const minPlaybackRate = PLAYBACK_RATES[0];
  const maxPlaybackRate = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
  const canDecreasePlaybackRate = playbackRate > minPlaybackRate;
  const canIncreasePlaybackRate = playbackRate < maxPlaybackRate;
  const showStreaming = item.status.type === "transcribing" && !showTimestamps;
  const showSegmentView = showTimestamps && canShowTimestamps;
  // Read-only script of speaker turns, in place of the editable textarea.
  const showSpeakerText =
    !showSegmentView &&
    item.status.type === "complete" &&
    speakersUsed >= 2 &&
    !transcriptEdited;
  const transcribingPlaceholder = showStreaming && streamChunks.length === 0;
  const detectingSpeakers =
    rediarizing ||
    (item.status.type === "transcribing" && !!item.status.detecting_speakers);
  // The placeholder shows progress itself until text arrives.
  const transcriptStatus = transcribingPlaceholder
    ? null
    : rediarizing
      ? detectingSpeakersLabel
      : transcribingLabel;
  // The transcript follows playback until the reader scrolls it themselves.
  const followTimestampsActive =
    followPlayback && showSegmentView && isPlaying && !followPaused;
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

  const itemWords = item.words ?? null;

  // Whisper word and segment clocks overlap and backtrack, so words are
  // assigned to rows by sequential text alignment, not by time. Rows that
  // fail to align (chunk seams, edited text) get null and fall back.
  const segmentWordStarts = useMemo(() => {
    const segments = item.segments ?? [];
    if (!itemWords?.length || !segments.length) return null;
    const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");
    const SCAN_AHEAD = 24;
    const starts: (number | null)[] = [];
    let pointer = 0;
    for (const segment of segments) {
      const tokenCount = segment.text
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const target = normalize(segment.text);
      let matched: number | null = null;
      for (let offset = 0; tokenCount > 0 && offset < SCAN_AHEAD; offset += 1) {
        const start = pointer + offset;
        if (start + tokenCount > itemWords.length) break;
        let joined = "";
        for (let i = start; i < start + tokenCount; i += 1) {
          joined += itemWords[i].text;
        }
        if (normalize(joined) === target) {
          matched = start;
          pointer = start + tokenCount;
          break;
        }
      }
      starts.push(matched);
    }
    return starts;
  }, [item.segments, itemWords]);

  const activeWordIndex = useMemo(() => {
    if (!showSegmentView || !itemWords?.length || activeSegmentIndex < 0) {
      return -1;
    }
    const wordStart = segmentWordStarts?.[activeSegmentIndex];
    const segment = (item.segments ?? [])[activeSegmentIndex];
    if (wordStart == null || !segment) return -1;
    const count = segment.text.trim().split(/\s+/).filter(Boolean).length;
    const targetMs = Math.max(0, Math.round(audioCurrentTime * 1000));
    let match = -1;
    const limit = Math.min(wordStart + count, itemWords.length);
    for (let i = wordStart; i < limit; i += 1) {
      if (itemWords[i].start_ms <= targetMs) match = i;
    }
    return match;
  }, [
    audioCurrentTime,
    showSegmentView,
    itemWords,
    activeSegmentIndex,
    segmentWordStarts,
    item.segments,
  ]);

  const renderSegmentWords = (
    segment: TranscriptSegment,
    segmentIndex: number,
  ) => {
    const wordStart = segmentWordStarts?.[segmentIndex];
    if (wordStart == null) return null;
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    const activePosition =
      activeWordIndex >= wordStart &&
      activeWordIndex < wordStart + tokens.length
        ? activeWordIndex - wordStart
        : -1;
    return <SegmentWordsRow tokens={tokens} activePosition={activePosition} />;
  };

  const segmentMatchIndexes = useMemo(() => {
    if (!normalizedSearchQuery || !showSegmentView) return [];
    return findRowMatches(
      visibleSegments.map((entry) => entry.segment.text),
      normalizedSearchQuery,
    );
  }, [normalizedSearchQuery, visibleSegments, showSegmentView]);

  const turnMatchIndexes = useMemo(() => {
    if (!normalizedSearchQuery || !showSpeakerText) return [];
    return findRowMatches(
      visibleTurns.map((turn) => turn.text),
      normalizedSearchQuery,
    );
  }, [normalizedSearchQuery, visibleTurns, showSpeakerText]);

  const streamMatchIndexes = useMemo(() => {
    if (!normalizedSearchQuery || !showStreaming) return [];
    return findRowMatches(streamChunks, normalizedSearchQuery);
  }, [normalizedSearchQuery, showStreaming, streamChunks]);

  const textMatchIndexes = useMemo(() => {
    if (
      !normalizedSearchQuery ||
      showSegmentView ||
      showSpeakerText ||
      showStreaming
    ) {
      return [];
    }
    const query = normalizedSearchQuery.toLowerCase();
    const text = transcriptDraft.toLowerCase();
    const matches: number[] = [];
    let cursor = text.indexOf(query);
    while (cursor !== -1) {
      matches.push(cursor);
      cursor = text.indexOf(query, cursor + query.length);
    }
    return matches;
  }, [
    normalizedSearchQuery,
    showSegmentView,
    showSpeakerText,
    showStreaming,
    transcriptDraft,
  ]);

  const searchMatchLabel = useMemo(() => {
    if (!normalizedSearchQuery) return null;
    const indexed = (matches: unknown[]) =>
      `${matches.length ? Math.min(activeSearchIndex, matches.length - 1) + 1 : 0}/${matches.length}`;
    if (showSegmentView) return indexed(segmentMatchIndexes);
    if (showSpeakerText) return indexed(turnMatchIndexes);
    if (showStreaming) return indexed(streamMatchIndexes);
    return indexed(textMatchIndexes);
  }, [
    normalizedSearchQuery,
    showSegmentView,
    showSpeakerText,
    showStreaming,
    segmentMatchIndexes,
    turnMatchIndexes,
    streamMatchIndexes,
    textMatchIndexes,
    activeSearchIndex,
  ]);

  const pickActiveMatch = (matches: RowMatch[]) =>
    matches.length
      ? matches[Math.min(activeSearchIndex, matches.length - 1)]
      : null;
  const activeSegmentMatch = pickActiveMatch(segmentMatchIndexes);
  const activeTurnMatch = pickActiveMatch(turnMatchIndexes);
  const activeStreamMatch = pickActiveMatch(streamMatchIndexes);
  const activeOccurrence = (match: RowMatch | null, row: number) =>
    match?.row === row ? match.occurrence : -1;

  const renderHighlightedText = useCallback(
    (text: string, activeHit: number) => {
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
            className={`transcript-search-hit${matchCount === activeHit ? " transcript-search-hit-active" : ""}`}
          >
            {matchText}
          </mark>,
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
    [normalizedSearchQuery],
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setActiveSearchIndex(0);
  };

  const handleSearchNavigate = useCallback(
    (direction: number) => {
      const count = showSegmentView
        ? segmentMatchIndexes.length
        : showSpeakerText
          ? turnMatchIndexes.length
          : showStreaming
            ? streamMatchIndexes.length
            : textMatchIndexes.length;
      if (count === 0) return;
      setActiveSearchIndex((prev) => (prev + direction + count) % count);
    },
    [
      showSegmentView,
      showSpeakerText,
      showStreaming,
      segmentMatchIndexes,
      turnMatchIndexes,
      streamMatchIndexes,
      textMatchIndexes,
    ],
  );

  const handleTimestampStep = useCallback(
    (direction: number) => {
      if (!showSegmentView || visibleSegments.length === 0) return;
      const currentPos = visibleSegments.findIndex(
        (entry) => entry.index === activeSegmentIndex,
      );
      let nextPos;
      if (currentPos < 0) {
        nextPos = direction > 0 ? 0 : visibleSegments.length - 1;
      } else {
        nextPos = Math.max(
          0,
          Math.min(visibleSegments.length - 1, currentPos + direction),
        );
      }
      if (nextPos === currentPos) return;
      handleTimestampClick(visibleSegments[nextPos].segment.start_ms);
    },
    [
      activeSegmentIndex,
      visibleSegments,
      showSegmentView,
      handleTimestampClick,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isTextInput =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      const isInteractiveElement =
        isTextInput ||
        tag === "button" ||
        tag === "a" ||
        tag === "select" ||
        (tag === "input" &&
          (target?.getAttribute("type") === "checkbox" ||
            target?.getAttribute("type") === "radio")) ||
        target?.getAttribute("role") === "button" ||
        target?.getAttribute("role") === "link" ||
        target?.getAttribute("role") === "menuitem";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        // A segment's speaker menu unmounts, still open, when its row scrolls
        // out of the list.
        if (speakerMenuSegment !== null) {
          setSpeakerMenuSegment(null);
        } else {
          onClose();
        }
        return;
      }

      if (event.key === " ") {
        if (isInteractiveElement) return;
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
  }, [
    handleTimestampStep,
    handleTogglePlayback,
    onClose,
    speakerMenuSegment,
    showSegmentView,
  ]);

  useEffect(() => {
    if (!normalizedSearchQuery) return;
    if (showSegmentView) {
      if (!activeSegmentMatch) return;
      segmentsVirtuosoRef.current?.scrollToIndex({
        index: activeSegmentMatch.row,
        align: "center",
        behavior: "smooth",
      });
      return;
    }
    if (showSpeakerText) {
      if (!activeTurnMatch) return;
      turnsVirtuosoRef.current?.scrollToIndex({
        index: activeTurnMatch.row,
        align: "center",
        behavior: "smooth",
      });
      return;
    }
    if (showStreaming) {
      if (!activeStreamMatch) return;
      streamVirtuosoRef.current?.scrollToIndex({
        index: activeStreamMatch.row,
        align: "center",
        behavior: "smooth",
      });
      return;
    }
    const scroller = transcriptScrollRef.current;
    const activeHit =
      transcriptHighlightsRef.current?.querySelector<HTMLElement>(
        "[data-active]",
      );
    if (!scroller || !activeHit) return;
    // Editing the transcript re-runs this; don't yank the view while typing there.
    if (document.activeElement === transcriptAreaRef.current) return;
    scroller.scrollTo({
      top: activeHit.offsetTop - scroller.clientHeight / 2,
      behavior: "smooth",
    });
  }, [
    normalizedSearchQuery,
    showSegmentView,
    showSpeakerText,
    showStreaming,
    activeSegmentMatch,
    activeTurnMatch,
    activeStreamMatch,
    activeSearchIndex,
    textMatchIndexes,
  ]);

  const stopFollowScroll = useCallback(() => {
    if (followScrollRafRef.current !== null) {
      cancelAnimationFrame(followScrollRafRef.current);
      followScrollRafRef.current = null;
    }
  }, []);

  const animateFollowScroll = useCallback(
    (target: number) => {
      const scroller = segmentsScrollerRef.current;
      if (!scroller) return;
      stopFollowScroll();
      const start = scroller.scrollTop;
      const delta = target - start;
      if (Math.abs(delta) < 1) return;
      // Distance-based duration so short hops glide and long jumps stay quick.
      const duration = Math.min(900, Math.max(450, Math.abs(delta) * 6));
      const startedAt = performance.now();
      const ease = (p: number) =>
        p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        scroller.scrollTop = start + delta * ease(progress);
        followScrollRafRef.current =
          progress < 1 ? requestAnimationFrame(tick) : null;
      };
      followScrollRafRef.current = requestAnimationFrame(tick);
    },
    [stopFollowScroll],
  );

  useEffect(() => {
    if (!followTimestampsActive || activeSegmentIndex < 0) return;
    const visiblePos = visibleSegments.findIndex(
      (entry) => entry.index === activeSegmentIndex,
    );
    if (visiblePos < 0) return;
    const scroller = segmentsScrollerRef.current;
    const row = scroller?.querySelector<HTMLElement>(
      `[data-index="${visiblePos}"]`,
    );
    if (!scroller || !row) {
      segmentsVirtuosoRef.current?.scrollToIndex({
        index: visiblePos,
        align: "center",
        behavior: "smooth",
      });
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const target =
      scroller.scrollTop +
      (rowRect.top - scrollerRect.top) -
      (scroller.clientHeight - rowRect.height) / 2;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    animateFollowScroll(Math.min(maxScroll, Math.max(0, target)));
  }, [
    activeSegmentIndex,
    followTimestampsActive,
    visibleSegments,
    animateFollowScroll,
  ]);

  useEffect(() => {
    const scroller = segmentsScrollerRef.current;
    if (!scroller) return;
    const cancel = () => stopFollowScroll();
    scroller.addEventListener("wheel", cancel, { passive: true });
    scroller.addEventListener("touchmove", cancel, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", cancel);
      scroller.removeEventListener("touchmove", cancel);
      stopFollowScroll();
    };
  }, [showSegmentView, stopFollowScroll]);

  const renderSpeakerChip = (segment: TranscriptSegment, idx: number) => {
    const speaker = segment.speaker_id
      ? speakerById.get(segment.speaker_id)
      : null;
    const menuOpen = speakerMenuSegment === idx;
    return (
      <div className="relative max-w-full">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setSpeakerMenuSegment(menuOpen ? null : idx);
          }}
          onContextMenu={
            speaker
              ? (event) => openSpeakerContext(speaker.id, event, idx)
              : undefined
          }
          title={
            speaker
              ? speaker.name
              : t({
                  id: "library.detail.speaker.unassigned",
                  message: "Assign",
                })
          }
          aria-label={
            speaker
              ? speaker.name
              : t({
                  id: "library.detail.speaker.unassigned",
                  message: "Assign",
                })
          }
          className={`flex items-center justify-center p-1 -m-1 transition-opacity hover:opacity-80 ${
            speaker
              ? ""
              : menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/seg:opacity-60 focus:opacity-60"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
              speaker ? "" : "border border-[var(--color-text-muted)]"
            }`}
            style={{
              backgroundColor: speaker?.color ?? "transparent",
            }}
            aria-hidden="true"
          />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={speakerMenuRef}
              role="menu"
              initial={{ opacity: 0, scale: 0.98, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full mt-1 z-[120] w-36 rounded-md border border-border-secondary/80 bg-surface-overlay shadow-lg shadow-black/40 overflow-hidden"
            >
              {speakers.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAssignSpeaker(idx, entry.id);
                  }}
                  className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 ui-text-meta font-medium text-content-secondary hover:bg-surface-elevated/70 hover:text-content-primary transition-colors"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.color ?? undefined }}
                    aria-hidden="true"
                  />
                  {entry.name}
                </button>
              ))}
              {segment.speaker_id && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAssignSpeaker(idx, null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 ui-text-meta text-content-muted hover:bg-surface-elevated/70 hover:text-content-primary transition-colors border-t border-border-primary"
                >
                  {t({
                    id: "library.detail.speaker.clear",
                    message: "Clear speaker",
                  })}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={async (event) => {
                  event.stopPropagation();
                  const created = await handleAddSpeaker();
                  if (created) await handleAssignSpeaker(idx, created.id);
                }}
                disabled={!canAddSpeaker}
                className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 ui-text-meta text-content-muted hover:bg-surface-elevated/70 hover:text-content-primary transition-colors border-t border-border-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content-muted"
              >
                <UserPlus size={11} />
                {t({
                  id: "library.detail.assign_new_speaker",
                  message: "Assign new speaker",
                })}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <header className="mx-auto mb-3 w-full max-w-column-wide shrink-0">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex h-8 items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <nav className="flex shrink-0 items-center gap-2 ui-text-screen-title tracking-tight text-content-muted">
                  <button
                    type="button"
                    onClick={onClose}
                    className="transition-colors hover:text-content-primary"
                  >
                    {t({ id: "library.view.title", message: "Library" })}
                  </button>
                  <ChevronRight size={14} aria-hidden="true" />
                  {currentFolder && (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenFolder(currentFolder)}
                        className="max-w-48 truncate transition-colors hover:text-content-primary"
                      >
                        {currentFolder}
                      </button>
                      <ChevronRight size={14} aria-hidden="true" />
                    </>
                  )}
                </nav>

                {isEditingName ? (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onBlur={handleNameCommit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleNameCommit();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelNameEdit();
                        }
                      }}
                      aria-label={t({
                        id: "library.detail.rename",
                        message: "Rename",
                      })}
                      className="min-w-0 flex-1 max-w-md bg-transparent border-b border-[var(--color-border-primary)] p-0 ui-text-screen-title tracking-tight text-content-primary focus:border-[var(--color-border-hover)] outline-hidden"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleNameCommit}
                      aria-label={t({
                        id: "library.detail.rename_save",
                        message: "Save name",
                      })}
                      className="text-content-muted hover:text-content-primary"
                    >
                      <Check size={12} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 group">
                    <h2 className="ui-text-screen-title tracking-tight text-content-primary truncate">
                      {libraryItemTitle(item, true)}
                    </h2>
                    <button
                      onClick={() => {
                        nameEditCancelled.current = false;
                        setNameDraft(item.name);
                        setIsEditingName(true);
                      }}
                      aria-label={t({
                        id: "library.detail.rename",
                        message: "Rename",
                      })}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-content-muted hover:text-content-primary transition-opacity shrink-0"
                    >
                      <Pencil size={11} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <SearchField
                  inputRef={searchInputRef}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSearchNavigate(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder={t({
                    id: "library.modal.search.placeholder",
                    message: "Search transcript...",
                  })}
                  trailing={
                    searchMatchLabel !== null && (
                      <span className="shrink-0 whitespace-nowrap ui-text-micro tabular-nums text-content-disabled">
                        {searchMatchLabel}
                      </span>
                    )
                  }
                />

                <div className="relative" ref={overflowMenuRef}>
                  <button
                    type="button"
                    onClick={() => setOverflowOpen((prev) => !prev)}
                    aria-haspopup="menu"
                    aria-expanded={overflowOpen}
                    className={`ui-button-ghost h-8 w-8 ${overflowOpen ? "text-content-primary" : ""}`}
                    aria-label={t({
                      id: "library.detail.more_actions",
                      message: "More actions",
                    })}
                  >
                    <DotsThree size={16} weight="bold" aria-hidden="true" />
                  </button>
                  <AnimatePresence>
                    {overflowOpen && (
                      <motion.div
                        ref={overflowMenuPanelRef}
                        role="menu"
                        initial={{ opacity: 0, scale: 0.98, y: -2 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -2 }}
                        transition={{ duration: 0.12 }}
                        className="ui-surface-menu absolute right-0 top-full z-[120] mt-1.5 max-h-[min(480px,70vh)] w-56 overflow-y-auto py-1 custom-scrollbar"
                      >
                        <div className="px-3 pb-1.5 pt-1 ui-text-label ui-color-muted">
                          {infoLine}
                        </div>
                        <div className="mx-3 my-1 border-t border-border-secondary" />
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!showSpeakerText && !transcriptDraft.trim()}
                          onClick={() => {
                            setOverflowOpen(false);
                            void copyTranscript(copyText());
                          }}
                          className={menuRowClass}
                        >
                          {t({
                            id: "library.detail.copy_transcript",
                            message: "Copy Transcript",
                          })}
                        </button>

                        <MenuSection
                          title={t({
                            id: "library.modal.export",
                            message: "Export",
                          })}
                        />
                        {EXPORT_FORMATS.map((format) => (
                          <button
                            key={format.value}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              void handleExport(format.value);
                            }}
                            disabled={
                              isExporting ||
                              !transcriptAvailable ||
                              (format.needsSegments &&
                                !(item.segments && item.segments.length))
                            }
                            className={menuRowClass}
                          >
                            {format.value.toUpperCase()}
                          </button>
                        ))}

                        <MenuSection
                          title={t({
                            id: "library.folder.label",
                            message: "Folder",
                          })}
                        />
                        {folders.map((folder) => (
                          <button
                            key={folder}
                            type="button"
                            role="menuitemradio"
                            aria-checked={folder === currentFolder}
                            disabled={isBusy}
                            onClick={() => {
                              setOverflowOpen(false);
                              if (folder !== currentFolder)
                                moveToFolder(folder);
                            }}
                            className={
                              folder === currentFolder
                                ? `${menuRowBase} ui-color-cloud`
                                : menuRowClass
                            }
                          >
                            <span className="min-w-0 truncate">{folder}</span>
                            <span className="flex w-3 shrink-0 items-center justify-center">
                              {folder === currentFolder && (
                                <Check size={12} aria-hidden="true" />
                              )}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOverflowOpen(false);
                            onNewFolder();
                          }}
                          className={menuRowClass}
                        >
                          {t({
                            id: "library.folder.new",
                            message: "New Folder...",
                          })}
                        </button>
                        {currentFolder && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              moveToFolder(null);
                            }}
                            className={menuRowClass}
                          >
                            {t({
                              id: "library.folder.remove_item",
                              message: "Remove from Folder",
                            })}
                          </button>
                        )}

                        <div className="mx-3 my-1 border-t border-border-secondary" />
                        {item.status.type === "error" ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              Promise.resolve(onRetry()).catch((err) => {
                                console.error("failed to retry:", err);
                                showErrorToast(retryFailedMessage);
                              });
                            }}
                            className={menuRowClass}
                          >
                            {t({ id: "library.modal.retry", message: "Retry" })}
                          </button>
                        ) : isBusy ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              onCancel();
                            }}
                            className={menuRowClass}
                          >
                            {t({
                              id: "library.modal.cancel",
                              message: "Cancel",
                            })}
                          </button>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              setShowRetranscribe(true);
                            }}
                            className={menuRowClass}
                          >
                            {t({
                              id: "library.modal.retranscribe",
                              message: "Retranscribe",
                            })}
                          </button>
                        )}
                        {diarizerInstalled &&
                          item.status.type === "complete" && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOverflowOpen(false);
                                void onRediarize();
                              }}
                              disabled={rediarizing}
                              className={menuRowClass}
                            >
                              {t({
                                id: "library.modal.detect_speakers_again",
                                message: "Detect speakers again",
                              })}
                            </button>
                          )}
                        <div className="mx-3 my-1 border-t border-border-secondary" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOverflowOpen(false);
                            setShowDeleteConfirm(true);
                          }}
                          className={`${menuRowBase} ui-color-error-strong`}
                        >
                          {t({ id: "library.modal.delete", message: "Delete" })}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
        <ScreenHeaderRule />
      </header>

      {/* The header stays put while the content fades in under it. */}
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        <main className="flex-1 min-h-0 overflow-hidden">
          {item.status.type === "error" ? (
            <div className="flex h-full items-center justify-center">
              {(() => {
                const details = getLibraryErrorDetails(item.status.message);
                return (
                  <div className="max-w-[280px] rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2 ui-color-error-tint">
                      <AlertTriangle size={14} />
                      <span className="ui-text-label font-medium">
                        {item.kind === "import"
                          ? t({
                              id: "library.modal.import_failed",
                              message: "Import failed",
                            })
                          : t({
                              id: "library.modal.transcription_failed",
                              message: "Transcription failed",
                            })}
                      </span>
                    </div>
                    <p className="mt-2 ui-text-meta leading-[14px] ui-color-error-tint select-text cursor-text">
                      {details.message}
                    </p>
                    {details.showFfmpegHelp && (
                      <button
                        type="button"
                        onClick={() =>
                          invoke("open_ffmpeg_install").catch(() => {})
                        }
                        className="mt-2 ui-text-meta ui-color-error-faint underline decoration-red-400/60 ui-hover-error-50"
                      >
                        {t({
                          id: "library.modal.ffmpeg_help",
                          message: "FFmpeg Help",
                        })}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="relative flex h-full w-full flex-col">
              <div
                className="pointer-events-none absolute left-0 right-3 bottom-0 h-10 z-10"
                style={{
                  background:
                    "linear-gradient(to top, var(--color-bg-tertiary), transparent)",
                }}
                aria-hidden="true"
              />
              <div
                aria-live="polite"
                className={`pointer-events-none absolute inset-x-0 bottom-1 z-10 h-4 truncate text-center ui-text-meta tabular-nums ${
                  detectingSpeakers ? "text-local" : "text-content-disabled"
                }`}
              >
                {transcriptStatus}
              </div>
              {!showSegmentView && bookmarks.length > 0 && (
                <div
                  className={`${CONTENT_COLUMN} max-h-[152px] shrink-0 overflow-y-auto pt-2 pb-1 custom-scrollbar`}
                >
                  {bookmarks.map(renderBookmarkRow)}
                </div>
              )}
              <div className="relative flex-1 min-h-0">
                <div
                  className="pointer-events-none absolute left-0 right-3 top-0 h-4 z-10"
                  style={{
                    background:
                      "linear-gradient(to bottom, var(--color-bg-tertiary), transparent)",
                  }}
                  aria-hidden="true"
                />
                {showSegmentView ? (
                  <Virtuoso
                    ref={segmentsVirtuosoRef}
                    scrollerRef={(ref) => {
                      segmentsScrollerRef.current =
                        (ref as HTMLElement) ?? null;
                    }}
                    onWheel={() => {
                      if (isPlaying) setFollowPaused(true);
                    }}
                    style={{ height: "100%" }}
                    data={visibleSegments}
                    overscan={200}
                    className="custom-scrollbar ui-text-body text-content-secondary leading-relaxed"
                    computeItemKey={(
                      _index: number,
                      entry: { segment: TranscriptSegment; index: number },
                    ) => `${entry.segment.start_ms}-${entry.index}`}
                    components={{
                      Header: () => <div className="h-4" />,
                      Footer: () => <div className="h-10" />,
                    }}
                    itemContent={(idx, entry) => {
                      const segment = entry.segment;
                      const isActive = entry.index === activeSegmentIndex;
                      const wordSpans =
                        isActive && !normalizedSearchQuery
                          ? renderSegmentWords(segment, entry.index)
                          : null;
                      return (
                        <div className={`${CONTENT_COLUMN} pb-1.5`}>
                          {entry.index === 0 &&
                            bookmarksBySegment.get(-1)?.map(renderBookmarkRow)}
                          <div
                            className={`group/seg -mx-2 grid grid-cols-[auto_1fr] gap-3 rounded-md px-2 py-1 select-none transcript-segment${
                              isActive ? " transcript-segment-active" : ""
                            }`}
                          >
                            <div className="relative flex items-center gap-1.5 self-start">
                              <span
                                className={`transcript-segment-time ${timestampWidth} shrink-0 text-right text-content-disabled font-mono ui-text-label tabular-nums pt-0.5 select-none cursor-pointer hover:text-content-primary transition-colors`}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  handleTimestampClick(segment.start_ms)
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    handleTimestampClick(segment.start_ms);
                                  }
                                }}
                              >
                                {formatTimestamp(segment.start_ms)}
                              </span>
                              {renderSpeakerChip(segment, entry.index)}
                            </div>
                            <div className="min-w-0 select-none w-fit">
                              <span className="select-text">
                                {wordSpans ??
                                  renderHighlightedText(
                                    segment.text,
                                    activeOccurrence(activeSegmentMatch, idx),
                                  )}
                              </span>
                            </div>
                          </div>
                          {bookmarksBySegment
                            .get(entry.index)
                            ?.map(renderBookmarkRow)}
                        </div>
                      );
                    }}
                  />
                ) : showStreaming ? (
                  transcribingPlaceholder ? (
                    <div className="flex flex-col h-full w-full items-center justify-center gap-5">
                      <IntelligencePixel active size="md" />
                      <div className="ui-text-label font-medium tabular-nums text-content-disabled">
                        {transcribingLabel}
                      </div>
                    </div>
                  ) : (
                    <Virtuoso
                      ref={streamVirtuosoRef}
                      style={{ height: "100%" }}
                      data={streamChunks}
                      overscan={200}
                      className="custom-scrollbar ui-text-body text-content-secondary leading-relaxed"
                      computeItemKey={(index: number) =>
                        `${item.id}-chunk-${index}`
                      }
                      components={{
                        Header: () => <div className="h-4" />,
                        Footer: () => <div className="h-10" />,
                      }}
                      itemContent={(idx, chunk) => (
                        <div className={`${CONTENT_COLUMN} pb-2`}>
                          <motion.p
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="select-text"
                          >
                            {renderHighlightedText(
                              chunk,
                              activeOccurrence(activeStreamMatch, idx),
                            )}
                          </motion.p>
                        </div>
                      )}
                    />
                  )
                ) : item.status.type === "importing" ||
                  item.status.type === "pending" ? (
                  <div className="flex flex-col h-full w-full items-center justify-center gap-5">
                    <IntelligencePixel active size="md" />
                    <div className="ui-text-label font-medium text-content-disabled">
                      {importStatusText}
                    </div>
                  </div>
                ) : showSpeakerText ? (
                  <Virtuoso
                    ref={turnsVirtuosoRef}
                    style={{ height: "100%" }}
                    data={visibleTurns}
                    overscan={200}
                    className="custom-scrollbar ui-text-body text-content-secondary leading-relaxed"
                    computeItemKey={(_index: number, turn: SpeakerTurn) =>
                      turn.key
                    }
                    components={{
                      Header: () => <div className="h-4" />,
                      Footer: () => <div className="h-10" />,
                    }}
                    itemContent={(idx, turn) => (
                      <div
                        className={`${CONTENT_COLUMN} ${
                          visibleTurns[idx + 1]?.continues ? "pb-2.5" : "pb-4"
                        }`}
                      >
                        <div className="-mx-2 px-2">
                          {turn.speaker && !turn.continues && (
                            <div
                              onContextMenu={(event) =>
                                turn.speaker &&
                                openSpeakerContext(turn.speaker.id, event)
                              }
                              className="flex w-fit max-w-full items-center gap-2 ui-text-label font-medium text-content-primary"
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    turn.speaker.color ?? undefined,
                                }}
                                aria-hidden="true"
                              />
                              <span className="truncate">
                                {turn.speaker.name}
                              </span>
                            </div>
                          )}
                          <p
                            className="select-text cursor-pointer transition-colors hover:text-content-primary"
                            onClick={() => {
                              // Selecting text shouldn't jump playback.
                              if (
                                window.getSelection()?.isCollapsed !== false
                              ) {
                                handleTimestampClick(turn.start_ms);
                              }
                            }}
                          >
                            {renderHighlightedText(
                              turn.text,
                              activeOccurrence(activeTurnMatch, idx),
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  />
                ) : (
                  // The textarea grows with the text so it scrolls together with the highlight layer.
                  <div
                    ref={transcriptScrollRef}
                    className="h-full w-full overflow-y-scroll custom-scrollbar"
                  >
                    <div className="relative grid min-h-full">
                      <div
                        key={normalizedSearchQuery}
                        ref={transcriptHighlightsRef}
                        aria-hidden="true"
                        className="pointer-events-none col-start-1 row-start-1 whitespace-pre-wrap [overflow-wrap:break-word] pl-[max(0px,calc((100%-64rem)/2))] pr-[max(0px,calc(100%-max(0px,calc((100%-64rem)/2))-45rem))] ui-text-body leading-relaxed text-transparent pt-4 pb-10"
                      >
                        {textMatchIndexes.map((start, idx) => {
                          const prevEnd =
                            idx === 0
                              ? 0
                              : textMatchIndexes[idx - 1] +
                                normalizedSearchQuery.length;
                          const end = start + normalizedSearchQuery.length;
                          const isActive =
                            idx ===
                            Math.min(
                              activeSearchIndex,
                              textMatchIndexes.length - 1,
                            );
                          return (
                            <Fragment key={start}>
                              {transcriptDraft.slice(prevEnd, start)}
                              <mark
                                data-active={isActive || undefined}
                                className={`transcript-search-hit${isActive ? " transcript-search-hit-active" : ""}`}
                              >
                                {transcriptDraft.slice(start, end)}
                              </mark>
                            </Fragment>
                          );
                        })}
                        {transcriptDraft.slice(
                          textMatchIndexes.length > 0
                            ? textMatchIndexes[textMatchIndexes.length - 1] +
                                normalizedSearchQuery.length
                            : 0,
                        )}{" "}
                      </div>
                      <textarea
                        ref={transcriptAreaRef}
                        value={transcriptDraft}
                        onChange={(event) =>
                          setTranscriptDraft(event.target.value)
                        }
                        disabled={!transcriptEditable}
                        placeholder={t({
                          id: "library.modal.transcript_placeholder",
                          message: "Transcript will appear here.",
                        })}
                        className="col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent pl-[max(0px,calc((100%-64rem)/2))] pr-[max(0px,calc(100%-max(0px,calc((100%-64rem)/2))-45rem))] ui-text-body text-content-secondary leading-relaxed outline-hidden disabled:opacity-60 select-text pt-4 pb-10"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        <footer className="mt-1 flex h-12 shrink-0 items-center px-5">
          <div className="flex w-full items-center gap-3">
            <button
              onClick={handleTogglePlayback}
              disabled={!audioReady || !!audioError}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg-secondary)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={
                isPlaying
                  ? t({
                      id: "library.modal.pause_audio",
                      message: "Pause audio",
                    })
                  : t({
                      id: "library.modal.play_audio",
                      message: "Play audio",
                    })
              }
            >
              {isPlaying ? (
                <Pause size={13} weight="fill" />
              ) : (
                <Play size={13} weight="fill" />
              )}
            </button>

            <span className="w-11 shrink-0 text-right ui-text-meta font-medium tabular-nums text-content-secondary">
              {formatDuration(audioCurrentTime)}
            </span>

            <div className="relative flex h-8 min-w-0 flex-1 items-center">
              {audioError ? (
                <span className="ui-text-meta text-content-disabled">
                  {audioError}
                </span>
              ) : (
                <AudioScrubber
                  duration={audioDuration}
                  currentTime={audioCurrentTime}
                  bookmarks={bookmarks}
                  disabled={!audioReady}
                  ariaLabel={t({
                    id: "library.modal.audio_scrubber",
                    message: "Audio scrubber",
                  })}
                  onScrubStart={handleScrubStart}
                  onScrub={(time) => handleScrubChange(String(time))}
                  onScrubEnd={handleScrubEnd}
                  onSeek={handleTimestampClick}
                />
              )}
            </div>

            <span className="w-11 shrink-0 ui-text-meta tabular-nums text-content-disabled">
              {formatDuration(audioDuration)}
            </span>

            <div className="flex h-7 shrink-0 items-center gap-0.5 ui-text-meta leading-none">
              <button
                type="button"
                onClick={() => handlePlaybackRateStep(-1)}
                disabled={
                  !audioReady || !!audioError || !canDecreasePlaybackRate
                }
                aria-label={t({
                  id: "library.modal.playback.decrease",
                  message: "Decrease playback speed",
                })}
                className="p-0.5 text-content-muted transition-colors hover:text-content-primary disabled:text-content-disabled"
              >
                <ChevronLeft size={10} />
              </button>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={playbackRate}
                  initial={{ opacity: 0, y: -2, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 2, scale: 0.92 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  onMouseDown={handleRateScrubStart}
                  onTouchStart={handleRateScrubStart}
                  className="w-[30px] min-w-[30px] text-center font-medium text-content-secondary tabular-nums cursor-ew-resize select-none"
                >
                  {formatPlaybackRate(playbackRate)}x
                </motion.span>
              </AnimatePresence>
              <button
                type="button"
                onClick={() => handlePlaybackRateStep(1)}
                disabled={
                  !audioReady || !!audioError || !canIncreasePlaybackRate
                }
                aria-label={t({
                  id: "library.modal.playback.increase",
                  message: "Increase playback speed",
                })}
                className="p-0.5 text-content-muted transition-colors hover:text-content-primary disabled:text-content-disabled"
              >
                <ChevronRight size={10} />
              </button>
            </div>

            {hasTracks && (
              <>
                <button
                  type="button"
                  onClick={() => handleToggleTrackMute("primary")}
                  aria-pressed={!trackMuted.primary}
                  title={t({
                    id: "library.tracks.microphone",
                    message: "Microphone track",
                  })}
                  className={`rounded-md p-1.5 transition-colors hover:bg-surface-surface ${
                    trackMuted.primary
                      ? "text-content-disabled"
                      : "text-content-secondary hover:text-content-primary"
                  }`}
                >
                  {trackMuted.primary ? (
                    <MicrophoneSlash size={14} />
                  ) : (
                    <Microphone size={14} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleTrackMute("secondary")}
                  aria-pressed={!trackMuted.secondary}
                  title={t({
                    id: "library.tracks.system_audio",
                    message: "System audio track",
                  })}
                  className={`rounded-md p-1.5 transition-colors hover:bg-surface-surface ${
                    trackMuted.secondary
                      ? "text-content-disabled"
                      : "text-content-secondary hover:text-content-primary"
                  }`}
                >
                  {trackMuted.secondary ? (
                    <SpeakerSlash size={14} />
                  ) : (
                    <SpeakerHigh size={14} />
                  )}
                </button>
              </>
            )}

            <div className="relative shrink-0" ref={speakersMenuRef}>
              <button
                type="button"
                onClick={() => setSpeakersMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={speakersMenuOpen}
                aria-label={t({
                  id: "library.detail.speakers",
                  message: "Speakers",
                })}
                title={t({
                  id: "library.detail.speakers",
                  message: "Speakers",
                })}
                className={`flex h-7 items-center gap-1.5 rounded-md px-1.5 ui-text-meta hover:bg-surface-surface transition-colors ${
                  hiddenSpeakers.size > 0
                    ? "text-[var(--color-cloud-dark)]"
                    : "text-content-secondary hover:text-content-primary"
                }`}
              >
                {hiddenSpeakers.size > 0 ? (
                  <EyeSlash size={11} />
                ) : (
                  <Users size={11} />
                )}
                <span
                  className={`tabular-nums ${
                    hiddenSpeakers.size > 0 ? "" : "text-content-disabled"
                  }`}
                >
                  {hiddenSpeakers.size > 0
                    ? `${speakers.length - hiddenSpeakers.size}/${speakers.length}`
                    : speakers.length}
                </span>
              </button>
              <AnimatePresence>
                {speakersMenuOpen && (
                  <motion.div
                    ref={speakersMenuPanelRef}
                    role="menu"
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="ui-surface-menu absolute right-0 bottom-full mb-1.5 z-[120] w-56 origin-bottom-right py-1"
                  >
                    {speakers.length > 1 && (
                      <>
                        <SpeakerMenuItem
                          icon={
                            <Eye
                              size={12}
                              className="shrink-0 ui-color-muted"
                            />
                          }
                          label={t({
                            id: "library.detail.speaker_menu.show_all",
                            message: "Show all speakers",
                          })}
                          disabled={hiddenSpeakers.size === 0}
                          onClick={() => setHiddenSpeakerIds([])}
                        />
                        <div className="my-1 h-px bg-[var(--border-subtle)]" />
                      </>
                    )}
                    {speakers.length === 0 && (
                      <div className="px-3 py-2 ui-text-menu-item ui-color-muted">
                        {t({
                          id: "library.detail.filter.no_speakers",
                          message: "No speakers yet",
                        })}
                      </div>
                    )}
                    <div className="max-h-72 overflow-y-auto custom-scrollbar">
                      {speakers.map((speaker) => {
                        const hidden = hiddenSpeakers.has(speaker.id);
                        return (
                          <div
                            key={speaker.id}
                            onContextMenu={(event) =>
                              openSpeakerContext(speaker.id, event)
                            }
                            className="group/speaker flex items-center gap-1.5 pr-3 hover:bg-surface-elevated transition-colors"
                          >
                            {renamingSpeakerId === speaker.id ? (
                              <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3">
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: speaker.color ?? undefined,
                                  }}
                                  aria-hidden="true"
                                />
                                <input
                                  value={speakerNameDraft}
                                  onChange={(event) =>
                                    setSpeakerNameDraft(event.target.value)
                                  }
                                  onFocus={(event) => event.target.select()}
                                  aria-label={t({
                                    id: "library.detail.speaker_menu.rename",
                                    message: "Rename",
                                  })}
                                  onBlur={() => handleRenameSpeaker(speaker.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      handleRenameSpeaker(speaker.id);
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      setRenamingSpeakerId(null);
                                      setSpeakerNameDraft("");
                                    }
                                  }}
                                  className="min-w-0 flex-1 border-0 bg-transparent p-0 ui-text-menu-item ui-color-primary shadow-[inset_0_-1px_0_0_var(--color-border-hover)] outline-hidden"
                                  autoFocus
                                />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingSpeakerId(speaker.id);
                                  setSpeakerNameDraft(speaker.name);
                                }}
                                title={t({
                                  id: "library.detail.speaker_menu.rename",
                                  message: "Rename",
                                })}
                                className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left ui-text-menu-item ui-color-secondary transition-opacity ${
                                  hidden ? "opacity-45" : ""
                                }`}
                              >
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: speaker.color ?? undefined,
                                  }}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{speaker.name}</span>
                                <Pencil
                                  size={11}
                                  className="shrink-0 ui-color-muted opacity-0 transition-opacity group-hover/speaker:opacity-100"
                                  aria-hidden="true"
                                />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleSpeakerHidden(speaker.id)}
                              aria-pressed={hidden}
                              aria-label={
                                hidden
                                  ? t({
                                      id: "library.detail.speaker_menu.show",
                                      message: "Show speaker",
                                    })
                                  : t({
                                      id: "library.detail.speaker_menu.hide",
                                      message: "Hide speaker",
                                    })
                              }
                              title={
                                hidden
                                  ? t({
                                      id: "library.detail.speaker_menu.show",
                                      message: "Show speaker",
                                    })
                                  : t({
                                      id: "library.detail.speaker_menu.hide",
                                      message: "Hide speaker",
                                    })
                              }
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ui-color-muted transition-opacity hover:text-content-primary focus-visible:opacity-100 ${
                                hidden
                                  ? ""
                                  : "opacity-0 group-hover/speaker:opacity-100"
                              }`}
                            >
                              {hidden ? (
                                <EyeSlash size={13} />
                              ) : (
                                <Eye size={13} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSpeaker(speaker.id)}
                              aria-label={t({
                                id: "library.detail.speaker.remove",
                                message: `Remove ${speaker.name}`,
                              })}
                              title={t({
                                id: "library.detail.speaker.remove",
                                message: `Remove ${speaker.name}`,
                              })}
                              className="shrink-0 p-0.5 ui-color-muted opacity-0 transition-opacity hover:text-red-500 group-hover/speaker:opacity-100 focus-visible:opacity-100"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {speakers.length > 0 && (
                      <div className="my-1 h-px bg-[var(--border-subtle)]" />
                    )}
                    <SpeakerMenuItem
                      icon={
                        <UserPlus
                          size={12}
                          className="shrink-0 ui-color-muted"
                        />
                      }
                      label={t({
                        id: "library.detail.add_speaker",
                        message: "Add speaker",
                      })}
                      disabled={!canAddSpeaker}
                      onClick={() => void handleAddSpeaker()}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative shrink-0" ref={playbackMenuRef}>
              <button
                type="button"
                onClick={() => setPlaybackMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={playbackMenuOpen}
                aria-label={t({
                  id: "library.detail.playback_settings",
                  message: "Playback settings",
                })}
                title={t({
                  id: "library.detail.playback_settings",
                  message: "Playback settings",
                })}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-surface ${
                  playbackMenuOpen
                    ? "text-content-primary"
                    : "text-content-muted hover:text-content-primary"
                }`}
              >
                <GearSix size={15} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {playbackMenuOpen && (
                  <motion.div
                    ref={playbackMenuPanelRef}
                    role="menu"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute right-0 bottom-full mb-2 w-52 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-overlay)] shadow-xl overflow-hidden z-[120] py-1"
                  >
                    {[
                      {
                        key: "timestamps",
                        label: t({
                          id: "library.detail.show_timestamps",
                          message: "Show timestamps",
                        }),
                        checked: showSegmentView,
                        disabled: !canShowTimestamps,
                        onSelect: handleToggleTimestamps,
                      },
                      {
                        key: "follow",
                        label: t({
                          id: "library.detail.follow_playback",
                          message: "Scroll with playback",
                        }),
                        checked: followPlayback && showSegmentView,
                        disabled: !showSegmentView,
                        onSelect: () => {
                          const next = !followPlayback;
                          setFollowPlayback(next);
                          localStorage.setItem(
                            FOLLOW_PLAYBACK_KEY,
                            next ? "on" : "off",
                          );
                        },
                      },
                    ].map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={option.checked}
                        disabled={option.disabled}
                        onClick={option.onSelect}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left ui-text-meta text-content-secondary hover:bg-surface-overlay hover:text-content-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span className="flex w-3 shrink-0 justify-center">
                          {option.checked && <Check size={11} />}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </footer>
      </motion.div>

      <LibraryDeleteDialog
        open={showDeleteConfirm}
        onCancel={closeDeleteConfirm}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          const audio = releaseAudioSource();
          void onDelete().catch(() => {
            if (audio) {
              audio.src = audioUrlFor(trackMutedRef.current);
              audioRef.current = audio;
              audio.load();
            }
          });
        }}
      />

      {createPortal(
        <AnimatePresence>
          {contextSpeaker && speakerContext && (
            <SpeakerContextMenu
              key={`${contextSpeaker.id}-${speakerContext.x}-${speakerContext.y}`}
              speaker={contextSpeaker}
              speakers={speakers}
              x={speakerContext.x}
              y={speakerContext.y}
              canAddSpeaker={canAddSpeaker}
              onMoveLine={
                lineIndex === undefined
                  ? undefined
                  : (speakerId) => {
                      closeSpeakerContext();
                      void handleAssignSpeaker(lineIndex, speakerId);
                    }
              }
              onMoveLineToNew={
                lineIndex === undefined
                  ? undefined
                  : async () => {
                      closeSpeakerContext();
                      const created = await handleAddSpeaker();
                      if (created) {
                        await handleAssignSpeaker(lineIndex, created.id);
                      }
                    }
              }
              filtered={
                hiddenSpeakers.size > 0 &&
                !hiddenSpeakers.has(contextSpeaker.id) &&
                hiddenSpeakers.size === speakers.length - 1
              }
              onRename={(name) =>
                void handleUpdateSpeaker(contextSpeaker.id, { name })
              }
              onRecolor={(color) =>
                void handleUpdateSpeaker(contextSpeaker.id, { color })
              }
              onMerge={(intoId) => {
                closeSpeakerContext();
                void handleMergeSpeaker(contextSpeaker.id, intoId);
              }}
              onToggleFilter={() => {
                closeSpeakerContext();
                setHiddenSpeakerIds(
                  hiddenSpeakers.size === speakers.length - 1 &&
                    !hiddenSpeakers.has(contextSpeaker.id)
                    ? []
                    : speakers
                        .filter((entry) => entry.id !== contextSpeaker.id)
                        .map((entry) => entry.id),
                );
              }}
              onRemove={() => {
                closeSpeakerContext();
                void handleRemoveSpeaker(contextSpeaker.id);
              }}
              onClose={closeSpeakerContext}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}

      {createPortal(
        <AnimatePresence>
          {showRetranscribe && (
            <LibraryRetranscribeModal
              item={item}
              models={models}
              onCancel={() => setShowRetranscribe(false)}
              onConfirm={async (options) => {
                // An unsaved edit would be dropped once the transcript is replaced.
                writeTranscript();
                await transcriptChain.current;
                if (transcriptPending.current !== null) {
                  throw new Error("Transcript edit not saved");
                }
                await onRetranscribe(options);
                setShowRetranscribe(false);
              }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export default LibraryDetail;
