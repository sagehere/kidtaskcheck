# CHANGELOG_AI

本文件记录 AI/Codex 对项目的维护历史。每次修改都应追加记录，最新记录放在顶部。

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
