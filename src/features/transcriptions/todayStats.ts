import type { TodayDictationStats, TranscriptionRecord } from "../../types";
import { pickStableForCurrentPeriod } from "./homeGreeting";

export const EMPTY_TODAY_DICTATION_STATS: TodayDictationStats = {
  count: 0,
  words: 0,
  audioSeconds: 0,
  longestWords: 0,
  longestAudioSeconds: 0,
  llmCleanedCount: 0,
};

export function deriveTodayStats(
  records: TranscriptionRecord[],
): TodayDictationStats {
  const now = new Date();
  const startMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const endMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  ).getTime();

  const stats = { ...EMPTY_TODAY_DICTATION_STATS };
  for (const record of records) {
    if (record.status !== "success") continue;
    const ts = new Date(record.timestamp).getTime();
    if (ts < startMs || ts >= endMs) continue;
    stats.count += 1;
    stats.words += record.word_count;
    stats.audioSeconds += record.audio_duration_seconds;
    stats.longestWords = Math.max(stats.longestWords, record.word_count);
    stats.longestAudioSeconds = Math.max(
      stats.longestAudioSeconds,
      record.audio_duration_seconds,
    );
    if (record.llm_cleaned) stats.llmCleanedCount += 1;
  }
  return stats;
}

export type TodayStatSlide =
  | "dictations_words"
  | "minutes_spoken"
  | "avg_words"
  | "longest_duration"
  | "longest_words"
  | "pace_wpm"
  | "llm_cleaned";

export function getTodayStatSlides(
  stats: TodayDictationStats,
): TodayStatSlide[] {
  const slides: TodayStatSlide[] = ["dictations_words", "minutes_spoken"];

  if (stats.count > 0) {
    slides.push("avg_words");
  }
  if (stats.longestAudioSeconds > 0) {
    slides.push("longest_duration");
  }
  if (stats.longestWords > 0) {
    slides.push("longest_words");
  }
  if (stats.audioSeconds >= 45 && stats.words >= 20) {
    slides.push("pace_wpm");
  }
  if (stats.llmCleanedCount > 0) {
    slides.push("llm_cleaned");
  }

  return slides;
}

export function getActiveTodayStatSlide(
  stats: TodayDictationStats,
  now: Date = new Date(),
): TodayStatSlide | undefined {
  const slides = getTodayStatSlides(stats);
  return pickStableForCurrentPeriod(slides, 1, now);
}

export function averageWordsPerDictation(stats: TodayDictationStats): number {
  if (stats.count <= 0) return 0;
  return Math.round(stats.words / stats.count);
}

export function wordsPerMinute(stats: TodayDictationStats): number {
  if (stats.audioSeconds <= 0 || stats.words <= 0) return 0;
  return Math.round(stats.words / (stats.audioSeconds / 60));
}

export function formatRecordingClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
