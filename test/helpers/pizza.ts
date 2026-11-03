import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { importSeed } from "../../src/catalog/index.js";
import { httpServer, jsonBody } from "./harness.js";

export type Reply = {
  text?: string;
  finishReason?: string;
  calls?: { name: string; args: unknown; id?: string }[];
};
/** Keep arbitrary result text literal through Pizza's native CLI parser. */
export function resultCommand(value: unknown): string {
  return `_submit_result --json <<'TASK_RESULT'\n${JSON.stringify(value)}\nTASK_RESULT`;
}
export function submitResultCall(args: unknown, id?: string) {
  return { name: "cli", args: { command: resultCommand(args) }, ...(id ? { id } : {}) };
}
export function streamReply(res: ServerResponse, reply: Reply) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const calls = reply.calls?.map((call, index) => ({
    index,
    id: call.id ?? `call-${index}-${Date.now()}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  res.write(
    `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", ...(calls ? { tool_calls: calls } : { content: reply.text ?? "OK" }) }, finish_reason: null }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason ?? (calls ? "tool_calls" : "stop") }], usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}
export async function pizzaHarness(
  respond: (
    body: any,
    res: ServerResponse,
  ) => Reply | Promise<Reply | void> | void,
) {
  const requests: any[] = [];
  const headers: import("node:http").IncomingHttpHeaders[] = [];
  const remote = await httpServer(async (req, res) => {
    const body = await jsonBody(req);
    requests.push(body);
    headers.push(req.headers);
    const reply = await respond(body, res);
    if (reply) streamReply(res, reply);
  });
  const dir = mkdtempSync(join(tmpdir(), "osa-pizza-test-"));
  const config = loadConfig(resolve("config.example.yaml"));
  config.instance.data_root = dir;
  const create = () => new App(config, { legacyLlm: null });
  const app = create();
  importSeed(app.store, resolve("seed"));
  app.settings.saveProvider({
    id: "probe",
    name: "Probe",
    baseUrl: remote.url,
    apiKey: "probe-secret",
    models: ["router", "worker-a", "worker-b"],
    maxTokens: 1024,
  });
  app.settings.saveRouting({
    router: { providerId: "probe", model: "router" },
    worker: { providerId: "probe", model: "worker-a" },
    profiles: {},
  });
  const task = (definition = "coding", objective = "Pizza verification") => {
    const trigger = app.submitConsole({ text: objective }).trigger;
    return app.routerTools.startTask({
      sessionId: "router",
      runId: "fixture",
      toolCallId: `start-${trigger.id}`,
      triggerIds: [trigger.id],
      definition,
      objective,
    }).taskId;
  };
  return {
    app,
    config,
    create,
    dir,
    requests,
    headers,
    task,
    remote,
    async close() {
      await app.stop();
      await remote.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
