import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  BookmarkSimple,
  CaretDown,
  CaretUp,
  Check,
  Copy,
  DotsSix,
  GearSix,
  Microphone,
  Pause,
  Play,
  SpeakerHigh,
  Stop,
  Warning,
  X,
} from "@phosphor-icons/react";
import * as recordingApi from "../api";
import { useRecordingSession } from "../useRecordingSession";
import { useSilenceWarning } from "../useSilenceWarning";
import { useLiveTranscript } from "../useLiveTranscript";
import { useLivePrefs, type LivePrefs, type LiveTextSize } from "../livePrefs";
import { withSpeakerColors } from "../../library/speakerColors";
import { formatTimestamp } from "../../library/components/library-utils";
import SpeakerContextMenu from "../../library/components/SpeakerContextMenu";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useCopyToClipboard } from "../../../shared/hooks/useCopyToClipboard";
import { getExpandedTextSegments } from "../../../shared/lib/wordReveal";
import SegmentedControl from "../../../shared/ui/SegmentedControl";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import type { Bookmark, LiveSegment } from "../../../types";
import { detectAppPlatform } from "../../../platform/service";

const NATIVE_FRAME = detectAppPlatform() === "windows";

type Turn = {
  key: string;
  speakerId: string;
  startMs: number;
  segments: LiveSegment[];
};

type Row =
  | { kind: "turn"; at: number; turn: Turn }
  | { kind: "bookmark"; at: number; bookmark: Bookmark };

const TEXT_CLASS: Record<LiveTextSize, string> = {
  small: "ui-text-body-sm",
  medium: "ui-text-body",
  large: "ui-text-body-lg",
};

// Within this distance of the bottom the list keeps following new text.
const FOLLOW_SLACK_PX = 48;
// Stiffness of the critically damped follow: settles in about 0.7 s, close
// to how long a burst of new words takes to fade in.
const FOLLOW_OMEGA = 7;
// Only the newest rows glide when turns are inserted or split; each animated
// row is measured on every update.
const LAYOUT_TAIL = 6;
const METER_BARS = 5;
const COMPACT_EASE_MS = 260;
// Matches COMPACT_HEIGHT in live_window.rs.
const HEADER_HEIGHT = 52;

const formatClock = (elapsedMs: number) => {
  const total = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const groupTurns = (segments: LiveSegment[]): Turn[] => {
  const turns: Turn[] = [];
  for (const segment of segments) {
    const last = turns[turns.length - 1];
    if (last && last.speakerId === segment.speaker_id) {
      last.segments.push(segment);
    } else {
      turns.push({
        key: segment.id,
        speakerId: segment.speaker_id,
        startMs: segment.start_ms,
        segments: [segment],
      });
    }
  }
  return turns;
};

// New words fade in the way the pill reveals live dictation; words already
// shown stay put while a preview is rewritten around them. `seen` outlives
// the component, so a segment regrouped under another turn doesn't replay.
const RevealText = ({
  id,
  text,
  seen,
}: {
  id: string;
  text: string;
  seen: Map<string, Set<number>>;
}) => {
  const words = useMemo(
    () => getExpandedTextSegments(text, seen.get(id) ?? new Set()),
    [id, text, seen],
  );
  useEffect(() => {
    seen.set(id, new Set(words.map((word) => word.key)));
  }, [id, words, seen]);
  return words.map(({ key, text: word, isWhitespace, delay }) =>
    isWhitespace ? (
      <span key={key} className="whitespace-pre-wrap">
        {word}
      </span>
    ) : (
      <motion.span
        key={key}
        className="inline-block"
        initial={{ opacity: 0, filter: "blur(2px)", y: 4 }}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        transition={{
          opacity: { duration: 0.2, ease: "easeOut", delay },
          filter: { duration: 0.18, ease: "easeOut", delay },
          y: { duration: 0.2, ease: "easeOut", delay },
        }}
      >
        {word}
      </motion.span>
    ),
  );
};

const SourceLevel = ({
  icon,
  level,
  on,
}: {
  icon: ReactNode;
  level: number;
  on: boolean;
}) => {
  const lit = on ? Math.min(METER_BARS, Math.round(level * METER_BARS)) : 0;
  return (
    <div
      className={`flex w-12 items-center gap-1.5 text-content-muted ${on ? "" : "opacity-35"}`}
      aria-hidden="true"
    >
      {icon}
      <span className="flex h-3 items-end gap-[2px]">
        {Array.from({ length: METER_BARS }, (_, index) => (
          <span
            key={index}
            className="w-[2px] rounded-full bg-[var(--color-success)] transition-opacity duration-100"
            style={{
              height: `${40 + index * 15}%`,
              opacity: index < lit ? 0.9 : 0.18,
            }}
          />
        ))}
      </span>
    </div>
  );
};

const BookmarkRow = ({
  bookmark,
  autoFocus,
  onCommit,
}: {
  bookmark: Bookmark;
  autoFocus: boolean;
  onCommit: (label: string) => void;
}) => {
  const { t } = useLingui();
  const [draft, setDraft] = useState(bookmark.label ?? "");
  const commit = () => {
    const value = draft.trim();
    if (value !== (bookmark.label ?? "")) onCommit(value);
  };
  return (
    <li className="flex h-8 items-center gap-2">
      <span className="flex w-2 shrink-0 justify-center">
        <BookmarkSimple
          size={11}
          weight="fill"
          className="text-[var(--color-cloud)]"
          aria-hidden="true"
        />
      </span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        placeholder={t({ id: "record.bookmark.note", message: "Add a note" })}
        autoFocus={autoFocus}
        className="min-w-0 flex-1 bg-transparent ui-text-label text-content-secondary outline-hidden placeholder:text-content-disabled focus:text-content-primary"
      />
      <span className="shrink-0 ui-text-label tabular-nums text-content-muted">
        {formatTimestamp(bookmark.at_ms)}
      </span>
    </li>
  );
};

const PrefsMenu = ({
  prefs,
  onChange,
}: {
  prefs: LivePrefs;
  onChange: (patch: Partial<LivePrefs>) => void;
}) => {
  const { t } = useLingui();
  const row = (label: string, control: ReactNode) => (
    <div className="flex h-9 items-center justify-between gap-3 px-3">
      <span className="ui-text-body-sm text-content-primary">{label}</span>
      {control}
    </div>
  );
  return (
    <motion.div
      role="menu"
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.12 }}
      className="ui-surface-menu absolute right-2 top-full z-30 mt-1 w-[248px] py-1"
    >
      {row(
        t({ id: "live.prefs.text_size", message: "Text size" }),
        <SegmentedControl<LiveTextSize>
          value={prefs.textSize}
          onChange={(textSize) => onChange({ textSize })}
          ariaLabel={t({ id: "live.prefs.text_size", message: "Text size" })}
          className="flex items-center rounded-md bg-[var(--color-bg-secondary)] p-0.5 border border-[var(--color-border-primary)] relative"
          buttonClassName="relative w-7 py-0.5 rounded ui-text-label font-medium transition-colors duration-200 z-10"
          activeIndicatorLayoutId="live-text-size"
          options={[
            {
              value: "small",
              label: t({ id: "live.prefs.text_size.small", message: "S" }),
            },
            {
              value: "medium",
              label: t({ id: "live.prefs.text_size.medium", message: "M" }),
            },
            {
              value: "large",
              label: t({ id: "live.prefs.text_size.large", message: "L" }),
            },
          ]}
        />,
      )}
      {row(
        t({ id: "live.prefs.timestamps", message: "Show timestamps" }),
        <ToggleSwitch
          size="sm"
          enabled={prefs.timestamps}
          onToggle={() => onChange({ timestamps: !prefs.timestamps })}
          ariaLabel={t({
            id: "live.prefs.timestamps",
            message: "Show timestamps",
          })}
        />,
      )}
      {row(
        t({ id: "live.prefs.on_top", message: "Keep on top" }),
        <ToggleSwitch
          size="sm"
          enabled={prefs.keepOnTop}
          onToggle={() => onChange({ keepOnTop: !prefs.keepOnTop })}
          ariaLabel={t({ id: "live.prefs.on_top", message: "Keep on top" })}
        />,
      )}
      {row(
        t({
          id: "live.prefs.open_on_start",
          message: "Open when recording starts",
        }),
        <ToggleSwitch
          size="sm"
          enabled={prefs.openOnStart}
          onToggle={() => onChange({ openOnStart: !prefs.openOnStart })}
          ariaLabel={t({
            id: "live.prefs.open_on_start",
            message: "Open when recording starts",
          })}
        />,
      )}
    </motion.div>
  );
};

const LiveView = () => {
  const { t } = useLingui();
  const { state } = useRecordingSession();
  const transcript = useLiveTranscript();
  const [prefs, updatePrefs] = useLivePrefs();
  const [menuOpen, setMenuOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const [focusBookmarkId, setFocusBookmarkId] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();
  const [compact, setCompact] = useState(false);
  const [speakerMenu, setSpeakerMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const followFrame = useRef<number | null>(null);
  const followTop = useRef(0);
  const compactTimer = useRef<number | undefined>(undefined);
  const shownSpeakers = useRef(new Map<string, string>());
  const seenWords = useRef(new Map<string, Set<number>>());
  const reduceMotion = useReducedMotion();
  const sawActive = useRef(false);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const active = state.status === "recording" || state.status === "paused";
  const paused = state.status === "paused";

  useEffect(() => {
    getCurrentWindow()
      .setAlwaysOnTop(prefs.keepOnTop)
      .catch(() => {});
  }, [prefs.keepOnTop]);

  const microphoneOn = Boolean(state.sources.microphone);
  const systemOn = Boolean(state.sources.system_audio);
  const silenceWarning = useSilenceWarning(state);

  // The panel eases inside the window; the window itself only resizes while
  // the change is invisible (after collapsing, before expanding).
  const toggleCompact = () => {
    setMenuOpen(false);
    setSpeakerMenu(null);
    window.clearTimeout(compactTimer.current);
    if (NATIVE_FRAME) {
      recordingApi
        .setLiveViewCompact(!compact)
        .then(() => setCompact(!compact))
        .catch(() => {});
      return;
    }
    if (compact) {
      recordingApi
        .setLiveViewCompact(false)
        .catch(() => {})
        .finally(() => setCompact(false));
      return;
    }
    setCompact(true);
    compactTimer.current = window.setTimeout(() => {
      recordingApi.setLiveViewCompact(true).catch(() => {});
    }, COMPACT_EASE_MS);
  };

  // The recording ended somewhere else (tray, Record screen): step aside.
  useEffect(() => {
    if (active && !state.finish_requested) {
      sawActive.current = true;
      return;
    }
    if (sawActive.current) {
      sawActive.current = false;
      recordingApi.hideLiveView(false).catch(() => {});
      if (compact) toggleCompact();
    }
  }, [active, state.finish_requested]);

  const speakers = useMemo(
    () => withSpeakerColors(transcript.speakers),
    [transcript.speakers],
  );
  const speakerById = useMemo(
    () => new Map(speakers.map((speaker) => [speaker.id, speaker])),
    [speakers],
  );

  // Unsettled text keeps the speaker it first appeared under until the
  // diarizer settles it, so a provisional guess moves at most once.
  const segments = useMemo(() => {
    const listed = new Set(transcript.speakers.map((speaker) => speaker.id));
    const previous = shownSpeakers.current;
    const next = new Map<string, string>();
    const held = transcript.segments.map((segment) => {
      if (segment.settled) return segment;
      const shown = previous.get(segment.id);
      const speakerId = shown && listed.has(shown) ? shown : segment.speaker_id;
      next.set(segment.id, speakerId);
      return speakerId === segment.speaker_id
        ? segment
        : { ...segment, speaker_id: speakerId };
    });
    shownSpeakers.current = next;
    if (held.length === 0) seenWords.current.clear();
    return held;
  }, [transcript.segments, transcript.speakers]);

  const turns = useMemo(() => groupTurns(segments), [segments]);
  const rows = useMemo<Row[]>(() => {
    const turnRows: Row[] = turns.map((turn) => ({
      kind: "turn",
      at: turn.startMs,
      turn,
    }));
    const bookmarks: Row[] = state.bookmarks.map((bookmark) => ({
      kind: "bookmark",
      at: bookmark.at_ms,
      bookmark,
    }));
    return [...turnRows, ...bookmarks].sort((a, b) => a.at - b.at);
  }, [turns, state.bookmarks]);

  const stopFollowing = () => {
    if (followFrame.current !== null) cancelAnimationFrame(followFrame.current);
    followFrame.current = null;
  };

  // Springs toward the bottom whenever the list grows, starting from rest and
  // keeping its speed when more text lands mid-glide. Opening and jumping to
  // live snap instead.
  const hasRows = rows.length > 0;
  // Paused while a speaker menu is open; its scroll listener would close it.
  const speakerMenuOpen = speakerMenu !== null;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!following || speakerMenuOpen || !scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    followTop.current = scroller.scrollTop;
    let velocity = 0;
    const follow = () => {
      if (followFrame.current !== null) return;
      if (reduceMotion) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      followTop.current = scroller.scrollTop;
      velocity = 0;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        const gap =
          scroller.scrollHeight - scroller.clientHeight - followTop.current;
        velocity +=
          (FOLLOW_OMEGA ** 2 * gap - 2 * FOLLOW_OMEGA * velocity) * dt;
        followTop.current += velocity * dt;
        scroller.scrollTop = followTop.current;
        if (Math.abs(gap) < 0.5 && Math.abs(velocity) < 5) {
          velocity = 0;
          followFrame.current = null;
          return;
        }
        followFrame.current = requestAnimationFrame(step);
      };
      followFrame.current = requestAnimationFrame(step);
    };
    const observer = new ResizeObserver(follow);
    observer.observe(scroller);
    if (listRef.current) observer.observe(listRef.current);
    return () => {
      observer.disconnect();
      stopFollowing();
    };
  }, [following, speakerMenuOpen, hasRows, reduceMotion]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Scroll events from the easing itself only ever move down.
    if (
      followFrame.current !== null &&
      scroller.scrollTop >= followTop.current - 1
    ) {
      return;
    }
    const distance =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const next = distance < FOLLOW_SLACK_PX;
    if (!next) stopFollowing();
    setFollowing(next);
  };

  const jumpToLive = () => setFollowing(true);

  const handleTogglePause = () => {
    (paused
      ? recordingApi.resumeRecordingSession()
      : recordingApi.pauseRecordingSession()
    ).catch((err) => console.error("Failed to toggle pause:", err));
  };

  const handleBookmark = () => {
    recordingApi
      .addRecordingBookmark()
      .then((bookmark) => {
        setFocusBookmarkId(bookmark.id);
        jumpToLive();
      })
      .catch((err) => console.error("Failed to add bookmark:", err));
  };

  const handleBookmarkNote = (id: string, label: string) => {
    recordingApi
      .updateRecordingBookmark(id, label || null)
      .catch((err) => console.error("Failed to update bookmark:", err));
  };

  const handleCopy = () => {
    const text = turns
      .map((turn) => {
        const name = speakerById.get(turn.speakerId)?.name ?? turn.speakerId;
        const words = turn.segments.map((segment) => segment.text).join(" ");
        return `${name}: ${words}`;
      })
      .join("\n\n");
    void copy(text);
  };

  const handleStop = () => {
    recordingApi
      .finishFromLiveView()
      .catch((err) => console.error("Failed to finish recording:", err));
  };

  const handleRename = (id: string, name: string) => {
    recordingApi
      .renameLiveSpeaker(id, name)
      .catch((err) => console.error("Failed to rename speaker:", err));
  };

  const handleRecolor = (id: string, color: string) => {
    recordingApi
      .setLiveSpeakerColor(id, color)
      .catch((err) => console.error("Failed to recolor speaker:", err));
  };

  const handleMerge = (from: string, into: string) => {
    recordingApi
      .mergeLiveSpeaker(from, into)
      .catch((err) => console.error("Failed to merge speakers:", err));
  };

  const openSpeakerMenu = (
    id: string,
    event: { clientX: number; clientY: number; preventDefault: () => void },
  ) => {
    event.preventDefault();
    setSpeakerMenu({ id, x: event.clientX, y: event.clientY });
  };

  const emptyMessage = !active
    ? null
    : transcript.status === "unavailable"
      ? t({
          id: "live.empty.unavailable",
          message: "Live transcription needs a speech model that supports it.",
        })
      : paused
        ? t({ id: "live.empty.paused", message: "Paused" })
        : t({ id: "live.empty.listening", message: "Listening..." });

  const textClass = TEXT_CLASS[prefs.textSize];
  const lastTurnKey = turns[turns.length - 1]?.key;

  const renderTurn = (turn: Turn, recent: boolean) => {
    const speaker = speakerById.get(turn.speakerId) ?? {
      id: turn.speakerId,
      name: turn.speakerId,
      color: null,
    };
    const speaking =
      !paused &&
      turn.key === lastTurnKey &&
      transcript.active_speaker_id === turn.speakerId;
    return (
      <motion.li
        key={turn.key}
        layout={recent ? "position" : false}
        className="py-2.5"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex h-5 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full transition-[background-color] duration-300 ${speaking ? "recording-pulse" : ""}`}
            style={{ backgroundColor: speaker.color ?? undefined }}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={(event) => openSpeakerMenu(speaker.id, event)}
            onContextMenu={(event) => openSpeakerMenu(speaker.id, event)}
            className="-mx-1 min-w-0 truncate rounded px-1 ui-text-label font-medium text-content-secondary transition-colors hover:bg-surface-interactive hover:text-content-primary"
          >
            {speaker.name}
          </button>
          {prefs.timestamps && (
            <span className="ml-auto shrink-0 ui-text-label tabular-nums text-content-muted">
              {formatTimestamp(turn.startMs)}
            </span>
          )}
        </div>
        <p className={`mt-1 pl-4 text-pretty ${textClass}`}>
          {turn.segments.map((segment, index) => (
            <span
              key={segment.id}
              className={`transition-colors duration-300 ${
                segment.settled ? "text-content-primary" : "text-content-muted"
              }`}
            >
              {index > 0 ? " " : ""}
              <RevealText
                id={segment.id}
                text={segment.text}
                seen={seenWords.current}
              />
            </span>
          ))}
        </p>
      </motion.li>
    );
  };

  const renderBookmark = (bookmark: Bookmark) => (
    <BookmarkRow
      key={bookmark.id}
      bookmark={bookmark}
      autoFocus={focusBookmarkId === bookmark.id}
      onCommit={(label) => handleBookmarkNote(bookmark.id, label)}
    />
  );

  const iconButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-interactive hover:text-content-primary disabled:opacity-40 disabled:hover:bg-transparent";

  const closeButton = (
    <button
      type="button"
      onClick={() => {
        if (compact) toggleCompact();
        recordingApi.hideLiveView(true).catch(() => {});
      }}
      aria-label={t({ id: "live.close", message: "Close live view" })}
      className={iconButton}
    >
      <X size={15} weight="bold" />
    </button>
  );

  const controlButton =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-secondary text-content-secondary transition-colors hover:border-border-hover hover:text-content-primary disabled:opacity-40";
  const compactControlButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-interactive hover:text-content-primary disabled:opacity-40 disabled:hover:bg-transparent";

  const renderControls = (small: boolean) => (
    <>
      <button
        type="button"
        onClick={handleTogglePause}
        disabled={!active}
        aria-label={
          paused
            ? t({ id: "record.active.resume", message: "Resume" })
            : t({ id: "record.active.pause", message: "Pause" })
        }
        className={small ? compactControlButton : controlButton}
      >
        {paused ? (
          <Play size={small ? 12 : 13} className="fill-current" />
        ) : (
          <Pause size={small ? 12 : 13} className="fill-current" />
        )}
      </button>
      <button
        type="button"
        onClick={handleBookmark}
        disabled={!active}
        aria-label={t({ id: "record.active.bookmark", message: "Bookmark" })}
        className={small ? compactControlButton : controlButton}
      >
        <BookmarkSimple size={small ? 13 : 14} />
      </button>
      <button
        type="button"
        onClick={handleStop}
        disabled={!active}
        aria-label={t({ id: "live.stop", message: "Stop recording" })}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#ff3b30] text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${
          small ? "h-6 w-6" : "h-9 w-9"
        }`}
      >
        <Stop size={small ? 10 : 12} weight="fill" />
      </button>
    </>
  );

  const menuSpeaker = speakerMenu ? speakerById.get(speakerMenu.id) : null;

  return (
    <div className="h-screen w-screen">
      <div
        className={`flex flex-col overflow-hidden bg-[var(--color-bg-secondary)] text-content-primary ${NATIVE_FRAME ? "" : "rounded-[14px] border border-border-primary transition-[height] ease-[cubic-bezier(0.16,1,0.3,1)]"}`}
        style={{
          height: compact ? HEADER_HEIGHT : "100%",
          transitionDuration: `${COMPACT_EASE_MS}ms`,
        }}
      >
        <header
          data-tauri-drag-region
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget) toggleCompact();
          }}
          className="relative flex shrink-0 items-center gap-2 px-2 pt-1"
          style={{ height: HEADER_HEIGHT - 2 }}
          ref={menuRef}
        >
          <DotsSix
            size={14}
            weight="bold"
            className="pointer-events-none absolute left-1/2 top-[3px] -translate-x-1/2 text-content-disabled"
            aria-hidden="true"
          />
          {closeButton}
          <span
            className={`pointer-events-none ml-1 h-2 w-2 shrink-0 rounded-full bg-[#ff3b30] ${
              paused || !active ? "opacity-40" : "recording-pulse"
            }`}
            aria-hidden="true"
          />
          <span className="pointer-events-none font-satoshi ui-text-body font-medium tabular-nums">
            {formatClock(state.elapsed_ms)}
          </span>
          {compact && silenceWarning ? (
            <Warning
              size={13}
              weight="fill"
              className="shrink-0 text-[var(--color-interactive)]"
              aria-label={silenceWarning}
            />
          ) : (
            <span className="pointer-events-none truncate ui-text-label text-content-muted">
              {transcript.status === "catching_up"
                ? t({ id: "live.status.catching_up", message: "Catching up" })
                : paused
                  ? t({ id: "live.status.paused", message: "Paused" })
                  : null}
            </span>
          )}
          <div className="ml-auto flex items-center">
            {compact ? (
              <div className="mr-1 flex items-center gap-0.5">
                {renderControls(true)}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={turns.length === 0}
                  aria-label={t({
                    id: "live.copy",
                    message: "Copy transcript",
                  })}
                  className={iconButton}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t({
                    id: "live.prefs",
                    message: "Live view settings",
                  })}
                  className={`${iconButton} ${menuOpen ? "bg-surface-interactive text-content-primary" : ""}`}
                >
                  <GearSix size={15} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={toggleCompact}
              aria-label={
                compact
                  ? t({ id: "live.expand", message: "Show transcript" })
                  : t({ id: "live.compact", message: "Hide transcript" })
              }
              className={iconButton}
            >
              {compact ? <CaretDown size={14} /> : <CaretUp size={14} />}
            </button>
          </div>
          <AnimatePresence>
            {menuOpen && <PrefsMenu prefs={prefs} onChange={updatePrefs} />}
          </AnimatePresence>
        </header>

        <div
          className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${
            compact ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          aria-hidden={compact}
        >
          <div className="relative min-h-0 flex-1">
            <div className="h-full list-fade-y">
              <motion.div
                ref={scrollerRef}
                layoutScroll
                onScroll={handleScroll}
                className="h-full overflow-y-auto px-4 py-4 custom-scrollbar"
              >
                {hasRows && (
                  <ul ref={listRef}>
                    {rows.map((row, index) =>
                      row.kind === "turn"
                        ? renderTurn(
                            row.turn,
                            index >= rows.length - LAYOUT_TAIL,
                          )
                        : renderBookmark(row.bookmark),
                    )}
                  </ul>
                )}
              </motion.div>
            </div>
            {turns.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-10 text-center ui-text-body-sm text-content-muted text-pretty">
                {emptyMessage}
              </div>
            )}
            <AnimatePresence>
              {silenceWarning && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  role="status"
                  title={silenceWarning}
                  className="ui-surface-menu absolute left-1/2 top-2 flex h-7 max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border-[color-mix(in_srgb,var(--color-interactive)_35%,var(--border-strong))]! bg-[color-mix(in_srgb,var(--color-interactive)_10%,var(--surface-floating))]! px-3 ui-text-label font-medium text-content-primary"
                >
                  <Warning
                    size={12}
                    weight="fill"
                    className="shrink-0 text-[var(--color-interactive)]"
                  />
                  <span className="min-w-0 truncate">{silenceWarning}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {!following && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  onClick={jumpToLive}
                  className="ui-surface-menu absolute bottom-2 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 ui-text-label font-medium text-content-secondary hover:text-content-primary"
                >
                  <ArrowDown size={11} />
                  {t({ id: "live.jump", message: "Jump to live" })}
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <footer className="flex h-16 shrink-0 items-center gap-3 px-4">
            <SourceLevel
              icon={<Microphone size={12} />}
              level={paused ? 0 : state.levels.microphone}
              on={microphoneOn}
            />
            <div className="flex flex-1 items-center justify-center gap-3">
              {renderControls(false)}
            </div>
            <div className="flex w-12 justify-end">
              <SourceLevel
                icon={<SpeakerHigh size={12} />}
                level={paused ? 0 : state.levels.system_audio}
                on={systemOn}
              />
            </div>
          </footer>
        </div>
      </div>

      <AnimatePresence>
        {speakerMenu && menuSpeaker && (
          <SpeakerContextMenu
            speaker={menuSpeaker}
            // You can't be merged away; system voices can merge into anyone.
            speakers={menuSpeaker.id === "you" ? [menuSpeaker] : speakers}
            x={speakerMenu.x}
            y={speakerMenu.y}
            onRename={(name) => handleRename(menuSpeaker.id, name)}
            onRecolor={(color) => handleRecolor(menuSpeaker.id, color)}
            onMerge={(into) => {
              handleMerge(menuSpeaker.id, into);
              setSpeakerMenu(null);
            }}
            onClose={() => setSpeakerMenu(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LiveView;
