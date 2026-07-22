# 2026-07-22

- 类型：功能新增
- 任务：必做任务未达标扣分支持按条件补救。
- 修改文件：`server/api/utils.js`、`server/api/routes/parent.js`、`server/api/routes/shared.js`、`server/api/routes/child.js`、`src/ParentApp.tsx`、`src/ChildApp.tsx`、`src/types/api.ts`。
- 数据库：新增 `migrations/0030_required_task_penalty_remedies.sql`，为任务补齐补救规则字段。
- 行为：周期结算可将扣分冻结；家长可在截止前确认补救并挽回配置积分；超时后结算为正式扣分。
- 验证：`rtk npm run build`；`rtk npm test -- --run tests/ledger.test.ts tests/migration.test.ts tests/api.test.ts`。

# 2026-07-19

- 类型：缺陷修复
- 任务：必做任务跨周期审核达标后退回实际扣分，同时保留正常任务积分结算。
- 修改文件：
  - `server/api/routes/parent.js`：审核通过后按历史周期达标条件追加幂等的必做扣分冲销账本流水。
  - `server/api/utils.js`：正向必做账本显示为“必做扣分退回”。
  - `tests/ledger.test.ts`：覆盖延迟审核达标、余额限制扣分、重复审核与驳回场景。
  - `docs/ai/FEATURE_INDEX.md`：记录跨周期审核结算规则。
- 验证：`npm test -- tests/ledger.test.ts`

## 2026-06-30

- Type: bug fix / maintenance hardening
- Scope: SQLite retention, activity archives, AI job cleanup, admin maintenance visibility, report indexes, emoji lazy loading
- Summary:
  - Fixed old-ledger archive consistency so late old `point_ledger` rows update existing monthly `activity_archives` and the matching `activity_archive` ledger row instead of losing balance after detail cleanup.
  - Added `ai_job_retention_days=92` and daily cleanup for completed/failed AI queue, scheduled-run, cartoon-report, checklist-image, and schedule-image job records while keeping pending/processing jobs.
  - Hardened soft-deleted task/reward/achievement/template cleanup so rows with history or pending references are skipped instead of causing maintenance/bootstrap failures.
  - Added `db:compact` for low-frequency SQLite VACUUM/optimization during a maintenance window.
  - Added admin maintenance stats showing latest cleanup counts, AI queue backlog, and 7-day AI job failure rate.
  - Added report/ledger window indexes and runtime ensure coverage for long-running query performance.
  - Delayed loading the emoji vendor data until the emoji picker is opened.
- Business code: `server/api/utils.js`, `server/api/routes/admin.js`, `src/AdminApp.tsx`, `src/components/EmojiSelect.tsx`, `src/styles.css`, `src/types/api.ts`, `scripts/sqlite-compact.mjs`, `package.json`
- Database: `migrations/0027_ai_job_retention_setting.sql`, `migrations/0028_report_window_indexes.sql`
- Tests: `tests/maintenance.test.ts`, `tests/api.test.ts`, `tests/migration.test.ts`
- Docs: `docs/operations/SQLITE_MAINTENANCE.md`
- Verification: `rtk npm test`; `rtk npm run build`; temp-db `node scripts/sqlite-compact.mjs` smoke test

# 2026-06-23

- 类型：文档新增
- 范围：AI 项目理解说明
- 摘要：
  - 新增 `docs/ai/PROJECT_BRIEF_FOR_AI.md`，用叙事化方式说明产品心智模型、角色、技术栈、关键入口文件、主要业务域、数据不变量、维护工作流、验证命令和部署形态。
  - 明确该文件不替代 `PROJECT_INDEX.md` / `FEATURE_INDEX.md`，后续具体维护任务仍需按功能索引定位 P0/P1/P2 文件。
- 业务代码：未修改
- 验证：文档结构检查

## 2026-06-22

- 类型：缺陷修复 / UI 调整
- 范围：儿童任务墙日程表显示
- 摘要：
  - 任务墙开启“日程表显示”后，在每个日程时段任务卡片上方展示已设置的“计划”富文本内容。
  - 计划内容为空时不显示空计划块，保持原任务墙布局简洁。
  - 调整日程时段标题布局，使时间文本紧靠时段名称，并通过 `2ch` 间距保持约两格字符距离。
- 业务代码：`src/ChildApp.tsx`、`src/styles.css`
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`rtk npx tsc --noEmit`、`rtk npx vite build --config vite.config.mjs --configLoader runner`、`rtk npm test`、`rtk git diff --check`
## 2026-06-22

- 类型：缺陷修复 / UI 调整
- 范围：孩子日程表、登录页
- 摘要：
  - 修复孩子端“日程表设置”计划富文本框输入时因 React 重写 contentEditable DOM 导致光标回到开头的问题。
  - `loadSchedule()` 恢复映射后端 `plan_html` 字段，避免保存后重新拉取日程时丢失计划内容。
  - 登录页“进入系统”按钮改为在“记住我”下一行独占显示。
- 业务代码：`src/ChildApp.tsx`、`src/styles.css`
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`npm run build`

# CHANGELOG_AI

本文件记录 AI/Codex 对项目的维护历史。每次修改都应追加记录，最新记录放在顶部。

## 2026-06-22

- 类型：功能增强
- 范围：记住我、日程计划富文本与 A4 报表
- 摘要：
  - 登录页新增“记住我”，选中后使用长期滚动会话，默认登录仍保持 180 天。
  - 孩子日程表每个时段新增“计划”富文本行，并保留“可完成任务”任务卡片行；计划保存为受限 HTML。
  - 日程表打印、周/月报表和日程表绘图 prompt 同步计划文本与任务卡片信息，打印输出统一 A4 适配。
- 业务代码：`src/App.tsx`、`src/ChildApp.tsx`、`src/styles.css`、`src/types/api.ts`、`server/api/routes/auth.js`、`server/api/routes/child.js`、`server/api/routes/parent.js`、`server/api/ai/orchestrator.js`、`server/api/utils.js`
- 数据库：`migrations/0025_child_schedule_plan_html.sql`
- 测试：`tests/api.test.ts`、`tests/migration.test.ts`
- 验证：`rtk npm test`；`rtk npm run build`；`rtk git diff --check`

## 2026-06-21

- 类型：UI 布局调整
- 范围：孩子端任务墙、奖励墙、仓库、日程表设置
- 摘要：
  - 孩子端任务、奖励、仓库主列表改为随内容高度自然展开，不再使用内部滚动列表。
  - 任务墙的日程分组显示同步取消内部滚动，时段和未安排任务随页面整体展开。
  - 日程表设置补充列表高度自适应样式，避免时段列表、时段内任务和任务卡片池出现内部纵向滚动限制。
- 业务代码：src/ChildApp.tsx、src/styles.css
- 验证：rtk npm run build

## 2026-06-21

- 类型：功能调整
- 范围：孩子日程表设置 + 任务墙日程显示
- 摘要：
  - 孩子端“日程表”改为“日程表设置”，日程编辑区改为所有时段共用一个任务卡片池。
  - 任务卡片池按任务自身周期可完成次数 `limitCount/limit_count` 控制可安排数量；达到上限后从池中移除，移除已安排项后恢复。
  - 任务墙右上角新增“日程表显示”开关，打开后按日程时段组织任务，并保留“未安排任务”分组；关闭后保持原任务墙。
- 修改文件：`src/ChildApp.tsx`、`src/styles.css`
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`rtk npm run build`
## 2026-06-21

- 类型：缺陷修复
- 范围：孩子日程表（保存后不显示 + 任务加载中卡住）
- 摘要：
  - **BUG 1**：保存日程表后界面无已保存内容。根因：后端 GET `/child-schedule` 返回 snake_case 字段（`slot_id`、`task_id`、`start_minutes`、`end_minutes`），前端 `loadSchedule()` 直接透传未做字段转换，UI 用 camelCase 字段过滤匹配不上。修复：`loadSchedule()` 中将 snake_case 映射为 camelCase。
  - **BUG 2**：点击选择任务显示"加载中..."。根因：(a) `useEffect` mount 时未调用 `loadSchedule()`，首次进入日程表数据为空；(b) `toggleTaskInSlot` 创建新 item 时只有 `id/slotId/taskId` 没有 `title`。修复：mount 时调用 `loadSchedule()`；创建 item 时从 `dash.tasks` 填入 `title`。
- 修改文件：`src/ChildApp.tsx`
- 验证：build 通过，116 tests 全部通过

## 2026-06-21

- 类型：缺陷修复
- 范围：孩子日程表（BUG 修复 + 拖拽 + 多实例支持）
- 摘要：
  - **BUG 1**：`addScheduleSlot()` 未为新时段分配客户端 ID，导致后端验证"日程项引用了不存在的时段"。修复：`addScheduleSlot()` 使用 `crypto.randomUUID()` 生成 ID；后端 item 匹配增加 `(slot.id || slotId)` 兜底。
  - **BUG 2**：任务在日程表中仅显示文本按钮，无拖拽功能。修复：任务池改为卡片式 chip（显示 emoji、标题、积分）；改为可拖拽（`draggable` + `onDragStart`）；slot 区域可拖放（`onDragOver`/`onDrop`/`onDragLeave`）；添加 `drag-over` 视觉高亮。
  - **BUG 3**：每日任务无法在日程表中多次出现。修复：新建 `migrations/0024_child_schedule_drop_unique.sql`，删除 `child_schedule_items` 的 `UNIQUE(child_id, task_id)` 约束；`toggleTaskInSlot` 改为支持同一任务多次添加（受 `required_count` 限制）；`removeTaskFromSchedule` 改为按 `item.id` 移除；`ensureChildScheduleSchema` 不再包含 UNIQUE。
  - 其他：slot 渲染去掉了 `slot.id || `_${index}`` 兜底，直接使用 slot.id（已保证一定有值）。
- 业务代码：`src/ChildApp.tsx`、`src/styles.css`、`server/api/routes/child.js`、`server/api/utils.js`
- 测试：`tests/migration.test.ts` — 更新迁移文件计数 23→24
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`npm test`、`npx tsc --noEmit`

## 2026-06-21

- 类型：功能新增
- 范围：孩子日程表（数据库、API、前端、AI 绘图）
- 摘要：
  - 新增 `migrations/0023_child_schedule.sql`：`child_schedule_slots`（时段）和 `child_schedule_items`（任务分配）表，`parent_ai_service_settings` 加 `schedule_image_prompt` 列。
  - 后端 `ensureChildScheduleSchema(env)` 自愈 schema，bootstrap 调用。
  - 孩子端 GET/PUT `/children/:id/schedule`：原子替换时段+任务分配，校验不重叠、任务归属。
  - 家长端 GET `/children/:id/schedule-print`：纯 HTML 打印页。POST/GET `/children/:id/schedule-image`：排队/轮询生成日程表插画（独立 `ai_schedule_image_jobs` 表）。
  - 前端 `ChildApp.tsx` 新增"日程表"标签页：时段增删改、任务列表点击添加到时段、保存/重置。`ParentApp.tsx` 报表弹窗新增打印/绘制日程表按钮、AI 设置新增日程表绘图提示词。
  - AI 侧：`cartoon-queue.js` 新增 `ai_schedule_image_jobs` 表及队列函数、`orchestrator.js` 新增 `generateScheduleImage`、`cache.js` 新增 `scheduleImagePrompt`。
- 业务代码：`src/ChildApp.tsx`、`src/ParentApp.tsx`、`src/styles.css`、`server/api/routes/child.js`、`server/api/routes/parent.js`、`server/api/utils.js`、`server/api/ai/cartoon-queue.js`、`server/api/ai/orchestrator.js`、`server/api/ai/index.js`、`server/api/ai/cache.js`、`src/types/api.ts`
- 测试：`tests/migration.test.ts` — 更新迁移文件计数 22→23
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`npx tsc --noEmit`、`npm test`

## 2026-06-15

- 类型：缺陷修复
- 范围：配置导入导出
- 摘要：
  - 修复 `/config/export` 漏导任务/奖励孩子分配、必做任务规则的问题，避免配置备份后再导入丢失分配和必做扣分设置。
  - 导出奖励前置任务和成就指定任务时补充任务标题，导入 `/config/import` 时按当前家庭任务标题重新映射，避免跨库导入使用旧任务 ID 导致条件丢失或外键失败。
  - 保持导入默认禁用配置项的既有行为不变。
- 业务代码：`server/api/routes/shared.js`、`server/api/utils.js`
- 测试：`tests/api.test.ts` — 增加配置导出字段和标题映射导入回归
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`rtk npm test -- tests/api.test.ts`

## 2026-06-15

- 类型：功能新增
- 范围：AI 测试结果替换缓存按钮
- 摘要：
  - 后端新增 `POST /api/parent/ai-service/preview/cache` 接口，接受 `{ childId, type, text }`，校验权限、孩子归属、AI 启用和配置完整性，拒绝空文本。
  - `greeting` 写入 `ai_child_greetings`（key: `periodKey("daily", now, offset)` + `aiConfigHash`）；`weeklyReport/monthlyReport` 写入 `ai_report_commentaries`（key: `previousCompletedReportRange(...)` 已完成周期 + `aiReportConfigHash`）。
  - 前端 `AiPreviewDialog` 增加"替换当前缓存"按钮，调用新接口，成功后关闭弹窗并显示成功提示；失败时保留弹窗和预览文本。
  - 保持 AI 预览默认不写缓存（`{ cache: false }`）。
- 业务代码：`server/api/routes/parent.js`、`src/ParentApp.tsx`
- 测试：`tests/api.test.ts` — 新增 6 个用例（周报替换、日寄语替换、月报替换、空文本拒绝、错误孩子拒绝、未启用 AI 拒绝）
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`npm test`

## 2026-06-15

- 类型：缺陷修复
- 范围：必做任务自动扣分未触发
- 摘要：
  - 根因：内置 scheduler（`ENABLE_BUILTIN_SCHEDULER=true`）的内置 tick 只调用 `bootstrap` + `runScheduledAiRefresh`，未像独立 scheduler 那样显式调用 `settleRequiredTaskPenalties`；`bootstrap -> maybeRunMaintenance` 虽有间接调用但受 24 小时 `cleanup_last_run_at` 闸门控制。
  - 修复：新建 `server/scheduler-tick.mjs` 作为统一 scheduler tick 入口，每次 tick 都依次执行 `bootstrap`、`settleRequiredTaskPenalties`、`runScheduledAiRefresh`。
  - `server/index.mjs` 和 `server/scheduler.mjs` 改为复用同一共享 tick，保证行为一致。
  - 日志输出统一包含 `requiredPenalties` 字段，部署后可从容器日志确认是否结算。
  - 不做历史漏期补扣；保留 `settleRequiredTaskPenalties` 的幂等、余额封顶、按 `task_id + child_id + period_key` 去重规则。
- 业务代码：`server/scheduler-tick.mjs`（新增）、`server/index.mjs`、`server/scheduler.mjs`
- 测试：`tests/scheduler.test.ts`（新增 5 个用例覆盖 tick 返回 requiredPenalties、非午夜窗口仍做必做结算、cleanup 24h 内仍触发、无必做任务不报错、幂等不重复扣）
- 文档：`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 验证：`npm test` — 109 passed、`npm run build`

## 2026-06-14

- 类型：测试覆盖增强
- 范围：必做任务周期扣分回归测试
- 摘要：
  - 新增 3 个回归用例覆盖跨周期扣分：连续两天未达标各扣一次（不同 `period_key`）、同周期幂等不受跨周期影响、已达标周期跳过但下一未达标周期仍可扣。
  - `settleRequiredTaskPenalties` 代码无需修改：`period_key` 基于调用时间 `at` 动态计算，不同周期自然生成不同键。
- 业务代码：`tests/ledger.test.ts`
- 文档：`docs/ai/FEATURE_INDEX.md`
- 验证：`npm test` — 104 passed

## 2026-06-14

- 类型：CSS 展示修复
- 范围：消息中心筛选标签布局
- 摘要：
  - 修复消息中心（`.notification-filter-bar`）分类标签被下方消息列表遮挡、滚动条可见的问题。
  - 为筛选条设置 `flex: 0 0 auto` 固定高度、`overflow-y: hidden` 和 `align-items: center` 垂直居中。
  - 隐藏筛选条横向滚动条（`scrollbar-width: none`、`-ms-overflow-style: none`、`::-webkit-scrollbar`），同时保留小屏横向滑动能力。
  - 将 `.notification-filter-bar` 与 `.ledger-filter-bar` 的 CSS 选择器拆分，避免误伤积分筛选滚动条行为。
  - `.notification-list.scroll-list` 保持 `min-height: 0; flex: 1 1 auto`，列表只占剩余空间，不向上覆盖筛选标签。
- 业务代码：`src/styles.css`
- 文档：`docs/ai/FEATURE_INDEX.md`
- 验证：`npm run build`

## 2026-06-13

- 类型：UI/交互修正
- 范围：积分清单、反馈撤回、奖励退款
- 摘要：
  - 积分清单共享 `LedgerModal` 移除顶部收入、支出、净变化、冻结汇总卡片，仅保留时间分组列表和筛选器。
  - 退还奖励、撤回反馈弹窗改为受限高度的列表弹窗，候选记录列表在弹窗内滚动，避免记录较多时挤出底部操作按钮。
  - 移除不再使用的 `ledger-summary` 样式，并补充移动端列表滚动覆盖规则。
- 业务代码：`src/components/LedgerModal.tsx`、`src/ParentApp.tsx`、`src/styles.css`
- 文档：`docs/ai/FEATURE_INDEX.md`
- 验证：`rtk npm test -- tests/ledger.test.ts`（14 passed）、`rtk npm run build`

## 2026-06-13

- 类型：UI/交互优化
- 范围：消息中心、积分清单
- 摘要：
  - 消息中心仍只展示未读消息，但后端排序改为待处理项优先，其后按时间倒序；前端新增全部未读、待处理、需签收、普通消息筛选和待处理分组。
  - 消息记录重排为来源标签、时间、标题、正文、操作者和固定操作区，保留签收、全部已读和家长快捷审核/核销操作。
  - 抽出共享 `LedgerModal` 和账本展示 helper，家长端与孩子端积分清单共用同一套时间分组、筛选和汇总逻辑。
  - 积分清单默认按今天/昨天/日期分组，支持收入、支出、冻结/补救、任务、奖励、反馈、必做扣分筛选，并汇总当前加载记录。
- 业务代码：`src/components/Shell.tsx`、`src/components/LedgerModal.tsx`、`src/lib/ledgerView.ts`、`src/ParentApp.tsx`、`src/ChildApp.tsx`、`src/styles.css`、`server/api/routes/shared.js`
- 测试：`tests/notifications.test.ts`、`tests/ledger.test.ts`
- 验证：`rtk npm test -- tests/notifications.test.ts tests/ledger.test.ts`（17 passed）、`rtk npm run build`

## 2026-06-13

- 类型：缺陷修复
- 范围：积分账本排序、表扬批评记录时间、旧 SQLite 时间兼容
- 摘要：
  - `/points/ledger`、反馈记录和报表中的账本查询改为按 `datetime(created_at) DESC, created_at DESC, id DESC` 排序，报表/反馈时间窗口用 `datetime(created_at)` 过滤，避免 ISO 时间文本让必做扣分长期靠前。
  - 表扬/批评创建时显式写入 `point_ledger.created_at=nowIso()`，并把同一时间传给通知，避免依赖 SQLite `CURRENT_TIMESTAMP`。
  - `localTimeText` 兼容旧 `YYYY-MM-DD HH:mm:ss` 时间文本，将其按 UTC 解析后再应用系统时区，避免日期提前一天。
  - 新增账本回归测试覆盖混合时间格式排序和反馈记录本地时间展示。
- 业务代码：`server/api/routes/shared.js`、`server/api/routes/parent.js`、`server/api/utils.js`
- 测试：`tests/ledger.test.ts`
- 验证：`rtk npm test -- tests/ledger.test.ts`（13 passed）、`rtk npm run build`

## 2026-06-14

- 类型：功能增强与测试
- 范围：登录会话时长、必做扣分通知、来源标签、排序语义
- 摘要：
  - 将登录会话从 7 天延长为 180 天，同步更新 `sessions.expires_at` 和 HttpOnly cookie `Max-Age`。
  - 必做任务未达标扣分时同步创建孩子端通知（`eventType='task_required_penalty'`，`relatedType='point_ledger'`）。
  - `notify` 扩展可选 `createdAt` 参数，必做扣分通知使用结算时间 `at` 保证排序与账本一致。
  - `eventTypeLabel`、`notificationSource`、`ledgerSource` 新增 `task_required_penalty` 支持，展示"必做扣分 / 任务：{title}"。
  - 通知 `/notifications` 和账本 `/points/ledger` 保持按 `created_at DESC` 排序，不对必做扣分做置顶。
  - 新增测试断言：login cookie 180 天 Max-Age、session 有效期、必做扣分通知来源标签、混排顺序。
- 业务代码：`server/api/routes/auth.js`、`server/api/utils.js`
- 测试：`tests/api.test.ts`、`tests/ledger.test.ts`
- 验证：`npx vitest run` 92 passed

## 2026-06-12

- 类型：UI 增强
- 范围：家长任务列表必做信息展示、儿童任务墙必做排序与标记
- 摘要：
  - 家长端 `Overview` 组件任务行 small 标签追加"必做 X 次 · 未达标扣 Y 分"摘要，样式与现有文本一致。
  - 儿童端任务墙对 `dash.tasks` 前端排序，必做任务靠前显示。
  - 必做任务卡片添加 `required-card` 类，`::before` 渐变色改为琥珀/红色以醒目区分。
  - 必做任务卡片 `card-meta` 区域添加"须完成X次"标签，使用 `.required-tag` 样式（琥珀色药丸标签）。
  - 置顶任务卡片 `renderTaskCard` 同步更新必做标记。
  - 更新 `FEATURE_INDEX.md` 第 5、9 节。
- 业务代码：`src/ParentApp.tsx`、`src/ChildApp.tsx`、`src/styles.css`
- 验证：`npm run build`、`npm test`（95 tests passed）

## 2026-06-12

- 类型：功能新增与 UI 修正
- 范围：任务必做配置、必做结算、前端表单、AI 模型选择、反馈/退款列表滚动、冻结积分标签居中
- 摘要：
  - 新增迁移 `0022_required_tasks.sql`：给 `tasks` 增加 `is_required`、`required_count`、`required_penalty_points`，新增 `task_required_penalties` 幂等结算表。
  - 后端新增 `settleRequiredTaskPenalties` 函数，每日/每周/每月周期结束后结算未达标必做任务扣分，挂到 scheduler tick 和 `maybeRunMaintenance`。
  - 家长端 `CreateTask` 和 `EditItemForm` 增加必做开关、必做次数、扣分输入。
  - AI 模型字段从 `<select>` 改为 `<input list>` 支持手动输入任意兼容模型名。
  - `RefundRewardDialog`、`FeedbackRecallDialog` 列表容器加 `overflow-y: auto`。
  - `.hero-band .metric .frozen-tag` 增加 `justify-self: center` 居中规则。
  - 更新 `FEATURE_INDEX.md` 第 5、12 节；新增 `tests/ledger.test.ts` 必做任务测试用例；更新 `tests/migration.test.ts` 检查新增列和结算表。
- 业务代码：`server/api/utils.js`、`server/api/routes/parent.js`、`server/scheduler.mjs`、`src/ParentApp.tsx`、`src/styles.css`
- 验证：`rtk npm test -- --run tests/ledger.test.ts tests/migration.test.ts`、`rtk npm run build`

## 2026-06-12

- 类型：文档初始化
- 范围：`AGENTS.md`、`docs/ai/PROJECT_INDEX.md`、`docs/ai/FEATURE_INDEX.md`、`docs/ai/CHANGELOG_AI.md`
- 摘要：初始化 AI 功能索引驱动维护模式，建立项目总览、按用户可感知功能拆分的读取索引、后续 Codex 任务规则和 AI 修改日志。
- 业务代码：未修改
- 验证：文档结构检查


## 2026-06-25

- 类型：功能新增
- 范围：家长设置配置组
- 摘要：
  - 新增配置组持久化表和 API，支持保存当前任务配置、奖励配置、成就称号、表扬与批评条款为命名配置组。
  - 设置页顶部新增配置组面板，支持新建、重命名、用当前设置更新、激活覆盖和删除，限制每个家长最多 5 个配置组。
  - 激活配置组时事务化软删除/停用当前四块设置并按快照重建，保留历史任务提交、兑换、积分和已解锁记录。
- 业务代码：`server/api/utils.js`、`server/api/routes/shared.js`、`src/ParentApp.tsx`、`src/types/api.ts`、`src/styles.css`
- 迁移：`migrations/0026_config_groups.sql`
- 测试：`tests/api.test.ts`、`tests/migration.test.ts`
- 验证：`rtk npm test -- --run tests/api.test.ts tests/migration.test.ts`

## 2026-06-25

- 类型：功能增强
- 范围：家长设置配置清空
- 摘要：
  - 配置组面板新增“清空当前配置”按钮，可一键清空任务配置、奖励配置、成就称号、批评与奖励条款。
  - 新增 `POST /api/config/clear-current`，按当前家长作用域软删除/停用四类当前配置，保留历史记录和配置组快照。
  - 扩展配置组 API 测试，覆盖清空统计、跨家长隔离、快照保留和历史关联记录保留。
- 业务代码：`server/api/utils.js`、`server/api/routes/shared.js`、`src/ParentApp.tsx`、`src/styles.css`
- 测试：`tests/api.test.ts`
- 验证：`rtk npm test -- --run tests/api.test.ts`

## 2026-07-06

- 类型：功能增强
- 范围：儿童成就墙/仓库、家长任务配置与审核
- 摘要：
  - 儿童成就墙新增称号隐藏/展示，隐藏称号进入仓库的成就标签。
  - 任务新增按完成程度给分模式，家长可配置文字标准档位并在审核时选择档位入账。
  - 配置导入导出和配置组快照保留完成程度给分设置。
- 业务代码：`server/api/routes/child.js`、`server/api/routes/parent.js`、`server/api/routes/shared.js`、`server/api/utils.js`、`src/ChildApp.tsx`、`src/ParentApp.tsx`
- 迁移：`migrations/0029_achievement_visibility_and_completion_grading.sql`
- 测试：`tests/api.test.ts`、`tests/ledger.test.ts`、`tests/migration.test.ts`
- 验证：`npm.cmd test -- --run tests/api.test.ts tests/ledger.test.ts tests/migration.test.ts`；`npm.cmd run build`
## 2026-07-07

- 类型：功能增强
- 范围：必做任务扣分、家长待处理、孩子每日寄语
- 摘要：
  - 必做任务结算跳过任务创建/修改后才开始生效的上一周期，避免新建或编辑后补扣前一天未完成分数。
  - 家长待处理页新增当前周期必做扣分豁免入口，复用 `task_required_penalties` 写入 0 分幂等记录。
  - 孩子端 AI 每日寄语读取时截断到 200 个字符。
- 业务代码：`server/api/utils.js`、`server/api/routes/parent.js`、`server/api/ai/cache.js`、`src/ParentApp.tsx`
- 测试：`tests/ledger.test.ts`、`tests/api.test.ts`
- 验证：`npm.cmd test -- --run tests/ledger.test.ts tests/api.test.ts`、`npm.cmd run build`

## 2026-07-07

- 类型：功能增强
- 范围：必做任务豁免显示、孩子任务墙、家长待处理
- 摘要：
  - `/dashboard/child` 和 `/dashboard/parent` 返回当前周期 0 分必做豁免状态。
  - 孩子任务卡/日程任务卡与家长必做豁免面板显示“已豁免”，并禁用已豁免任务的重复提交按钮。
  - 补充必做豁免接口测试，覆盖 0 分豁免与非 0 扣分记录的显示差异。
- 业务代码：`server/api/routes/child.js`、`server/api/routes/shared.js`、`src/ChildApp.tsx`、`src/ParentApp.tsx`、`src/styles.css`、`src/types/api.ts`
- 测试：`tests/ledger.test.ts`
- 验证：待运行 `npm.cmd test -- --run tests/ledger.test.ts`


## 2026-07-07

- 类型：功能增强
- 范围：必做任务豁免、家长待处理、孩子任务墙
- 摘要：
  - 新增 `DELETE /api/tasks/:id/required-penalty-exemptions`，家长可撤销当前周期尚未实际扣分结算的 0 分豁免记录。
  - 家长必做扣分豁免面板对已豁免任务显示“撤销豁免”操作，撤销后现有刷新会同步清除孩子端和家长端“已豁免”状态。
  - 修正任务卡片中“已豁免”标签被通用元信息样式覆盖的问题，孩子任务墙和日程任务卡显示绿色底色。
- 业务代码：`server/api/routes/parent.js`、`src/ParentApp.tsx`、`src/styles.css`
- 测试：`tests/ledger.test.ts`
- 验证：待运行 `npm.cmd test -- --run tests/ledger.test.ts`
