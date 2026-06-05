import { describe, expect, it } from "vitest";
import { createSqliteDb } from "../server/sqlite-db.mjs";

describe("SQLite database adapter", () => {
  it("supports prepare/bind/run/all/first", () => {
    const db = createSqliteDb(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, done INTEGER NOT NULL)");

    const result = db.prepare("INSERT INTO items (id, done) VALUES (?, ?)").bind("a", true).run();
    expect(result.meta.changes).toBe(1);
    expect(db.prepare("SELECT done FROM items WHERE id=?").bind("a").first().done).toBe(1);
    expect(db.prepare("SELECT id FROM items").all().results).toEqual([{ id: "a" }]);

    db.close();
  });

  it("rolls back failed batches", () => {
    const db = createSqliteDb(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");

    expect(() => db.batch([
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("a"),
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("a")
    ])).toThrow();
    expect(db.prepare("SELECT COUNT(*) count FROM items").first().count).toBe(0);

    db.close();
  });
});
