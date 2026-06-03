import type { TranscriptionRecord } from "../../types";
import { pickStableForCurrentPeriod } from "./homeGreeting";

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function isLocalToday(isoTimestamp: string): boolean {
  const recorded = new Date(isoTimestamp);
  if (Number.isNaN(recorded.getTime())) return false;
  const today = startOfLocalDay(new Date());
  const day = startOfLocalDay(recorded);
  return today.getTime() === day.getTime();
}

export type TodayDictationStats = {
  count: number;
  words: number;
  audioSeconds: number;
  longestWords: number;
  longestAudioSeconds: number;
  llmCleanedCount: number;
};

export type TodayStatSlide =
  | "dictations_words"
  | "minutes_spoken"
  | "avg_words"
  | "longest_duration"
  | "longest_words"
  | "pace_wpm"
  | "llm_cleaned";

export function computeTodayDictationStats(
  records: TranscriptionRecord[],
): TodayDictationStats {
  let count = 0;
  let words = 0;
  let audioSeconds = 0;
  let longestWords = 0;
  let longestAudioSeconds = 0;
  let llmCleanedCount = 0;

  for (const record of records) {
    if (record.status !== "success") continue;
    if (!isLocalToday(record.timestamp)) continue;

    const recordWords = record.word_count ?? 0;
    const recordAudio = record.audio_duration_seconds ?? 0;

    count += 1;
    words += recordWords;
    audioSeconds += recordAudio;
    if (recordWords > longestWords) longestWords = recordWords;
    if (recordAudio > longestAudioSeconds) longestAudioSeconds = recordAudio;
    if (record.llm_cleaned) llmCleanedCount += 1;
  }

  return {
    count,
    words,
    audioSeconds,
    longestWords,
    longestAudioSeconds,
    llmCleanedCount,
  };
}

export function getTodayStatSlides(stats: TodayDictationStats): TodayStatSlide[] {
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
