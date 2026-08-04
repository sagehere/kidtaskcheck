import { ReactNode, useEffect } from "react";
import { Check, Trash2 } from "lucide-react";

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function Empty(props: { text: string }) {
  return <div className="empty">{props.text}</div>;
}

export function FeedbackToast({ message, error, onDismiss }: { message: string; error: string; onDismiss: () => void }) {
  const text = error || message;
  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [text]);
  if (!text) return null;
  return (
    <div className={`feedback-toast ${error ? "is-error" : "is-success"}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}

export function Tabs({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="tabs">
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function EditDialog({ title, icon: dialogIcon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel edit-modal">
        <div className="panel-title compact-title">
          {dialogIcon}
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function icon(type: string, value: string, label: string) {
  if (type === "gallery_image") return <img className="visual" src={value} alt={label} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  return <span className="emoji" role="img" aria-label={label}>{value || "⭐"}</span>;
}

const WEEKDAY_OPTIONS_LOCAL = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" }
];

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  const selected = [...value];
  function toggle(day: number) {
    const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day];
    onChange(next.length ? next : [1, 2, 3, 4, 5, 6, 0]);
  }
  return (
    <div className="weekday-picker">
      {WEEKDAY_OPTIONS_LOCAL.map((option) => (
        <button key={option.value} type="button" className={selected.includes(option.value) ? "active" : ""} onClick={() => toggle(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function formatPeriod(value: string) {
  const labels: Record<string, string> = { daily: "每日", weekly: "每周", monthly: "每月", once: "一次性", none: "不限" };
  return labels[value] || value;
}

export function formatMetric(value: string) {
  const labels: Record<string, string> = {
    tasks_completed: "累计完成任务", total_earned: "累计获得积分", balance: "当前积分余额",
    streak_days: "连续打卡天数", redemptions: "累计兑换奖励"
  };
  return labels[value] || value;
}

export function formatReset(resetAt?: string | null, label = "距重置", empty = "已达上限") {
  if (!resetAt) return empty;
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return "即将重置";
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${label} ${days}天${hours}小时`;
  return `${label} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function normalizeWeekdaysLocal(value: unknown) {
  if (Array.isArray(value)) return value.map(Number).filter((item) => item >= 0 && item <= 6);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((item) => item >= 0 && item <= 6);
    } catch {
      return value.split(",").map(Number).filter((item) => item >= 0 && item <= 6);
    }
  }
  return [1, 2, 3, 4, 5, 6, 0];
}

export function weekdayLabel(value: unknown) {
  const days = normalizeWeekdaysLocal(value);
  if (days.length === 7) return "周一至周日";
  return WEEKDAY_OPTIONS_LOCAL.filter((item) => days.includes(item.value)).map((item) => item.label).join("、") || "未设置";
}

export function weekdayLimitSuffix(value: unknown) {
  const days = normalizeWeekdaysLocal(value);
  if (days.length === 7) return "";
  return `（限${WEEKDAY_OPTIONS_LOCAL.filter((item) => days.includes(item.value)).map((item) => item.label.replace("周", "周")).join("、")}）`;
}

export function rewardDisplayTitle(item: any) {
  return `${item.title}${weekdayLimitSuffix(item.redeem_weekdays || item.redeemWeekdays)}`;
}

export function formatSource(value: string) {
  const labels: Record<string, string> = { task: "任务", reward: "奖励兑换", reward_cancel: "兑换退回", manual_deduction: "即时扣分", praise: "表扬", criticism: "批评" };
  return labels[value] || value;
}

export function formatNotificationSource(item: Notification) {
  if (item.sourceLabel || item.sourceTypeLabel) return item.sourceLabel || item.sourceTypeLabel;
  const labels: Record<string, string> = {
    task_submitted: "任务", task_approved: "任务", task_rejected: "任务",
    reward_requested: "奖励", reward_redeemed: "奖励", reward_cancelled: "奖励",
    praise: "表扬", criticism: "批评"
  };
  return labels[item.event_type || ""] || "";
}

import { Notification } from "../types/api";

export function PrerequisiteEditor({ tasks, value, onChange }: { tasks: any[]; value: { taskId: string; requiredCount: number }[]; onChange: (value: { taskId: string; requiredCount: number }[]) => void }) {
  function addPrerequisite() {
    onChange([...value, { taskId: tasks[0]?.id || "", requiredCount: 1 }]);
  }
  function removePrerequisite(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function updatePrerequisite(index: number, field: "taskId" | "requiredCount", val: string | number) {
    const next = value.map((item, i) => i === index ? { ...item, [field]: val } : item);
    onChange(next);
  }
  return (
    <Field label="前置任务">
      <div className="prerequisite-list">
        {value.map((prereq, index) => (
          <div className="prerequisite-item" key={index}>
            <select value={prereq.taskId} onChange={(e) => updatePrerequisite(index, "taskId", e.target.value)}>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
            <input type="number" min="1" value={prereq.requiredCount} onChange={(e) => updatePrerequisite(index, "requiredCount", Number(e.target.value))} style={{ width: 60 }} />
            <span>次</span>
            <button type="button" className="icon danger" onClick={() => removePrerequisite(index)}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="secondary" onClick={addPrerequisite}><Check size={14} />添加前置任务</button>
    </Field>
  );
}
