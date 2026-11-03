import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadSkillsFromDir } from "@tomsun28/pizza";
import { temporaryApp } from "./helpers/harness.js";
import { importDefinitionFile } from "../src/catalog/import.js";

it("imports all specialized Workers with valid tools, useful skills and immutable per-Task snapshots", async () => {
  const h = temporaryApp();
  try {
    const definitions = h.app.store.catalog.listActiveDefinitions();
    const skills = h.app.store.catalog.listSkills();
    assert.equal(definitions.length, 10);
    assert.equal(skills.length, 13);
    const allowed = new Set(["_read", "_write", "_edit", "_skill"]);
    for (const definition of definitions) {
      assert.ok(definition.systemPrompt.length > 50);
      assert.ok(definition.tools.every((tool) => allowed.has(tool)));
      assert.equal(new Set(definition.tools).size, definition.tools.length);
      assert.ok(definition.skills.length > 0);
      for (const name of definition.skills)
        assert.ok(
          skills.some((skill) => skill.name === name),
          `${definition.id} references missing ${name}`,
        );
      const origin = h.app.submitConsole({
        text: `Simulate ${definition.id}`,
      }).trigger;
      const { taskId } = h.app.routerTools.startTask({
        sessionId: "router",
        runId: "catalog-test",
        toolCallId: `start-${definition.id}`,
        triggerIds: [origin.id],
        definition: definition.id,
        objective: `Simulate ${definition.id}`,
      });
      const listed = loadSkillsFromDir({ dir: h.app.paths.taskSkills(taskId), source: "task" }).skills;
      assert.deepEqual(listed.map((skill) => skill.name).sort(), [...definition.skills].sort());
      for (const name of definition.skills) {
        const path = join(h.app.paths.taskSkills(taskId), name, "SKILL.md");
        assert.ok(existsSync(path));
        assert.ok(readFileSync(path, "utf8").includes(name));
      }
      if (definition.id === "data") {
        const path = join(
          h.app.paths.taskSkills(taskId),
          "data-quality/scripts/profile_csv.py",
        );
        const before = readFileSync(path, "utf8");
        h.app.store.catalog.replaceSkillFiles("data-quality", [
          {
            path: "SKILL.md",
            content: Buffer.from("changed catalog"),
            mode: 0o644,
          },
        ]);
        assert.equal(readFileSync(path, "utf8"), before);
      }
    }
  } finally {
    await h.close();
  }
});

it("executes the bundled data-quality script against missing, duplicate and inconsistent CSV rows", async () => {
  const h = temporaryApp();
  try {
    h.app.workspaces.ensureTaskWorkspace("csv-test");
    const { writeFileSync } = await import("node:fs");
    const path = join(h.app.paths.workspace("csv-test"), "fixture.csv");
    const csv = "id,score\na,10\nb,\na,10\nc\n";
    writeFileSync(path, csv);
    const result = JSON.parse(
      execFileSync(
        "python3",
        ["seed/skills/data-quality/scripts/profile_csv.py", path],
        { encoding: "utf8" },
      ),
    );
    assert.equal(result.rows, 4);
    assert.equal(result.duplicate_rows, 1);
    assert.equal(result.blank_by_column.score, 2);
    assert.equal(result.inconsistent_width_rows, 1);
    assert.equal(readFileSync(path, "utf8"), csv);
  } finally {
    await h.close();
  }
});

it("rejects deprecated imported tools with a migration message and leaves the input untouched", async () => {
  const h = temporaryApp();
  try {
    const base = h.app.store.catalog.getDefinition("coding")!;
    for (const tool of ["cli", "read", "exec", "start", "stop", "skill", "submit_result", "_submit_result", "unknown_tool"]) {
      const spec = { ...base, tools: [tool] };
      const path = join(h.dir, `${tool}.json`);
      const content = JSON.stringify(spec);
      writeFileSync(path, content);
      assert.throws(() => importDefinitionFile(h.app.store, path), /obsolete or unsupported|registered automatically/);
      assert.equal(readFileSync(path, "utf8"), content);
      assert.deepEqual(h.app.store.catalog.getDefinition(base.id), base);
    }
  } finally { await h.close(); }
});
