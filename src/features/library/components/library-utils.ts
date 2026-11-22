import { msg } from "@lingui/core/macro";
import { i18n } from "../../../i18n";
import type {
  AudioSources,
  LibraryItem,
  LibraryItemStatus,
} from "../../../types";

export const SUPPORTED_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "mp4",
  "mov",
  "webm",
  "mkv",
];
export const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 2.5, 3, 4];

export const clampProgress = (value: number) => Math.min(Math.max(value, 0), 1);

export const shouldShowImportProgress = (value: number) => {
  const clamped = clampProgress(value);
  return clamped >= 0.02 && clamped < 0.98;
};

export const formatDuration = (seconds: number) =>
  Number.isFinite(seconds) && seconds > 0
    ? formatTimestamp(Math.round(seconds) * 1000)
    : "0:00";

export const formatPlaybackRate = (rate: number) =>
  rate.toFixed(2).replace(/\.?0+$/, "");

export const formatTimestamp = (ms: number, padMinutes = false) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm =
    hours > 0 || padMinutes
      ? minutes.toString().padStart(2, "0")
      : minutes.toString();
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const getFileExtension = (path: string) => {
  const parts = path.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
};

export const uniquePaths = (paths: string[]) => Array.from(new Set(paths));
export const formatLibraryName = (name: string) => name.replace(/[_.]/g, " ");

const SLOT = "\u0001";
// A filled-in date or time: digits and punctuation with at least one digit
// and at most two short words (a month, AM/PM).
const DATE_GAP = String.raw`[\p{N}\p{P}\p{Z}\s]*`;
const DATE_WORD = String.raw`\p{L}[\p{L}\p{M}]{0,6}(?![\p{L}\p{M}])`;
const DATE_SLOT = `(?=[^\\p{L}]*\\p{N}|(?:${DATE_GAP}${DATE_WORD}){1,2}[^\\p{L}]*\\p{N})${DATE_GAP}(?:${DATE_WORD}${DATE_GAP}){0,2}`;
let defaultNames: { locale: string; pattern: RegExp } | null = null;

// The names a recording gets when it's saved without one, in the app language.
const isDefaultRecordingName = (name: string) => {
  if (defaultNames?.locale !== i18n.locale) {
    const templates = [
      i18n._("record.default_name", { day: SLOT, time: SLOT }),
      i18n._("native.recording.default_name", { date: SLOT }),
    ].map((template) =>
      template
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .split(SLOT)
        .join(DATE_SLOT),
    );
    defaultNames = {
      locale: i18n.locale,
      pattern: new RegExp(`^(?:${templates.join("|")})$`, "u"),
    };
  }
  return defaultNames.pattern.test(name);
};

export const isUntitledRecording = (
  item: Pick<LibraryItem, "name" | "kind" | "created_at">,
) =>
  item.kind === "recording" &&
  !Number.isNaN(new Date(item.created_at).getTime()) &&
  isDefaultRecordingName(item.name);

// A recording that was never named shows when it was made, so the date isn't
// repeated in its name; `withDay` adds the day where nothing else shows it.
export const libraryItemTitle = (
  item: Pick<LibraryItem, "name" | "kind" | "created_at">,
  withDay = false,
) =>
  isUntitledRecording(item)
    ? i18n.date(new Date(item.created_at), {
        ...(withDay ? { month: "short", day: "numeric" } : {}),
        hour: "numeric",
        minute: "2-digit",
      })
    : formatLibraryName(item.name);
export const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");

export const formatImportErrorMessage = (rawMessage: string) => {
  const message = rawMessage.trim();
  if (!message) {
    return i18n._(
      msg({
        id: "library.import_error.default",
        message: "Import failed for one of the files.",
      }),
    );
  }

  const lower = message.toLowerCase();
  if (lower.includes("selected model is not installed")) {
    return i18n._(
      msg({
        id: "library.import_error.model_missing",
        message:
          "The selected model isn't installed. Download one in Settings > Models.",
      }),
    );
  }
  if (lower.includes("file not found")) {
    return i18n._(
      msg({
        id: "library.import_error.file_not_found",
        message: "File not found. It may have moved or been deleted.",
      }),
    );
  }
  if (lower.includes("unsupported file format")) {
    return i18n._(
      msg({
        id: "library.import_error.unsupported_format",
        message: "Unsupported file format.",
      }),
    );
  }
  if (lower.includes("no supported audio tracks")) {
    return i18n._(
      msg({
        id: "library.import_error.no_audio_track",
        message: "No audio track found in this file.",
      }),
    );
  }
  if (
    lower.includes("audio decode failed") ||
    lower.includes("failed to read audio container") ||
    lower.includes("unsupported audio codec") ||
    lower.includes("no audio samples decoded")
  ) {
    return i18n._(
      msg({
        id: "library.import_error.decode_failed",
        message: "Couldn't decode this audio file. Try installing FFmpeg.",
      }),
    );
  }
  if (lower.includes("failed to create library folder")) {
    return i18n._(
      msg({
        id: "library.import_error.create_storage_failed",
        message: "Couldn't create library storage. Check disk permissions.",
      }),
    );
  }
  if (lower.includes("failed to copy original file")) {
    return i18n._(
      msg({
        id: "library.import_error.copy_original_failed",
        message: "Couldn't copy the original file into the library.",
      }),
    );
  }
  if (
    lower.includes("wav writer init failed") ||
    lower.includes("wav finalize error") ||
    lower.includes("wav write error")
  ) {
    return i18n._(
      msg({
        id: "library.import_error.audio_conversion_failed",
        message: "Couldn't convert this file to audio for transcription.",
      }),
    );
  }
  if (
    lower.includes("invalid sample rate") ||
    lower.includes("unknown sample rate")
  ) {
    return i18n._(
      msg({
        id: "library.import_error.unsupported_sample_rate",
        message: "This file has an unsupported sample rate.",
      }),
    );
  }

  return i18n._(
    msg({
      id: "library.import_error.default_fallback",
      message: "Import failed for one of the files.",
    }),
  );
};

// Queued or running, so it can be cancelled.
export const isLibraryItemBusy = (status: LibraryItemStatus) =>
  status.type === "transcribing" ||
  status.type === "cancelling" ||
  status.type === "pending" ||
  status.type === "importing";

export const formatDeleteErrorMessage = (rawMessage: string) => {
  const message = rawMessage.trim();
  if (!message) {
    return i18n._(
      msg({
        id: "library.delete_error.default",
        message: "Failed to delete the library item.",
      }),
    );
  }

  const lower = message.toLowerCase();
  if (lower.includes("outside the library folder")) {
    return i18n._(
      msg({
        id: "library.delete_error.outside_folder",
        message:
          "Couldn't delete this item because its files are outside the library folder.",
      }),
    );
  }
  if (lower.includes("storage location")) {
    return i18n._(
      msg({
        id: "library.delete_error.storage_missing",
        message:
          "Couldn't delete this item. Library storage couldn't be found.",
      }),
    );
  }
  if (
    lower.includes("delete library files") ||
    lower.includes("delete library file")
  ) {
    return i18n._(
      msg({
        id: "library.delete_error.delete_files_failed",
        message:
          "Couldn't delete the library files. Check permissions and try again.",
      }),
    );
  }
  if (lower.includes("invalid library file path")) {
    return i18n._(
      msg({
        id: "library.delete_error.invalid_path",
        message: "Couldn't delete this item due to an invalid file path.",
      }),
    );
  }

  return i18n._(
    msg({
      id: "library.delete_error.default_fallback",
      message: "Failed to delete the library item.",
    }),
  );
};

export const getLibraryErrorDetails = (rawMessage: string) => {
  const message = rawMessage.trim();
  if (!message) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.import_failed",
          message: "Import failed.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }

  const lower = message.toLowerCase();

  if (lower.includes("selected model is not installed")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.model_not_installed",
          message: "Model not installed.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (
    lower.includes("file not found") ||
    lower.includes("audio file not found")
  ) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.file_not_found",
          message: "File not found.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (lower.includes("unsupported file format")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.unsupported_format",
          message: "Unsupported file format.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (lower.includes("no supported audio tracks")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.no_audio_track",
          message: "No audio track found.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (
    lower.includes("invalid sample rate") ||
    lower.includes("unknown sample rate") ||
    lower.includes("unknown channel count") ||
    lower.includes("unsupported wav sample format")
  ) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.unsupported_audio_settings",
          message: "Unsupported audio settings.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (
    lower.includes("audio decode failed") ||
    lower.includes("failed to read audio container") ||
    lower.includes("unsupported audio codec") ||
    lower.includes("no audio samples decoded")
  ) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.invalid_audio",
          message: "Not a valid audio file.",
        }),
      ),
      showFfmpegHelp: true,
    };
  }
  if (lower.includes("ffmpeg")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.ffmpeg_required",
          message: "FFmpeg required for video imports.",
        }),
      ),
      showFfmpegHelp: true,
    };
  }
  if (lower.includes("failed to create library folder")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.create_storage_failed",
          message: "Couldn't create library storage.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (lower.includes("failed to copy original file")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.copy_original_failed",
          message: "Couldn't copy original file.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }
  if (lower.includes("insufficient disk space")) {
    return {
      message: i18n._(
        msg({
          id: "library.error_details.insufficient_disk_space",
          message: "Not enough disk space.",
        }),
      ),
      showFfmpegHelp: false,
    };
  }

  return { message, showFfmpegHelp: false };
};

// "Zoom, Chrome + Microphone" / "System Audio + Microphone" / "Microphone".
export const describeAudioSources = (
  sources: AudioSources | null | undefined,
  labels: { microphone: string; systemAudio: string },
) => {
  if (!sources) return null;
  const parts: string[] = [];
  if (sources.system_audio) {
    parts.push(
      sources.system_audio.length > 0
        ? sources.system_audio.join(", ")
        : labels.systemAudio,
    );
  }
  if (sources.microphone) parts.push(labels.microphone);
  return parts.length > 0 ? parts.join(" + ") : null;
};
