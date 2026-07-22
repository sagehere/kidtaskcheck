import { describe, expect, it } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureRequiredTaskSchema, hashPassword, id, listWithAssignees } from "../server/api/utils.js";

describe("hot-path optimizations", () => {
  it("runs required-task schema repair only once per database", async () => {
    const env = resetTestEnv();
    await ensureRequiredTaskSchema(env);
    env._db.resetQueryCount();
    await ensureRequiredTaskSchema(env);
    expect(env._db.queryCount()).toBe(0);
  });

  it("loads task assignees in a constant number of queries", async () => {
    const env = resetTestEnv();
    const parentId = id();
    const password = await hashPassword("pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(parentId, "opt-parent", password).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('opt-cat', ?, 'Cat', 'emoji', '📚')").bind(parentId).run();
    for (const title of ["A", "B", "C"]) {
      env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id) VALUES (?, ?, ?, 1, 'daily', 1, 'earn', '[1,2,3,4,5,6,0]', 'opt-cat')")
        .bind(id(), parentId, title)
        .run();
    }
    await ensureRequiredTaskSchema(env);
    env._db.resetQueryCount();
    const tasks = await listWithAssignees(env, "tasks", parentId);
    expect(tasks).toHaveLength(3);
    expect(env._db.queryCount()).toBe(2);
  });
});
