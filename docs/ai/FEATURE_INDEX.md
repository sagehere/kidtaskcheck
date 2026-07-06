# FEATURE_INDEX

最近更新：2026-06-30

本文件按“用户可感知功能”组织维护入口。P0 是默认必须读取文件；P1 是实现跨界或需要上下文时再读；P2 是 schema、测试、部署或高风险排查时谨慎读取。

## 1. 登录、会话与角色入口

- 功能说明：用户登录、退出、获取当前身份，并按 admin/parent/parent_delegate/child 进入对应页面。
- 用户入口：登录页、右上角退出、应用首次加载。
- P0：`src/App.tsx`、`src/api/client.ts`、`server/api/routes/auth.js`、`server/api/router.mjs`
- P1：`server/api/utils.js`、`src/components/Shell.tsx`、`src/types/api.ts`
- P2：`migrations/0001_initial.sql`、`tests/api.test.ts`
- 主要调用链：`App Login.submit` -> `api("/auth/login")` -> `handleApiRequest` -> `handleAuthRoutes`; `App.loadMe` -> `/auth/me`; `Shell.logout` -> `/auth/logout`
- 相关状态：`sessions`、`users.status`、`users.role`、浏览器 unauthorized 事件
- 相关接口：`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`
- 修改注意事项：登录错误要保留后端凭据错误；生产默认管理员密码限制在 router/bootstrap 路径；角色分流改动会影响三个角色 App；会话默认 180 天；登录页支持“记住我”，选中后使用长期滚动会话（auth.js + utils.js cookie Max-Age 与 sessions.expires_at 同步更新）；“进入系统”按钮在“记住我”下一行独占显示。
- 最近更新时间：2026-06-22

## 2. 管理员后台

- 功能说明：管理员管理家长账号、图库、系统时区、系统错误日志、维护统计、AI 队列健康度和管理员自身资料。
- 用户入口：管理员登录后的后台页面。
- P0：`src/AdminApp.tsx`、`server/api/routes/admin.js`、`server/api/utils.js`
- P1：`src/types/api.ts`、`src/components/UI.tsx`、`server/api/router.mjs`
- P2：`migrations/0001_initial.sql`、`migrations/0018_system_error_logs_and_ai_queue_controls.sql`、`tests/api.test.ts`
- 主要调用链：`AdminApp.load` -> `/admin/users`、`/admin/gallery-images`、`/admin/system-settings`、`/admin/system-error-logs`、`/admin/maintenance-stats` -> `handleAdminRoutes`
- 相关状态：`users`、`gallery_images`、`system_settings.timezone_offset_minutes`、`system_settings.cleanup_last_*`、`system_error_logs`、AI job tables
- 相关接口：`GET/POST /api/admin/users`、`PATCH/DELETE /api/admin/users/:id`、`PATCH /api/admin/profile`、`GET/POST /api/admin/gallery-images`、`GET/PATCH /api/admin/system-settings`、`GET /api/admin/maintenance-stats`、`GET/POST /api/admin/system-error-logs`
- 修改注意事项：删除家长是归档/停用而非硬删；生产图片 URL 协议限制不同；时区影响报表和 scheduled AI；维护统计只读展示最近清理数量、AI 队列积压和 7 天失败率。
- 最近更新时间：2026-06-12

## 3. 家长待办审核

- 功能说明：家长审核孩子提交的任务、核销或取消奖励兑换，并从通知中心快捷处理。
- 用户入口：家长首页“待处理”标签、通知中心快捷操作。
- P0：`src/ParentApp.tsx`、`src/components/Shell.tsx`、`server/api/routes/parent.js`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/ChildApp.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0003_notifications.sql`、`migrations/0013_concurrency_idempotency.sql`、`tests/concurrency.test.ts`、`tests/notifications.test.ts`
- 主要调用链：`ParentApp.review`/`Shell.quickAction` -> `/task-submissions/:id/review`; `ParentApp.finishRedemption`/`Shell.quickAction` -> `/reward-redemptions/:id/redeem|cancel`; 后端写账本和通知后刷新 dashboard。
- 相关状态：`task_submissions`、`reward_redemptions`、`point_ledger`、`notifications`
- 相关接口：`PATCH /api/task-submissions/:id/review`、`PATCH /api/reward-redemptions/:id/redeem`、`PATCH /api/reward-redemptions/:id/cancel`、`GET /api/dashboard/parent`
- 修改注意事项：审核和兑换需要幂等/并发保护；积分余额只从 `point_ledger` 汇总；通知快捷处理要同步标记已读和刷新；`grading_mode=completion` 的任务审核必须从家长待办选择 `completion_standards_json` 中的文字标准，不能走通知中心无档位快捷通过。
- 最近更新时间：2026-06-12

## 4. 孩子账号、协同管理与家长资料

- 功能说明：家长创建/编辑/归档孩子账号，设置孩子 AI/demographic 字段，维护协同管理账号和操作称谓。
- 用户入口：家长“孩子/设置”相关区域。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/utils.js`
- P1：`src/types/api.ts`、`src/App.tsx`、`src/components/Shell.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0011_ai_service_and_child_fields.sql`、`migrations/0020_parent_delegates_operator_cartoon_jobs.sql`、`tests/api.test.ts`、`tests/cross-family.test.ts`
- 主要调用链：`ParentApp.load` -> `/children`、`/parent/delegates`; `saveChild/toggleChild/deleteChild` -> `/children/:id`; delegate create/update/delete -> `/parent/delegates`
- 相关状态：`children`、`users`、`parent_delegates`、`operator_label`、`ai_enabled`、`gender`、`birth_date`
- 相关接口：`GET/POST /api/children`、`PATCH/DELETE /api/children/:id`、`GET/POST /api/parent/delegates`、`PATCH/DELETE /api/parent/delegates/:id`、`PATCH /api/parent/profile`
- 修改注意事项：跨家庭查询必须 SQL 层过滤 `parent_id`；归档优先软删除；协同管理权限边界待确认。
- 最近更新时间：2026-06-12

## 5. 任务与分类配置

- 功能说明：家长维护任务分类、任务规则、分配孩子、周期限制、星期限制、展示图标和按完成程度给分标准。Emoji vendor 数据仅在 `EmojiSelect` 打开选择器时动态加载。支持必做任务配置：设置必做次数和未达标扣分，周期结束后由后端幂等结算。现有任务列表中显示必做规则摘要。
- 用户入口：家长设置/配置区域中的任务和分类表单。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`src/lib/domain.ts`、`src/lib/domain.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/components/EmojiSelect.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0002_limits_and_repeat_submissions.sql`、`migrations/0005_feedback_templates_and_timezone.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0022_required_tasks.sql`、`tests/domain.test.ts`、`tests/api.test.ts`、`tests/ledger.test.ts`
- 主要调用链：`ParentApp.load` -> `/task-categories`、`/tasks`; `create/update/remove` -> `/task-categories`、`/tasks`; 孩子端从 `/dashboard/child` 接收可提交任务；必做结算 `settleRequiredTaskPenalties` 由 `server/scheduler-tick.mjs` 的共享 `schedulerTick` 函数（被内置 scheduler 和独立 scheduler 共同调用）每次 tick 显式触发，同时受 `maybeRunMaintenance` 的 24 小时清理闸门间接触发。
- 相关状态：`task_categories`、`tasks`、`task_assignees`、`task_submissions`、`task_required_penalties`、`tasks.grading_mode`、`tasks.completion_standards_json`
- 相关接口：`GET/POST /api/task-categories`、`PATCH/DELETE /api/task-categories/:id`、`GET/POST /api/tasks`、`PATCH/DELETE /api/tasks/:id`
- 修改注意事项：`domain.ts` 与 `domain.js` 必须同步；任务可见性会影响孩子端、报表、成就和奖励前置条件；必做任务只对每日/每周/每月任务生效；扣分最多扣到可用积分 0，不产生负分；家长任务列表 small 标签中追加必做规则摘要；完成程度给分使用任务行 JSON 档位，不拆独立表；必做扣分会通过 `notify` 创建 `task_required_penalty` 事件通知，来源标签为"必做扣分 / 任务：{title}"，排序按 `created_at` 倒序，不做置顶；必做扣分按 `task_id + child_id + period_key` 每周期幂等结算，同周期不重复扣、不同周期各自生成独立扣分和账本记录。
- 最近更新时间：2026-06-14

## 6. 奖励、兑换、仓库与退款

- 功能说明：家长维护奖励和兑换规则，孩子兑换奖励，家长核销/取消/退款，孩子查看或清理仓库；仓库含奖励与隐藏成就两个标签。
- 用户入口：家长奖励配置、家长待办、孩子奖励/仓库页面。
- P0：`src/ParentApp.tsx`、`src/ChildApp.tsx`、`server/api/routes/parent.js`、`server/api/routes/child.js`
- P1：`server/api/routes/shared.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0001_initial.sql`、`migrations/0004_reward_once_period.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0010_retention_reports_feedback_recall.sql`、`tests/ledger.test.ts`、`tests/api.test.ts`
- 主要调用链：`ChildApp.redeemReward` -> `/reward-redemptions`; `ParentApp.finishRedemption` -> `/reward-redemptions/:id/redeem|cancel`; refund modal -> `/reward-redemptions/:id/refund`; warehouse -> `/warehouse`
- 相关状态：`rewards`、`reward_assignees`、`reward_prerequisites`、`reward_redemptions`、`point_ledger`
- 相关接口：`GET/POST /api/rewards`、`PATCH/DELETE /api/rewards/:id`、`POST /api/reward-redemptions`、`PATCH /api/reward-redemptions/:id/redeem|cancel|refund`、`GET /api/warehouse`、`PATCH /api/warehouse/clear-redeemed`、`GET /api/warehouse/achievements`
- 修改注意事项：取消/退款要正确返还积分；已核销仓库记录和孩子端隐藏逻辑要分清；奖励前置任务会依赖任务完成周期；退还奖励弹窗的候选列表需要保持弹窗内滚动，避免记录较多时挤出操作按钮。
- 最近更新时间：2026-06-13

## 7. 成就规则

- 功能说明：家长维护成就、解锁规则、目标任务/分类/时间窗口和成就关联奖励；孩子可隐藏/展示已解锁称号。
- 用户入口：家长设置/配置区域中的成就表单，孩子端成就展示。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`src/lib/appHelpers.ts`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/ChildApp.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0006_achievement_rules.sql`、`migrations/0007_achievement_category_rules.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`tests/api.test.ts`
- 主要调用链：`ParentApp.load` -> `/achievements`; create/update/delete -> `/achievements`; 后端在任务审核等路径中计算或授予成就。
- 相关状态：`achievements`、`child_achievements.hidden_from_child_at`、`tasks`、`task_categories`、`rewards`
- 相关接口：`GET/POST /api/achievements`、`PATCH/DELETE /api/achievements/:id`
- 修改注意事项：成就规则和奖励联动容易影响积分/通知；规则展示由 `appHelpers.ts` 生成，后端判定在 helper 路径中；孩子隐藏称号只更新 `child_achievements.hidden_from_child_at`，不影响成就配置和解锁历史。
- 最近更新时间：2026-06-12

## 8. 表扬批评、补救与反馈召回

- 功能说明：家长维护反馈模板，对孩子记录表扬/批评，支持召回和可补救批评。
- 用户入口：家长设置中的反馈模板、孩子管理中的反馈记录入口。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/ChildApp.tsx`
- P2：`migrations/0005_feedback_templates_and_timezone.sql`、`migrations/0010_retention_reports_feedback_recall.sql`、`migrations/0021_remediable_criticism_daily_greeting_checklist_images.sql`、`tests/api.test.ts`、`tests/ledger.test.ts`
- 主要调用链：`ParentApp.applyFeedback` -> `/children/:id/feedback-events`; event list -> `/children/:id/feedback-events`; recall/remedy -> `/feedback-events/:id/recall|remedy`
- 相关状态：`feedback_templates`、`point_ledger`、`activity_archives`、`notifications`
- 相关接口：`GET/POST /api/feedback-templates`、`PATCH/DELETE /api/feedback-templates/:id`、`GET/POST /api/children/:id/feedback-events`、`PATCH /api/feedback-events/:id/recall`、`PATCH /api/feedback-events/:id/remedy`
- 修改注意事项：批评可能冻结积分，补救后结算；召回要保留审计/归档语义；相关账本字段在 0021 之后扩展；反馈创建必须显式写入 `point_ledger.created_at=nowIso()` 并把同一 `createdAt` 传给通知，反馈记录查询用 `datetime(created_at)` 过滤并按 `datetime(created_at) DESC, created_at DESC, id DESC` 排序以兼容旧 SQLite 时间文本；反馈撤回弹窗的候选列表需要保持弹窗内滚动，避免记录较多时挤出操作按钮。
- 最近更新时间：2026-06-13

## 9. 孩子端任务、积分与固定卡片

- 功能说明：孩子查看今日任务、提交任务、查看积分/冻结积分、固定任务或奖励卡片、查看 AI 问候；成就墙支持隐藏称号，隐藏后可在仓库成就标签中展示回来。必做任务在任务墙中靠前排序并以醒目标记标识，卡片上提示"须完成X次"。任务墙右上角支持"日程表显示"开关，打开后按已设置的日程时段组织任务，显示每个时段的计划内容，并保留未安排任务分组。
- 用户入口：孩子登录后的首页、积分账本弹层、固定按钮。
- P0：`src/ChildApp.tsx`、`server/api/routes/child.js`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/components/Shell.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0008_child_pins.sql`、`migrations/0011_ai_service_and_child_fields.sql`、`migrations/0021_remediable_criticism_daily_greeting_checklist_images.sql`、`tests/api.test.ts`
- 主要调用链：`ChildApp.loadSummary` -> `/dashboard/child-summary`; `ChildApp.load` -> `/dashboard/child`; submit -> `/task-submissions`; pin -> `/child-pins/:kind`; ledger -> `/points/ledger`
- 相关状态：`task_submissions`、`point_ledger`、`child_pins`、`ai_child_greetings`
- 相关接口：`GET /api/dashboard/child-summary`、`GET /api/dashboard/child`、`POST /api/task-submissions`、`PATCH /api/child-pins/:kind`、`PATCH /api/child-achievements/:achievementId/visibility`、`GET /api/points/ledger`
- 修改注意事项：孩子提交任务要防重复；冻结/有效积分展示要和账本一致；AI 问候只展示缓存状态，不应在孩子端暴露生成触发逻辑；必做任务排序在前端完成，不改变后端查询顺序；任务墙日程表显示只改变前端组织方式，不改变任务提交/审核/积分流程；任务墙时段标题旁时间文本使用约两格字符间距紧邻展示，计划富文本仅在非空时显示在任务卡片上方；`.required-card::before` 覆盖默认渐变色为琥珀/红色。
- 最近更新时间：2026-06-22

## 10. 积分账本、报表、打印与归档

- 功能说明：家长/孩子查看积分账本，家长导出孩子打印清单和周/月报表，系统保留活动归档。
- 用户入口：家长孩子卡片中的账本/打印/报表按钮，孩子积分账本；周/月报表与打印输出包含日程计划并适配 A4。
- P0：`src/ParentApp.tsx`、`src/ChildApp.tsx`、`server/api/routes/parent.js`、`server/api/routes/shared.js`、`src/lib/domain.ts`、`src/lib/domain.js`
- P1：`server/api/utils.js`、`server/api/ai/cache.js`、`src/types/api.ts`
- P2：`migrations/0010_retention_reports_feedback_recall.sql`、`migrations/0015_ai_report_commentaries.sql`、`migrations/0028_report_window_indexes.sql`、`migrations/0028_report_window_indexes.sql`、`tests/domain.test.ts`、`tests/api.test.ts`、`tests/ledger.test.ts`
- 主要调用链：ledger modal -> `/points/ledger`; print -> `/children/:id/export-print`; report -> `/children/:id/report?period=weekly|monthly`; report may read cached AI commentary.
- 相关状态：`point_ledger`、`activity_archives`、`ai_report_commentaries`、`system_settings.timezone_offset_minutes`
- 相关接口：`GET /api/points/ledger`、`GET /api/children/:id/export-print`、`GET /api/children/:id/report`
- 修改注意事项：报表应使用已完成周期语义；所有报表打印应适配 A4；AI 评论缺失不能让基础 HTML 报表 500；时区变化影响周期窗口；`ledgerSource` 支持 `task_required_penalty` 来源类型，展示"必做扣分 / 任务：{title}"；`/points/ledger` 按 `datetime(created_at) DESC, created_at DESC, id DESC` 排序，报表账本窗口用 `datetime(created_at)` 过滤，`localTimeText` 将旧 `YYYY-MM-DD HH:mm:ss` 视为 UTC 后再应用系统时区；积分清单 UI 使用共享 `LedgerModal`，默认按今天/昨天/日期分组，支持收入、支出、冻结/补救、任务、奖励、反馈、必做扣分筛选，不显示顶部汇总卡片。
- 最近更新时间：2026-06-13

- Maintenance note (2026-06-30): long-running SQLite cleanup keeps detailed ledger/submission/redemption rows for `detail_retention_days` (default 365) and summarizes old ledger rows into `activity_archives`. `archiveOldActivity` must update existing monthly archives and the matching `activity_archive` ledger row when late old rows appear, because `point_ledger` remains the balance source of truth. `db:compact` is the low-frequency maintenance-window command for shrinking the SQLite file after cleanup; do not run VACUUM on the normal request/bootstrap path. Report/ledger window queries are supported by `idx_ledger_child_parent_created`, `idx_submissions_child_parent_submitted`, `idx_redemptions_child_parent_requested`, and `idx_child_achievements_child_unlocked`; keep runtime `ensureReportWindowIndexes` in sync with migration 0028.

## 11. 通知中心

- 功能说明：家长和孩子查看未读通知，标记已读，家长可对任务/奖励通知快捷审批。
- 用户入口：全局 Shell 通知按钮和通知抽屉。
- P0：`src/components/Shell.tsx`、`server/api/routes/shared.js`
- P1：`server/api/routes/parent.js`、`server/api/routes/child.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0003_notifications.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0020_parent_delegates_operator_cartoon_jobs.sql`、`tests/notifications.test.ts`
- 主要调用链：`Shell.loadNotifications` -> `/notifications`; mark read -> `/notifications/:id/read`; read all -> `/notifications/read-all`; quick action -> parent review/redemption endpoints.
- 相关状态：`notifications.read_at`、`recipient_type`、`recipient_id`、`actor_label_snapshot`
- 相关接口：`GET /api/notifications`、`PATCH /api/notifications/read-all`、`PATCH /api/notifications/:id/read`
- 修改注意事项：当前通知列表只展示未读；后端排序为待处理项（`task_submission` / `reward_redemption`）优先，再按 `created_at DESC, id DESC`；前端消息中心提供全部未读、待处理、需签收、普通消息筛选，并在全部未读中把待处理分组置顶；`notificationSource` 支持 `task_required_penalty` 事件类型和 `point_ledger` 关联来源；`eventTypeLabel` 新增 `task_required_penalty` 返回"必做扣分"；消息筛选条（`.notification-filter-bar`）已修复 CSS 布局：固定高度、隐藏滚动条、不遮挡下方消息列表、移动端保留横向滑动但不显示滚动条。
- 最近更新时间：2026-06-14

## 12. AI 服务、问候与报告评论

- 功能说明：家长配置 OpenAI-compatible 文本 AI，拉取模型，测试连接，预览问候/周报/月报，系统定时生成孩子问候和报告评论。模型选择支持手动输入任意兼容模型名。预览结果可手动替换写入对应缓存。
- 用户入口：家长设置中的 AI 服务区域、孩子端问候、家长报表。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/ai/orchestrator.js`、`server/api/ai/providers.js`、`server/api/ai/prompt.js`
- P1：`server/api/ai/cache.js`、`server/api/ai/queue.js`、`server/api/ai/scheduled.js`、`server/scheduler-tick.mjs`、`server/scheduler.mjs`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0011_ai_service_and_child_fields.sql`、`migrations/0014_parent_ai_service_settings.sql`、`migrations/0015_ai_report_commentaries.sql`、`migrations/0016_ai_generation_queue.sql`、`migrations/0017_ai_scheduled_refresh_runs.sql`、`migrations/0018_system_error_logs_and_ai_queue_controls.sql`、`tests/ai.test.ts`、`tests/api.test.ts`
- 主要调用链：settings load/save -> `/parent/ai-service`; model/test -> `/parent/ai-service/models|test`; preview -> `/parent/ai-service/preview`; preview/cache -> `/parent/ai-service/preview/cache`; scheduler -> `server/api/ai/scheduled.js` -> queue/orchestrator/cache。
- 相关状态：`parent_ai_service_settings`、`ai_child_greetings`、`ai_report_commentaries`、`ai_generation_queue`、`ai_scheduled_refresh_runs`、`system_error_logs`、`system_settings.cleanup_last_stats_json`
- 相关接口：`GET/PATCH /api/parent/ai-service`、`POST /api/parent/ai-service/models`、`POST /api/parent/ai-service/test`、`POST /api/parent/ai-service/preview`、`POST /api/parent/ai-service/preview/cache`
- 修改注意事项：AI 预览默认不写缓存（`{ cache: false }`）；设置页 draft state 不能被轮询覆盖；新增 schema 要同时考虑 runtime ensure；scheduled 使用管理员时区和已完成周期；模型字段使用 `<input list>` 支持手动输入；预览替换缓存使用 `INSERT OR REPLACE` 只替换当前配置 hash 下的缓存，不触发新 AI 调用；管理员维护统计读取 AI 队列 pending/processing 积压和近 7 天终态失败率，不触发 AI 生成。
- 最近更新时间：2026-06-15

## 13. AI 图片、漫画报告、打印清单图与日程表图

- 功能说明：家长配置图片 AI，生成周/月漫画报告图片，生成孩子打印清单图，生成日程表插画图，并轮询异步任务状态；日程图 prompt 会包含每个时段的计划文本和可完成任务。
- 用户入口：家长 AI 设置/孩子报表或打印相关按钮。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/ai/cartoon-queue.js`、`server/api/ai/orchestrator.js`、`server/api/ai/providers.js`
- P1：`server/api/ai/prompt.js`、`server/api/ai/cache.js`、`server/api/ai/index.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0019_parent_ai_image_settings.sql`、`migrations/0020_parent_delegates_operator_cartoon_jobs.sql`、`migrations/0021_remediable_criticism_daily_greeting_checklist_images.sql`、`migrations/0023_child_schedule.sql`、`migrations/0025_child_schedule_plan_html.sql`、`tests/ai.test.ts`、`tests/api.test.ts`
- 主要调用链：`ParentApp.generateCartoonReport` -> `/parent/ai-service/cartoon-report` -> queue -> provider image generation -> polling `/parent/ai-service/cartoon-report/:jobId`; checklist image -> `/children/:id/print-checklist-image` -> polling job endpoint; schedule image -> `/children/:id/schedule-image` -> polling job endpoint。
- 相关状态：`parent_ai_service_settings.image_*`、`ai_cartoon_report_jobs`、`ai_print_checklist_image_jobs`、`ai_schedule_image_jobs`、`system_settings.cleanup_last_stats_json`
- 相关接口：`POST /api/parent/ai-service/cartoon-report`、`GET /api/parent/ai-service/cartoon-report/:jobId`、`POST /api/children/:id/print-checklist-image`、`GET /api/children/:id/print-checklist-image/:jobId`、`POST /api/children/:id/schedule-image`、`GET /api/children/:id/schedule-image/:jobId`
- 修改注意事项：图片 AI 配置和文本 AI 配置分开；前端轮询有 abort controller；不要把生成结果持久化到新存储，除非用户明确要求。日程表图使用独立 `ai_schedule_image_jobs` 表和独立提示词 `schedule_image_prompt`；生成 prompt 时将 `plan_html` 转为纯文本，避免把 HTML 标签直接交给图片模型。
- 最近更新时间：2026-06-22

- Maintenance note (2026-06-30): AI queue/job history uses `ai_job_retention_days` (default 92). Daily maintenance deletes only completed/failed rows older than the cutoff from `ai_generation_queue`, `ai_scheduled_refresh_runs`, `ai_cartoon_report_jobs`, `ai_print_checklist_image_jobs`, and `ai_schedule_image_jobs`; pending/processing rows and user-visible AI content caches are retained. Admin `/admin/maintenance-stats` surfaces latest cleanup counts, backlog, and recent failure rate across these tables.

## 14. 孩子日程表

- 功能说明：孩子编辑每日日程表设置（时段增删、每个时段的“计划”富文本、任务拖入/移除），所有时段共用一个任务卡片池；任务达到本周期可完成次数上限后从任务池移除。家长打印日程表、绘制日程表插画。日程表为每日模板结构，独立于清单/报表。日程表绘图有独立提示词。
- 用户入口：孩子端"日程表设置"标签页、任务墙右上角"日程表显示"开关、家长报告弹窗中"打印日程表/绘制日程表"。
- P0：`src/ChildApp.tsx`、`src/ParentApp.tsx`、`server/api/routes/child.js`、`server/api/routes/parent.js`
- P1：`server/api/utils.js`、`server/api/ai/cartoon-queue.js`、`server/api/ai/orchestrator.js`、`server/api/ai/cache.js`、`server/api/ai/index.js`、`src/types/api.ts`、`src/styles.css`
- P2：`migrations/0023_child_schedule.sql`、`migrations/0024_child_schedule_drop_unique.sql`、`migrations/0025_child_schedule_plan_html.sql`、`tests/migration.test.ts`、`tests/api.test.ts`
- 主要调用链：`ChildApp.scheduleTab` -> GET/PUT `/children/:id/schedule`; `ParentApp.exportChildSchedulePrint` -> window.open `/children/:id/schedule-print`; `ParentApp.generateScheduleImage` -> POST `/children/:id/schedule-image` -> queue -> polling -> GET `/children/:id/schedule-image/:jobId`
- 相关状态：`child_schedule_slots.plan_html`、`child_schedule_items`、`ai_schedule_image_jobs`、`parent_ai_service_settings.schedule_image_prompt`
- 相关接口：`GET/PUT /api/children/:id/schedule`、`GET /api/children/:id/schedule-print`、`POST /api/children/:id/schedule-image`、`GET /api/children/:id/schedule-image/:jobId`
- 修改注意事项：日程表只有孩子可编辑、家长只读查看；每个时段包含“计划”和“可完成任务”两行；计划富文本保存为受限 HTML，前端编辑器避免在输入中重写 DOM 以保留光标位置，加载日程时必须映射后端 `plan_html`；任务拖入日程表不改变积分/任务提交流程；任务卡片池使用任务自身 `limitCount/limit_count` 作为可安排次数口径，不使用必做 `required_count`；日程表绘图排队使用独立 `ai_schedule_image_jobs` 表；`PUT schedule` 原子替换事务；验证时段不重叠、任务属于该孩子。新数据库迁移 0023/0025 需 bootstrap 运行 ensureChildScheduleSchema。
- 最近更新时间：2026-06-22

## 15. 配置导入导出与开发测试入口

- 功能说明：家长导出/导入家庭配置，开发模式下重置当前家长进度。导出配置会保留任务/奖励的孩子分配显示名、必做任务规则、奖励前置任务标题和成就指定任务标题，导入时按当前家庭的孩子名、分类名和任务标题重新映射。
- 用户入口：家长设置中的导入导出按钮和开发隐藏重置入口。
- P0：`src/ParentApp.tsx`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`server/api/routes/parent.js`、`src/types/api.ts`
- P2：`migrations/*.sql`、`tests/api.test.ts`、`tests/migration.test.ts`
- 主要调用链：export -> `/config/export`; import -> `/config/import`; dev reset -> `/testing/reset-parent-progress`
- 相关状态：家庭配置相关表、任务/奖励/成就/反馈模板/孩子分配关系
- 相关接口：`GET /api/config/export`、`POST /api/config/import`、`POST /api/testing/reset-parent-progress`
- 修改注意事项：导入必须保持跨家庭隔离和去重策略；任务配置导入导出要保留 `grading_mode` 和 `completion_standards_json`；开发重置只应在开发环境可用；`migrations/*.sql` 属 P2，只有 schema 兼容排查或导入格式变化时读取；跨库可移植配置不要依赖旧数据库内的任务/孩子 ID，优先使用 `assignee_names`、`task_title`、`target_task_title` 等名称映射。
- 最近更新时间：2026-06-15


## 16. 配置组

- 功能说明：家长在设置页保存、重命名、更新、删除和激活配置组，并可一键清空当前任务配置、奖励配置、成就称号、表扬与批评条款；配置组快照包含四类配置，最多保存 5 个。
- 用户入口：家长设置页顶部“配置组”面板。
- P0：`src/ParentApp.tsx`、`server/api/routes/shared.js`、`server/api/utils.js`
- P1：`src/types/api.ts`、`src/styles.css`
- P2：`migrations/0026_config_groups.sql`、`tests/api.test.ts`、`tests/migration.test.ts`
- 主要调用链：`ParentApp.load` -> `/config-groups`；保存/重命名/更新/激活/删除/清空当前配置 -> `handleSharedRoutes` -> config group helpers；激活使用事务覆盖四类设置并保留历史记录；清空当前配置复用同一软删除/停用语义但不删除配置组快照。
- 相关状态：`config_groups`、`task_categories`、`tasks`、`rewards`、`achievements`、`feedback_templates`。
- 相关接口：`GET/POST /api/config-groups`、`PATCH/DELETE /api/config-groups/:id`、`POST /api/config-groups/:id/refresh`、`POST /api/config-groups/:id/activate`、`POST /api/config/clear-current`。
- 修改注意事项：配置组激活是覆盖当前四块设置而非普通导入；任务快照要保留完成程度给分档位；当前业务配置采用软删除/停用以保留历史记录；配置组删除只删除保存的快照；一键清空只清当前可编辑四块配置，不清孩子账号、历史提交、兑换、积分账本或配置组快照；每个家长最多 5 个配置组。
- 最近更新时间：2026-06-25
