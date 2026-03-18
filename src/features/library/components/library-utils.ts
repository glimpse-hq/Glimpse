import type { LibraryItemStatus } from "../../../types";

export const SUPPORTED_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4", "mov", "webm", "mkv"];
export const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 2.5, 3, 4];

export const clampProgress = (value: number) => Math.min(Math.max(value, 0), 1);

export const shouldShowImportProgress = (value: number) => {
    const clamped = clampProgress(value);
    return clamped >= 0.02 && clamped < 0.98;
};

export const buildProgressDots = (progress: number, cols: number, rows: number) => {
    const totalDots = cols * rows;
    const activeCount = Math.round(clampProgress(progress) * totalDots);
    return Array.from({ length: Math.min(activeCount, totalDots) }, (_, i) => i);
};

export type LibraryProgressDotsProps = {
    progress: number;
    status: "importing" | "transcribing";
};

export const statusLabel = (status: LibraryItemStatus) => {
    switch (status.type) {
        case "pending":
            return "Queued";
        case "importing":
            if (!shouldShowImportProgress(status.progress)) return "Converting";
            return `Converting ${Math.round(clampProgress(status.progress) * 100)}%`;
        case "transcribing":
            if (status.progress < 0.01) return "Starting...";
            return `Transcribing ${Math.round(clampProgress(status.progress) * 100)}%`;
        case "complete":
            return "Done";
        case "cancelling":
            return "Canceling...";
        case "cancelled":
            return "Canceled";
        case "error":
            return "Failed";
        default:
            return "Queued";
    }
};

export const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

export const formatPlaybackRate = (rate: number) => rate.toFixed(2).replace(/\.?0+$/, "");

export const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const getFileExtension = (path: string) => {
    const parts = path.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
};

export const uniquePaths = (paths: string[]) => Array.from(new Set(paths));
export const sanitizeFileName = (value: string) =>
    value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");

export const formatImportErrorMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return "Import failed for one of the files.";

    const lower = message.toLowerCase();
    if (lower.includes("selected model is not installed")) {
        return "Selected model isn't installed. Download one in Settings \u2192 Models.";
    }
    if (lower.includes("file not found")) {
        return "File not found. It may have moved or been deleted.";
    }
    if (lower.includes("unsupported file format")) {
        return "Unsupported file format.";
    }
    if (lower.includes("no supported audio tracks")) {
        return "No audio track found in this file.";
    }
    if (
        lower.includes("audio decode failed")
        || lower.includes("failed to read audio container")
        || lower.includes("unsupported audio codec")
        || lower.includes("no audio samples decoded")
    ) {
        return "Couldn't decode this audio file. Try installing FFmpeg.";
    }
    if (lower.includes("failed to create library folder")) {
        return "Couldn't create library storage. Check disk permissions.";
    }
    if (lower.includes("failed to copy original file")) {
        return "Couldn't copy the original file into the library.";
    }
    if (
        lower.includes("wav writer init failed")
        || lower.includes("wav finalize error")
        || lower.includes("wav write error")
    ) {
        return "Couldn't convert this file to audio for transcription.";
    }
    if (lower.includes("invalid sample rate") || lower.includes("unknown sample rate")) {
        return "This file has an unsupported sample rate.";
    }

    return "Import failed for one of the files.";
};

export const formatDeleteErrorMessage = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return "Failed to delete the library item.";

    const lower = message.toLowerCase();
    if (lower.includes("outside the library folder")) {
        return "Couldn't delete this item because its files are outside the library folder.";
    }
    if (lower.includes("storage location")) {
        return "Couldn't delete this item. Library storage couldn't be found.";
    }
    if (lower.includes("delete library files") || lower.includes("delete library file")) {
        return "Couldn't delete the library files. Check permissions and try again.";
    }
    if (lower.includes("invalid library file path")) {
        return "Couldn't delete this item due to an invalid file path.";
    }

    return "Failed to delete the library item.";
};

export const getLibraryErrorDetails = (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) {
        return { message: "Import failed.", showFfmpegHelp: false };
    }

    const lower = message.toLowerCase();

    if (lower.includes("selected model is not installed")) {
        return { message: "Model not installed.", showFfmpegHelp: false };
    }
    if (lower.includes("file not found") || lower.includes("audio file not found")) {
        return { message: "File not found.", showFfmpegHelp: false };
    }
    if (lower.includes("unsupported file format")) {
        return { message: "Unsupported file format.", showFfmpegHelp: false };
    }
    if (lower.includes("no supported audio tracks")) {
        return { message: "No audio track found.", showFfmpegHelp: false };
    }
    if (
        lower.includes("invalid sample rate")
        || lower.includes("unknown sample rate")
        || lower.includes("unknown channel count")
        || lower.includes("unsupported wav sample format")
    ) {
        return { message: "Unsupported audio settings.", showFfmpegHelp: false };
    }
    if (
        lower.includes("audio decode failed")
        || lower.includes("failed to read audio container")
        || lower.includes("unsupported audio codec")
        || lower.includes("no audio samples decoded")
    ) {
        return { message: "Not a valid audio file.", showFfmpegHelp: true };
    }
    if (lower.includes("ffmpeg")) {
        return { message: "FFmpeg required for video imports.", showFfmpegHelp: true };
    }
    if (lower.includes("failed to create library folder")) {
        return { message: "Couldn't create library storage.", showFfmpegHelp: false };
    }
    if (lower.includes("failed to copy original file")) {
        return { message: "Couldn't copy original file.", showFfmpegHelp: false };
    }
    if (lower.includes("insufficient disk space")) {
        return { message: "Not enough disk space.", showFfmpegHelp: false };
    }

    return { message, showFfmpegHelp: false };
};
