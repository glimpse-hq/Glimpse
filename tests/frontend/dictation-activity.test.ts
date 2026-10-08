import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async () => []),
}));

const {
  ACTIVITY_ROWS,
  ACTIVITY_WEEKS,
  activityLevel,
  activityStart,
  buildActivityGrid,
  buildActivityWeeks,
  columnDots,
  currentStreak,
  localDayKey,
  longestStreak,
  minutesSaved,
  monthLabels,
  speakingWpm,
} = await import("../../src/features/transcriptions/dictationActivity");

const day = (key: string, count = 1, words = 10) => ({
  day: key,
  count,
  words,
});

describe("dictation activity grid", () => {
  // Saturday, so the 53 columns end exactly on today.
  const saturday = new Date(2026, 9, 10, 18, 45);

  test("starts on a Sunday and covers 53 full weeks", () => {
    const start = activityStart(saturday);
    expect(start.getDay()).toBe(0);
    expect(start.getHours()).toBe(0);

    const grid = buildActivityGrid([], saturday);
    expect(grid).toHaveLength(ACTIVITY_WEEKS);
    expect(grid.every((column) => column.length === 7)).toBe(true);
    expect(grid[0][0].key).toBe(localDayKey(start));
    expect(grid[0][0].key).toBe("2025-10-05");
    expect(grid[grid.length - 1][6].key).toBe("2026-10-10");
  });

  test("includes today and marks later days in its week as future", () => {
    const wednesday = new Date(2026, 9, 7);
    const cells = buildActivityGrid(
      [day("2026-10-07", 3, 120), day("2026-10-08", 9, 900)],
      wednesday,
    ).flat();
    expect(cells.find((cell) => cell.key === "2026-10-07")).toMatchObject({
      count: 3,
      words: 120,
      future: false,
    });
    expect(cells.find((cell) => cell.key === "2026-10-08")?.future).toBe(true);
  });

  test("the last column holds today on every weekday", () => {
    for (let offset = 0; offset < 7; offset += 1) {
      const today = new Date(2026, 9, 4 + offset, 12);
      const last = buildActivityGrid([], today).at(-1)!;
      expect(last[today.getDay()]).toMatchObject({
        key: localDayKey(today),
        future: false,
      });
      expect(last.filter((cell) => cell.future)).toHaveLength(6 - offset);
    }
  });

  test("fills counts by day key and totals each week", () => {
    const grid = buildActivityGrid(
      [
        day("2026-09-28", 1, 50),
        day("2026-10-05", 2, 70),
        day("2026-10-10", 3, 30),
      ],
      saturday,
    );
    const cells = grid.flat();
    expect(cells.find((cell) => cell.key === "2026-10-10")).toMatchObject({
      count: 3,
      words: 30,
      future: false,
    });
    expect(cells.every((cell) => !cell.future)).toBe(true);

    const weeks = buildActivityWeeks(grid);
    expect(weeks[weeks.length - 2]).toMatchObject({
      key: "2026-09-27",
      words: 50,
      cumulativeWords: 50,
    });
    expect(weeks[weeks.length - 1]).toMatchObject({
      key: "2026-10-04",
      count: 5,
      words: 100,
      cumulativeWords: 150,
    });
  });

  test("month labels skip a partial first column", () => {
    const labels = monthLabels(buildActivityGrid([], saturday));
    expect(labels.length).toBeGreaterThan(10);
    for (let i = 1; i < labels.length; i += 1) {
      expect(labels[i].column).toBeGreaterThan(labels[i - 1].column);
      expect(labels[i].month).not.toBe(labels[i - 1].month);
    }
    if (labels[0].column === 0) {
      expect(labels[1].column).toBeGreaterThan(1);
    }
  });
});

describe("dictation activity scales", () => {
  test("column dots stay within one and the row count", () => {
    expect(columnDots(0, 10)).toBe(0);
    expect(columnDots(5, 0)).toBe(1);
    expect(columnDots(1, 1000)).toBe(1);
    expect(columnDots(10, 10)).toBe(ACTIVITY_ROWS);
    expect(columnDots(50, 10)).toBe(ACTIVITY_ROWS);
  });

  test("activity levels bucket by share of the busiest day", () => {
    expect(activityLevel(0, 100)).toBe(0);
    expect(activityLevel(5, 0)).toBe(1);
    expect(activityLevel(10, 100)).toBe(1);
    expect(activityLevel(11, 100)).toBe(2);
    expect(activityLevel(34, 100)).toBe(3);
    expect(activityLevel(67, 100)).toBe(4);
  });

  test("speaking pace and minutes saved", () => {
    expect(speakingWpm(300, 120_000)).toBe(150);
    expect(speakingWpm(300, 0)).toBe(0);
    expect(minutesSaved(400, 60_000)).toBe(9);
    expect(minutesSaved(10, 600_000)).toBe(0);
  });
});

describe("dictation streaks", () => {
  test("a streak survives until the end of today", () => {
    const days = [day("2026-10-05"), day("2026-10-06")];
    expect(currentStreak(days, new Date(2026, 9, 7, 23))).toBe(2);
    expect(
      currentStreak([...days, day("2026-10-07")], new Date(2026, 9, 7)),
    ).toBe(3);
    expect(currentStreak(days, new Date(2026, 9, 8))).toBe(0);
  });

  test("days without dictations do not count", () => {
    expect(
      currentStreak(
        [day("2026-10-06", 0), day("2026-10-07")],
        new Date(2026, 9, 7),
      ),
    ).toBe(1);
  });

  test("longest streak spans months and ignores order", () => {
    expect(
      longestStreak([
        day("2026-03-01"),
        day("2026-02-27"),
        day("2026-02-28"),
        day("2026-03-05"),
        day("2026-03-02", 0),
      ]),
    ).toBe(3);
    expect(longestStreak([])).toBe(0);
  });
});
