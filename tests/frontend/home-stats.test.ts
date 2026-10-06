import { describe, expect, test } from "bun:test";
import { mockLingui } from "./support/lingui";

mockLingui();

const {
  EMPTY_TODAY_DICTATION_STATS,
  averageWordsPerDictation,
  formatRecordingClock,
  getActiveTodayStatSlide,
  getTodayStatSlides,
  wordsPerMinute,
} = await import("../../src/features/transcriptions/todayStats");
const { labelForTodayStatSlide } =
  await import("../../src/features/transcriptions/homeHeaderStats");
const {
  getHomeGreetingVariant,
  getHomeOccasions,
  homeGreetingKey,
  pickStableForCurrentPeriod,
  timeOfDayPeriod,
} = await import("../../src/features/transcriptions/homeGreeting");

type Stats = typeof EMPTY_TODAY_DICTATION_STATS;

const stats = (overrides: Partial<Stats>): Stats => ({
  ...EMPTY_TODAY_DICTATION_STATS,
  ...overrides,
});

const passthrough = (descriptor: { message?: string; id?: string }) =>
  descriptor.message ?? descriptor.id ?? "";

describe("today stat slides", () => {
  test("an empty day only shows the two base slides", () => {
    expect(getTodayStatSlides(EMPTY_TODAY_DICTATION_STATS)).toEqual([
      "dictations_words",
      "minutes_spoken",
    ]);
  });

  test("pace needs at least 45 seconds and 20 words", () => {
    const busy = stats({
      count: 3,
      words: 20,
      audioSeconds: 45,
      longestWords: 12,
      longestAudioSeconds: 20,
      llmCleanedCount: 1,
    });
    expect(getTodayStatSlides(busy)).toEqual([
      "dictations_words",
      "minutes_spoken",
      "avg_words",
      "longest_duration",
      "longest_words",
      "pace_wpm",
      "llm_cleaned",
    ]);
    expect(getTodayStatSlides({ ...busy, words: 19 })).not.toContain(
      "pace_wpm",
    );
    expect(getTodayStatSlides({ ...busy, audioSeconds: 44 })).not.toContain(
      "pace_wpm",
    );
  });

  test("the active slide is stable within a period", () => {
    const busy = stats({ count: 2, words: 40, audioSeconds: 60 });
    const morning = new Date(2026, 4, 1, 7, 0);
    const lateMorning = new Date(2026, 4, 1, 11, 59);
    const slide = getActiveTodayStatSlide(busy, morning);
    expect(getTodayStatSlides(busy)).toContain(slide!);
    expect(getActiveTodayStatSlide(busy, lateMorning)).toBe(slide);
  });

  test("averages and pace round and guard against zero", () => {
    expect(averageWordsPerDictation(stats({ count: 3, words: 10 }))).toBe(3);
    expect(averageWordsPerDictation(stats({ words: 10 }))).toBe(0);
    expect(wordsPerMinute(stats({ words: 150, audioSeconds: 60 }))).toBe(150);
    expect(wordsPerMinute(stats({ words: 100, audioSeconds: 0 }))).toBe(0);
    expect(formatRecordingClock(3725)).toBe("1:02:05");
    expect(formatRecordingClock(-1)).toBe("0:00");
  });
});

describe("today stat labels", () => {
  test("switches from seconds to minutes at one minute", () => {
    const label = (audioSeconds: number) =>
      labelForTodayStatSlide(
        "minutes_spoken",
        stats({ audioSeconds }),
        passthrough,
      );
    expect(label(1)).toBe("1 second spoken today");
    expect(label(59.4)).toBe("59 seconds spoken today");
    expect(label(59.6)).toBe("1 minute spoken today");
    expect(label(150)).toBe("3 minutes spoken today");
  });

  test("formats the other slides", () => {
    const day = stats({
      count: 1,
      words: 1,
      audioSeconds: 90,
      longestWords: 1,
      longestAudioSeconds: 61,
      llmCleanedCount: 2,
    });
    expect(labelForTodayStatSlide("dictations_words", day, passthrough)).toBe(
      "1 dictation · 1 word today",
    );
    expect(labelForTodayStatSlide("longest_duration", day, passthrough)).toBe(
      "Longest recording today: 1:01",
    );
    expect(labelForTodayStatSlide("longest_words", day, passthrough)).toBe(
      "Longest dictation today: 1 word",
    );
    expect(labelForTodayStatSlide("llm_cleaned", day, passthrough)).toBe(
      "2 dictations polished with AI today",
    );
  });
});

describe("home greeting", () => {
  test("periods split at 6, 12, and 17 local time", () => {
    const at = (hour: number) => timeOfDayPeriod(new Date(2026, 0, 1, hour));
    expect(at(5)).toBe("evening");
    expect(at(6)).toBe("morning");
    expect(at(11)).toBe("morning");
    expect(at(12)).toBe("afternoon");
    expect(at(16)).toBe("afternoon");
    expect(at(17)).toBe("evening");
  });

  test("leap day is the only occasion", () => {
    expect(getHomeOccasions(new Date(2028, 1, 29))).toEqual(["leap_day"]);
    expect(getHomeOccasions(new Date(2027, 2, 1))).toEqual([]);
    expect(getHomeGreetingVariant(new Date(2027, 2, 1, 9))).toEqual({
      kind: "time",
    });
  });

  test("greeting keys name the occasion or the period", () => {
    const evening = new Date(2026, 0, 1, 20);
    expect(homeGreetingKey({ kind: "time" }, evening)).toBe("time-evening");
    expect(homeGreetingKey({ kind: "occasion", id: "leap_day" }, evening)).toBe(
      "occasion-leap_day",
    );
  });

  test("stable picks depend on the day, period, and salt", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    const now = new Date(2026, 5, 10, 13);
    expect(pickStableForCurrentPeriod([], 0, now)).toBeUndefined();
    expect(pickStableForCurrentPeriod(items, 3, now)).toBe(
      pickStableForCurrentPeriod(items, 3, new Date(2026, 5, 10, 16, 59)),
    );
    const acrossDays = new Set(
      Array.from({ length: 30 }, (_, i) =>
        pickStableForCurrentPeriod(items, 0, new Date(2026, 5, i + 1, 13)),
      ),
    );
    expect(acrossDays.size).toBeGreaterThan(1);
  });
});
