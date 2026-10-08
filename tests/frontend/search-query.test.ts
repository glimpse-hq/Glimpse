import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  currentTimePreset,
  formatDateToken,
  parseTranscriptionSearch,
  withSortToken,
  withTimePreset,
} from "../../src/features/transcriptions/searchQuery";

const day = (year: number, month: number, date: number) =>
  new Date(year, month - 1, date);

afterEach(() => {
  setSystemTime();
});

describe("transcription search parsing", () => {
  test("splits free text from filter tokens", () => {
    const parsed = parseTranscriptionSearch(
      "  meeting   sort:OLDEST notes after:2026-01-05 ",
    );
    expect(parsed.text).toBe("meeting notes");
    expect(parsed.sort).toBe("oldest");
    expect(parsed.after).toEqual(day(2026, 1, 5));
    expect(parsed.before).toBeNull();
  });

  test("falls back to recent for unknown sort values", () => {
    expect(parseTranscriptionSearch("sort:newest").sort).toBe("recent");
    expect(parseTranscriptionSearch("SORT:longest").sort).toBe("longest");
    expect(parseTranscriptionSearch("sort:shortest").sort).toBe("shortest");
  });

  test("on: covers exactly one local day", () => {
    const parsed = parseTranscriptionSearch("on:2026-03-31");
    expect(parsed.after).toEqual(day(2026, 3, 31));
    expect(parsed.before).toEqual(day(2026, 4, 1));
    expect(parsed.text).toBe("");
  });

  test("on: rolls over the end of a year", () => {
    const parsed = parseTranscriptionSearch("on:2025-12-31");
    expect(parsed.before).toEqual(day(2026, 1, 1));
  });

  test("keeps invalid dates as search text", () => {
    const parsed = parseTranscriptionSearch(
      "after:2026-02-30 before:yesterday on:2026-13-01",
    );
    expect(parsed.after).toBeNull();
    expect(parsed.before).toBeNull();
    expect(parsed.text).toBe("after:2026-02-30 before:yesterday on:2026-13-01");
  });

  test("accepts single-digit months and days", () => {
    expect(parseTranscriptionSearch("before:2026-2-3").before).toEqual(
      day(2026, 2, 3),
    );
  });

  test("treats a leading colon and unknown keys as text", () => {
    expect(parseTranscriptionSearch(":hello foo:bar").text).toBe(
      ":hello foo:bar",
    );
  });

  test("the last date filter wins", () => {
    const parsed = parseTranscriptionSearch("on:2026-01-10 after:2026-01-01");
    expect(parsed.after).toEqual(day(2026, 1, 1));
    expect(parsed.before).toEqual(day(2026, 1, 11));
  });
});

describe("transcription search tokens", () => {
  test("formats date tokens with zero padding", () => {
    expect(formatDateToken(day(2026, 1, 5))).toBe("2026-01-05");
  });

  test("replaces any existing sort token", () => {
    expect(withSortToken("notes Sort:oldest  later", "longest")).toBe(
      "notes later sort:longest",
    );
    expect(withSortToken("notes sort:oldest", "recent")).toBe("notes");
  });

  test("time presets replace date tokens relative to today", () => {
    setSystemTime(new Date(2026, 2, 3, 15, 30));
    expect(
      withTimePreset("notes after:2020-01-01 ON:2020-01-02", "today"),
    ).toBe("notes on:2026-03-03");
    expect(withTimePreset("notes before:2020-01-01", "7d")).toBe(
      "notes after:2026-02-25",
    );
    expect(withTimePreset("notes on:2020-01-01", "any")).toBe("notes");
    expect(withTimePreset("notes on:2020-01-01", "custom")).toBe("notes");
  });

  test("recognizes the preset a parsed range came from", () => {
    setSystemTime(new Date(2026, 2, 3, 9, 0));
    const today = parseTranscriptionSearch(withTimePreset("", "today"));
    const week = parseTranscriptionSearch(withTimePreset("", "7d"));
    expect(currentTimePreset(today.after, today.before)).toBe("today");
    expect(currentTimePreset(week.after, week.before)).toBe("7d");
    expect(currentTimePreset(null, null)).toBe("any");
    expect(currentTimePreset(day(2026, 1, 1), null)).toBe("custom");
    expect(currentTimePreset(null, day(2026, 3, 4))).toBe("custom");
  });
});
