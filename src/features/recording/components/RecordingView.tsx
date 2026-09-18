import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  BookmarkSimple,
  CaretUpDown,
  Check,
  Microphone,
  Pause,
  Play,
  SpeakerHigh,
  Stop,
  X,
} from "@phosphor-icons/react";
import * as recordingApi from "../api";
import { useRecordingSession } from "../useRecordingSession";
import { useInputDevices, useSettings } from "../../settings/queries";
import { libraryKeys } from "../../library/queries";
import { formatTimestamp } from "../../library/components/library-utils";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import type {
  AudioApp,
  Bookmark,
  LibraryItem,
  RecordingCapabilities,
  RecordingSources,
} from "../../../types";

type StartError = {
  message: string;
  action?: "microphone" | "system_audio";
};

type NamingDialog = {
  resumeOnCancel: boolean;
};

const METER_DOTS = 24;
const METER_DOT_SIZE = 3;
const METER_DOT_GAP = 2;

type SourceChoices = {
  microphone: boolean;
  systemAudio: boolean;
  // `null` follows the dictation microphone, `""` is the system default.
  microphoneDevice: string | null;
  apps: Array<{ id: string; name: string }>;
};

const DEFAULT_CHOICES: SourceChoices = {
  microphone: true,
  systemAudio: false,
  microphoneDevice: null,
  apps: [],
};

const choicesFromSources = (sources: RecordingSources): SourceChoices => ({
  microphone: sources.microphone !== null,
  systemAudio: sources.system_audio !== null,
  // A recording started on the system default is saved with no device id.
  microphoneDevice: sources.microphone
    ? (sources.microphone.device_id ?? "")
    : null,
  // Apps without a bundle id are keyed by pid, which won't match next launch.
  apps: (sources.system_audio?.apps ?? []).filter(
    (app) => !app.id.startsWith("pid:"),
  ),
});

const formatClock = (elapsedMs: number) => {
  const total = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const defaultRecordingName = (date: Date) => {
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Recording - ${day}, ${time}`;
};

const LevelMeter = ({ level }: { level: number }) => {
  const active = Math.min(METER_DOTS, Math.round(level * METER_DOTS));
  return (
    <div
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${METER_DOTS}, ${METER_DOT_SIZE}px)`,
        gap: METER_DOT_GAP,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: METER_DOTS }, (_, index) => {
        const lit = index < active;
        const color =
          index >= METER_DOTS - 3
            ? "var(--color-error)"
            : "var(--color-success)";
        return (
          <span
            key={index}
            style={{
              width: METER_DOT_SIZE,
              height: METER_DOT_SIZE,
              backgroundColor: color,
              opacity: lit ? 0.95 : 0.16,
              borderRadius: lit ? 0.5 : "50%",
              transition:
                "opacity 0.12s ease-out, border-radius 0.12s ease-out",
            }}
          />
        );
      })}
    </div>
  );
};

type SourceMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
};

type SourceMenuSection = {
  key: string;
  title?: string;
  multiple?: boolean;
  emptyLabel?: string;
  items: SourceMenuItem[];
};

// A settings row value that opens a menu. Multiple-choice sections keep the
// menu open so several apps can be ticked in one go.
const SourceMenu = ({
  ariaLabel,
  valueLabel,
  valueIcons,
  sections,
  onOpenChange,
}: {
  ariaLabel: string;
  valueLabel: string;
  valueIcons?: ReactNode;
  sections: SourceMenuSection[];
  onOpenChange: (open: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  useClickOutside(ref, () => change(false), open);

  return (
    <div className="relative flex min-w-0 flex-1 justify-end" ref={ref}>
      <button
        type="button"
        onClick={() => change(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`-mr-2 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 ui-text-body-sm transition-colors hover:bg-surface-interactive hover:text-content-primary ${
          open
            ? "bg-surface-interactive text-content-primary"
            : "text-content-secondary"
        }`}
      >
        {valueIcons}
        <span className="truncate">{valueLabel}</span>
        <CaretUpDown
          size={11}
          className="shrink-0 text-content-muted"
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.98, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute -right-2 top-full z-30 mt-1.5 max-h-[300px] w-[260px] overflow-y-auto py-1 custom-scrollbar"
          >
            {sections.map((section, index) => (
              <div key={section.key}>
                {index > 0 && (
                  <div className="mx-3 my-1 border-t border-border-secondary" />
                )}
                {section.title && (
                  <div className="px-3 pb-1 pt-1 ui-text-uppercase-micro ui-color-muted">
                    {section.title}
                  </div>
                )}
                {section.items.length === 0 && section.emptyLabel && (
                  <p className="px-3 pb-1.5 ui-text-label text-content-muted text-pretty">
                    {section.emptyLabel}
                  </p>
                )}
                {section.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role={
                      section.multiple ? "menuitemcheckbox" : "menuitemradio"
                    }
                    aria-checked={item.selected}
                    onClick={() => {
                      item.onSelect();
                      if (!section.multiple) change(false);
                    }}
                    className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1 text-left ui-text-body-sm transition-colors hover:bg-[var(--surface-interactive)] ${
                      item.selected
                        ? "ui-color-primary"
                        : "ui-color-secondary hover:text-content-primary"
                    }`}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    <span className="flex w-3 shrink-0 items-center justify-center">
                      {item.selected && <Check size={12} aria-hidden="true" />}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const BookmarkNoteRow = ({
  bookmark,
  autoFocus,
  onCommit,
  onRemove,
}: {
  bookmark: Bookmark;
  autoFocus: boolean;
  onCommit: (label: string) => void;
  onRemove: () => void;
}) => {
  const { t } = useLingui();
  const [draft, setDraft] = useState(bookmark.label ?? "");
  const commit = () => {
    const value = draft.trim();
    if (value !== (bookmark.label ?? "")) onCommit(value);
  };
  return (
    <li className="group/bookmark flex h-9 items-center gap-3">
      <span className="flex w-4 shrink-0 justify-center">
        <BookmarkSimple
          size={12}
          weight="fill"
          className="text-[var(--color-cloud)]"
          aria-hidden="true"
        />
      </span>
      <span className="w-14 shrink-0 ui-text-body-sm tabular-nums text-content-muted">
        {formatTimestamp(bookmark.at_ms)}
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
        className="min-w-0 flex-1 bg-transparent ui-text-body-sm text-content-primary outline-hidden placeholder:text-content-disabled"
        autoFocus={autoFocus}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t({
          id: "record.bookmark.remove",
          message: "Remove bookmark",
        })}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-content-disabled opacity-0 transition-[opacity,color,background-color] hover:bg-surface-interactive hover:text-red-500 group-hover/bookmark:opacity-100 focus-visible:opacity-100"
      >
        <X size={12} />
      </button>
    </li>
  );
};

const HOLD_DELETE_MS = 1500;

// Press and hold; releasing early cancels. The fill shows how far along it is.
const HoldToDeleteButton = ({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) => {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    startedAt.current = null;
    setProgress(0);
  }, []);

  const step = useCallback(
    (now: number) => {
      if (startedAt.current === null) return;
      const next = Math.min(1, (now - startedAt.current) / HOLD_DELETE_MS);
      setProgress(next);
      if (next >= 1) {
        cancel();
        onConfirm();
        return;
      }
      frame.current = requestAnimationFrame(step);
    },
    [cancel, onConfirm],
  );

  const start = () => {
    if (disabled) return;
    startedAt.current = performance.now();
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => cancel, [cancel]);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      className="relative overflow-hidden rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-red-500 disabled:opacity-50 select-none"
    >
      <span
        className="absolute inset-y-0 left-0 bg-red-500/15"
        style={{ width: `${progress * 100}%` }}
        aria-hidden="true"
      />
      <span className="relative">{label}</span>
    </button>
  );
};

type RecordingViewProps = {
  isActive: boolean;
  onOpenLibraryItem: (id: string) => void;
};

const RecordingView = ({ isActive, onOpenLibraryItem }: RecordingViewProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { state, applyState } = useRecordingSession();
  const { data: devices = [] } = useInputDevices(isActive);
  const { data: defaultDeviceId = null } = useSettings(
    (settings) => settings.microphone_device ?? null,
    isActive,
  );

  const [capabilities, setCapabilities] = useState<RecordingCapabilities>({
    system_audio: false,
    app_selection: false,
  });
  const [choices, setChoices] = useState<SourceChoices>(DEFAULT_CHOICES);
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<StartError | null>(null);
  const [naming, setNaming] = useState<NamingDialog | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<LibraryItem | null>(null);
  const [focusBookmarkId, setFocusBookmarkId] = useState<string | null>(null);
  const [microphoneMenuOpen, setMicrophoneMenuOpen] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);

  const active = state.status === "recording" || state.status === "paused";
  const paused = state.status === "paused";
  const busy = state.status === "saving" || saving;
  const selectedApps = choices.apps;

  useEffect(() => {
    setStartError(null);
  }, [choices]);

  useEffect(() => {
    Promise.all([
      recordingApi.getRecordingCapabilities(),
      recordingApi.getLastRecordingSources().catch(() => null),
    ])
      .then(([next, last]) => {
        setCapabilities(next);
        const restored = last ? choicesFromSources(last) : DEFAULT_CHOICES;
        setChoices({
          ...restored,
          systemAudio: restored.systemAudio && next.system_audio,
        });
      })
      .catch(() => {});
  }, []);

  const refreshApps = useCallback(() => {
    if (!capabilities.app_selection) return;
    recordingApi
      .listAudioApps()
      .then(setApps)
      .catch(() => {});
  }, [capabilities.app_selection]);

  const wantsApps = !active && (systemMenuOpen || selectedApps.length > 0);
  useEffect(() => {
    if (!isActive || !wantsApps) return;
    refreshApps();
    const timer = setInterval(refreshApps, 4000);
    return () => clearInterval(timer);
  }, [isActive, wantsApps, refreshApps]);

  // Tray "Finish Recording" lands here: the backend already paused.
  useEffect(() => {
    if (!state.finish_requested || naming || !active) return;
    setNameDraft(defaultRecordingName(new Date()));
    setNaming({ resumeOnCancel: true });
  }, [state.finish_requested, naming, active]);

  const systemDefaultLabel = useMemo(() => {
    const fallback = devices.find((device) => device.is_default)?.name;
    return fallback
      ? t({
          id: "record.setup.microphone.default_named",
          message: `System Default (${fallback})`,
        })
      : t({ id: "record.setup.microphone.default", message: "System Default" });
  }, [devices, t]);

  // A remembered microphone that is no longer connected falls back to the default.
  const rememberedDevice =
    choices.microphoneDevice !== null &&
    (choices.microphoneDevice === "" ||
      devices.some((device) => device.id === choices.microphoneDevice))
      ? choices.microphoneDevice
      : null;
  const effectiveDevice = rememberedDevice ?? defaultDeviceId ?? "";

  const describeError = (raw: unknown): StartError => {
    const message = raw instanceof Error ? raw.message : String(raw);
    switch (message) {
      case "microphone_permission":
        return {
          message: t({
            id: "record.error.microphone_permission",
            message: "Glimpse needs microphone access.",
          }),
          action: "microphone",
        };
      case "system_audio_permission":
        return {
          message: t({
            id: "record.error.system_audio_permission",
            message: "Glimpse needs permission to record system audio.",
          }),
          action: "system_audio",
        };
      case "no_microphone":
        return {
          message: t({
            id: "record.error.no_microphone",
            message: "No microphone was found.",
          }),
        };
      case "no_model":
        return {
          message: t({
            id: "record.error.no_model",
            message: "Install a speech model in Settings first.",
          }),
        };
      case "no_sources":
        return {
          message: t({
            id: "record.error.no_sources",
            message: "Turn on at least one source.",
          }),
        };
      case "already_recording":
        return {
          message: t({
            id: "record.error.already_recording",
            message: "A recording is already running.",
          }),
        };
      default:
        return { message };
    }
  };

  const handleStart = async () => {
    if (starting) return;
    const sources: RecordingSources = {
      microphone: choices.microphone
        ? { device_id: effectiveDevice || null }
        : null,
      system_audio: choices.systemAudio
        ? {
            apps:
              capabilities.app_selection && selectedApps.length > 0
                ? selectedApps
                : null,
          }
        : null,
    };
    if (!sources.microphone && !sources.system_audio) {
      setStartError(describeError("no_sources"));
      return;
    }
    setStarting(true);
    setStartError(null);
    setSaved(null);
    try {
      applyState(await recordingApi.startRecordingSession(sources));
    } catch (err) {
      setStartError(describeError(err));
    } finally {
      setStarting(false);
    }
  };

  const handleTogglePause = async () => {
    try {
      applyState(
        paused
          ? await recordingApi.resumeRecordingSession()
          : await recordingApi.pauseRecordingSession(),
      );
    } catch (err) {
      console.error("Failed to toggle pause:", err);
    }
  };

  const handleBookmark = async () => {
    try {
      const bookmark = await recordingApi.addRecordingBookmark();
      setFocusBookmarkId(bookmark.id);
    } catch (err) {
      console.error("Failed to add bookmark:", err);
    }
  };

  const handleBookmarkNote = async (id: string, label: string) => {
    try {
      applyState(await recordingApi.updateRecordingBookmark(id, label || null));
    } catch (err) {
      console.error("Failed to update bookmark:", err);
    }
  };

  const handleRemoveBookmark = async (id: string) => {
    try {
      applyState(await recordingApi.removeRecordingBookmark(id));
    } catch (err) {
      console.error("Failed to remove bookmark:", err);
    }
  };

  const handleDiscard = async () => {
    if (saving) return;
    setSaving(true);
    try {
      applyState(await recordingApi.discardRecordingSession());
      setNaming(null);
    } catch (err) {
      console.error("Failed to discard recording:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDone = async () => {
    const wasRecording = state.status === "recording";
    if (wasRecording) {
      try {
        applyState(await recordingApi.pauseRecordingSession());
      } catch (err) {
        console.error("Failed to pause before naming:", err);
      }
    }
    setNameDraft(defaultRecordingName(new Date()));
    setNaming({ resumeOnCancel: wasRecording });
  };

  const handleCancelNaming = async () => {
    const dialog = naming;
    setNaming(null);
    if (!dialog) return;
    try {
      applyState(
        dialog.resumeOnCancel
          ? await recordingApi.resumeRecordingSession()
          : await recordingApi.pauseRecordingSession(),
      );
    } catch (err) {
      console.error("Failed to resume after cancel:", err);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const item = await recordingApi.finishRecordingSession(nameDraft);
      queryClient.invalidateQueries({ queryKey: libraryKeys.all });
      setNaming(null);
      setSaved(item);
    } catch (err) {
      setStartError(describeError(err));
      setNaming(null);
    } finally {
      setSaving(false);
    }
  };

  const openPermissionSettings = (action: StartError["action"]) => {
    if (action === "microphone") {
      invoke("open_microphone_settings").catch(() => {});
    } else if (action === "system_audio") {
      recordingApi.openSystemAudioSettings().catch(() => {});
    }
  };

  const toggleApp = (app: AudioApp) => {
    setChoices((prev) => ({
      ...prev,
      systemAudio: true,
      apps: prev.apps.some((entry) => entry.id === app.id)
        ? prev.apps.filter((entry) => entry.id !== app.id)
        : [...prev.apps, { id: app.id, name: app.name }],
    }));
  };

  const idle = !active && !busy;
  const secondaryButton =
    "flex h-9 w-[104px] items-center justify-center gap-1.5 rounded-full border border-border-secondary ui-text-body-sm font-medium text-content-secondary transition-colors hover:border-border-hover hover:text-content-primary disabled:cursor-default disabled:opacity-30 disabled:hover:border-border-secondary disabled:hover:text-content-secondary";

  const microphoneOn = active
    ? Boolean(state.sources.microphone)
    : choices.microphone;
  const systemOn = active
    ? Boolean(state.sources.system_audio)
    : choices.systemAudio;

  const offLabel = t({ id: "record.setup.source.off", message: "Off" });
  const entireSystemLabel = t({
    id: "record.setup.system_mode.all",
    message: "Entire system",
  });

  const microphoneOptions = [
    { id: "", name: systemDefaultLabel },
    ...devices.map((device) => ({ id: device.id, name: device.name })),
  ];
  const microphoneSections: SourceMenuSection[] = [
    {
      key: "off",
      items: [
        {
          key: "off",
          label: offLabel,
          selected: !choices.microphone,
          onSelect: () =>
            setChoices((prev) => ({ ...prev, microphone: false })),
        },
      ],
    },
    {
      key: "devices",
      items: microphoneOptions.map((device) => ({
        key: device.id || "default",
        label: device.name,
        selected: choices.microphone && device.id === effectiveDevice,
        onSelect: () => {
          setChoices((prev) => ({
            ...prev,
            microphone: true,
            microphoneDevice: device.id,
          }));
        },
      })),
    },
  ];
  const microphoneValue = choices.microphone
    ? (microphoneOptions.find((device) => device.id === effectiveDevice)
        ?.name ?? systemDefaultLabel)
    : offLabel;

  const systemSections: SourceMenuSection[] = [
    {
      key: "mode",
      items: [
        {
          key: "off",
          label: offLabel,
          selected: !choices.systemAudio,
          onSelect: () =>
            setChoices((prev) => ({ ...prev, systemAudio: false })),
        },
        {
          key: "all",
          label: entireSystemLabel,
          selected: choices.systemAudio && selectedApps.length === 0,
          onSelect: () => {
            setChoices((prev) => ({ ...prev, systemAudio: true, apps: [] }));
          },
        },
      ],
    },
  ];
  if (capabilities.app_selection) {
    // Remembered apps stay listed while closed so they can be deselected.
    const menuApps: AudioApp[] = [
      ...apps,
      ...selectedApps.filter(
        (selected) => !apps.some((app) => app.id === selected.id),
      ),
    ];
    systemSections.push({
      key: "apps",
      title: t({ id: "record.setup.apps", message: "Only these apps" }),
      multiple: true,
      emptyLabel: t({
        id: "record.setup.apps.empty",
        message: "Open the app you want to capture and it will show up here.",
      }),
      items: menuApps.map((app) => ({
        key: app.id,
        label: app.name,
        icon: app.icon ? (
          <img
            src={app.icon}
            alt=""
            className="h-4 w-4 shrink-0 rounded-[4px]"
          />
        ) : (
          <AppWindow size={14} className="shrink-0 text-content-muted" />
        ),
        selected:
          choices.systemAudio &&
          selectedApps.some((entry) => entry.id === app.id),
        onSelect: () => toggleApp(app),
      })),
    });
  }
  const systemValue = !choices.systemAudio
    ? offLabel
    : selectedApps.length > 1
      ? t({
          id: "record.setup.apps.count",
          message: plural(selectedApps.length, {
            one: "# app",
            other: "# apps",
          }),
        })
      : (selectedApps[0]?.name ?? entireSystemLabel);
  const systemValueIcons =
    choices.systemAudio && selectedApps.length > 0 ? (
      <span className="flex shrink-0 items-center gap-1">
        {selectedApps.slice(0, 4).map((selected) => {
          const icon = apps.find((app) => app.id === selected.id)?.icon;
          return icon ? (
            <img
              key={selected.id}
              src={icon}
              alt=""
              className="h-4 w-4 rounded-[4px]"
            />
          ) : (
            <AppWindow
              key={selected.id}
              size={14}
              className="text-content-muted"
            />
          );
        })}
      </span>
    ) : undefined;

  // The clock steps down a size per extra field so hours still fit the column.
  const hoursElapsed = Math.floor(state.elapsed_ms / 3_600_000);
  const clockSize =
    hoursElapsed >= 10
      ? "text-[72px]"
      : hoursElapsed >= 1
        ? "text-[84px]"
        : "text-[96px]";

  const renderStatusSlot = () => {
    if (startError) {
      return (
        <>
          <span className="ui-color-error">{startError.message}</span>
          {startError.action && (
            <button
              type="button"
              onClick={() => openPermissionSettings(startError.action)}
              className="ui-color-error underline decoration-red-400/60 hover:opacity-80"
            >
              {t({
                id: "record.error.open_settings",
                message: "Open Settings",
              })}
            </button>
          )}
        </>
      );
    }
    if (saved && idle) {
      return (
        <>
          <span className="text-content-muted">
            {t({
              id: "record.saved",
              message: `Saved “${saved.name}” to Library.`,
            })}
          </span>
          <button
            type="button"
            onClick={() => onOpenLibraryItem(saved.id)}
            className="text-content-secondary underline decoration-border-hover hover:text-content-primary"
          >
            {t({ id: "record.saved.open", message: "Open" })}
          </button>
        </>
      );
    }
    return null;
  };

  const renderBookmarks = () => {
    if (state.bookmarks.length === 0) return null;
    // Newest first, so a new bookmark is visible without scrolling.
    const sorted = [...state.bookmarks].sort((a, b) => b.at_ms - a.at_ms);
    return (
      // The scrollbar sits outside the column, clear of the remove buttons.
      <ul className="-mr-5 h-full overflow-y-auto pr-[14px] [scrollbar-gutter:stable] custom-scrollbar">
        {sorted.map((bookmark) => (
          <BookmarkNoteRow
            key={bookmark.id}
            bookmark={bookmark}
            autoFocus={focusBookmarkId === bookmark.id}
            onCommit={(label) => void handleBookmarkNote(bookmark.id, label)}
            onRemove={() => void handleRemoveBookmark(bookmark.id)}
          />
        ))}
      </ul>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="mt-10 flex flex-col items-center">
        <div
          className={`flex h-24 items-center font-satoshi leading-none tracking-tight tabular-nums ${clockSize} ${
            idle
              ? "text-content-disabled"
              : paused
                ? "text-content-secondary"
                : "ui-color-primary"
          }`}
        >
          {formatClock(state.elapsed_ms)}
        </div>
        <div className="mt-4 flex h-5 items-center gap-2 ui-text-body-sm text-content-muted">
          {active && (
            <>
              <span
                className={`h-2 w-2 rounded-full bg-[#ff3b30] ${
                  paused ? "opacity-40" : "recording-pulse"
                }`}
                aria-hidden="true"
              />
              {paused
                ? t({ id: "record.active.paused", message: "Paused" })
                : t({ id: "record.active.recording", message: "Recording" })}
            </>
          )}
        </div>
      </div>

      <div
        className={`mt-10 divide-y divide-border-primary border-y border-border-primary ${
          microphoneMenuOpen || systemMenuOpen ? "relative z-dropdown-open" : ""
        }`}
      >
        <section
          className={`flex h-12 items-center gap-3 transition-opacity duration-200 ${
            active && !microphoneOn ? "opacity-35" : ""
          }`}
        >
          <Microphone size={16} className="shrink-0 text-content-muted" />
          <span className="shrink-0 ui-text-body font-medium text-content-primary">
            {t({ id: "record.setup.microphone", message: "Microphone" })}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end">
            {active ? (
              microphoneOn ? (
                <LevelMeter level={paused ? 0 : state.levels.microphone} />
              ) : (
                <span className="ui-text-body-sm text-content-secondary">
                  {offLabel}
                </span>
              )
            ) : (
              <SourceMenu
                ariaLabel={t({
                  id: "record.setup.microphone",
                  message: "Microphone",
                })}
                valueLabel={microphoneValue}
                sections={microphoneSections}
                onOpenChange={setMicrophoneMenuOpen}
              />
            )}
          </div>
        </section>

        <section
          className={`flex h-12 items-center gap-3 transition-opacity duration-200 ${
            active && !systemOn ? "opacity-35" : ""
          }`}
        >
          <SpeakerHigh size={16} className="shrink-0 text-content-muted" />
          <span className="shrink-0 ui-text-body font-medium text-content-primary">
            {t({ id: "record.setup.system_audio", message: "System Audio" })}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end">
            {!capabilities.system_audio ? (
              <span className="ui-text-body-sm text-content-disabled">
                {t({
                  id: "record.setup.system_audio.unsupported",
                  message: "Needs macOS 14.2 or later",
                })}
              </span>
            ) : active ? (
              systemOn ? (
                <LevelMeter level={paused ? 0 : state.levels.system_audio} />
              ) : (
                <span className="ui-text-body-sm text-content-secondary">
                  {offLabel}
                </span>
              )
            ) : (
              <SourceMenu
                ariaLabel={t({
                  id: "record.setup.system_audio",
                  message: "System Audio",
                })}
                valueLabel={systemValue}
                valueIcons={systemValueIcons}
                sections={systemSections}
                onOpenChange={setSystemMenuOpen}
              />
            )}
          </div>
        </section>
      </div>

      <div className="mt-3 min-h-0 flex-1">{active && renderBookmarks()}</div>

      <div className="flex items-center justify-center gap-3 pt-6">
        <button
          type="button"
          onClick={handleTogglePause}
          disabled={!active || busy}
          className={secondaryButton}
        >
          {paused ? (
            <Play size={13} className="fill-current" />
          ) : (
            <Pause size={13} className="fill-current" />
          )}
          {paused
            ? t({ id: "record.active.resume", message: "Resume" })
            : t({ id: "record.active.pause", message: "Pause" })}
        </button>
        <button
          type="button"
          onClick={handleBookmark}
          disabled={!active || busy}
          className={secondaryButton}
        >
          <BookmarkSimple size={13} />
          {t({ id: "record.active.bookmark", message: "Bookmark" })}
        </button>
        <button
          type="button"
          onClick={active ? handleDone : handleStart}
          disabled={starting || busy}
          className="ui-button-primary flex h-9 w-[150px] items-center justify-center gap-2 rounded-full ui-text-body-sm"
        >
          {active ? (
            <>
              <Stop size={12} weight="fill" />
              {t({ id: "record.active.done", message: "Done" })}
            </>
          ) : starting ? (
            t({ id: "record.setup.starting", message: "Starting..." })
          ) : (
            t({ id: "record.setup.start", message: "Start Recording" })
          )}
        </button>
      </div>

      <div className="mt-3 mb-8 flex h-5 items-center justify-center gap-2 ui-text-label">
        {renderStatusSlot()}
      </div>

      {createPortal(
        <AnimatePresence>
          {naming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6 backdrop-blur-xs"
              onClick={handleCancelNaming}
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
                <p className="ui-text-body-lg font-semibold text-content-primary">
                  {t({ id: "record.name.title", message: "Name recording" })}
                </p>
                <p className="mt-0.5 ui-text-label text-content-muted tabular-nums">
                  {formatClock(state.elapsed_ms)}
                  {state.bookmarks.length === 1
                    ? ` · ${t({ id: "record.name.bookmark_one", message: "1 bookmark" })}`
                    : state.bookmarks.length > 1
                      ? ` · ${t({
                          id: "record.name.bookmarks",
                          message: `${state.bookmarks.length} bookmarks`,
                        })}`
                      : ""}
                </p>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSave();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      void handleCancelNaming();
                    }
                  }}
                  onFocus={(event) => event.target.select()}
                  className="mt-4 h-10 w-full rounded-lg border border-border-primary bg-[var(--color-bg-surface)] px-3 ui-text-body text-content-primary outline-hidden focus:border-border-hover"
                  autoFocus
                />
                <div className="mt-4 flex items-center gap-2">
                  <HoldToDeleteButton
                    label={t({
                      id: "record.name.delete",
                      message: "Hold to delete",
                    })}
                    onConfirm={() => void handleDiscard()}
                    disabled={saving}
                  />
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleCancelNaming}
                    disabled={saving}
                    className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary disabled:opacity-50"
                  >
                    {t({ id: "record.name.cancel", message: "Cancel" })}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="ui-button-primary rounded-lg px-4 py-2 ui-text-body-sm"
                  >
                    {saving
                      ? t({ id: "record.name.saving", message: "Saving..." })
                      : t({
                          id: "record.name.save",
                          message: "Save to Library",
                        })}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export default RecordingView;
