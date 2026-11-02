import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createMvpFacadeFactory } from "../src/session/mvp-agent.js";

function testConfig(dataRoot: string): AppConfig {
  return {
    instance: { data_root: dataRoot, max_active_tasks: 2 },
    models: { router: "router-profile" },
    router: { instructions: "" },
    execution: {
      exec_timeout_sec: 120,
      default_deadline_sec: 1800,
      max_output_mb: 50,
    },
    supervisor: {
      max_turn_duration_sec: 1200,
      stall_after_sec: 1800,
      interval_sec: 60,
    },
    budget: { daily_cost_usd: 50 },
    console: { listen: "127.0.0.1:0" },
    sources: [{ source: "console" }],
  };
}

describe("mvp flow", () => {
  it("console → router → worker → completed delivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osa-mvp-"));
    // Local secrets must never turn the deterministic MVP test into live LLM calls.
    const app: App = new App(testConfig(dir), {
      facadeFactory: async (options) => createMvpFacadeFactory({
        store: app.store, routerTools: app.routerTools,
        workerTools: app.workerTools, events: app.events,
      })(options),
    });
    try {
      // seed coding definition via catalog
      const { importSeed } = await import("../src/catalog/index.js");
      const { resolve, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      importSeed(app.store, join(root, "seed"));

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
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
