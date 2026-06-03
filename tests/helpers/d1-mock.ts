import { DatabaseSync } from "node:sqlite";

type BindValue = string | number | null | boolean;

class D1Statement {
  private sql: string;
  private db: DatabaseSync;
  private params: BindValue[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...params: (BindValue | undefined)[]) {
    this.params = params.map((p) => p === undefined ? null : p);
    return this;
  }

  run() {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.params);
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowId) } };
  }

  all() {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params);
    return { results: rows, success: true };
  }

  first() {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params);
    return row ?? null;
  }

  raw() {
    const stmt = this.db.prepare(this.sql);
    return stmt.raw(...this.params);
  }
}

export class D1Mock {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }

  exec(sql: string) {
    this.db.exec(sql);
    return { success: true };
  }

  batch(statements: { run: () => any }[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((s) => s.run());
      this.db.exec("COMMIT");
      return results;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close() {
    this.db.close();
  }

  dump(table?: string): any[] {
    if (table) return this.prepare(`SELECT * FROM ${table}`).all().results;
    const tables = this.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().results as any[];
    const result: Record<string, any[]> = {};
    for (const t of tables) {
      result[t.name] = this.prepare(`SELECT * FROM ${t.name}`).all().results;
    }
    return result as any;
  }
}

export function createTestEnv(extras: Record<string, any> = {}): any {
  const d1 = new D1Mock();
  return { DB: d1, ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-pw", ENVIRONMENT: "test", ...extras, _d1: d1 };
}
