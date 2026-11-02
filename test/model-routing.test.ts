import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { App } from "../src/app.js";
import { ApiServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { importSeed } from "../src/catalog/index.js";
import {
  deferred,
  httpServer,
  eventually,
  delay,
  jsonBody,
} from "./helpers/harness.js";

it("hot-swaps the next Worker model while a slow existing Worker keeps its model; Router and new messages remain responsive", async () => {
  const gate = deferred();
  const requests: any[] = [];
  let held = false;
  const remote = await httpServer(async (req, res) => {
    const body = await jsonBody(req);
    requests.push(body);
    res.setHeader("Content-Type", "application/json");
    const isInitial = body.messages.at(-1)?.role === "user";
    let message: any = { role: "assistant", content: "OK" };
    if (body.model === "router-model" && isInitial) {
      const ids = [
        ...String(body.messages.at(-1).content).matchAll(
          /trigger=(trg_[a-f0-9]+)/g,
        ),
      ].map((m) => m[1]);
      message = {
        role: "assistant",
        content: null,
        tool_calls: ids.map((id, i) => ({
          id: `router-${requests.length}-${i}`,
          type: "function",
          function: {
            name: "start_task",
            arguments: JSON.stringify({
              triggerIds: [id],
              definition: "coding",
              objective: "Model routing verification",
            }),
          },
        })),
      };
    } else if (body.model !== "router-model" && isInitial) {
      if (body.model === "worker-a") {
        held = true;
        await gate.promise;
      }
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `worker-${requests.length}`,
            type: "function",
            function: {
              name: "submit_result",
              arguments: JSON.stringify({
                outcome: "completed",
                notice: "Verified",
                summary: "Protocol routing verified",
              }),
            },
          },
        ],
      };
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message,
            finish_reason: message.tool_calls ? "tool_calls" : "stop",
          },
        ],
      }),
    );
  });
  const dir = mkdtempSync(join(tmpdir(), "osa-model-routing-"));
  const config = loadConfig(resolve("config.example.yaml"));
  config.instance.data_root = dir;
  config.console.listen = "127.0.0.1:0";
  const app = new App(config, { legacyLlm: null });
  importSeed(app.store, resolve("seed"));
  const api = new ApiServer(app);
  app.settings.saveProvider({
    id: "probe",
    name: "Probe provider",
    baseUrl: remote.url,
    apiKey: "probe-key",
    models: ["router-model", "worker-a", "worker-b"],
  });
  app.settings.saveRouting({
    router: { providerId: "probe", model: "router-model" },
    worker: { providerId: "probe", model: "worker-a" },
    profiles: {},
  });
  await app.start();
  await api.start();
  const submit = async (text: string) =>
    fetch(api.url + "/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  try {
    await submit("first " + "详细上下文".repeat(80) + " END_OF_FULL_INPUT");
    for (let i = 0; i < 40 && !held; i++) {
      void app.pump();
      await delay(10);
    }
    await eventually(() => held);
    const change = await fetch(api.url + "/api/settings/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        router: { providerId: "probe", model: "router-model" },
        worker: { providerId: "probe", model: "worker-b" },
        profiles: {},
      }),
    });
    assert.equal(change.status, 200);
    assert.equal((await submit("second independent goal")).status, 201);
    for (
      let i = 0;
      i < 100 && !app.store.tasks.list().some((t) => t.status === "completed");
      i++
    ) {
      void app.pump();
      await delay(10);
    }
    assert.ok(
      app.store.tasks.list().some((t) => t.status === "completed"),
      "second Worker should finish while first Worker is still gated",
    );
    assert.ok(requests.some((r) => r.model === "worker-b"));
    assert.ok(
      requests.some(
        (r) =>
          r.model === "worker-a" &&
          r.messages.some((m: any) =>
            String(m.content).includes("END_OF_FULL_INPUT"),
          ),
      ),
      "full input must survive the 200-character preview limit",
    );
    gate.resolve();
    await eventually(
      () =>
        app.store.tasks.list().filter((t) => t.status === "completed")
          .length === 2 && app.store.runs.listIncomplete().length === 0,
    );
    assert.ok(
      requests.filter((r) => r.model === "worker-a").length >= 2,
      "existing Run keeps the same model through tool iterations",
    );
  } finally {
    gate.resolve();
    await api.stop();
    await app.stop();
    await remote.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
