import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/index.js";
import { decideRoute } from "../src/ingress/route.js";
import { importSeed } from "../src/catalog/index.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("storage + routing", () => {
  it("migrates and imports seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "osa-"));
    try {
      const store = Store.open(join(dir, "state.sqlite"));
      const imported = importSeed(store, join(root, "seed"));
      assert.ok(imported.definitions.includes("coding"));
      assert.equal(imported.skills.length, 13);
      const coding = store.catalog.getDefinition("coding");
      assert.equal(coding?.id, "coding");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes unique subscription to task", () => {
    const dir = mkdtempSync(join(tmpdir(), "osa-"));
    try {
      const store = Store.open(join(dir, "state.sqlite"));
      importSeed(store, join(root, "seed"));
      const def = store.catalog.getDefinition("coding")!;
      const trigger = store.triggers.insert({
        source: "console",
        externalId: "e1",
        threadId: "thread-a",
        actorId: "owner",
        payloadRef: "x",
        preview: "fix bug",
        status: "routed",
      });
      const task = store.tasks.insert({
        ownerId: "owner",
        objective: "fix bug",
        definition: def,
        originTriggerId: trigger.id,
        workspacePath: join(dir, "ws"),
        status: "active",
      });
      store.tasks.addSubscription(task.id, "thread-a");

      const d = decideRoute(store, { threadId: "thread-a" });
      assert.deepEqual(d, { kind: "task", taskId: task.id });

      const d2 = decideRoute(store, {});
      assert.deepEqual(d2, { kind: "router" });
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
