import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryApp } from "./helpers/harness.js";

describe("fixture flow", () => {
  it("console → router → worker → completed delivery", async () => {
    const h = temporaryApp();
    const { app } = h;
    try {
      await app.start();
      const submitted = app.submitConsole({
        text: "fix the flaky login test",
      });
      assert.equal(submitted.duplicate, false);
      assert.equal(submitted.decision?.kind, "router");

      // Drive until task completes (router + worker + delivery)
      for (let i = 0; i < 20; i++) {
        await app.pump();
        const tasks = app.store.tasks.list();
        if (tasks.some((t) => t.status === "completed")) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const tasks = app.store.tasks.list();
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.status, "completed");
      assert.ok(tasks[0]!.result?.notice.includes("fix the flaky login test"));

      const objective = join(tasks[0]!.workspacePath, "OBJECTIVE.md");
      assert.ok(existsSync(objective), "OBJECTIVE.md written");
      assert.match(readFileSync(objective, "utf8"), /flaky login/);

      const origin = app.store.triggers.get(tasks[0]!.originTriggerId);
      assert.ok(origin?.threadId);
      const deliveries = app.store.deliveries.listByTarget(
        "console",
        origin!.threadId!,
      );
      assert.ok(deliveries.some((d) => d.status === "sent"));

      const journal = app.events.list(tasks[0]!.id);
      assert.ok(journal.some((e) => e.kind === "tool"));
    } finally {
      await h.close();
    }
  });
});
