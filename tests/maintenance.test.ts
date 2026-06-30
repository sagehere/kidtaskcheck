import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { archiveOldActivity, cleanupAiJobHistory, hardDeleteSoftDeleted, hashPassword, id } from "../server/api/utils.js";
import { ensureAiGenerationQueue } from "../server/api/ai/queue.js";
import { ensureAiScheduledRefreshRuns } from "../server/api/ai/scheduled.js";
import { ensureAiCartoonReportJobs, ensureAiPrintChecklistImageJobs, ensureAiScheduleImageJobs } from "../server/api/ai/cartoon-queue.js";

async function seedFamily(env: any) {
  const parentId = id();
  const childId = id();
  const pw = await hashPassword("pw");
  env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'Parent')").bind(parentId, `p-${parentId}`, pw).run();
  env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'Child', 'active')").bind(childId, parentId, `c-${childId}`, pw).run();
  return { parentId, childId };
}

describe("maintenance cleanup", () => {
  let env: any;

  beforeEach(() => {
    env = resetTestEnv();
  });

  it("adds late old ledger rows into an existing monthly archive without losing balance", async () => {
    const { parentId, childId } = await seedFamily(env);
    const cutoff = "2026-01-01T00:00:00.000Z";

    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, 10, 'manual', 'seed-a', '2025-01', 'old', '2025-01-05T00:00:00.000Z')")
      .bind(id(), childId, parentId).run();
    await archiveOldActivity(env, cutoff, 480);

    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, 7, 'manual', 'seed-b', '2025-01', 'late', '2025-01-10T00:00:00.000Z')")
      .bind(id(), childId, parentId).run();
    await archiveOldActivity(env, cutoff, 480);

    const archive = env.DB.prepare("SELECT * FROM activity_archives WHERE child_id=? AND month_key='2025-01'").bind(childId).first() as any;
    expect(Number(archive.net_points)).toBe(17);
    const archiveLedger = env.DB.prepare("SELECT amount FROM point_ledger WHERE child_id=? AND source_type='activity_archive' AND source_id=?").bind(childId, `archive:${childId}:2025-01`).first() as any;
    expect(Number(archiveLedger.amount)).toBe(17);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) balance FROM point_ledger WHERE child_id=?").bind(childId).first() as any;
    expect(Number(balance.balance)).toBe(17);
    const detailRows = env.DB.prepare("SELECT COUNT(*) count FROM point_ledger WHERE child_id=? AND source_type='manual'").bind(childId).first() as any;
    expect(Number(detailRows.count)).toBe(0);
  });

  it("cleans only completed or failed AI jobs older than the retention cutoff", async () => {
    const { parentId, childId } = await seedFamily(env);
    await ensureAiGenerationQueue(env);
    await ensureAiScheduledRefreshRuns(env);
    await ensureAiCartoonReportJobs(env);
    await ensureAiPrintChecklistImageJobs(env);
    await ensureAiScheduleImageJobs(env);
    const old = "2026-01-01T00:00:00.000Z";
    const recent = "2026-05-01T00:00:00.000Z";
    const cutoff = "2026-04-01T00:00:00.000Z";

    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, retry_count, max_retries, created_at, completed_at) VALUES ('q-old', ?, ?, 'greeting', '2026-01-01', 'completed', 0, 3, ?, ?)").bind(parentId, childId, old, old).run();
    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, retry_count, max_retries, created_at, completed_at) VALUES ('q-recent', ?, ?, 'greeting', '2026-05-01', 'completed', 0, 3, ?, ?)").bind(parentId, childId, recent, recent).run();
    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, retry_count, max_retries, created_at) VALUES ('q-pending', ?, ?, 'greeting', '2026-01-02', 'pending', 0, 3, ?)").bind(parentId, childId, old).run();
    env.DB.prepare("INSERT INTO ai_scheduled_refresh_runs (job_type, period_key, status, triggered_at, completed_at) VALUES ('greeting_daily', 'old', 'completed', ?, ?), ('greeting_daily', 'pending', 'processing', ?, NULL)").bind(old, old, old).run();
    env.DB.prepare("INSERT INTO ai_cartoon_report_jobs (id, parent_id, child_id, period_type, period_key, status, retry_count, max_retries, created_at, updated_at, completed_at) VALUES ('cartoon-old', ?, ?, 'weekly', 'old', 'failed', 3, 3, ?, ?, ?)").bind(parentId, childId, old, old, old).run();
    env.DB.prepare("INSERT INTO ai_print_checklist_image_jobs (id, parent_id, child_id, job_key, status, retry_count, max_retries, created_at, updated_at, completed_at) VALUES ('print-old', ?, ?, 'old', 'completed', 0, 3, ?, ?, ?)").bind(parentId, childId, old, old, old).run();
    env.DB.prepare("INSERT INTO ai_schedule_image_jobs (id, parent_id, child_id, job_key, status, retry_count, max_retries, created_at, updated_at, completed_at) VALUES ('schedule-old', ?, ?, 'old', 'completed', 0, 3, ?, ?, ?)").bind(parentId, childId, old, old, old).run();

    await cleanupAiJobHistory(env, cutoff);

    expect(env.DB.prepare("SELECT id FROM ai_generation_queue WHERE id='q-old'").first()).toBeNull();
    expect(env.DB.prepare("SELECT id FROM ai_generation_queue WHERE id='q-recent'").first()).toBeTruthy();
    expect(env.DB.prepare("SELECT id FROM ai_generation_queue WHERE id='q-pending'").first()).toBeTruthy();
    expect(env.DB.prepare("SELECT period_key FROM ai_scheduled_refresh_runs WHERE period_key='old'").first()).toBeNull();
    expect(env.DB.prepare("SELECT period_key FROM ai_scheduled_refresh_runs WHERE period_key='pending'").first()).toBeTruthy();
    expect(env.DB.prepare("SELECT id FROM ai_cartoon_report_jobs WHERE id='cartoon-old'").first()).toBeNull();
    expect(env.DB.prepare("SELECT id FROM ai_print_checklist_image_jobs WHERE id='print-old'").first()).toBeNull();
    expect(env.DB.prepare("SELECT id FROM ai_schedule_image_jobs WHERE id='schedule-old'").first()).toBeNull();
  });

  it("skips hard deletion of soft-deleted tasks and rewards that still have history references", async () => {
    const { parentId, childId } = await seedFamily(env);
    const old = "2025-01-01T00:00:00.000Z";
    const cutoff = "2026-01-01T00:00:00.000Z";
    const taskWithHistory = id();
    const taskWithoutHistory = id();
    const rewardWithHistory = id();
    const rewardWithoutHistory = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('maint-cat', ?, 'Maintenance', 'emoji', 'M')").bind(parentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, period, point_type, points, deleted_at, is_active) VALUES (?, ?, 'maint-cat', 'With history', 'daily', 'earn', 1, ?, 0), (?, ?, 'maint-cat', 'No history', 'daily', 'earn', 1, ?, 0)")
      .bind(taskWithHistory, parentId, old, taskWithoutHistory, parentId, old).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?), (?, ?)").bind(taskWithHistory, childId, taskWithoutHistory, childId).run();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, status) VALUES ('pending-submission', ?, ?, ?, '2025-01-01', ?, 'pending')")
      .bind(taskWithHistory, childId, parentId, old).run();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, deleted_at, is_active) VALUES (?, ?, 'With history', 1, ?, 0), (?, ?, 'No history', 1, ?, 0)")
      .bind(rewardWithHistory, parentId, old, rewardWithoutHistory, parentId, old).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?), (?, ?)").bind(rewardWithHistory, childId, rewardWithoutHistory, childId).run();
    env.DB.prepare("INSERT INTO reward_redemptions (id, reward_id, child_id, parent_id, period_key, requested_at, status) VALUES ('pending-redemption', ?, ?, ?, '2025-01-01', ?, 'pending')")
      .bind(rewardWithHistory, childId, parentId, old).run();

    await hardDeleteSoftDeleted(env, cutoff);

    expect(env.DB.prepare("SELECT id FROM tasks WHERE id=?").bind(taskWithHistory).first()).toBeTruthy();
    expect(env.DB.prepare("SELECT id FROM tasks WHERE id=?").bind(taskWithoutHistory).first()).toBeNull();
    expect(env.DB.prepare("SELECT id FROM rewards WHERE id=?").bind(rewardWithHistory).first()).toBeTruthy();
    expect(env.DB.prepare("SELECT id FROM rewards WHERE id=?").bind(rewardWithoutHistory).first()).toBeNull();
  });
});