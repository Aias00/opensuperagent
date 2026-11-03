import { it } from "node:test";
import assert from "node:assert/strict";
import { pizzaHarness } from "./helpers/pizza.js";

it("Pizza rejects malformed submissions before side effects and accepts a valid retry", async () => {
  const valid = {
    outcome: "completed",
    notice: "Verified",
    summary: "Validated before execution",
    artifacts: ["verified.txt"],
  };
  const invalid = [
    null,
    [],
    { outcome: "completed", notice: "Missing summary" },
    { ...valid, outcome: "invented" },
    { ...valid, summary: null },
    { ...valid, artifacts: [123] },
    { ...valid, extra: true },
  ];
  let count = 0;
  const h = await pizzaHarness(() => ({
    calls: [
      {
        name: "submit_result",
        args: count < invalid.length ? invalid[count++] : valid,
      },
    ],
  }));
  try {
    const id = h.task();
    await h.app.workerLoop.tick(id);
    assert.deepEqual(h.app.store.tasks.get(id)?.result, valid);
    const results = h.app.events
      .list(id)
      .filter((e) => e.kind === "tool_result");
    assert.equal(
      results.filter((e) => (e.payload as any)?.isError).length,
      invalid.length,
    );
    assert.equal(h.requests.length, invalid.length + 1);
    assert.equal(
      h.app.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM tool_actions WHERE tool='submit_result'",
        )
        .get()?.n,
      1,
    );
  } finally {
    await h.close();
  }
});
