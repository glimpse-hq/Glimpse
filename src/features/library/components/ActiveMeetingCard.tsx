import { useLingui } from "@lingui/react/macro";
import {
  HardDrives,
  Microphone,
  MonitorPlay,
  Stop,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeetingState } from "../../../types";
import { useMeetingLevels } from "../queries";

const WAVEFORM_BARS = 160;
const WAVEFORM_FRAME_MS = 50;

function formatElapsed(startedAt?: string | null): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started)) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function LiveWaveform({
  level,
  color,
  label,
}: {
  level: number;
  color: string;
  label: string;
}) {
  const [samples, setSamples] = useState<number[]>(() =>
    Array.from({ length: WAVEFORM_BARS }, () => 0),
  );
  const currentLevelRef = useRef(0);

  useEffect(() => {
    currentLevelRef.current = Number.isFinite(level)
      ? Math.min(1, Math.max(0, level))
      : 0;
  }, [level]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSamples((current) => [...current.slice(1), currentLevelRef.current]);
    }, WAVEFORM_FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="grid h-12 min-w-0 items-center gap-px overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${WAVEFORM_BARS}, minmax(0, 1fr))`,
      }}
      role="img"
      aria-label={label}
    >
      {samples.map((sample, index) => (
        <span
          // The position is stable while the sample value moves through the strip.
          key={index}
          className="w-full min-w-0 rounded-full transition-[height,opacity] duration-75"
          style={{
            height: `${Math.max(3, sample * 42)}px`,
            backgroundColor: color,
            opacity: sample > 0.015 ? 0.9 : 0.18,
          }}
        />
      ))}
    </div>
  );
}

type ActiveMeetingCardProps = {
  meeting: MeetingState;
  stopping: boolean;
  onStop: () => void;
};

export default function ActiveMeetingCard({
  meeting,
  stopping,
  onStop,
}: ActiveMeetingCardProps) {
  const { t } = useLingui();
  const { data: levels } = useMeetingLevels(meeting.recording);
  const [elapsed, setElapsed] = useState(() =>
    formatElapsed(meeting.started_at),
  );
  const microphoneSignalSeen = useRef(false);
  const [showMicrophoneWarning, setShowMicrophoneWarning] = useState(false);

  useEffect(() => {
    setElapsed(formatElapsed(meeting.started_at));
    const timer = window.setInterval(() => {
      setElapsed(formatElapsed(meeting.started_at));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [meeting.started_at]);

  useEffect(() => {
    microphoneSignalSeen.current = false;
    setShowMicrophoneWarning(false);
    const timer = window.setTimeout(() => {
      if (!microphoneSignalSeen.current) setShowMicrophoneWarning(true);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [meeting.started_at]);

  useEffect(() => {
    if ((levels?.microphone_level ?? 0) > 0.015) {
      microphoneSignalSeen.current = true;
      setShowMicrophoneWarning(false);
    }
  }, [levels?.microphone_level]);

  const microphoneName =
    meeting.microphone_name ||
    t({
      id: "meeting.active.microphone.default",
      message: "Default microphone",
    });
  const sourceName =
    meeting.source_app_name ||
    t({ id: "meeting.active.system.default", message: "System audio" });
  const waveformLabels = useMemo(
    () => ({
      microphone: t({
        id: "meeting.active.microphone.waveform",
        message: "Live microphone level",
      }),
      system: t({
        id: "meeting.active.system.waveform",
        message: "Live meeting audio level",
      }),
    }),
    [t],
  );

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl border border-border-secondary bg-surface-surface shadow-sm">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-error)]/45 to-transparent" />
      <div className="flex min-w-0 flex-col gap-4 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-error)] opacity-40" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-error)]" />
            </span>
            <div className="min-w-0">
              <p className="ui-text-body-lg-strong text-content-primary">
                {t({
                  id: "meeting.active.title",
                  message: "Recording in progress",
                })}
              </p>
              <p className="mt-0.5 ui-text-label text-content-muted">
                {t({
                  id: "meeting.active.subtitle",
                  message: "Both audio sources are being saved separately",
                })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <time className="font-mono text-base font-semibold tabular-nums text-content-primary">
              {elapsed}
            </time>
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-error)] px-3 ui-text-body-sm-strong text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Stop size={13} weight="fill" aria-hidden="true" />
              {t({ id: "library.meeting.stop", message: "Stop recording" })}
            </button>
          </div>
        </div>

        {(meeting.capture_error || levels?.capture_error) && (
          <p
            role="alert"
            className="flex items-center gap-2 ui-text-body-sm text-[var(--color-error)]"
          >
            <WarningCircle size={16} weight="fill" aria-hidden="true" />
            {t({
              id: "meeting.active.capture_failed",
              message:
                "Audio capture was interrupted. Stop recording to save the captured audio; retry if saving fails.",
            })}
          </p>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-border-primary bg-surface-secondary px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-10)] text-[var(--color-accent)]">
                <Microphone size={16} weight="fill" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="ui-text-label text-content-muted">
                  {t({
                    id: "meeting.active.microphone",
                    message: "Microphone",
                  })}
                </p>
                <p className="truncate ui-text-body-sm-strong text-content-primary">
                  {microphoneName}
                </p>
              </div>
            </div>
            <LiveWaveform
              level={levels?.microphone_level ?? 0}
              color="var(--color-accent)"
              label={waveformLabels.microphone}
            />
            {showMicrophoneWarning && (
              <p className="flex items-center gap-1.5 ui-text-label text-[var(--color-warning)]">
                <WarningCircle size={14} weight="fill" aria-hidden="true" />
                {t({
                  id: "meeting.active.microphone.no_signal",
                  message: "No microphone signal detected",
                })}
              </p>
            )}
          </div>

          <div className="min-w-0 rounded-xl border border-border-primary bg-surface-secondary px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]">
                <MonitorPlay size={16} weight="fill" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="ui-text-label text-content-muted">
                  {t({
                    id: "meeting.active.system",
                    message: "Meeting audio",
                  })}
                </p>
                <p className="truncate ui-text-body-sm-strong text-content-primary">
                  {sourceName}
                </p>
              </div>
              <span className="ml-auto shrink-0 ui-text-label text-content-disabled">
                {meeting.application_isolated
                  ? t({
                      id: "meeting.active.system.scope.application",
                      message: "App only",
                    })
                  : t({
                      id: "meeting.active.system.scope",
                      message: "System capture",
                    })}
              </span>
            </div>
            <LiveWaveform
              level={levels?.system_level ?? 0}
              color="var(--color-warning)"
              label={waveformLabels.system}
            />
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 border-t border-border-primary pt-3 ui-text-label text-content-muted">
          <HardDrives size={14} aria-hidden="true" />
          <span>
            {t({
              id: "meeting.active.local",
              message:
                "Saved locally · Transcription starts when the recording stops",
            })}
          </span>
        </div>
      </div>
    </section>
  );
}
