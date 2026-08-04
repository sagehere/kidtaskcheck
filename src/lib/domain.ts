export type Period = "daily" | "weekly" | "monthly" | "once";
export type RewardLimitPeriod = "none" | Period;
export const DEFAULT_TIMEZONE_OFFSET_MINUTES = 480;
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const MINUTE_MS = 60000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDate(input?: string | Date) {
  return input instanceof Date ? input : input ? new Date(input) : new Date();
}

function zonedDate(input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return new Date(toDate(input).getTime() + timezoneOffsetMinutes * MINUTE_MS);
}

function utcFromZonedParts(year: number, month: number, day: number, timezoneOffsetMinutes: number, hour = 0, minute = 0) {
return new Date(Date.UTC(year, month, day, hour, minute) - timezoneOffsetMinutes * MINUTE_MS);
}

export function periodKey(period: RewardLimitPeriod, input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const date = zonedDate(input, timezoneOffsetMinutes);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());

  if (period === "none") return "none";
  if (period === "once") return "once";
  if (period === "daily") return `${year}-${month}-${day}`;
  if (period === "monthly") return `${year}-${month}`;

  const copy = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  const weekday = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - weekday);
  const weekYear = copy.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekYear}-W${pad(week)}`;
}

export function prerequisitePeriodKey(period: RewardLimitPeriod, input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return period === "once" || period === "none" ? null : periodKey(period, input, timezoneOffsetMinutes);
}

export function weekdayInTimezone(input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return zonedDate(input, timezoneOffsetMinutes).getUTCDay();
}

export function normalizeWeekdays(value?: unknown) {
  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      items = value.split(",");
    }
  }
  const weekdays = [...new Set(items.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))];
  return weekdays.length ? weekdays : [...DEFAULT_WEEKDAYS];
}

export function isWeekdayAllowed(value?: unknown, input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return normalizeWeekdays(value).includes(weekdayInTimezone(input, timezoneOffsetMinutes));
}

export function nextPeriodReset(period: RewardLimitPeriod, input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  if (period === "none" || period === "once") return null;

  const date = zonedDate(input, timezoneOffsetMinutes);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === "daily") {
    return utcFromZonedParts(year, month, day + 1, timezoneOffsetMinutes).toISOString();
  }

  if (period === "monthly") {
    return utcFromZonedParts(year, month + 1, 1, timezoneOffsetMinutes).toISOString();
  }

  const weekday = date.getUTCDay() || 7;
  return utcFromZonedParts(year, month, day + (8 - weekday), timezoneOffsetMinutes).toISOString();
}

export type TaskSubmissionDeadline =
  | { time: string }
  | { weekday: number; time: string }
  | { day: number; time: string }
  | { at: string };

function deadlineTimeParts(value: unknown) {
  const match = typeof value === "string" && value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute, time: value } : null;
}

function localDateTimeParts(value: unknown) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute, at: value };
}

export function normalizeTaskSubmissionDeadline(period: Period, value: unknown): TaskSubmissionDeadline | null {
  if (value === null || value === undefined || value === "") return null;
  let rule: any = value;
  if (typeof value === "string") {
    try { rule = JSON.parse(value); } catch { return null; }
  }
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  if (period === "daily") {
    const time = deadlineTimeParts(rule.time);
    return time ? { time: time.time } : null;
  }
  if (period === "weekly") {
    const weekday = Number(rule.weekday);
    const time = deadlineTimeParts(rule.time);
    return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 && time ? { weekday, time: time.time } : null;
  }
  if (period === "monthly") {
    const day = Number(rule.day);
    const time = deadlineTimeParts(rule.time);
    return Number.isInteger(day) && day >= 1 && day <= 31 && time ? { day, time: time.time } : null;
  }
  const at = localDateTimeParts(rule.at);
  return at ? { at: at.at } : null;
}

export function taskSubmissionDeadlineState(period: Period, value: unknown, input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const rule = normalizeTaskSubmissionDeadline(period, value);
  if (!rule) return { deadlineAt: null, locked: false, unlockAt: null };
  const date = zonedDate(input, timezoneOffsetMinutes);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  let deadlineAt: string;
  if (period === "daily" && "time" in rule) {
    const time = deadlineTimeParts(rule.time)!;
    deadlineAt = utcFromZonedParts(year, month, date.getUTCDate(), timezoneOffsetMinutes, time.hour, time.minute).toISOString();
  } else if (period === "weekly" && "weekday" in rule) {
    const currentWeekday = date.getUTCDay() || 7;
    const time = deadlineTimeParts(rule.time)!;
    deadlineAt = utcFromZonedParts(year, month, date.getUTCDate() - currentWeekday + rule.weekday, timezoneOffsetMinutes, time.hour, time.minute).toISOString();
  } else if (period === "monthly" && "day" in rule) {
    const time = deadlineTimeParts(rule.time)!;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    deadlineAt = utcFromZonedParts(year, month, Math.min(rule.day, lastDay), timezoneOffsetMinutes, time.hour, time.minute).toISOString();
  } else if (period === "once" && "at" in rule) {
    const at = localDateTimeParts(rule.at)!;
    deadlineAt = utcFromZonedParts(at.year, at.month - 1, at.day, timezoneOffsetMinutes, at.hour, at.minute).toISOString();
  } else {
    return { deadlineAt: null, locked: false, unlockAt: null };
  }
  const locked = toDate(input).getTime() >= new Date(deadlineAt).getTime();
  return { deadlineAt, locked, unlockAt: locked && period !== "once" ? nextPeriodReset(period, input, timezoneOffsetMinutes) : null };
}

export function signedPoints(pointType: "earn" | "deduct", points: number) {
  return pointType === "earn" ? Math.abs(points) : -Math.abs(points);
}

export function todayKey(input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return periodKey("daily", input, timezoneOffsetMinutes);
}

export type AchievementWindowType = "all_time" | "current_week" | "current_month" | "custom";
export type ReportPeriod = "weekly" | "monthly";

export function localDateKey(input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return todayKey(input, timezoneOffsetMinutes);
}

export function achievementWindowRange(
  windowType: AchievementWindowType,
  input?: string | Date,
  timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES,
  customStart?: string | null,
  customEnd?: string | null
) {
  if (windowType === "all_time") return null;

  if (windowType === "custom") {
    if (!customStart || !customEnd) return null;
    const [startYear, startMonth, startDay] = customStart.split("-").map(Number);
    const [endYear, endMonth, endDay] = customEnd.split("-").map(Number);
    if (![startYear, startMonth, startDay, endYear, endMonth, endDay].every(Number.isFinite)) return null;
    return {
      start: utcFromZonedParts(startYear, startMonth - 1, startDay, timezoneOffsetMinutes).toISOString(),
      end: utcFromZonedParts(endYear, endMonth - 1, endDay + 1, timezoneOffsetMinutes).toISOString()
    };
  }

  const date = zonedDate(input, timezoneOffsetMinutes);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (windowType === "current_month") {
    return {
      start: utcFromZonedParts(year, month, 1, timezoneOffsetMinutes).toISOString(),
      end: utcFromZonedParts(year, month + 1, 1, timezoneOffsetMinutes).toISOString()
    };
  }

  const weekday = date.getUTCDay() || 7;
  return {
    start: utcFromZonedParts(year, month, day - weekday + 1, timezoneOffsetMinutes).toISOString(),
    end: utcFromZonedParts(year, month, day + (8 - weekday), timezoneOffsetMinutes).toISOString()
  };
}

export function reportWindowRange(
  period: ReportPeriod,
  input?: string | Date,
  timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES
) {
  const date = zonedDate(input, timezoneOffsetMinutes);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === "monthly") {
    return {
      start: utcFromZonedParts(year, month, 1, timezoneOffsetMinutes).toISOString(),
      end: utcFromZonedParts(year, month + 1, 1, timezoneOffsetMinutes).toISOString(),
      label: `${year}-${pad(month + 1)}`
    };
  }

  const weekday = date.getUTCDay() || 7;
  const startDate = utcFromZonedParts(year, month, day - weekday + 1, timezoneOffsetMinutes);
  const endDate = utcFromZonedParts(year, month, day + (8 - weekday), timezoneOffsetMinutes);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    label: periodKey("weekly", input, timezoneOffsetMinutes)
  };
}

export function inAchievementWindow(
  value: string | Date,
  windowType: AchievementWindowType,
  input?: string | Date,
  timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES,
  customStart?: string | null,
  customEnd?: string | null
) {
  const range = achievementWindowRange(windowType, input, timezoneOffsetMinutes, customStart, customEnd);
  if (!range) return true;
  const at = toDate(value).getTime();
  return at >= new Date(range.start).getTime() && at < new Date(range.end).getTime();
}

export function consecutiveDayStreak(inputs: (string | Date)[], timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const unique = [...new Set(inputs.map((input) => todayKey(input, timezoneOffsetMinutes)))].sort().reverse();
  if (!unique.length) return 0;
  let streak = 1;
  let cursor = utcFromZonedParts(Number(unique[0].slice(0, 4)), Number(unique[0].slice(5, 7)) - 1, Number(unique[0].slice(8, 10)), timezoneOffsetMinutes);
  for (const key of unique.slice(1)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const expected = todayKey(cursor, timezoneOffsetMinutes);
    if (key !== expected) break;
    streak += 1;
  }
  return streak;
}

export function consecutiveSameTaskStreak(inputs: (string | Date)[], timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return consecutiveDayStreak(inputs, timezoneOffsetMinutes);
}

export function daysWithoutEvents(inputs: (string | Date)[], input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES, maxDays = 3650) {
  const blocked = new Set(inputs.map((item) => todayKey(item, timezoneOffsetMinutes)));
  let cursor = todayKey(input, timezoneOffsetMinutes);
  let days = 0;
  while (!blocked.has(cursor) && days < maxDays) {
    days += 1;
    const date = utcFromZonedParts(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 1, Number(cursor.slice(8, 10)) - 1, timezoneOffsetMinutes);
    cursor = todayKey(date, timezoneOffsetMinutes);
  }
  return days;
}
