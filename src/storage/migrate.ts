import type { Db } from "./db.js";
import { rows } from "./db.js";
import { MIGRATIONS } from "./migrations.js";
import { nowIso } from "../ids.js";

export function migrate(db: Db): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    rows<{ version: number }>(
      db.prepare("SELECT version FROM schema_migrations").all(),
    ).map((r) => Number(r.version)),
  );

  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(m.version, nowIso());
      db.exec("COMMIT");
      count += 1;
      console.log(`Applied migration ${m.version}: ${m.name}`);
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
  return count;
}
