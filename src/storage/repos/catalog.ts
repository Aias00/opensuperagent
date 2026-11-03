import type { Db } from "../db.js";
import { row, rows } from "../db.js";
import type { SkillFile, SkillMeta, WorkerDefinitionSpec } from "../../types.js";
import { validateWorkerTools } from "../../worker/definition.js";
import { nowIso } from "../../ids.js";

export class CatalogRepo {
  constructor(private readonly db: Db) {}

  upsertDefinition(spec: WorkerDefinitionSpec, active = true): void {
    validateWorkerTools(spec);
    this.db
      .prepare(
        `INSERT INTO worker_definitions (id, spec, active, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           spec = excluded.spec,
           active = excluded.active,
           updated_at = excluded.updated_at`,
      )
      .run(spec.id, JSON.stringify(spec), active ? 1 : 0, nowIso());
  }

  getDefinition(id: string): WorkerDefinitionSpec | null {
    const r = row<{ spec: string }>(
      this.db
        .prepare("SELECT spec FROM worker_definitions WHERE id = ?")
        .get(id),
    );
    return r ? (JSON.parse(r.spec) as WorkerDefinitionSpec) : null;
  }

  listActiveDefinitions(): WorkerDefinitionSpec[] {
    return rows<{ spec: string }>(
      this.db
        .prepare(
          "SELECT spec FROM worker_definitions WHERE active = 1 ORDER BY id",
        )
        .all(),
    ).map((r) => JSON.parse(r.spec) as WorkerDefinitionSpec);
  }

  upsertSkill(name: string, description: string): void {
    this.db
      .prepare(
        `INSERT INTO skills (name, description, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           description = excluded.description,
           updated_at = excluded.updated_at`,
      )
      .run(name, description, nowIso());
  }

  replaceSkillFiles(
    skillName: string,
    files: Omit<SkillFile, "skillName">[],
  ): void {
    this.db
      .prepare("DELETE FROM skill_files WHERE skill_name = ?")
      .run(skillName);
    const stmt = this.db.prepare(
      `INSERT INTO skill_files (skill_name, path, content, mode)
       VALUES (?, ?, ?, ?)`,
    );
    for (const f of files) {
      stmt.run(skillName, f.path, f.content, f.mode);
    }
  }

  listSkills(): SkillMeta[] {
    return rows<{ name: string; description: string; updated_at: string }>(
      this.db
        .prepare(
          "SELECT name, description, updated_at FROM skills ORDER BY name",
        )
        .all(),
    ).map((r) => ({
      name: r.name,
      description: r.description,
      updatedAt: r.updated_at,
    }));
  }

  getSkillFiles(skillName: string): SkillFile[] {
    return rows<{
      skill_name: string;
      path: string;
      content: Uint8Array | Buffer;
      mode: number;
    }>(
      this.db
        .prepare(
          "SELECT skill_name, path, content, mode FROM skill_files WHERE skill_name = ?",
        )
        .all(skillName),
    ).map((r) => ({
      skillName: r.skill_name,
      path: r.path,
      content: Buffer.from(r.content),
      mode: r.mode,
    }));
  }
}
