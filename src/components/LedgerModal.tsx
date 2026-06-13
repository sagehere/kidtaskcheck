import { useMemo, useState } from "react";
import { Coins } from "lucide-react";
import { LedgerRow } from "../types/api";
import { Empty, formatSource } from "./UI";
import { groupLedgerRows, LEDGER_FILTERS, LedgerFilter, ledgerDisplayTime } from "../lib/ledgerView";

function amountText(row: LedgerRow) {
  if (row.freeze_status === "frozen") return `预扣冻结${row.frozen_amount || 0}`;
  return `${row.amount >= 0 ? "+" : ""}${row.amount}`;
}

function sourceText(row: LedgerRow) {
  return row.sourceLabel || row.note || formatSource(row.source_type);
}

function kindText(row: LedgerRow) {
  return row.sourceTypeLabel || formatSource(row.source_type);
}

function LedgerRowItem({ row }: { row: LedgerRow }) {
  const isPositive = row.freeze_status !== "frozen" && Number(row.amount || 0) >= 0;
  return (
    <article className="ledger-row">
      <div className={`ledger-amount ${isPositive ? "positive" : "negative"}`}>{amountText(row)}</div>
      <div className="ledger-main">
        <div className="ledger-row-head">
          <strong>{sourceText(row)}</strong>
          <span className="ledger-chip">{kindText(row)}</span>
        </div>
        <div className="ledger-meta">
          <span>{ledgerDisplayTime(row)}</span>
          {row.actorLabel && <span>操作者：{row.actorLabel}</span>}
          {row.period_key && <span>{row.period_key}</span>}
        </div>
        {row.remedy_condition && (
          <small className="ledger-detail">
            补救：{row.remedy_condition}
            {row.remedy_points ? ` · 可挽回 ${row.remedy_points} 分` : ""}
            {row.localRemedyDeadlineAt ? ` · 截止 ${row.localRemedyDeadlineAt}` : ""}
          </small>
        )}
      </div>
    </article>
  );
}

export function LedgerModal({ title, rows, onClose }: { title: string; rows: LedgerRow[]; onClose: () => void }) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const groups = useMemo(() => groupLedgerRows(rows, filter), [rows, filter]);
  const visibleCount = groups.reduce((count, group) => count + group.rows.length, 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel ledger-modal ledger-modal-redesigned">
        <div className="panel-title compact-title">
          <Coins />
          <h2>{title}</h2>
          <button className="secondary" onClick={onClose}>关闭</button>
        </div>

        <div className="ledger-filter-bar" role="tablist" aria-label="积分筛选">
          {LEDGER_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? "active" : ""}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ledger-list">
          {visibleCount ? groups.map((group) => (
            <section className="ledger-group" key={group.key}>
              <h3>{group.label}</h3>
              <div className="ledger-group-list">
                {group.rows.map((row) => <LedgerRowItem key={row.id} row={row} />)}
              </div>
            </section>
          )) : <Empty text="没有符合条件的积分记录" />}
        </div>
      </section>
    </div>
  );
}
