import { isWeekdayAllowed, nextPeriodReset, normalizeWeekdays, periodKey } from "../../../src/lib/domain.js";
import { ok, fail, body, id, nowIso, requireRole, timezoneOffsetMinutes, childUsageForPeriod, childUsageCountsForPeriods, childLatestTaskStatuses, rewardLockedByAchievement, unmetRewardPrerequisites, balance, frozenPointsForChild, recalcAchievements, notify, settleExpiredCriticismFreezes, activeRemedyCriticisms } from "../utils.js";
import { loadAiGreetingSnapshot } from "../ai/index.js";

export async function handleChildRoutes(path, method, request, env, actor, ctx) {
    if (path === "/task-submissions" && method === "POST") {
        const a = requireRole(actor, ["child"]);
        const input = await body(request);
        const task = await env.DB.prepare("SELECT t.* FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE t.id=? AND ta.child_id=? AND t.parent_id=? AND t.is_active=1 AND t.deleted_at IS NULL")
            .bind(input.taskId, a.id, a.parent_id)
            .first();
        if (!task)
            return fail("NOT_ASSIGNED", "任务不存在或未分配给当前孩子", 404);
        const submittedAt = nowIso();
        const offset = await timezoneOffsetMinutes(env);
        if (!isWeekdayAllowed(task.enabled_weekdays, submittedAt, offset))
            return fail("TASK_NOT_ENABLED_TODAY", "该任务今天未启用", 409);
        const pkey = periodKey(task.period, submittedAt, offset);
        const used = await childUsageForPeriod(env, "task_submissions", "task_id", task.id, a.id, pkey, ["pending", "approved"]);
        if (used >= Number(task.limit_count || 1))
            return fail("LIMIT_REACHED", "已达到本周期提交次数限制", 409);
        const submissionId = id();
        await env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
            .bind(submissionId, task.id, a.id, a.parent_id, pkey, submittedAt)
            .run();
        await notify(env, {
            recipientType: "user",
            recipientId: a.parent_id,
            actorType: "child",
            actorId: a.id,
            title: "有新的任务待审核",
            body: `${a.displayName} 提交了「${task.title}」。`,
            eventType: "task_submitted",
            relatedType: "task_submission",
            relatedId: submissionId
        });
        return ok(true);
    }
    if (path === "/reward-redemptions" && method === "POST") {
        const a = requireRole(actor, ["child"]);
        await settleExpiredCriticismFreezes(env);
        const input = await body(request);
        const reward = await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE r.id=? AND ra.child_id=? AND r.parent_id=? AND r.is_active=1 AND r.deleted_at IS NULL")
            .bind(input.rewardId, a.id, a.parent_id)
            .first();
        if (!reward)
            return fail("NOT_ASSIGNED", "奖励不存在或未分配给当前孩子", 404);
        if ((await balance(env, a.id)) < Number(reward.cost_points))
            return fail("LOW_BALANCE", "积分不足", 409);
        if (await rewardLockedByAchievement(env, reward.id, a.id))
            return fail("REWARD_LOCKED", "该奖励需要先解锁对应成就称号", 409);
        if (reward.stock !== null) {
            const used = Number((await env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE reward_id=? AND status IN ('pending','redeemed')").bind(reward.id).first())?.v || 0);
            if (used >= Number(reward.stock))
                return fail("OUT_OF_STOCK", "奖励库存不足", 409);
        }
        const requestedAt = nowIso();
        const offset = await timezoneOffsetMinutes(env);
        const pkey = periodKey(reward.limit_period, requestedAt, offset);
        const unmet = await unmetRewardPrerequisites(env, reward.id, a.id, requestedAt);
        if (unmet.length)
            return fail("PREREQUISITE_NOT_MET", `前置任务未完成：${unmet.map((item) => `${item.title} ${item.completed}/${item.required_count}`).join("；")}`, 409);
        if (reward.limit_period !== "none" && reward.limit_count !== null) {
            const count = await childUsageForPeriod(env, "reward_redemptions", "reward_id", reward.id, a.id, pkey, ["pending", "redeemed"]);
            if (count >= Number(reward.limit_count))
                return fail("LIMIT_REACHED", "已达到本周期兑换次数限制", 409);
        }
        const redemptionId = id();
        const ledgerId = id();
        await env.DB.batch([
            env.DB.prepare("INSERT INTO reward_redemptions (id, reward_id, child_id, parent_id, period_key, requested_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
                .bind(redemptionId, reward.id, a.id, a.parent_id, pkey, requestedAt),
            env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'reward', ?, ?, ?)")
                .bind(ledgerId, a.id, a.parent_id, -Number(reward.cost_points), redemptionId, pkey, "兑换奖励")
        ]);
        await recalcAchievements(env, a.parent_id, a.id);
        await notify(env, {
            recipientType: "user",
            recipientId: a.parent_id,
            actorType: "child",
            actorId: a.id,
            title: "有新的奖励待核销",
            body: `${a.displayName} 兑换了「${reward.title}」。`,
            eventType: "reward_requested",
            relatedType: "reward_redemption",
            relatedId: redemptionId
        });
        return ok(true);
    }
    const childPin = path.match(/^\/child-pins\/(task|reward)$/);
    if (childPin && method === "PATCH") {
        const a = requireRole(actor, ["child"]);
        const input = await body(request);
        const itemType = childPin[1];
        const itemId = input.itemId === null ? null : String(input.itemId || "").trim();
        if (!itemId) {
            await env.DB.prepare("DELETE FROM child_pins WHERE child_id=? AND item_type=?").bind(a.id, itemType).run();
            return ok({ itemType, itemId: null });
        }
        const found = itemType === "task"
            ? await env.DB.prepare("SELECT t.id FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE t.id=? AND ta.child_id=? AND t.parent_id=? AND t.is_active=1 AND t.deleted_at IS NULL").bind(itemId, a.id, a.parent_id).first()
            : await env.DB.prepare("SELECT r.id FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE r.id=? AND ra.child_id=? AND r.parent_id=? AND r.is_active=1 AND r.deleted_at IS NULL").bind(itemId, a.id, a.parent_id).first();
        if (!found)
            return fail("NOT_ASSIGNED", itemType === "task" ? "任务不存在或未分配给当前孩子" : "奖励不存在或未分配给当前孩子", 404);
        const now = nowIso();
        await env.DB.prepare(`INSERT INTO child_pins (child_id, item_type, item_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(child_id, item_type) DO UPDATE SET item_id=excluded.item_id, updated_at=excluded.updated_at`)
            .bind(a.id, itemType, itemId, now, now)
            .run();
        return ok({ itemType, itemId });
    }
    if (path === "/warehouse" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        return ok((await env.DB.prepare(`SELECT rr.*, r.title, r.description, r.icon_type, r.icon_value, r.cost_points, r.redeem_weekdays
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.status IN ('pending','redeemed') AND rr.hidden_from_child_at IS NULL
ORDER BY rr.requested_at DESC`).bind(a.id).all()).results);
    }
    if (path === "/warehouse/clear-redeemed" && method === "PATCH") {
        const a = requireRole(actor, ["child"]);
        await env.DB.prepare("UPDATE reward_redemptions SET hidden_from_child_at=? WHERE child_id=? AND status='redeemed' AND hidden_from_child_at IS NULL")
            .bind(nowIso(), a.id)
            .run();
        return ok(true);
    }
    if (path === "/dashboard/child-summary" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        await settleExpiredCriticismFreezes(env);
        const offset = await timezoneOffsetMinutes(env);
        const childRow = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=?")
            .bind(a.id)
            .first();
        if (!childRow)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const snapshot = await loadAiGreetingSnapshot(env, childRow, offset);
        return ok({
            balance: await balance(env, a.id),
            frozenPoints: await frozenPointsForChild(env, a.id),
            aiGreeting: snapshot.greeting,
            aiRefreshPending: snapshot.aiRefreshPending,
            child: a
        });
    }
    if (path === "/dashboard/child" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        await settleExpiredCriticismFreezes(env);
        const offset = await timezoneOffsetMinutes(env);
        const pins = (await env.DB.prepare("SELECT item_type, item_id FROM child_pins WHERE child_id=?").bind(a.id).all()).results;
        const pinnedTaskId = pins.find((pin) => pin.item_type === "task")?.item_id || null;
        const pinnedRewardId = pins.find((pin) => pin.item_type === "reward")?.item_id || null;
        const currentTasks = await env.DB.prepare("SELECT t.*, tc.name category_name, tc.icon_type category_icon_type, tc.icon_value category_icon_value FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id JOIN task_categories tc ON tc.id=t.category_id WHERE ta.child_id=? AND t.parent_id=? AND t.is_active=1 AND t.deleted_at IS NULL ORDER BY tc.name, t.created_at DESC")
            .bind(a.id, a.parent_id)
            .all();
        const enabledTasks = currentTasks.results.filter((task) => isWeekdayAllowed(task.enabled_weekdays, undefined, offset));
        const taskPeriods = enabledTasks.map((task) => ({ itemId: task.id, periodKey: periodKey(task.period, undefined, offset) }));
        const [taskUsageCounts, taskStatuses] = await Promise.all([
            childUsageCountsForPeriods(env, "task_submissions", "task_id", a.id, taskPeriods, ["pending", "approved"]),
            childLatestTaskStatuses(env, a.id, taskPeriods)
        ]);
        const taskRows = enabledTasks.map((task, index) => {
            const pkey = taskPeriods[index].periodKey;
            const key = `${task.id}:${pkey}`;
            const activeCount = taskUsageCounts.get(key) || 0;
            const latest = taskStatuses.latest.get(key);
            const rejected = taskStatuses.rejected.get(key);
            const limitCount = Number(task.limit_count || 1);
            return {
                ...task,
                enabledWeekdays: normalizeWeekdays(task.enabled_weekdays),
                periodKey: pkey,
                limitCount,
                usedCount: activeCount,
                remainingCount: Math.max(0, limitCount - activeCount),
                canSubmit: activeCount < limitCount,
                resetAt: nextPeriodReset(task.period, undefined, offset),
                submissionStatus: latest?.status || null,
                rejectionNote: rejected?.review_note || "",
                isPinned: task.id === pinnedTaskId
            };
        });
        const rewardRows = await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE ra.child_id=? AND r.parent_id=? AND r.is_active=1 AND r.deleted_at IS NULL ORDER BY r.cost_points")
            .bind(a.id, a.parent_id)
            .all();
        const rewardsWithLocks = [];
        for (const reward of rewardRows.results) {
            if (!(await rewardLockedByAchievement(env, reward.id, a.id)))
                rewardsWithLocks.push(reward);
        }
        const rewardPeriods = rewardsWithLocks.map((reward) => ({ itemId: reward.id, periodKey: periodKey(reward.limit_period, undefined, offset) }));
        const rewardUsageCounts = await childUsageCountsForPeriods(env, "reward_redemptions", "reward_id", a.id, rewardPeriods, ["pending", "redeemed"]);
        const rewards = rewardsWithLocks.map((reward, index) => {
            const pkey = rewardPeriods[index].periodKey;
            const limitCount = reward.limit_period === "none" || reward.limit_count === null ? null : Number(reward.limit_count);
            const usedCount = limitCount === null ? 0 : rewardUsageCounts.get(`${reward.id}:${pkey}`) || 0;
            return {
                ...reward,
                redeemWeekdays: normalizeWeekdays(reward.redeem_weekdays),
                periodKey: pkey,
                limitCount,
                usedCount,
                remainingCount: limitCount === null ? null : Math.max(0, limitCount - usedCount),
                canRedeem: limitCount === null || usedCount < limitCount,
                resetAt: nextPeriodReset(reward.limit_period, undefined, offset),
                isPinned: reward.id === pinnedRewardId
            };
        });
        const visiblePinnedTaskId = taskRows.some((task) => task.id === pinnedTaskId) ? pinnedTaskId : null;
        const visiblePinnedRewardId = rewards.some((reward) => reward.id === pinnedRewardId) ? pinnedRewardId : null;
        const childRow = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=?").bind(a.id).first();
        return ok({
            child: a,
            balance: await balance(env, a.id),
            frozenPoints: await frozenPointsForChild(env, a.id),
            pinnedTaskId: visiblePinnedTaskId,
            pinnedRewardId: visiblePinnedRewardId,
            tasks: taskRows,
            rewards,
            remedyCriticisms: await activeRemedyCriticisms(env, a.id, offset),
            aiGreeting: "",
            aiRefreshPending: false,
            achievements: (await env.DB.prepare("SELECT a.*, ca.unlocked_at FROM achievements a JOIN child_achievements ca ON ca.achievement_id=a.id WHERE ca.child_id=? ORDER BY ca.unlocked_at DESC").bind(a.id).all()).results
        });
    }
    return null;
}
