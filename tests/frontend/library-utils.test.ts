import { describe, expect, test } from "bun:test";
import { mockLingui } from "./support/lingui";

mockLingui();

const {
  clampProgress,
  describeAudioSources,
  formatDeleteErrorMessage,
  formatDuration,
  formatImportErrorMessage,
  formatLibraryName,
  formatPlaybackRate,
  formatTimestamp,
  getFileExtension,
  getLibraryErrorDetails,
  sanitizeFileName,
  shouldShowImportProgress,
  uniquePaths,
} = await import("../../src/features/library/components/library-utils");
const { SPEAKER_COLORS, withSpeakerColors } =
  await import("../../src/features/library/speakerColors");

describe("library formatting", () => {
  test("durations round to whole seconds and grow an hour field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatDuration(59.5)).toBe("1:00");
    expect(formatDuration(605)).toBe("10:05");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3 * 3600 + 7 * 60 + 9)).toBe("3:07:09");
  });

  test("timestamps floor milliseconds instead of rounding", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(59_999)).toBe("0:59");
    expect(formatTimestamp(61_000)).toBe("1:01");
    expect(formatTimestamp(3_600_000)).toBe("1:00:00");
    expect(formatTimestamp(36_061_500)).toBe("10:01:01");
  });

  test("playback rates drop trailing zeros", () => {
    expect(formatPlaybackRate(1)).toBe("1");
    expect(formatPlaybackRate(1.5)).toBe("1.5");
    expect(formatPlaybackRate(0.75)).toBe("0.75");
    expect(formatPlaybackRate(2.25)).toBe("2.25");
    expect(formatPlaybackRate(10)).toBe("10");
  });

  test("import progress shows only between the ends", () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(shouldShowImportProgress(0.01)).toBe(false);
    expect(shouldShowImportProgress(0.02)).toBe(true);
    expect(shouldShowImportProgress(0.97)).toBe(true);
    expect(shouldShowImportProgress(0.98)).toBe(false);
    expect(shouldShowImportProgress(5)).toBe(false);
  });

  test("file names and extensions", () => {
    expect(getFileExtension("/a/b/Talk.Final.MP3")).toBe("mp3");
    expect(getFileExtension("README")).toBe("");
    expect(formatLibraryName("team_sync.2026")).toBe("team sync 2026");
    expect(sanitizeFileName('  a/b\\c:d*e?"f"<g>|h   i  ')).toBe(
      "a-b-c-d-e-f-g-h i",
    );
    expect(sanitizeFileName("x//:y")).toBe("x-y");
    expect(uniquePaths(["/a", "/b", "/a"])).toEqual(["/a", "/b"]);
  });

  test("audio sources list apps before the microphone", () => {
    const labels = { microphone: "Microphone", systemAudio: "System Audio" };
    expect(describeAudioSources(null, labels)).toBeNull();
    expect(describeAudioSources({}, labels)).toBeNull();
    expect(
      describeAudioSources(
        { microphone: "MacBook Mic", system_audio: ["Zoom", "Chrome"] },
        labels,
      ),
    ).toBe("Zoom, Chrome + Microphone");
    expect(
      describeAudioSources(
        { microphone: "MacBook Mic", system_audio: [] },
        labels,
      ),
    ).toBe("System Audio + Microphone");
    expect(describeAudioSources({ microphone: "Mic" }, labels)).toBe(
      "Microphone",
    );
  });
});

describe("library error messages", () => {
  test("maps backend import errors to user messages", () => {
    expect(formatImportErrorMessage("  ")).toBe(
      "Import failed for one of the files.",
    );
    expect(formatImportErrorMessage("Selected model is not installed")).toBe(
      "The selected model isn't installed. Download one in Settings > Models.",
    );
    expect(formatImportErrorMessage("Unsupported file format: xyz")).toBe(
      "Unsupported file format.",
    );
    expect(formatImportErrorMessage("No audio samples decoded")).toBe(
      "Couldn't decode this audio file. Try installing FFmpeg.",
    );
    expect(formatImportErrorMessage("WAV write error: disk")).toBe(
      "Couldn't convert this file to audio for transcription.",
    );
    expect(formatImportErrorMessage("Unknown sample rate")).toBe(
      "This file has an unsupported sample rate.",
    );
    expect(formatImportErrorMessage("something odd")).toBe(
      "Import failed for one of the files.",
    );
  });

  test("maps backend delete errors to user messages", () => {
    expect(formatDeleteErrorMessage("")).toBe(
      "Failed to delete the library item.",
    );
    expect(
      formatDeleteErrorMessage("Refusing: path is outside the library folder"),
    ).toBe(
      "Couldn't delete this item because its files are outside the library folder.",
    );
    expect(formatDeleteErrorMessage("Failed to delete library files")).toBe(
      "Couldn't delete the library files. Check permissions and try again.",
    );
    expect(
      formatDeleteErrorMessage("Couldn't move the audio to the Trash"),
    ).toBe(
      "Couldn't move the audio to the Trash or Recycle Bin, so nothing was deleted.",
    );
  });

  test("offers FFmpeg help only for decode and FFmpeg errors", () => {
    expect(getLibraryErrorDetails("")).toEqual({
      message: "Import failed.",
      showFfmpegHelp: false,
    });
    expect(getLibraryErrorDetails("Audio decode failed: bad header")).toEqual({
      message: "Not a valid audio file.",
      showFfmpegHelp: true,
    });
    expect(getLibraryErrorDetails("ffmpeg not found in PATH")).toEqual({
      message: "FFmpeg required for video imports.",
      showFfmpegHelp: true,
    });
    expect(getLibraryErrorDetails("Unknown channel count")).toEqual({
      message: "Unsupported audio settings.",
      showFfmpegHelp: false,
    });
    expect(getLibraryErrorDetails("Insufficient disk space")).toEqual({
      message: "Not enough disk space.",
      showFfmpegHelp: false,
    });
  });

  test("passes unrecognized detail messages through trimmed", () => {
    expect(getLibraryErrorDetails("  Provider returned 500  ")).toEqual({
      message: "Provider returned 500",
      showFfmpegHelp: false,
    });
  });
});

describe("speaker colors", () => {
  test("keeps fixed colors and hands out the unused ones in order", () => {
    const colored = withSpeakerColors([
      { id: "mic", name: "Me", color: SPEAKER_COLORS[0] },
      { id: "speaker_1", name: "Speaker 1" },
      { id: "speaker_2", name: "Speaker 2" },
    ]);
    expect(colored.map((speaker) => speaker.color)).toEqual([
      SPEAKER_COLORS[0],
      SPEAKER_COLORS[1],
      SPEAKER_COLORS[2],
    ]);
  });

  test("wraps around the palette once every color is taken", () => {
    const list = Array.from({ length: SPEAKER_COLORS.length + 2 }, (_, i) => ({
      id: `speaker_${i + 1}`,
      name: `Speaker ${i + 1}`,
    }));
    const colors = withSpeakerColors(list).map((speaker) => speaker.color);
    expect(colors.slice(0, SPEAKER_COLORS.length)).toEqual(SPEAKER_COLORS);
    expect(colors[SPEAKER_COLORS.length]).toBe(SPEAKER_COLORS[0]);
    expect(colors[SPEAKER_COLORS.length + 1]).toBe(SPEAKER_COLORS[1]);
  });
});
