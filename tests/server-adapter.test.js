import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "../server/d1-sqlite-adapter.mjs";

describe("Sqlite D1 adapter", () => {
  it("supports D1 prepare/bind/run/all/first", () => {
    const db = createSqliteD1(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, done INTEGER NOT NULL)");

    const result = db.prepare("INSERT INTO items (id, done) VALUES (?, ?)").bind("a", true).run();
    expect(result.meta.changes).toBe(1);
    expect(db.prepare("SELECT done FROM items WHERE id=?").bind("a").first().done).toBe(1);
    expect(db.prepare("SELECT id FROM items").all().results).toEqual([{ id: "a" }]);

    db.close();
  });

  it("rolls back failed batches", () => {
    const db = createSqliteD1(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");

    expect(() => db.batch([
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("a"),
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("a")
    ])).toThrow();
    expect(db.prepare("SELECT COUNT(*) count FROM items").first().count).toBe(0);

    db.close();
  });
});
