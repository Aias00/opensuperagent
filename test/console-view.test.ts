import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ConsoleView } from "../src/api/console-view.js";
import { importSeed } from "../src/catalog/index.js";

describe("console read models", () => {
  it("preserves cross-channel routes, run order and task-specific delivery attribution", () => {
    const dir = mkdtempSync(join(tmpdir(), "osa-console-"));
    const config = loadConfig(resolve("config.example.yaml"));
    config.instance.data_root = dir;
    config.sources.push({ source: "feishu" });
    const app = new App(config);
    try {
      const store = app.store;
      importSeed(store, resolve("seed"));
      const trigger = store.triggers.insert({
        source: "feishu",
        externalId: "message-1",
        threadId: "shared-thread",
        actorId: "user",
        payloadRef: "test",
        preview: "fix login",
        status: "routed",
      });
      const task = store.tasks.insert({
        ownerId: "user",
        objective: "fix login",
        definition: store.catalog.getDefinition("coding")!,
        originTriggerId: trigger.id,
        workspacePath: join(dir, "workspace"),
        status: "active",
      });
      store.tasks.addSubscription(task.id, "shared-thread");
      const session = store.sessions.ensure(task.id, "events.jsonl");
      const run = store.runs.create(session.id);
      store.inbox.insertOrGet({ target: task.id, triggerId: trigger.id });
      store.db
        .prepare(
          "UPDATE inbox SET run_id = ?, status = 'accepted' WHERE target = ?",
        )
        .run(run.id, task.id);
      const delivery = store.deliveries.insert({
        channel: "feishu",
        target: "shared-thread",
        content: "fixed",
        idempotencyKey: `submit:${session.id}:call1`,
      });
      store.deliveries.insert({
        channel: "feishu",
        target: "shared-thread",
        content: "unrelated task result",
        idempotencyKey: "unrelated",
      });
      store.toolActions.recordOrGet({
        sessionId: session.id,
        runId: run.id,
        toolCallId: "call1",
        tool: "submit_result",
        result: { ok: true, deliveryId: delivery.id },
      });
      store.runs.transition(run.id, "pending", "completed");
      const run2 = store.runs.create(session.id);
      const followup = store.triggers.insert({
        source: "github",
        externalId: "comment-1",
        threadId: "pr-7",
        actorId: "reviewer",
        payloadRef: "test",
        preview: "also cover retries",
        status: "routed",
      });
      store.inbox.insertOrGet({ target: task.id, triggerId: followup.id });
      store.db
        .prepare("UPDATE inbox SET run_id = ? WHERE trigger_id = ?")
        .run(run2.id, followup.id);
      const view = new ConsoleView(app);
      const overview = view.overview();
      assert.equal(overview.tasks[0]?.source, "feishu");
      assert.equal(overview.tasks[0]?.runCount, 2);
      assert.equal(
        overview.sources.find((s) => s.id === "feishu")?.configured,
        false,
      );
      assert.equal(
        overview.sources.find((s) => s.id === "feishu")?.transport,
        "disabled",
      );
      const flow = view.taskFlow(task.id)!;
      assert.deepEqual(
        flow.runs.map((r) => r.id),
        [run.id, run2.id],
      );
      assert.equal(flow.runs[1]?.inputs[0]?.source, "github");
      assert.deepEqual(
        flow.deliveries.map((d) => d.id),
        [delivery.id],
      );
      assert.equal(flow.subscriptions[0]?.threadId, "shared-thread");
      assert.equal(view.messages("github").total, 1);
      assert.equal(
        view.messages("github").messages[0]?.routes[0]?.target,
        task.id,
      );
      assert.equal(view.messages("github", 100).messages.length, 0);
      assert.equal(view.taskFlow("does-not-exist"), null);
    } finally {
      app.store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
