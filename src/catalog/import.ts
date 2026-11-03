import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import type { Store } from "../storage/index.js";
import type { WorkerDefinitionSpec } from "../types.js";
import { validateWorkerTools } from "../worker/definition.js";

/** Parse YAML-ish frontmatter from SKILL.md (name + description only). */
export function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("SKILL.md missing frontmatter");
  }
  const fm = match[1]!;
  const body = match[2]!;
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description) {
    throw new Error("SKILL.md frontmatter requires name and description");
  }
  return { name, description, body };
}

function walkFiles(
  dir: string,
  base = dir,
): { path: string; abs: string; mode: number }[] {
  const out: { path: string; abs: string; mode: number }[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else {
      out.push({
        path: relative(base, abs).split("\\").join("/"),
        abs,
        mode: st.mode & 0o777,
      });
    }
  }
  return out;
}

export function importDefinitionFile(
  store: Store,
  filePath: string,
): WorkerDefinitionSpec {
  const spec = JSON.parse(readFileSync(filePath, "utf8")) as WorkerDefinitionSpec;
  if (!spec.id || !spec.systemPrompt || !Array.isArray(spec.tools)) {
    throw new Error(`Invalid worker definition: ${filePath}`);
  }
  validateWorkerTools(spec);
  store.catalog.upsertDefinition(spec, true);
  return spec;
}

export function importSkillDir(store: Store, skillDir: string): string {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    throw new Error(`No SKILL.md in ${skillDir}`);
  }
  const raw = readFileSync(skillMd, "utf8");
  const { name, description } = parseSkillFrontmatter(raw);
  store.catalog.upsertSkill(name, description);
  const files = walkFiles(skillDir).map((f) => ({
    path: f.path,
    content: readFileSync(f.abs),
    mode: f.mode,
  }));
  store.catalog.replaceSkillFiles(name, files);
  return name;
}

/** Import seed/definitions/*.json and each seed/skills/<name>/ directory. */
export function importSeed(
  store: Store,
  seedRoot: string,
): { definitions: string[]; skills: string[] } {
  const definitions: string[] = [];
  const skills: string[] = [];

  const defDir = join(seedRoot, "definitions");
  if (existsSync(defDir)) {
    for (const name of readdirSync(defDir)) {
      if (!name.endsWith(".json")) continue;
      const spec = importDefinitionFile(store, join(defDir, name));
      definitions.push(spec.id);
    }
  }

  const skillsDir = join(seedRoot, "skills");
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const dir = join(skillsDir, name);
      if (!statSync(dir).isDirectory()) continue;
      skills.push(importSkillDir(store, dir));
    }
  }

  return { definitions, skills };
}

/** Snapshot skill files for a task into tasks/<id>/skills/. */
export function snapshotSkillsForTask(
  store: Store,
  skillNames: string[],
  destRoot: string,
): void {
  mkdirSync(destRoot, { recursive: true });
  for (const name of skillNames) {
    const files = store.catalog.getSkillFiles(name);
    for (const f of files) {
      const target = join(destRoot, name, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
      try {
        chmodSync(target, f.mode);
      } catch {
        /* ignore on platforms without chmod */
      }
    }
  }
}
