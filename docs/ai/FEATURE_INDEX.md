# FEATURE_INDEX

最近更新：2026-06-12

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
- 修改注意事项：登录错误要保留后端凭据错误；生产默认管理员密码限制在 router/bootstrap 路径；角色分流改动会影响三个角色 App。
- 最近更新时间：2026-06-12

## 2. 管理员后台

- 功能说明：管理员管理家长账号、图库、系统时区、系统错误日志和管理员自身资料。
- 用户入口：管理员登录后的后台页面。
- P0：`src/AdminApp.tsx`、`server/api/routes/admin.js`、`server/api/utils.js`
- P1：`src/types/api.ts`、`src/components/UI.tsx`、`server/api/router.mjs`
- P2：`migrations/0001_initial.sql`、`migrations/0018_system_error_logs_and_ai_queue_controls.sql`、`tests/api.test.ts`
- 主要调用链：`AdminApp.load` -> `/admin/users`、`/admin/gallery-images`、`/admin/system-settings`、`/admin/system-error-logs` -> `handleAdminRoutes`
- 相关状态：`users`、`gallery_images`、`system_settings.timezone_offset_minutes`、`system_error_logs`
- 相关接口：`GET/POST /api/admin/users`、`PATCH/DELETE /api/admin/users/:id`、`PATCH /api/admin/profile`、`GET/POST /api/admin/gallery-images`、`GET/PATCH /api/admin/system-settings`、`GET/POST /api/admin/system-error-logs`
- 修改注意事项：删除家长是归档/停用而非硬删；生产图片 URL 协议限制不同；时区影响报表和 scheduled AI。
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
- 修改注意事项：审核和兑换需要幂等/并发保护；积分余额只从 `point_ledger` 汇总；通知快捷处理要同步标记已读和刷新。
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

- 功能说明：家长维护任务分类、任务规则、分配孩子、周期限制、星期限制和展示图标。支持必做任务配置：设置必做次数和未达标扣分，周期结束后由后端幂等结算。现有任务列表中显示必做规则摘要。
- 用户入口：家长设置/配置区域中的任务和分类表单。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`src/lib/domain.ts`、`src/lib/domain.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/components/EmojiSelect.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0002_limits_and_repeat_submissions.sql`、`migrations/0005_feedback_templates_and_timezone.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0022_required_tasks.sql`、`tests/domain.test.ts`、`tests/api.test.ts`、`tests/ledger.test.ts`
- 主要调用链：`ParentApp.load` -> `/task-categories`、`/tasks`; `create/update/remove` -> `/task-categories`、`/tasks`; 孩子端从 `/dashboard/child` 接收可提交任务；必做结算 `settleRequiredTaskPenalties` 由 scheduler tick 和 `maybeRunMaintenance` 触发。
- 相关状态：`task_categories`、`tasks`、`task_assignees`、`task_submissions`、`task_required_penalties`
- 相关接口：`GET/POST /api/task-categories`、`PATCH/DELETE /api/task-categories/:id`、`GET/POST /api/tasks`、`PATCH/DELETE /api/tasks/:id`
- 修改注意事项：`domain.ts` 与 `domain.js` 必须同步；任务可见性会影响孩子端、报表、成就和奖励前置条件；必做任务只对每日/每周/每月任务生效；扣分最多扣到可用积分 0，不产生负分；家长任务列表 small 标签中追加必做规则摘要。
- 最近更新时间：2026-06-12

## 6. 奖励、兑换、仓库与退款

- 功能说明：家长维护奖励和兑换规则，孩子兑换奖励，家长核销/取消/退款，孩子查看或清理仓库。
- 用户入口：家长奖励配置、家长待办、孩子奖励/仓库页面。
- P0：`src/ParentApp.tsx`、`src/ChildApp.tsx`、`server/api/routes/parent.js`、`server/api/routes/child.js`
- P1：`server/api/routes/shared.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0001_initial.sql`、`migrations/0004_reward_once_period.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0010_retention_reports_feedback_recall.sql`、`tests/ledger.test.ts`、`tests/api.test.ts`
- 主要调用链：`ChildApp.redeemReward` -> `/reward-redemptions`; `ParentApp.finishRedemption` -> `/reward-redemptions/:id/redeem|cancel`; refund modal -> `/reward-redemptions/:id/refund`; warehouse -> `/warehouse`
- 相关状态：`rewards`、`reward_assignees`、`reward_prerequisites`、`reward_redemptions`、`point_ledger`
- 相关接口：`GET/POST /api/rewards`、`PATCH/DELETE /api/rewards/:id`、`POST /api/reward-redemptions`、`PATCH /api/reward-redemptions/:id/redeem|cancel|refund`、`GET /api/warehouse`、`PATCH /api/warehouse/clear-redeemed`
- 修改注意事项：取消/退款要正确返还积分；已核销仓库记录和孩子端隐藏逻辑要分清；奖励前置任务会依赖任务完成周期。
- 最近更新时间：2026-06-12

## 7. 成就规则

- 功能说明：家长维护成就、解锁规则、目标任务/分类/时间窗口和成就关联奖励。
- 用户入口：家长设置/配置区域中的成就表单，孩子端成就展示。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`src/lib/appHelpers.ts`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/ChildApp.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0006_achievement_rules.sql`、`migrations/0007_achievement_category_rules.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`tests/api.test.ts`
- 主要调用链：`ParentApp.load` -> `/achievements`; create/update/delete -> `/achievements`; 后端在任务审核等路径中计算或授予成就。
- 相关状态：`achievements`、`child_achievements`、`tasks`、`task_categories`、`rewards`
- 相关接口：`GET/POST /api/achievements`、`PATCH/DELETE /api/achievements/:id`
- 修改注意事项：成就规则和奖励联动容易影响积分/通知；规则展示由 `appHelpers.ts` 生成，后端判定在 helper 路径中。
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
- 修改注意事项：批评可能冻结积分，补救后结算；召回要保留审计/归档语义；相关账本字段在 0021 之后扩展。
- 最近更新时间：2026-06-12

## 9. 孩子端任务、积分与固定卡片

- 功能说明：孩子查看今日任务、提交任务、查看积分/冻结积分、固定任务或奖励卡片、查看 AI 问候。必做任务在任务墙中靠前排序并以醒目标记标识，卡片上提示"须完成X次"。
- 用户入口：孩子登录后的首页、积分账本弹层、固定按钮。
- P0：`src/ChildApp.tsx`、`server/api/routes/child.js`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`src/types/api.ts`、`src/components/Shell.tsx`
- P2：`migrations/0001_initial.sql`、`migrations/0008_child_pins.sql`、`migrations/0011_ai_service_and_child_fields.sql`、`migrations/0021_remediable_criticism_daily_greeting_checklist_images.sql`、`tests/api.test.ts`
- 主要调用链：`ChildApp.loadSummary` -> `/dashboard/child-summary`; `ChildApp.load` -> `/dashboard/child`; submit -> `/task-submissions`; pin -> `/child-pins/:kind`; ledger -> `/points/ledger`
- 相关状态：`task_submissions`、`point_ledger`、`child_pins`、`ai_child_greetings`
- 相关接口：`GET /api/dashboard/child-summary`、`GET /api/dashboard/child`、`POST /api/task-submissions`、`PATCH /api/child-pins/:kind`、`GET /api/points/ledger`
- 修改注意事项：孩子提交任务要防重复；冻结/有效积分展示要和账本一致；AI 问候只展示缓存状态，不应在孩子端暴露生成触发逻辑；必做任务排序在前端完成，不改变后端查询顺序；`.required-card::before` 覆盖默认渐变色为琥珀/红色。
- 最近更新时间：2026-06-12

## 10. 积分账本、报表、打印与归档

- 功能说明：家长/孩子查看积分账本，家长导出孩子打印清单和周/月报表，系统保留活动归档。
- 用户入口：家长孩子卡片中的账本/打印/报表按钮，孩子积分账本。
- P0：`src/ParentApp.tsx`、`src/ChildApp.tsx`、`server/api/routes/parent.js`、`server/api/routes/shared.js`、`src/lib/domain.ts`、`src/lib/domain.js`
- P1：`server/api/utils.js`、`server/api/ai/cache.js`、`src/types/api.ts`
- P2：`migrations/0010_retention_reports_feedback_recall.sql`、`migrations/0015_ai_report_commentaries.sql`、`tests/domain.test.ts`、`tests/api.test.ts`、`tests/ledger.test.ts`
- 主要调用链：ledger modal -> `/points/ledger`; print -> `/children/:id/export-print`; report -> `/children/:id/report?period=weekly|monthly`; report may read cached AI commentary.
- 相关状态：`point_ledger`、`activity_archives`、`ai_report_commentaries`、`system_settings.timezone_offset_minutes`
- 相关接口：`GET /api/points/ledger`、`GET /api/children/:id/export-print`、`GET /api/children/:id/report`
- 修改注意事项：报表应使用已完成周期语义；AI 评论缺失不能让基础 HTML 报表 500；时区变化影响周期窗口。
- 最近更新时间：2026-06-12

## 11. 通知中心

- 功能说明：家长和孩子查看未读通知，标记已读，家长可对任务/奖励通知快捷审批。
- 用户入口：全局 Shell 通知按钮和通知抽屉。
- P0：`src/components/Shell.tsx`、`server/api/routes/shared.js`
- P1：`server/api/routes/parent.js`、`server/api/routes/child.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0003_notifications.sql`、`migrations/0009_weekdays_rewards_warehouse.sql`、`migrations/0020_parent_delegates_operator_cartoon_jobs.sql`、`tests/notifications.test.ts`
- 主要调用链：`Shell.loadNotifications` -> `/notifications`; mark read -> `/notifications/:id/read`; read all -> `/notifications/read-all`; quick action -> parent review/redemption endpoints.
- 相关状态：`notifications.read_at`、`recipient_type`、`recipient_id`、`actor_label_snapshot`
- 相关接口：`GET /api/notifications`、`PATCH /api/notifications/read-all`、`PATCH /api/notifications/:id/read`
- 修改注意事项：当前通知列表倾向展示未读；快捷操作后要刷新通知和业务 dashboard；协同管理称谓要保留快照语义。
- 最近更新时间：2026-06-12

## 12. AI 服务、问候与报告评论

- 功能说明：家长配置 OpenAI-compatible 文本 AI，拉取模型，测试连接，预览问候/周报/月报，系统定时生成孩子问候和报告评论。模型选择支持手动输入任意兼容模型名。
- 用户入口：家长设置中的 AI 服务区域、孩子端问候、家长报表。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/ai/orchestrator.js`、`server/api/ai/providers.js`、`server/api/ai/prompt.js`
- P1：`server/api/ai/cache.js`、`server/api/ai/queue.js`、`server/api/ai/scheduled.js`、`server/scheduler.mjs`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0011_ai_service_and_child_fields.sql`、`migrations/0014_parent_ai_service_settings.sql`、`migrations/0015_ai_report_commentaries.sql`、`migrations/0016_ai_generation_queue.sql`、`migrations/0017_ai_scheduled_refresh_runs.sql`、`migrations/0018_system_error_logs_and_ai_queue_controls.sql`、`tests/ai.test.ts`
- 主要调用链：settings load/save -> `/parent/ai-service`; model/test -> `/parent/ai-service/models|test`; preview -> `/parent/ai-service/preview`; scheduler -> `server/api/ai/scheduled.js` -> queue/orchestrator/cache。
- 相关状态：`parent_ai_service_settings`、`ai_child_greetings`、`ai_report_commentaries`、`ai_generation_queue`、`ai_scheduled_refresh_runs`、`system_error_logs`
- 相关接口：`GET/PATCH /api/parent/ai-service`、`POST /api/parent/ai-service/models`、`POST /api/parent/ai-service/test`、`POST /api/parent/ai-service/preview`
- 修改注意事项：AI 预览默认不写缓存；设置页 draft state 不能被轮询覆盖；新增 schema 要同时考虑 runtime ensure；scheduled 使用管理员时区和已完成周期；模型字段使用 `<input list>` 支持手动输入。
- 最近更新时间：2026-06-12

## 13. AI 图片、漫画报告与打印清单图

- 功能说明：家长配置图片 AI，生成周/月漫画报告图片，生成孩子打印清单图，并轮询异步任务状态。
- 用户入口：家长 AI 设置/孩子报表或打印相关按钮。
- P0：`src/ParentApp.tsx`、`server/api/routes/parent.js`、`server/api/ai/cartoon-queue.js`、`server/api/ai/orchestrator.js`、`server/api/ai/providers.js`
- P1：`server/api/ai/prompt.js`、`server/api/utils.js`、`src/types/api.ts`
- P2：`migrations/0019_parent_ai_image_settings.sql`、`migrations/0020_parent_delegates_operator_cartoon_jobs.sql`、`migrations/0021_remediable_criticism_daily_greeting_checklist_images.sql`、`tests/ai.test.ts`
- 主要调用链：`ParentApp.generateCartoonReport` -> `/parent/ai-service/cartoon-report` -> queue -> provider image generation -> polling `/parent/ai-service/cartoon-report/:jobId`; checklist image -> `/children/:id/print-checklist-image` -> polling job endpoint。
- 相关状态：`parent_ai_service_settings.image_*`、`ai_cartoon_report_jobs`、`ai_print_checklist_image_jobs`
- 相关接口：`POST /api/parent/ai-service/cartoon-report`、`GET /api/parent/ai-service/cartoon-report/:jobId`、`POST /api/children/:id/print-checklist-image`、`GET /api/children/:id/print-checklist-image/:jobId`
- 修改注意事项：图片 AI 配置和文本 AI 配置分开；前端轮询有 abort controller；不要把生成结果持久化到新存储，除非用户明确要求。待确认：漫画报告和打印清单图是否应长期复用同一队列策略。
- 最近更新时间：2026-06-12

## 14. 配置导入导出与开发测试入口

- 功能说明：家长导出/导入家庭配置，开发模式下重置当前家长进度。
- 用户入口：家长设置中的导入导出按钮和开发隐藏重置入口。
- P0：`src/ParentApp.tsx`、`server/api/routes/shared.js`
- P1：`server/api/utils.js`、`server/api/routes/parent.js`、`src/types/api.ts`
- P2：`migrations/*.sql`、`tests/api.test.ts`、`tests/migration.test.ts`
- 主要调用链：export -> `/config/export`; import -> `/config/import`; dev reset -> `/testing/reset-parent-progress`
- 相关状态：家庭配置相关表、任务/奖励/成就/反馈模板/孩子分配关系
- 相关接口：`GET /api/config/export`、`POST /api/config/import`、`POST /api/testing/reset-parent-progress`
- 修改注意事项：导入必须保持跨家庭隔离和去重策略；开发重置只应在开发环境可用；`migrations/*.sql` 属 P2，只有 schema 兼容排查或导入格式变化时读取。待确认：导入导出的完整字段覆盖范围需要按当前实现再次核对。
- 最近更新时间：2026-06-12
