import { describe, expect, it } from "vitest";
import { achievementWindowRange, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, isWeekdayAllowed, nextPeriodReset, normalizeWeekdays, periodKey, prerequisitePeriodKey, reportMonthKey, reportPeriodLabel, reportWindowRange, signedPoints, weekdayInTimezone } from "../src/lib/domain";

describe("periodKey", () => {
  it("calculates daily, weekly, monthly and once keys in the default UTC+8 timezone", () => {
    const at = "2026-05-24T16:30:00.000Z";
    expect(periodKey("daily", at)).toBe("2026-05-25");
    expect(periodKey("weekly", at)).toBe("2026-W22");
    expect(periodKey("monthly", at)).toBe("2026-05");
    expect(periodKey("once", at)).toBe("once");
  });

  it("uses task periods for reward prerequisite windows", () => {
    const at = "2026-05-24T16:30:00.000Z";
    expect(prerequisitePeriodKey("daily", at)).toBe("2026-05-25");
    expect(prerequisitePeriodKey("weekly", at)).toBe("2026-W22");
    expect(prerequisitePeriodKey("monthly", at)).toBe("2026-05");
    expect(prerequisitePeriodKey("once", at)).toBeNull();
  });

  it("uses the configured timezone for cross-period attribution", () => {
    expect(periodKey("daily", "2026-05-24T15:59:00.000Z")).toBe("2026-05-24");
    expect(periodKey("daily", "2026-05-24T16:00:00.000Z")).toBe("2026-05-25");
    expect(periodKey("weekly", "2026-05-25T03:00:00.000Z", 0)).toBe("2026-W22");
    expect(periodKey("weekly", "2026-05-25T03:00:00.000Z", -240)).toBe("2026-W21");
  });
});

describe("points", () => {
  it("signs task points", () => {
    expect(signedPoints("earn", 10)).toBe(10);
    expect(signedPoints("deduct", 10)).toBe(-10);
  });
});

describe("weekdays", () => {
  it("normalizes weekday lists and falls back to every day", () => {
    expect(normalizeWeekdays("[1,2,2,8]")).toEqual([1, 2]);
    expect(normalizeWeekdays("")).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("uses the configured timezone when checking allowed weekdays", () => {
    const at = "2026-05-24T16:30:00.000Z";
    expect(weekdayInTimezone(at, 480)).toBe(1);
    expect(weekdayInTimezone(at, 0)).toBe(0);
    expect(isWeekdayAllowed([1], at, 480)).toBe(true);
    expect(isWeekdayAllowed([1], at, 0)).toBe(false);
  });
});

describe("nextPeriodReset", () => {
  it("returns the next reset boundary at midnight in the configured timezone", () => {
    const at = "2026-05-25T10:30:00.000Z";
    expect(nextPeriodReset("daily", at)).toBe("2026-05-25T16:00:00.000Z");
    expect(nextPeriodReset("weekly", at)).toBe("2026-05-31T16:00:00.000Z");
    expect(nextPeriodReset("monthly", at)).toBe("2026-05-31T16:00:00.000Z");
    expect(nextPeriodReset("daily", at, -240)).toBe("2026-05-26T04:00:00.000Z");
  });

  it("does not reset once-only or unlimited periods", () => {
    expect(nextPeriodReset("once", "2026-05-25T10:30:00.000Z")).toBeNull();
    expect(nextPeriodReset("none", "2026-05-25T10:30:00.000Z")).toBeNull();
  });
});

describe("consecutiveDayStreak", () => {
  it("counts consecutive approved submission days in the configured timezone", () => {
    expect(consecutiveDayStreak(["2026-05-24T16:30:00.000Z", "2026-05-23T16:30:00.000Z", "2026-05-21T16:30:00.000Z"])).toBe(2);
  });
});

describe("achievement windows", () => {
  it("builds current week and month windows in the configured timezone", () => {
    expect(achievementWindowRange("current_week", "2026-05-27T10:00:00.000Z")).toEqual({
      start: "2026-05-24T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z"
    });
    expect(achievementWindowRange("current_month", "2026-05-27T10:00:00.000Z")).toEqual({
      start: "2026-04-30T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z"
    });
  });

  it("checks custom date ranges inclusively by local date", () => {
    expect(inAchievementWindow("2026-09-01T00:00:00.000Z", "custom", "2026-10-01T00:00:00.000Z", 480, "2026-09-01", "2027-01-20")).toBe(true);
    expect(inAchievementWindow("2027-01-20T15:59:59.000Z", "custom", "2026-10-01T00:00:00.000Z", 480, "2026-09-01", "2027-01-20")).toBe(true);
    expect(inAchievementWindow("2027-01-20T16:00:00.000Z", "custom", "2026-10-01T00:00:00.000Z", 480, "2026-09-01", "2027-01-20")).toBe(false);
  });
});

describe("consecutiveSameTaskStreak", () => {
  it("counts consecutive local dates for one task", () => {
    expect(consecutiveSameTaskStreak(["2026-05-24T16:30:00.000Z", "2026-05-23T16:30:00.000Z", "2026-05-22T16:30:00.000Z"])).toBe(3);
  });
});

describe("daysWithoutEvents", () => {
  it("counts clean days from the current local date backwards", () => {
    expect(daysWithoutEvents(["2026-05-23T16:30:00.000Z"], "2026-05-26T03:00:00.000Z")).toBe(2);
    expect(daysWithoutEvents(["2026-05-25T16:30:00.000Z"], "2026-05-26T03:00:00.000Z")).toBe(0);
  });

  it("caps the count when there are no blocking events", () => {
    expect(daysWithoutEvents([], "2026-05-26T03:00:00.000Z", 480, 7)).toBe(7);
  });
});

describe("reportWindowRange", () => {
  it("returns current week boundaries in UTC+8", () => {
    const range = reportWindowRange("weekly", "2026-05-27T10:00:00.000Z");
    expect(range).toEqual({
      start: "2026-05-24T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z"
    });
  });

  it("returns current month boundaries in UTC+8", () => {
    const range = reportWindowRange("monthly", "2026-05-27T10:00:00.000Z");
    expect(range).toEqual({
      start: "2026-04-30T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z"
    });
  });

  it("handles Monday week start correctly", () => {
    const range = reportWindowRange("weekly", "2026-05-25T16:30:00.000Z");
    expect(range.start).toBe("2026-05-24T16:00:00.000Z");
    expect(range.end).toBe("2026-05-31T16:00:00.000Z");
  });

  it("handles Sunday week correctly", () => {
    const range = reportWindowRange("weekly", "2026-05-24T16:30:00.000Z");
    expect(range.start).toBe("2026-05-24T16:00:00.000Z");
    expect(range.end).toBe("2026-05-31T16:00:00.000Z");
  });

  it("handles custom timezone for report", () => {
    const range = reportWindowRange("monthly", "2026-05-25T03:00:00.000Z", 0);
    expect(range.start).toBe("2026-05-01T00:00:00.000Z");
    expect(range.end).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("reportPeriodLabel", () => {
  it("generates week label in UTC+8", () => {
    const label = reportPeriodLabel("weekly", "2026-05-27T10:00:00.000Z");
    expect(label).toBe("2026-05-25 至 2026-05-31");
  });

  it("generates month label in UTC+8", () => {
    const label = reportPeriodLabel("monthly", "2026-05-27T10:00:00.000Z");
    expect(label).toBe("2026-05-01 至 2026-05-31");
  });
});

describe("reportMonthKey", () => {
  it("returns YYYY-MM month key in timezone", () => {
    expect(reportMonthKey("2026-05-27T10:00:00.000Z")).toBe("2026-05");
    expect(reportMonthKey("2026-05-27T10:00:00.000Z")).toBe("2026-05");
  });

  it("returns correct month key at year boundary", () => {
    expect(reportMonthKey("2025-12-31T18:00:00.000Z")).toBe("2026-01");
    expect(reportMonthKey("2026-01-01T02:00:00.000Z")).toBe("2026-01");
  });

  it("handles cross-timezone month boundaries", () => {
    expect(reportMonthKey("2026-01-31T18:00:00.000Z")).toBe("2026-02");
    expect(reportMonthKey("2026-01-31T18:00:00.000Z", 0)).toBe("2026-01");
  });
});

describe("reportPeriodLabel edge cases", () => {
  it("handles year boundary for weekly report", () => {
    const label = reportPeriodLabel("weekly", "2025-12-31T10:00:00.000Z");
    expect(label).toBe("2025-12-29 至 2026-01-04");
  });

  it("handles year boundary for monthly report", () => {
    const label = reportPeriodLabel("monthly", "2025-12-15T10:00:00.000Z");
    expect(label).toBe("2025-12-01 至 2025-12-31");
  });

  it("handles January monthly report", () => {
    const label = reportPeriodLabel("monthly", "2026-01-15T10:00:00.000Z");
    expect(label).toBe("2026-01-01 至 2026-01-31");
  });
});

describe("archive month key consistency", () => {
  it("reportMonthKey matches YYYY-MM from ISO string consistently", () => {
    const keys = [
      "2026-01-15T10:00:00.000Z",
      "2026-01-31T23:59:00.000Z",
      "2026-02-01T00:01:00.000Z",
      "2026-02-28T12:00:00.000Z",
      "2026-03-31T18:00:00.000Z"
    ];
    const expected = ["2026-01", "2026-02", "2026-02", "2026-02", "2026-04"];
    expect(keys.map((k) => reportMonthKey(k))).toEqual(expected);
  });
});
