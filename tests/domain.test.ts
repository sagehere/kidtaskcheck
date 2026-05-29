import { describe, expect, it } from "vitest";
import { achievementWindowRange, consecutiveDayStreak, consecutiveSameTaskStreak, inAchievementWindow, nextPeriodReset, periodKey, signedPoints } from "../src/lib/domain";

describe("periodKey", () => {
  it("calculates daily, weekly, monthly and once keys in the default UTC+8 timezone", () => {
    const at = "2026-05-24T16:30:00.000Z";
    expect(periodKey("daily", at)).toBe("2026-05-25");
    expect(periodKey("weekly", at)).toBe("2026-W22");
    expect(periodKey("monthly", at)).toBe("2026-05");
    expect(periodKey("once", at)).toBe("once");
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
