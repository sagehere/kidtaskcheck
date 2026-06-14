# CHANGELOG_AI

本文件记录 AI/Codex 对项目的维护历史。每次修改都应追加记录，最新记录放在顶部。

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
