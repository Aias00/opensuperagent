import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export function openStateDb(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

type TxState = { __txDepth?: number };

/** Run fn inside an IMMEDIATE transaction. Nested calls use SAVEPOINT. */
export function withTransaction<T>(db: Db, fn: () => T): T {
  const state = db as unknown as TxState;
  const depth = state.__txDepth ?? 0;

  if (depth > 0) {
    const sp = `sp_${depth}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      state.__txDepth = depth + 1;
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw err;
    } finally {
      state.__txDepth = depth;
    }
  }

  db.exec("BEGIN IMMEDIATE");
  state.__txDepth = 1;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    state.__txDepth = 0;
  }
}

/** Cast node:sqlite `.all()` / `.get()` rows to a typed shape. */
export function rows<T>(result: unknown): T[] {
  return result as T[];
}

export function row<T>(result: unknown): T | undefined {
  return result as T | undefined;
}
