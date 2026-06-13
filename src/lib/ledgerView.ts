import { LedgerRow } from "../types/api";

export type LedgerFilter = "all" | "income" | "expense" | "frozen" | "task" | "reward" | "feedback" | "required";

export const LEDGER_FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "income", label: "收入" },
  { value: "expense", label: "支出" },
  { value: "frozen", label: "冻结/补救" },
  { value: "task", label: "任务" },
  { value: "reward", label: "奖励" },
  { value: "feedback", label: "反馈" },
  { value: "required", label: "必做扣分" }
];

export function ledgerDisplayTime(row: LedgerRow) {
  return row.localCreatedAt || row.created_at || "";
}

export function ledgerDateKey(row: LedgerRow) {
  const value = ledgerDisplayTime(row);
  return value.slice(0, 10) || "unknown";
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ledgerGroupLabel(dateKey: string, now = new Date()) {
  if (dateKey === "unknown") return "未记录日期";
  const today = localDateKey(now);
  const yesterdayDate = new Date(now.getTime() - 86400000);
  const yesterday = localDateKey(yesterdayDate);
  if (dateKey === today) return "今天";
  if (dateKey === yesterday) return "昨天";
  return dateKey;
}

export function ledgerMatchesFilter(row: LedgerRow, filter: LedgerFilter) {
  if (filter === "all") return true;
  if (filter === "income") return Number(row.amount || 0) > 0;
  if (filter === "expense") return Number(row.amount || 0) < 0;
  if (filter === "frozen") return !!row.freeze_status || Number(row.frozen_amount || 0) > 0 || !!row.remedy_condition;
  if (filter === "task") return row.source_type === "task";
  if (filter === "reward") return ["reward", "reward_cancel", "reward_refund"].includes(row.source_type);
  if (filter === "feedback") return ["praise", "criticism", "feedback_recall"].includes(row.source_type);
  if (filter === "required") return row.source_type === "task_required_penalty";
  return true;
}

export function ledgerSummary(rows: LedgerRow[]) {
  return rows.reduce(
    (summary, row) => {
      const amount = Number(row.amount || 0);
      if (amount > 0) summary.income += amount;
      if (amount < 0) summary.expense += Math.abs(amount);
      summary.net += amount;
      if (row.freeze_status === "frozen") summary.frozen += Math.abs(Number(row.frozen_amount || 0));
      return summary;
    },
    { income: 0, expense: 0, net: 0, frozen: 0 }
  );
}

export function groupLedgerRows(rows: LedgerRow[], filter: LedgerFilter, now = new Date()) {
  const groups = new Map<string, { key: string; label: string; rows: LedgerRow[] }>();
  for (const row of rows) {
    if (!ledgerMatchesFilter(row, filter)) continue;
    const key = ledgerDateKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { key, label: ledgerGroupLabel(key, now), rows: [row] });
    }
  }
  return [...groups.values()];
}
