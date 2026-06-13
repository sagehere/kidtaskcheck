# CHANGELOG_AI

本文件记录 AI/Codex 对项目的维护历史。每次修改都应追加记录，最新记录放在顶部。

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
