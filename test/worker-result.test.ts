import { it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { pizzaHarness, submitResultCall } from "./helpers/pizza.js";

it("continues a text-only Worker turn and completes through a later result submission", async () => {
  let calls = 0;
  const h = await pizzaHarness(() =>
    ++calls === 1
      ? { text: "The analysis is ready." }
      : {
          calls: [
            submitResultCall(
              {
                outcome: "completed",
                notice: "Done",
                summary: "Verified analysis",
              },
              "final-result",
            ),
          ],
        },
  );
  try {
    const id = h.task();
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "active");
    assert.equal(h.app.store.inbox.listPending(id).length, 1);
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "completed");
    assert.equal(
      h.app.store.tasks.get(id)!.result!.summary,
      "Verified analysis",
    );
    assert.equal(calls, 2);
  } finally {
    await h.close();
  }
});

it("persists the result-repair budget across restart and fails clearly after two follow-ups", async () => {
  const h = await pizzaHarness(() => ({
    text: "I am done, but forgot the result command.",
  }));
  let restarted: ReturnType<typeof h.create> | undefined;
  let originalStopped = false;
  try {
    const id = h.task();
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "active");
    await h.app.stop();
    originalStopped = true;
    restarted = h.create();
    await restarted.sessions.recoverIncomplete();
    await restarted.workerLoop.tick(id);
    assert.equal(restarted.store.tasks.get(id)!.status, "active");
    await restarted.workerLoop.tick(id);
    assert.equal(restarted.store.tasks.get(id)!.status, "failed");
    assert.match(
      restarted.store.tasks.get(id)!.result!.summary,
      /未提交任务结果/,
    );
    assert.equal(restarted.store.inbox.listPending(id).length, 0);
    assert.equal(await restarted.workerLoop.tick(id), false);
    assert.equal(h.requests.length, 3);
  } finally {
    await restarted?.stop();
    if (originalStopped) {
      await h.remote.close();
      rmSync(h.dir, { recursive: true, force: true });
    } else await h.close();
  }
});

it("reserves waiting for explicit needs_input and does not reuse an older request for input", async () => {
  let round = 0;
  const h = await pizzaHarness(() => {
    round++;
    if (round === 2) return { text: "Thanks; I have enough information now." };
    return {
      calls: [
        submitResultCall(
          {
            outcome: round === 1 ? "needs_input" : "completed",
            notice: round === 1 ? "Which format?" : "Done",
            summary:
              round === 1 ? "Please choose a format" : "Markdown is ready",
          },
          `result-${round}`,
        ),
      ],
    };
  });
  try {
    const id = h.task();
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "waiting");
    assert.equal(h.app.store.inbox.listPending(id).length, 0);
    assert.equal(await h.app.workerLoop.tick(id), false);
    h.app.submitConsole({ taskId: id, text: "Use Markdown" });
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "active");
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "completed");
    assert.equal(round, 3);
  } finally {
    await h.close();
  }
});

it("marks interrupted model execution failed and allows an explicit retry in the same workspace", async () => {
  let retry = false;
  const h = await pizzaHarness(() =>
    retry
      ? {
          calls: [
            submitResultCall(
              { outcome: "completed", notice: "Done", summary: "Recovered" },
              "retry-result",
            ),
          ],
        }
      : { text: "Truncated response", finishReason: "length" },
  );
  try {
    const id = h.task();
    const workspace = h.app.store.tasks.get(id)!.workspacePath;
    await assert.rejects(h.app.workerLoop.tick(id), /length limit/);
    assert.equal(h.app.store.tasks.get(id)!.status, "failed");
    assert.ok(h.app.store.tasks.get(id)!.result?.summary);
    retry = true;
    const message = h.app.submitConsole({
      taskId: id,
      text: "Retry this task",
    });
    assert.deepEqual(message.decision, { kind: "task", taskId: id });
    assert.equal(h.app.store.tasks.get(id)!.status, "pending");
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "completed");
    assert.equal(h.app.store.tasks.get(id)!.workspacePath, workspace);
    assert.equal(h.requests.length, 2);
  } finally {
    await h.close();
  }
});

it("recovers legacy waiting tasks that never submitted a result without duplicating the recovery input", async () => {
  const h = await pizzaHarness(() => ({
    calls: [
      submitResultCall(
        {
          outcome: "completed",
          notice: "Done",
          summary: "Recovered legacy task",
        },
        "legacy-result",
      ),
    ],
  }));
  try {
    const id = h.task();
    const batch = h.app.sessions.beginRun(id, () => "Legacy input")!;
    h.app.store.runs.transition(batch.run.id, "pending", "submitted");
    h.app.store.runs.transition(batch.run.id, "submitted", "completed");
    h.app.store.inbox.markDone(batch.items.map((item) => item.id));
    h.app.store.tasks.transition(id, "pending", "waiting");
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "active");
    assert.equal(h.app.store.inbox.listPending(id).length, 1);
    await h.app.workerLoop.tick(id);
    assert.equal(h.app.store.tasks.get(id)!.status, "completed");
    assert.equal(h.requests.length, 1);
  } finally {
    await h.close();
  }
});
