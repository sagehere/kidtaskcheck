export type Me =
  | { type: "user"; role: "admin" | "parent" | "parent_delegate"; id: string; displayName: string; username: string; operatorLabel?: string; delegateId?: string; parentId?: string }
  | { type: "child"; role: "child"; id: string; parentId: string; displayName: string; username: string }
  | null;

export type Child = { id: string; username: string; display_name: string; status: string; balance?: number; frozenPoints?: number; ai_enabled?: number; gender?: string; birth_date?: string | null; daily_review_enabled?: number; daily_review_seconds?: number };
export type Gallery = { id: string; name: string; url: string; usage: string };
export type Category = { id: string; name: string; icon_type: string; icon_value: string; is_system: number };
export type Task = Record<string, any> & { assignees?: string[] };
export type Reward = Record<string, any> & { assignees?: string[] };
export type FeedbackTemplate = Record<string, any> & { id: string; kind: "praise" | "criticism"; title: string; description: string; points: number; icon_type: string; icon_value: string; is_active: number; is_remediable?: number; remedy_condition?: string; remedy_points?: number; remedy_deadline_hours?: number };
export type ConfigGroupSummary = { id: string; name: string; is_active: number; activated_at?: string | null; created_at: string; updated_at: string; summary: { categories: number; tasks: number; rewards: number; achievements: number; feedbackTemplates: number }; applied?: Record<string, number> };
export type ParentDelegate = { id: string; username: string; display_name: string; operator_label?: string; status: string; created_at?: string; updated_at?: string };
export type Notification = { id: string; title: string; body: string; event_type?: string; related_type?: string | null; related_id?: string | null; requires_ack?: number; read_at: string | null; created_at: string; sourceLabel?: string; sourceTypeLabel?: string; actorLabel?: string };
export type LedgerRow = { id: string; amount: number; source_type: string; sourceLabel?: string; sourceTypeLabel?: string; actorLabel?: string; note: string; created_at: string; localCreatedAt?: string; period_key?: string | null; effective_amount?: number; frozen_amount?: number; freeze_status?: string; remedy_condition?: string; remedy_points?: number; remedy_deadline_at?: string | null; localRemedyDeadlineAt?: string; remedied_at?: string | null; settled_at?: string | null };
export type DailyReview = { reviewDate: string; presentedAt: string; acknowledgeAvailableAt: string; timezoneLabel: string; totals: { gained: number; deducted: number; net: number; frozen: number; praiseCount: number }; items: LedgerRow[]; praiseItems: LedgerRow[]; notificationCount: number };
export type WarehouseItem = Record<string, any> & { id: string; title: string; status: "pending" | "redeemed" | "cancelled"; redeemed_at?: string | null };
export type FeedbackEvent = Record<string, any> & {
  id: string;
  source_type: "praise" | "criticism";
  amount: number;
  note: string;
  created_at: string;
  localCreatedAt?: string;
  template_title?: string;
  sourceLabel?: string;
  sourceTypeLabel?: string;
  revoked_at?: string | null;
  effective_amount?: number;
  frozen_amount?: number;
  freeze_status?: string;
  remedy_condition?: string;
  remedy_points?: number;
  remedy_deadline_at?: string | null;
  localRemedyDeadlineAt?: string;
  remedied_at?: string | null;
  settled_at?: string | null;
};
export type LedgerResponse = { items: LedgerRow[]; timezoneOffsetMinutes: number; timezoneLabel: string };
export type SystemSettings = { timezoneOffsetMinutes: number; timezoneLabel: string };
export type SystemErrorLog = {
  id: string;
  level: "error" | "warning";
  source: string;
  message: string;
  stack?: string;
  status?: number | null;
  method?: string;
  path?: string;
  actor_type?: string;
  actor_id?: string;
  metadata_json?: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};
export type MaintenanceQueueStats = {
  key: string;
  table: string;
  label: string;
  exists: boolean;
  total: number;
  backlog: number;
  pending: number;
  processing: number;
  failedRecent: number;
  terminalRecent: number;
  failureRate: number;
  statusCounts: Record<string, number>;
};
export type MaintenanceStats = {
  retentionDays: { detail: number; shortRecord: number; aiJob: number };
  lastRunAt: string;
  lastRunStats: Record<string, any>;
  aiJobs: { since: string; queues: MaintenanceQueueStats[]; totalBacklog: number; failedRecent: number; terminalRecent: number };
};export type ChildDashboardSummary = { balance: number; frozenPoints: number; aiGreeting: string; aiRefreshPending: boolean; child: Child | null };

export type RemedyCriticismItem = {
  id: string;
  sourceType?: "criticism" | "task_required_penalty";
  childId: string;
  childName: string;
  title: string;
  note: string;
  frozenAmount: number;
  remedyPoints: number;
  remedyCondition: string;
  remedyDeadlineAt: string;
  localRemedyDeadlineAt: string;
  remainingMs: number;
  createdAt: string;
  localCreatedAt: string;
};

export type EmojiSource = {
  name: string;
  unified: string;
  short_name: string;
  short_names?: string[];
  category: string;
  sort_order: number;
  skin_variations?: Record<string, { unified: string }>;
};

export type EmojiOption = { emoji: string; name: string; shortNames: string[]; category: string; sortOrder: number; search: string; rank: number };

export type AiServiceConfig = {
  baseUrl: string;
  model: string;
  prompt: string;
  reportPrompt?: string;
  monthlyPrompt?: string;
  hasKey: boolean;
  apiKey?: string;
  imageBaseUrl?: string;
  imageModel?: string;
  imagePrompt?: string;
  checklistImagePrompt?: string;
  scheduleImagePrompt?: string;
  imageSize?: string;
  imageQuality?: string;
  imageFormat?: "png" | "jpeg" | "webp" | string;
  imageN?: number;
  hasImageKey?: boolean;
  imageApiKey?: string;
  updatedAt?: string;
};
export type ParentAiServiceConfig = AiServiceConfig;
export type CartoonReportResponse = { id?: string; childId?: string; period?: "weekly" | "monthly"; periodKey?: string; status?: "pending" | "processing" | "completed" | "failed"; retryCount?: number; lastError?: string; imageUrl?: string; format: string; filename: string; promptPreview?: string; createdAt?: string; updatedAt?: string; completedAt?: string };
export type ChecklistImageResponse = Omit<CartoonReportResponse, "period" | "periodKey">;
export type ScheduleImageResponse = Omit<CartoonReportResponse, "period" | "periodKey">;
export type ChildScheduleSlot = { id?: string; title: string; planHtml?: string; startMinutes: number; endMinutes: number; sort_order?: number };
export type ChildScheduleItem = { id?: string; slotId: string; taskId: string; title?: string; points?: number; period?: string; category_name?: string; is_required?: number; required_count?: number; description?: string; requiredPenaltyExempted?: boolean };
export type ChildScheduleData = { slots: ChildScheduleSlot[]; items: ChildScheduleItem[] };
export const REFRESH_INTERVAL_MS = 12000;
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" }
];
