import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

function normalizeParam(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export class SqliteStatement {
  #db;
  #sql;
  #params = [];

  constructor(db, sql) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...params) {
    this.#params = params.map(normalizeParam);
    return this;
  }

  run() {
    const stmt = this.#db.prepare(this.#sql);
    const info = stmt.run(...this.#params);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowId)
      }
    };
  }

  all() {
    const stmt = this.#db.prepare(this.#sql);
    return { results: stmt.all(...this.#params), success: true };
  }

  first() {
    const stmt = this.#db.prepare(this.#sql);
    return stmt.get(...this.#params) ?? null;
  }

  raw() {
    const stmt = this.#db.prepare(this.#sql);
    return stmt.all(...this.#params).map((row) => Object.values(row));
  }
}

export class SqliteDatabase {
  #db;

  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA busy_timeout = 5000");
  }

  prepare(sql) {
    return new SqliteStatement(this.#db, sql);
  }

  exec(sql) {
    this.#db.exec(sql);
    return { success: true };
  }

  batch(statements) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.#db.close();
  }
}

export function createSqliteDb(path = process.env.DATABASE_PATH || "./data/taskcheck.sqlite") {
  return new SqliteDatabase(path);
}
