import { ok, fail, body, id, nowIso, requireRole, timezoneOffsetMinutes, timezoneLabel, settingNumber, recalcAchievements, notificationRecipient, withNotificationSources, childIdsForParent, withLedgerSources, balancesForChildren, listConfig, importConfig, ensureRewardOnceSchema, notify, DAY_MS } from "../utils.js";

export async function handleSharedRoutes(path, method, request, env, actor, url) {
    if (path === "/notifications" && method === "GET") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        const rows = (await env.DB.prepare("SELECT * FROM notifications WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 50")
            .bind(recipient.type, recipient.id)
            .all()).results;
        const unread = Number((await env.DB.prepare("SELECT COUNT(*) v FROM notifications WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(recipient.type, recipient.id)
            .first())?.v || 0);
        return ok({ items: await withNotificationSources(env, rows), unread });
    }
    if (path === "/notifications/read-all" && method === "PATCH") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(nowIso(), recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    const notificationRead = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (notificationRead && method === "PATCH") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=? AND recipient_type=? AND recipient_id=?")
            .bind(nowIso(), notificationRead[1], recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    if (path === "/config/export" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const config = await listConfig(env, a.id);
        const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
        return ok({
            version: 1,
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
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            rewards: config.rewards.map((item) => ({
                title: item.title,
                description: item.description,
                cost_points: item.cost_points,
                stock: item.stock,
                limit_period: item.limit_period,
                limit_count: item.limit_count,
                redeem_weekdays: item.redeem_weekdays,
                prerequisites: item.prerequisites,
                required_achievement_title: item.requiredAchievementTitle,
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
                icon_type: item.icon_type,
                icon_value: item.icon_value
            }))
        });
    }
    if (path === "/config/import" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        await ensureRewardOnceSchema(env);
        return ok(await importConfig(env, a.id, await body(request)));
    }
    const feedbackRecall = path.match(/^\/feedback-events\/([^/]+)\/recall$/);
    if (feedbackRecall && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
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
        await env.DB.batch([
            env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until) VALUES (?, ?, ?, ?, 'feedback_recall', ?, NULL, ?, ?)")
                .bind(recallId, row.child_id, a.id, -Number(row.amount || 0), row.id, `${label}撤回冲正`, retentionUntil),
            env.DB.prepare("UPDATE point_ledger SET revoked_at=?, revoke_ledger_id=?, retention_until=? WHERE id=?")
                .bind(now, recallId, retentionUntil, row.id),
            env.DB.prepare("UPDATE notifications SET title=?, body=?, read_at=COALESCE(read_at, ?) WHERE related_type='point_ledger' AND related_id=?")
                .bind(`${label}已撤回`, "家长已撤回这条反馈，积分已恢复。", now, row.id)
        ]);
        await recalcAchievements(env, a.id, row.child_id);
        return ok(true);
    }
    const redemptionRefundWithRetention = path.match(/^\/reward-redemptions\/([^/]+)\/refund$/);
    if (redemptionRefundWithRetention && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
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
            env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until) VALUES (?, ?, ?, ?, 'reward_refund', ?, ?, ?, ?)")
                .bind(refundLedgerId, redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "奖励退还积分", retentionUntil)
        ]);
        await recalcAchievements(env, a.id, redemption.child_id);
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: "user",
            actorId: a.id,
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
        const a = requireRole(actor, ["parent"]);
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
        const a = requireRole(actor, ["parent", "child"]);
        const childId = a.role === "child" ? a.id : url.searchParams.get("childId");
        if (!childId)
            return fail("BAD_REQUEST", "缺少 childId");
        if (a.role === "parent" && !(await childIdsForParent(env, a.id)).includes(childId))
            return fail("FORBIDDEN", "没有权限查看该孩子积分", 403);
        const offset = await timezoneOffsetMinutes(env);
        const rows = (await env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? ORDER BY created_at DESC LIMIT 100").bind(childId).all()).results;
        return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset), items: await withLedgerSources(env, rows, offset) });
    }
    if (path === "/dashboard/parent" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all()).results;
        const balances = await balancesForChildren(env, children.map((child) => child.id));
        const childCards = children.map((child) => ({ ...child, balance: balances.get(child.id) || 0 }));
        return ok({
            children: childCards,
            pendingSubmissions: (await env.DB.prepare("SELECT s.*, t.title, c.display_name child_name FROM task_submissions s JOIN tasks t ON t.id=s.task_id JOIN children c ON c.id=s.child_id WHERE s.parent_id=? AND s.status='pending' ORDER BY s.submitted_at").bind(a.id).all()).results,
            pendingRedemptions: (await env.DB.prepare("SELECT rr.*, r.title, r.redeem_weekdays, c.display_name child_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN children c ON c.id=rr.child_id WHERE rr.parent_id=? AND rr.status='pending' ORDER BY rr.requested_at").bind(a.id).all()).results
        });
    }
    return null;
}
