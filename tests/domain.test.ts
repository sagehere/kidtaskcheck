import { describe, expect, it } from "vitest";
import { achievementWindowRange, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, isWeekdayAllowed, nextPeriodReset, normalizeTaskSubmissionDeadline, normalizeWeekdays, periodKey, prerequisitePeriodKey, reportWindowRange, signedPoints, taskSubmissionDeadlineState, weekdayInTimezone } from "../src/lib/domain";

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

describe("task submission deadlines", () => {
  it("locks weekly tasks at the configured weekday and unlocks next Monday", () => {
    const rule = { weekday: 1, time: "09:00" };
    expect(taskSubmissionDeadlineState("weekly", rule, "2026-05-25T00:59:00.000Z")).toMatchObject({ locked: false, deadlineAt: "2026-05-25T01:00:00.000Z" });
    expect(taskSubmissionDeadlineState("weekly", rule, "2026-05-25T01:00:00.000Z")).toMatchObject({ locked: true, unlockAt: "2026-05-31T16:00:00.000Z" });
  });

  it("clamps monthly dates to month end and keeps once deadlines permanent", () => {
    expect(taskSubmissionDeadlineState("monthly", { day: 31, time: "20:00" }, "2026-02-28T12:00:00.000Z")).toMatchObject({ deadlineAt: "2026-02-28T12:00:00.000Z", locked: true, unlockAt: "2026-02-28T16:00:00.000Z" });
    expect(taskSubmissionDeadlineState("once", { at: "2026-03-01T09:00" }, "2026-03-01T01:00:00.000Z")).toMatchObject({ locked: true, unlockAt: null });
  });

  it("locks daily tasks at the configured time and unlocks at the next local midnight", () => {
    const rule = { time: "09:00" };
    expect(normalizeTaskSubmissionDeadline("daily", rule)).toEqual(rule);
    expect(taskSubmissionDeadlineState("daily", rule, "2026-03-01T00:59:00.000Z")).toMatchObject({ locked: false, deadlineAt: "2026-03-01T01:00:00.000Z" });
    expect(taskSubmissionDeadlineState("daily", rule, "2026-03-01T01:00:00.000Z")).toMatchObject({ locked: true, unlockAt: "2026-03-01T16:00:00.000Z" });
    expect(taskSubmissionDeadlineState("daily", rule, "2026-03-01T08:59:00.000Z", 0)).toMatchObject({ locked: false, deadlineAt: "2026-03-01T09:00:00.000Z" });
  });

  it("rejects malformed deadline rules", () => {
    expect(normalizeTaskSubmissionDeadline("weekly", { weekday: 8, time: "09:00" })).toBeNull();
    expect(normalizeTaskSubmissionDeadline("monthly", { day: 31, time: "24:00" })).toBeNull();
    expect(normalizeTaskSubmissionDeadline("daily", { time: "24:00" })).toBeNull();
    expect(normalizeTaskSubmissionDeadline("daily", { at: "2026-03-01T09:00" })).toBeNull();
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

describe("report windows", () => {
  it("builds weekly and monthly report windows in the configured timezone", () => {
    expect(reportWindowRange("weekly", "2026-05-27T10:00:00.000Z")).toEqual({
      start: "2026-05-24T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z",
      label: "2026-W22"
    });
    expect(reportWindowRange("monthly", "2026-05-27T10:00:00.000Z")).toEqual({
      start: "2026-04-30T16:00:00.000Z",
      end: "2026-05-31T16:00:00.000Z",
      label: "2026-05"
    });
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
