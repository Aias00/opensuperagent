import { it } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../src/channels/http.js";
import { temporaryApp, delay } from "./helpers/harness.js";
it("serializes one destination, delivers different destinations concurrently, and recovers uncertain sends without retry", async () => {
  const h = temporaryApp();
  let active = 0,
    max = 0;
  const calls: string[] = [];
  const perTarget = new Map<string, number>();
  const service = h.app.delivery;
  service.register({
    name: "probe",
    async send(d) {
      assert.equal(perTarget.get(d.target) ?? 0, 0);
      perTarget.set(d.target, 1);
      active++;
      max = Math.max(max, active);
      calls.push(d.content);
      await delay(15);
      active--;
      perTarget.set(d.target, 0);
      if (d.content === "timeout") throw new Error("network disconnected");
      if (d.content === "rejected")
        throw new HttpError(400, "definitive rejection");
      return { externalMessageId: d.id };
    },
  });
  try {
    for (const [target, content] of [
      ["a", "a1"],
      ["a", "a2"],
      ["b", "b1"],
      ["c", "timeout"],
      ["c", "after-timeout"],
      ["d", "rejected"],
    ])
      service.enqueue({
        channel: "probe",
        target: target!,
        content: content!,
        idempotencyKey: content!,
      });
    await Promise.all(Array.from({ length: 20 }, () => service.flushPending()));
    assert.equal(
      h.app.store.deliveries.findByKey("after-timeout")?.status,
      "pending",
    );
    assert.equal(calls.length, 5);
    assert.ok(max >= 3);
    assert.ok(calls.indexOf("a1") < calls.indexOf("a2"));
    assert.equal(
      h.app.store.deliveries.findByKey("timeout")?.status,
      "unknown",
    );
    assert.equal(
      h.app.store.deliveries.findByKey("rejected")?.status,
      "failed",
    );
    const interrupted = service.enqueue({
      channel: "probe",
      target: "e",
      content: "interrupted",
      idempotencyKey: "interrupted",
    });
    h.app.store.deliveries.markStatus(interrupted.id, "pending", "sending");
    assert.equal(service.recoverInterrupted(), 1);
    await service.flushPending();
    assert.equal(calls.length, 5);
    assert.equal(h.app.store.deliveries.get(interrupted.id)?.status, "unknown");
    await h.api.start();
    const timeoutId = h.app.store.deliveries.findByKey("timeout")!.id;
    const confirmed = await fetch(
      h.api.url + `/api/deliveries/${timeoutId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed" }),
      },
    );
    assert.equal(confirmed.status, 200);
    await service.flushPending();
    assert.ok(calls.includes("after-timeout"));
    assert.equal(calls.filter((c) => c === "timeout").length, 1);
  } finally {
    await h.close();
  }
});
