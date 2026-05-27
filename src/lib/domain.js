function pad(value) {
    return String(value).padStart(2, "0");
}
export function toDate(input) {
    return input instanceof Date ? input : input ? new Date(input) : new Date();
}
export function periodKey(period, input) {
    const date = toDate(input);
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    if (period === "none")
        return "none";
    if (period === "once")
        return "once";
    if (period === "daily")
        return `${year}-${month}-${day}`;
    if (period === "monthly")
        return `${year}-${month}`;
    const copy = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const weekday = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() + 4 - weekday);
    const weekYear = copy.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${weekYear}-W${pad(week)}`;
}
export function signedPoints(pointType, points) {
    return pointType === "earn" ? Math.abs(points) : -Math.abs(points);
}
export function todayKey(input) {
    return periodKey("daily", input);
}
export function consecutiveDayStreak(dayKeys) {
    const unique = [...new Set(dayKeys)].sort().reverse();
    if (!unique.length)
        return 0;
    let streak = 1;
    let cursor = new Date(`${unique[0]}T00:00:00.000Z`);
    for (const key of unique.slice(1)) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        const expected = todayKey(cursor);
        if (key !== expected)
            break;
        streak += 1;
    }
    return streak;
}
