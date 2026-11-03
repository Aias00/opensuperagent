import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { executeWorkerTool } from "../src/llm/tools-worker.js";
import { temporaryApp } from "./helpers/harness.js";

it("loads Pizza and retains input until a production LLM is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "osa-unconfigured-"));
  const config = loadConfig(resolve("config.example.yaml"));
  config.instance.data_root = dir;
  const app = new App(config, { legacyLlm: null });
  try {
    await app.start();
    assert.equal(app.engineMode, "pizza");
    app.submitConsole({ text: "This input must wait for a configured model" });
    await app.pump();
    assert.equal(app.agentMode, "unconfigured");
    assert.equal(app.store.tasks.list().length, 0);
    assert.equal(app.store.inbox.listPending("router").length, 1);
    assert.equal(app.store.runs.listIncomplete().length, 0);
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects a hallucinated tool call outside the Worker definition at execution time", async () => {
  const h = temporaryApp();
  try {
    const definition = {
      id: "readonly",
      description: "Read only",
      systemPrompt: "Read only",
      modelProfile: "worker-fast",
      tools: ["read", "submit_result"],
      skills: [],
      limits: { maxTurns: 10, maxTokens: 1000 },
    };
    h.app.store.catalog.upsertDefinition(definition);
    const trigger = h.app.submitConsole({ text: "Read-only request" }).trigger;
    const task = h.app.routerTools.startTask({
      sessionId: "router",
      runId: "test",
      toolCallId: "start-readonly",
      triggerIds: [trigger.id],
      definition: "readonly",
      objective: "Read-only request",
    });
    const result = (await executeWorkerTool({
      tools: h.app.workerTools,
      taskId: task.taskId,
      sessionId: "test",
      runId: "test",
      toolCallId: "unauthorized-write",
      name: "write",
      args: { path: "must-not-exist.txt", content: "unauthorized" },
    })) as { error?: string };
    assert.match(result.error ?? "", /not permitted/);
    assert.equal(
      existsSync(
        join(
          h.app.store.tasks.get(task.taskId)!.workspacePath,
          "must-not-exist.txt",
        ),
      ),
      false,
    );
  } finally {
    await h.close();
  }
});

it("remembers a cross-channel conversation when Router forwards its first message to an existing Task", async () => {
  const h = temporaryApp();
  try {
    h.app.settings.saveAdapter("webhook", {
      enabled: true,
      secret: "inbound-test",
      outboundSecret: "outbound-test",
      callbackUrl: "http://127.0.0.1:1/callback",
    });
    const origin = h.app.submitConsole({ text: "Existing goal" }).trigger;
    const task = h.app.routerTools.startTask({
      sessionId: "router",
      runId: "test",
      toolCallId: "start-cross",
      triggerIds: [origin.id],
      definition: "coding",
      objective: "Existing goal",
    });
    const first = h.app.submitExternal({
      source: "webhook",
      externalId: "cross-1",
      threadId: "webhook:cross-channel",
      actorId: "ci",
      preview: "Related external context",
      payload: { text: "Related external context" },
    });
    assert.equal(first.decision?.kind, "router");
    h.app.routerTools.sendToTask({
      sessionId: "router",
      runId: "test",
      toolCallId: "link-cross",
      taskId: task.taskId,
      triggerIds: [first.trigger.id],
    });
    const next = h.app.submitExternal({
      source: "webhook",
      externalId: "cross-2",
      threadId: "webhook:cross-channel",
      actorId: "ci",
      preview: "Follow-up",
      payload: { text: "Follow-up" },
    });
    assert.deepEqual(next.decision, { kind: "task", taskId: task.taskId });
    assert.equal(h.app.store.tasks.list().length, 1);
  } finally {
    await h.close();
  }
});

it("sends one Router reply per incoming message and rejects replaying a prior Run's trigger", async () => {
  const { executeRouterTool } = await import("../src/llm/tools-router.js");
  const h = temporaryApp();
  try {
    const first = h.app.submitConsole({ text: "hihi" }).trigger;
    const session = await h.app.sessions.open("router");
    const batch = h.app.sessions.beginRun("router", () => "hihi")!;
    const reply = (
      runId: string,
      toolCallId: string,
      triggerId: string,
      content: string,
    ) =>
      executeRouterTool({
        tools: h.app.routerTools,
        store: h.app.store,
        sessionId: session.session.id,
        runId,
        toolCallId,
        name: "reply",
        args: { triggerId, content },
      });
    const sent = await reply(batch.run.id, "first-reply", first.id, "Hello");
    const repeated = await reply(
      batch.run.id,
      "model-repeats-reply",
      first.id,
      "Repeated greeting",
    );
    assert.deepEqual(repeated, sent);
    assert.equal(h.app.store.deliveries.listPending().length, 1);
    assert.equal(h.app.store.deliveries.listPending()[0]!.content, "Hello");
    h.app.store.runs.transition(batch.run.id, "pending", "submitted");
    h.app.store.runs.transition(batch.run.id, "submitted", "completed");
    h.app.store.inbox.markDone(batch.items.map((i) => i.id));
    const second = h.app.submitConsole({ text: "haha" }).trigger;
    const next = h.app.sessions.beginRun("router", () => "haha")!;
    const replayed = (await reply(
      next.run.id,
      "history-replays-first-trigger",
      first.id,
      "Old input must not get another reply",
    )) as { error: string };
    assert.match(replayed.error, /current Router Run/);
    await reply(next.run.id, "second-reply", second.id, "Haha");
    assert.equal(h.app.store.deliveries.listPending().length, 2);
  } finally {
    await h.close();
  }
});
