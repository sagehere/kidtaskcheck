import { describe, expect, it } from "vitest";
import { consecutiveDayStreak, nextPeriodReset, periodKey, signedPoints } from "../src/lib/domain";

describe("periodKey", () => {
  it("calculates daily, weekly, monthly and once keys", () => {
    const at = "2026-05-25T10:30:00.000Z";
    expect(periodKey("daily", at)).toBe("2026-05-25");
    expect(periodKey("weekly", at)).toBe("2026-W22");
    expect(periodKey("monthly", at)).toBe("2026-05");
    expect(periodKey("once", at)).toBe("once");
  });

  it("uses the submitted/requested timestamp for cross-period attribution", () => {
    expect(periodKey("weekly", "2026-05-24T23:55:00.000Z")).toBe("2026-W21");
    expect(periodKey("weekly", "2026-05-25T00:05:00.000Z")).toBe("2026-W22");
  });
});

describe("points", () => {
  it("signs task points", () => {
    expect(signedPoints("earn", 10)).toBe(10);
    expect(signedPoints("deduct", 10)).toBe(-10);
  });
});

describe("nextPeriodReset", () => {
  it("returns the next UTC reset boundary for repeating periods", () => {
    const at = "2026-05-25T10:30:00.000Z";
    expect(nextPeriodReset("daily", at)).toBe("2026-05-26T00:00:00.000Z");
    expect(nextPeriodReset("weekly", at)).toBe("2026-06-01T00:00:00.000Z");
    expect(nextPeriodReset("monthly", at)).toBe("2026-06-01T00:00:00.000Z");
  });

  it("does not reset once-only or unlimited periods", () => {
    expect(nextPeriodReset("once", "2026-05-25T10:30:00.000Z")).toBeNull();
    expect(nextPeriodReset("none", "2026-05-25T10:30:00.000Z")).toBeNull();
  });
});

describe("consecutiveDayStreak", () => {
  it("counts consecutive approved submission days", () => {
    expect(consecutiveDayStreak(["2026-05-24", "2026-05-23", "2026-05-21"])).toBe(2);
  });
});
