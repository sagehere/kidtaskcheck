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

function utcFromZonedParts(year: number, month: number, day: number, timezoneOffsetMinutes: number) {
  return new Date(Date.UTC(year, month, day) - timezoneOffsetMinutes * MINUTE_MS);
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

export function signedPoints(pointType: "earn" | "deduct", points: number) {
  return pointType === "earn" ? Math.abs(points) : -Math.abs(points);
}

export function todayKey(input?: string | Date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return periodKey("daily", input, timezoneOffsetMinutes);
}

export type AchievementWindowType = "all_time" | "current_week" | "current_month" | "custom";

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
