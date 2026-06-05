export type Me =
  | { type: "user"; role: "admin" | "parent"; id: string; displayName: string; username: string }
  | { type: "child"; role: "child"; id: string; parentId: string; displayName: string; username: string }
  | null;

export type Child = { id: string; username: string; display_name: string; status: string; balance?: number; ai_enabled?: number; gender?: string; birth_date?: string | null };
export type Gallery = { id: string; name: string; url: string; usage: string };
export type Category = { id: string; name: string; icon_type: string; icon_value: string; is_system: number };
export type Task = Record<string, any> & { assignees?: string[] };
export type Reward = Record<string, any> & { assignees?: string[] };
export type FeedbackTemplate = Record<string, any> & { id: string; kind: "praise" | "criticism"; title: string; description: string; points: number; icon_type: string; icon_value: string; is_active: number };
export type Notification = { id: string; title: string; body: string; event_type?: string; related_type?: string | null; related_id?: string | null; requires_ack?: number; read_at: string | null; created_at: string; sourceLabel?: string; sourceTypeLabel?: string };
export type LedgerRow = { id: string; amount: number; source_type: string; sourceLabel?: string; sourceTypeLabel?: string; note: string; created_at: string; localCreatedAt?: string; period_key?: string | null };
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
export type ChildDashboardSummary = { balance: number; aiGreeting: string; aiRefreshPending: boolean; child: Child | null };

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
  imageSize?: string;
  imageQuality?: string;
  imageFormat?: "png" | "jpeg" | "webp" | string;
  imageN?: number;
  hasImageKey?: boolean;
  imageApiKey?: string;
  updatedAt?: string;
};
export type ParentAiServiceConfig = AiServiceConfig;
export type CartoonReportResponse = { imageUrl: string; format: string; filename: string; promptPreview?: string };
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
