# 数据清理、报告、撤回与 Emoji 修复计划

## Summary

实现一轮后端 + 前端改造：数据库每日懒执行清理；旧明细保留 12 个月并按月归档；奖励退还和已撤回表扬/批评记录保留 7 天；删除成就后停用其解锁奖励；儿童管理中增加周报/月报打印页；Emoji 选择器移除肤色变体和 `flag-` 国家图标，并修复移动端关闭按钮。

## Key Changes

- 新增迁移 `0010_retention_reports_feedback_recall.sql`：
  
  - `point_ledger` 增加 `revoked_at`、`revoke_ledger_id`、`retention_until`，用于表扬/批评撤回和 7 天清理。
  - `reward_redemptions` 增加 `refunded_at`、`retention_until`，区分“待核销取消”和“已核销退还”。
  - 新增 `activity_archives`，按 `parent_id + child_id + month_key` 汇总旧明细的净积分、任务数、奖励数、表扬/批评数、成就数等。
  - `system_settings` 增加清理配置键：`cleanup_last_run_at`、`detail_retention_days=365`、`short_record_retention_days=7`。

- 数据清理机制：
  
  - 在后端 bootstrap 后执行 `maybeRunMaintenance(env)`，每天最多运行一次。
  - 7 天后清理奖励退还记录：删除 `reward_refund` 流水、对应原奖励扣分流水、退还通知、已退还 redemption，确保净积分不变。
  - 7 天后清理已撤回表扬/批评：删除原反馈流水、反向冲正流水、相关通知，确保净积分不变。
  - 12 个月前的非待处理任务、奖励、通知、成就解锁等明细先写入 `activity_archives`，再删除明细；余额通过保留/生成月度汇总流水保证仍可由 `point_ledger` 求和得出。
  - 已软删配置超过 12 个月且无仍保留明细引用后再硬删除；软删家长及其子数据超过 12 个月后整体清理。

- 成就删除后的奖励处理：
  
  - `deleteAchievementWithExclusiveReward` 改为查找 `unlock_reward_id` 指向被删成就的奖励。
  - 删除成就时软删成就、删除对应 `child_achievements` 可见关联，并将该成就解锁的奖励设为 `is_active=0`。
  - 返回 `{ disabledUnlockRewardIds: [...] }`，前端提示“成就已删除，关联奖励已停用”。

- 表扬/批评撤回：
  
  - 新增 `GET /api/children/:id/feedback-events`，儿童管理中展示近 7 天可撤回反馈。
  - 新增 `PATCH /api/feedback-events/:ledgerId/recall`。
  - 撤回时插入一条反向冲正流水，原流水标记 `revoked_at`，对应孩子通知改为“已撤回”并保留 7 天。
  - 成就重算时排除 `revoked_at IS NOT NULL` 的表扬/批评，避免已撤回反馈继续影响表扬/未批评类成就。

- 周/月度报告：
  
  - 新增 `GET /api/children/:id/report?period=weekly|monthly&anchor=YYYY-MM-DD`，返回可打印 HTML。
  - 儿童管理每个孩子增加“周报”“月报”按钮，默认生成当前系统时区内的本周/本月报告。
  - 报告包含：周期范围、当前余额、周期积分变化、任务完成/驳回/待审统计、奖励申请/核销/退还统计、表扬/批评记录、成就解锁、分类完成分布。
  - 新增 domain helper 计算周/月报告窗口，并同步更新 `src/lib/domain.ts` 与 `src/lib/domain.js`。

- Emoji 与移动端修复：
  
  - `buildEmojiOptions` 不再加入 `skin_variations`，只保留默认黄皮肤基础 emoji。
  - 过滤 `short_name` 或 `short_names` 以 `flag-` 开头的国家旗帜图标。
  - 已保存的不允许 emoji 在 UI 中回退显示默认图标，编辑保存后写入允许图标。
  - Emoji 弹层关闭逻辑改为 pointer 事件：backdrop 用 `onPointerDown`，弹层内部阻止冒泡，关闭按钮显式 `preventDefault + stopPropagation + setOpen(false)`，并加移动端尺寸/层级检查。

## Test Plan

- `npm test`：补充报告周/月窗口、归档汇总计算、撤回后成就统计排除逻辑的单元测试。
- `npm run build`：验证 TypeScript 和 Vite 构建。
- `npm run db:migrate:local`：验证新迁移可应用。
- 手动浏览器验证：
  - 移动端打开 Emoji 选择框，关闭按钮和点击遮罩都可关闭。
  - 删除成就后，关联奖励在孩子端不可见、家长端显示停用。
  - 表扬/批评撤回后积分恢复、孩子通知显示已撤回、7 天后清理策略不破坏余额。
  - 儿童管理周报/月报可打开并打印。

## Assumptions

- 旧明细保留周期采用用户选择的 12 个月。
- 删除成就后采用用户选择的“停用该奖励”，不一并删除奖励。
- 表扬/批评撤回采用用户选择的“显示已撤回 7 天”。
- 数据清理采用用户选择的“每日懒执行”，不新增 Cloudflare Cron。
- 报告采用用户选择的“网页打印版”。
