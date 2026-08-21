import { periodKey } from "../../../src/lib/domain.js";
import { ok, fail, body, id, nowIso, requireRole, timezoneOffsetMinutes, timezoneLabel, settingNumber, recalcAchievements, notificationRecipient, withNotificationSources, childIdsForParent, withLedgerSources, balancesForChildren, frozenPointsForChildren, listConfig, importConfig, ensureRewardOnceSchema, notify, actorAudit, DAY_MS, listConfigGroups, createConfigGroup, renameConfigGroup, refreshConfigGroupSnapshot, activateConfigGroup, deleteConfigGroup, clearCurrentConfig, ensureRequiredTaskSchema, ensureTaskSetSchema, taskSetProgress } from "../utils.js";
import { ensureCriticismRemedySchema, settleExpiredCriticismFreezes, activeRemedyItemsForChildren } from "../utils.js";

async function confirmFrozenRemedy(env, actor, ledgerId, sourceType) {
    await ensureCriticismRemedySchema(env);
    await settleExpiredCriticismFreezes(env);
    const audit = actorAudit(actor);
    const row = await env.DB.prepare(`SELECT pl.*, c.id child_id
FROM point_ledger pl
JOIN children c ON c.id=pl.child_id
WHERE pl.id=? AND pl.parent_id=? AND c.parent_id=? AND pl.source_type=?`)
        .bind(ledgerId, actor.id, actor.id, sourceType)
        .first();
    if (!row)
        return fail("NOT_FOUND", sourceType === "criticism" ? "批评记录不存在" : "必做扣分记录不存在", 404);
    if (row.revoked_at)
        return fail("ALREADY_RECALLED", "该记录已经撤回", 409);
    if (row.freeze_status !== "frozen")
        return fail("NOT_REMEDIABLE", "该记录不在可补救状态", 409);
    if (row.remedy_deadline_at && row.remedy_deadline_at <= nowIso())
        return fail("REMEDY_EXPIRED", "补救时限已过", 409);
    const now = nowIso();
    const frozen = Math.abs(Number(row.frozen_amount || 0));
    const recovered = Math.max(0, Math.min(frozen, Number(row.remedy_points || 0)));
    const finalAmount = -Math.max(0, frozen - recovered);
    await env.DB.prepare(`UPDATE point_ledger
SET amount=?, effective_amount=?, freeze_status='remedied', remedied_at=?, settled_at=?
WHERE id=? AND freeze_status='frozen'`)
        .bind(finalAmount, finalAmount, now, now, row.id)
        .run();
    const title = sourceType === "criticism" ? "批评补救已确认" : "必做补救已确认";
    await notify(env, {
        recipientType: "child",
        recipientId: row.child_id,
        actorType: audit.type,
        actorId: audit.id || actor.id,
        actorLabel: audit.label,
        title,
        body: `家长已确认补救完成，挽回 ${recovered} 积分。`,
        eventType: sourceType,
        relatedType: "point_ledger",
        relatedId: row.id
    });
    await recalcAchievements(env, actor.id, row.child_id);
    return ok(true);
}

export async function handleSharedRoutes(path, method, request, env, actor, url) {
    if (path === "/notifications" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate", "child"]);
        const recipient = notificationRecipient(a);
        const unread = Number((await env.DB.prepare("SELECT COUNT(*) v FROM notifications WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(recipient.type, recipient.id)
            .first())?.v || 0);
        if (url.searchParams.get("summary") === "1")
            return ok({ unread });
        const rows = (await env.DB.prepare(`SELECT * FROM notifications
WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL
ORDER BY CASE WHEN related_type IN ('task_submission', 'reward_redemption') THEN 0 ELSE 1 END,
  created_at DESC,
  id DESC
LIMIT 50`)
            .bind(recipient.type, recipient.id)
            .all()).results;
        return ok({ items: await withNotificationSources(env, rows), unread });
    }
    if (path === "/notifications/read-all" && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(nowIso(), recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    const notificationRead = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (notificationRead && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=? AND recipient_type=? AND recipient_id=?")
            .bind(nowIso(), notificationRead[1], recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    if (path === "/config/export" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const config = await listConfig(env, a.id);
        const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
        const taskNames = new Map(config.tasks.map((task) => [task.id, task.title]));
        const childNames = new Map((await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL")
            .bind(a.id)
            .all()).results.map((child) => [child.id, child.display_name]));
        const assigneeNames = (item) => (item.assignees || []).map((childId) => childNames.get(childId)).filter(Boolean);
        return ok({
            version: 4,
            exportedAt: nowIso(),
            categories: config.categories.map((item) => ({
                name: item.name,
                icon_type: item.icon_type,
                icon_value: item.icon_value,
                is_system: item.is_system
            })),
            tasks: config.tasks.map((item) => ({
                title: item.title,
                description: item.description,
                category_name: categoryNames.get(item.category_id) || "",
                period: item.period,
                points: item.points,
                limit_count: item.limit_count,
                enabled_weekdays: item.enabled_weekdays,
                is_required: item.is_required,
                required_count: item.required_count,
                required_penalty_points: item.required_penalty_points,
                required_remedy_enabled: item.required_remedy_enabled,
                required_remedy_condition: item.required_remedy_condition,
                required_remedy_points: item.required_remedy_points,
                required_remedy_deadline_hours: item.required_remedy_deadline_hours,
                submission_deadline: item.submissionDeadline,
                assignee_names: assigneeNames(item),
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            taskSets: (config.taskSets || []).map((item) => ({
                title: item.title,
                description: item.description,
                icon_type: item.icon_type,
                icon_value: item.icon_value,
                is_active: item.is_active,
                members: (item.members || []).map((member) => ({ title: member.title, period: config.tasks.find((task) => task.id === member.task_id)?.period || "daily" }))
            })),
            rewards: config.rewards.map((item) => ({
                title: item.title,
                description: item.description,
                cost_points: item.cost_points,
                stock: item.stock,
                limit_period: item.limit_period,
                limit_count: item.limit_count,
                redeem_weekdays: item.redeem_weekdays,
                prerequisites: (item.prerequisites || []).map((prerequisite) => ({
                    ...prerequisite,
                    task_title: taskNames.get(prerequisite.task_id) || prerequisite.title || ""
                })),
                required_achievement_title: item.requiredAchievementTitle,
                assignee_names: assigneeNames(item),
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            achievements: config.achievements.map((item) => ({
                title: item.title,
                description: item.description,
                metric: item.metric,
                threshold: item.threshold,
                rule_type: item.rule_type || item.metric,
                window_type: item.window_type || "all_time",
                window_start: item.window_start,
                window_end: item.window_end,
                target_task_id: item.target_task_id,
                target_task_title: taskNames.get(item.target_task_id) || "",
                target_category_id: item.target_category_id,
                target_category_name: categoryNames.get(item.target_category_id) || "",
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            feedbackTemplates: config.feedbackTemplates.map((item) => ({
                kind: item.kind,
                title: item.title,
                description: item.description,
                points: item.points,
                is_remediable: item.is_remediable,
                remedy_condition: item.remedy_condition,
                remedy_points: item.remedy_points,
                remedy_deadline_hours: item.remedy_deadline_hours,
                icon_type: item.icon_type,
                icon_value: item.icon_value
            }))
        });
    }
    if (path === "/config/import" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await ensureRewardOnceSchema(env);
        return ok(await importConfig(env, a.id, await body(request)));
    }
    if (path === "/config/clear-current" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return ok(await clearCurrentConfig(env, a.id));
    }
    if (path === "/config-groups" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return ok(await listConfigGroups(env, a.id));
    }
    if (path === "/config-groups" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        return ok(await createConfigGroup(env, a.id, input.name));
    }
    const configGroupPatch = path.match(/^\/config-groups\/([^/]+)$/);
    if (configGroupPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        return ok(await renameConfigGroup(env, a.id, configGroupPatch[1], input.name));
    }
    if (configGroupPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await deleteConfigGroup(env, a.id, configGroupPatch[1]);
        return ok(true);
    }
    const configGroupRefresh = path.match(/^\/config-groups\/([^/]+)\/refresh$/);
    if (configGroupRefresh && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return ok(await refreshConfigGroupSnapshot(env, a.id, configGroupRefresh[1]));
    }
    const configGroupActivate = path.match(/^\/config-groups\/([^/]+)\/activate$/);
    if (configGroupActivate && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return ok(await activateConfigGroup(env, a.id, configGroupActivate[1]));
    }
    const feedbackRecall = path.match(/^\/feedback-events\/([^/]+)\/recall$/);
    if (feedbackRecall && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await settleExpiredCriticismFreezes(env);
        const audit = actorAudit(a);
        const row = await env.DB.prepare(`SELECT pl.*, c.id child_id
FROM point_ledger pl
JOIN children c ON c.id=pl.child_id
WHERE pl.id=? AND pl.parent_id=? AND c.parent_id=? AND pl.source_type IN ('praise','criticism')`)
            .bind(feedbackRecall[1], a.id, a.id)
            .first();
        if (!row)
            return fail("NOT_FOUND", "表扬或批评记录不存在", 404);
        if (row.revoked_at)
            return fail("ALREADY_RECALLED", "该记录已经撤回", 409);
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const cutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
        if (row.created_at < cutoff)
            return fail("RECALL_EXPIRED", "只能撤回7天内的表扬或批评", 409);
        const now = nowIso();
        const retentionUntil = new Date(Date.now() + shortDays * DAY_MS).toISOString();
        const recallId = id();
        const label = row.source_type === "praise" ? "表扬" : "批评";
        const recallAmount = -Number(row.amount || 0);
        await env.DB.batch([
            env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until, actor_type, actor_id, actor_label_snapshot, effective_amount) VALUES (?, ?, ?, ?, 'feedback_recall', ?, NULL, ?, ?, ?, ?, ?, ?)")
                .bind(recallId, row.child_id, a.id, recallAmount, row.id, `${label}撤回冲正`, retentionUntil, audit.type, audit.id, audit.label, recallAmount),
            env.DB.prepare("UPDATE point_ledger SET revoked_at=?, revoke_ledger_id=?, retention_until=? WHERE id=?")
                .bind(now, recallId, retentionUntil, row.id),
            env.DB.prepare("UPDATE notifications SET title=?, body=?, read_at=COALESCE(read_at, ?) WHERE related_type='point_ledger' AND related_id=?")
                .bind(`${label}已撤回`, "家长已撤回这条反馈，积分已恢复。", now, row.id)
        ]);
        await notify(env, {
            recipientType: "child",
            recipientId: row.child_id,
            actorType: audit.type,
            actorId: audit.id || a.id,
            actorLabel: audit.label,
            title: `${label}已撤回`,
            body: "家长已撤回这条反馈，积分已恢复。",
            eventType: "feedback_recall",
            relatedType: "point_ledger",
            relatedId: row.id
        });
        await recalcAchievements(env, a.id, row.child_id);
        return ok(true);
    }
    const feedbackRemedy = path.match(/^\/feedback-events\/([^/]+)\/remedy$/);
    if (feedbackRemedy && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return confirmFrozenRemedy(env, a, feedbackRemedy[1], "criticism");
    }
    const requiredPenaltyRemedy = path.match(/^\/task-required-penalties\/([^/]+)\/remedy$/);
    if (requiredPenaltyRemedy && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return confirmFrozenRemedy(env, a, requiredPenaltyRemedy[1], "task_required_penalty");
    }
    const redemptionRefundWithRetention = path.match(/^\/reward-redemptions\/([^/]+)\/refund$/);
    if (redemptionRefundWithRetention && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const audit = actorAudit(a);
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='redeemed'")
            .bind(redemptionRefundWithRetention[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "可退还的奖励兑换不存在", 404);
        const refunded = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='reward_refund' AND source_id=?").bind(redemption.id).first();
        if (refunded)
            return fail("ALREADY_REFUNDED", "该奖励已经退还过积分", 409);
        const now = nowIso();
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const retentionUntil = new Date(Date.now() + shortDays * DAY_MS).toISOString();
        const refundLedgerId = id();
        await env.DB.batch([
            env.DB.prepare("UPDATE reward_redemptions SET status='cancelled', cancelled_at=?, refunded_at=?, retention_until=? WHERE id=?")
                .bind(now, now, retentionUntil, redemption.id),
            env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until, actor_type, actor_id, actor_label_snapshot) VALUES (?, ?, ?, ?, 'reward_refund', ?, ?, ?, ?, ?, ?, ?)")
                .bind(refundLedgerId, redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "奖励退还积分", retentionUntil, audit.type, audit.id, audit.label)
        ]);
        await recalcAchievements(env, a.id, redemption.child_id);
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: audit.type,
            actorId: audit.id || a.id,
            actorLabel: audit.label,
            title: "奖励已退还积分",
            body: "家长已退还该奖励兑换的积分。",
            eventType: "reward_refund",
            relatedType: "reward_redemption",
            relatedId: redemption.id
        });
        return ok(true);
    }
    if (path === "/testing/reset-parent-progress" && method === "POST") {
        if (env.ENVIRONMENT === "production")
            return fail("FORBIDDEN", "测试接口在生产环境不可用", 403);
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const children = await childIdsForParent(env, a.id);
        if (!children.length)
            return ok(true);
        const placeholders = children.map(() => "?").join(",");
        await env.DB.prepare(`DELETE FROM point_ledger WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM task_submissions WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM reward_redemptions WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM child_achievements WHERE child_id IN (${placeholders})`).bind(...children).run();
        return ok(true);
    }
    if (path === "/points/ledger" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate", "child"]);
        await settleExpiredCriticismFreezes(env);
        const childId = a.role === "child" ? a.id : url.searchParams.get("childId");
        if (!childId)
            return fail("BAD_REQUEST", "缺少 childId");
        if (a.role !== "child" && !(await childIdsForParent(env, a.id)).includes(childId))
            return fail("FORBIDDEN", "没有权限查看该孩子积分", 403);
        const offset = await timezoneOffsetMinutes(env);
        const rows = (await env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? ORDER BY datetime(created_at) DESC, created_at DESC, id DESC LIMIT 100").bind(childId).all()).results;
        return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset), items: await withLedgerSources(env, rows, offset) });
    }
    if (path === "/dashboard/parent" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await settleExpiredCriticismFreezes(env);
        const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all()).results;
        const childIds = children.map((child) => child.id);
        const [balances, frozenMap] = await Promise.all([
            balancesForChildren(env, childIds),
            frozenPointsForChildren(env, childIds)
        ]);
        const offset = await timezoneOffsetMinutes(env);
        const remedyItems = await activeRemedyItemsForChildren(env, children, offset);
        const allRemedy = remedyItems.filter((item) => item.sourceType === "criticism");
        const allRequiredPenaltyRemedies = remedyItems.filter((item) => item.sourceType === "task_required_penalty");
        await Promise.all([ensureRequiredTaskSchema(env), ensureTaskSetSchema(env)]);
        const requiredRows = (await env.DB.prepare(`SELECT t.id task_id, t.period, ta.child_id
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
JOIN children c ON c.id=ta.child_id AND c.parent_id=t.parent_id AND c.deleted_at IS NULL
WHERE t.parent_id=? AND t.is_required=1 AND t.is_active=1 AND t.deleted_at IS NULL`).bind(a.id).all()).results;
        const currentRequired = requiredRows.map((row) => ({ childId: row.child_id, taskId: row.task_id, periodKey: periodKey(row.period, undefined, offset) }));
        const penaltyRows = (await env.DB.prepare("SELECT child_id, task_id, period_key FROM task_required_penalties WHERE parent_id=? AND penalty_points=0").bind(a.id).all()).results;
        const exempted = new Set(penaltyRows.map((row) => `${row.child_id}:${row.task_id}:${row.period_key}`));
        const requiredPenaltyExemptions = currentRequired.filter((row) => exempted.has(`${row.childId}:${row.taskId}:${row.periodKey}`));
        const deadlineRows = (await env.DB.prepare(`SELECT t.id task_id, t.period, ta.child_id, e.period_key
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
JOIN children c ON c.id=ta.child_id AND c.parent_id=t.parent_id AND c.status='active' AND c.deleted_at IS NULL
JOIN task_submission_deadline_exemptions e ON e.task_id=t.id AND e.child_id=ta.child_id AND e.parent_id=t.parent_id
WHERE t.parent_id=? AND t.is_active=1 AND t.deleted_at IS NULL`).bind(a.id).all()).results;
        const submissionDeadlineExemptions = deadlineRows.filter((row) => row.period_key === periodKey(row.period, undefined, offset)).map((row) => ({ childId: row.child_id, taskId: row.task_id, periodKey: row.period_key }));
        const childCards = children.map((child) => ({ ...child, balance: balances.get(child.id) || 0, frozenPoints: frozenMap.get(child.id) || 0 }));
        const pendingRows = (await env.DB.prepare("SELECT s.*, t.title, t.points, t.grading_mode, t.completion_standards_json, c.display_name child_name, ts.title task_set_title FROM task_submissions s JOIN tasks t ON t.id=s.task_id JOIN children c ON c.id=s.child_id LEFT JOIN task_sets ts ON ts.id=s.task_set_id WHERE s.parent_id=? AND s.status='pending' ORDER BY s.submitted_at").bind(a.id).all()).results;
        const taskSetProgressRows = new Map();
        for (const row of pendingRows) {
            if (row.task_set_id) {
                const key = `${row.task_set_id}:${row.child_id}`;
                if (!taskSetProgressRows.has(key)) taskSetProgressRows.set(key, await taskSetProgress(env, row.task_set_id, row.child_id));
            }
        }
        const pendingSubmissions = pendingRows.map((row) => ({ ...row, taskSetProgress: row.task_set_id ? taskSetProgressRows.get(`${row.task_set_id}:${row.child_id}`) : null }));
        return ok({
            children: childCards,
            remedyCriticisms: allRemedy,
            requiredPenaltyRemedies: allRequiredPenaltyRemedies,
            requiredPenaltyExemptions,
            submissionDeadlineExemptions,
            pendingSubmissions,
            pendingRedemptions: (await env.DB.prepare("SELECT rr.*, r.title, r.redeem_weekdays, c.display_name child_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN children c ON c.id=rr.child_id WHERE rr.parent_id=? AND rr.status='pending' ORDER BY rr.requested_at").bind(a.id).all()).results
        });
    }
    return null;
}
