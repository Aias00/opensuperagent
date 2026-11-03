/** Explicit live-model smoke test. Platform endpoints remain isolated local HTTP fixtures. */
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { App } from "../src/app.js";
import { ApiServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { loadLlmConfig } from "../src/llm/client.js";
import { SettingsStore } from "../src/settings/store.js";
import { importSeed } from "../src/catalog/index.js";
import { hmac } from "../src/channels/http.js";
import { httpServer, jsonBody, delay } from "../test/helpers/harness.js";

async function main() {
  const config = loadConfig();
  const current = new SettingsStore(config.instance.data_root, loadLlmConfig());
  if (!current.ready)
    throw new Error(
      "Configure Router and Worker LLM routes before running this explicit live test",
    );
  const router = current.resolve("router");
  const worker = current.resolve("worker", "worker-strong");
  const dir = mkdtempSync(join(tmpdir(), "osa-live-native-"));
  const replies: { channel: string; text: string }[] = [];
  const transport = await httpServer(async (req, res) => {
    const body = await jsonBody(req);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.includes("/auth/v3/tenant_access_token/internal")) {
      res.end(
        JSON.stringify({
          code: 0,
          tenant_access_token: "isolated-token",
          expire: 7200,
        }),
      );
      return;
    }
    const channel = req.url?.includes("/issues/")
      ? "github"
      : req.url?.includes("/im/v1/messages/")
        ? "feishu"
        : "webhook";
    const text =
      channel === "github"
        ? body.body
        : channel === "feishu"
          ? JSON.parse(body.content).text
          : body.text;
    replies.push({ channel, text });
    res.end(
      JSON.stringify(
        channel === "feishu"
          ? {
              code: 0,
              data: { message_id: "om_local_reply_" + replies.length },
            }
          : { id: "local-reply-" + replies.length },
      ),
    );
  });
  config.instance.data_root = dir;
  config.console.listen = "127.0.0.1:0";
  config.router.instructions =
    "This is an isolated transport verification. For each incoming file creation request, create a coding Task. Do not reply directly. Each Worker must write and read the requested file, then _submit_result with the verified file content. Keep each channel in its own Task.";
  const app = new App(config, { legacyLlm: null });
  importSeed(app.store, resolve("seed"));
  const api = new ApiServer(app);
  for (const [id, value] of [
    ["live-router", router],
    ["live-worker", worker],
  ] as const)
    app.settings.saveProvider({
      id,
      name: id,
      protocol: value.protocol ?? "openai-compatible",
      baseUrl: value.baseUrl,
      apiKey: value.apiKey,
      models: [value.routerModel],
      maxTokens: Math.min(4096, value.maxTokens ?? 4096),
    });
  app.settings.saveRouting({
    router: { providerId: "live-router", model: router.routerModel },
    worker: { providerId: "live-worker", model: worker.workerModel },
    profiles: {},
  });
  app.settings.saveAdapter("github", {
    enabled: true,
    apiBaseUrl: transport.url,
    token: "isolated-gh-token",
    webhookSecret: "isolated-gh-secret",
    repos: ["sandbox/opensuperagent"],
    actors: ["test-owner"],
  });
  app.settings.saveAdapter("feishu", {
    receiveMode: "webhook",
    enabled: true,
    apiBaseUrl: transport.url + "/open-apis",
    appId: "cli_isolated",
    appSecret: "isolated-app-secret",
    verificationToken: "isolated-verify",
    chats: ["oc_isolated"],
  });
  app.settings.saveAdapter("webhook", {
    enabled: true,
    secret: "isolated-inbound",
    outboundSecret: "isolated-outbound",
    callbackUrl: transport.url + "/callback",
  });
  await app.start();
  await api.start();
  const started = Date.now();
  app.events.on((event) => {
    if (["run_completed", "run_failed", "delivery"].includes(event.kind))
      console.log(`[live] ${event.scope} ${event.kind}`);
  });
  try {
    const goal = (channel: string) =>
      `在当前 Task 工作空间创建 verify-${channel}.txt，内容精确为 OSA_${channel.toUpperCase()}_VERIFIED。调用 read 确认内容，再用 cli 的 _submit_result --outcome completed 报告文件名和实际内容。不要运行 shell，也不要修改其他文件。`;
    const github = JSON.stringify({
      action: "created",
      repository: { full_name: "sandbox/opensuperagent" },
      sender: { login: "test-owner", type: "User" },
      issue: { number: 1, title: "OpenSuperAgent verification" },
      comment: { id: 1, body: "@opensuperagent " + goal("github") },
    });
    const feishu = JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "live-fs",
        event_type: "im.message.receive_v1",
        app_id: "cli_isolated",
        token: "isolated-verify",
      },
      event: {
        sender: { sender_type: "user", sender_id: { open_id: "ou_isolated" } },
        message: {
          message_id: "om_isolated",
          chat_id: "oc_isolated",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: goal("feishu") }),
        },
      },
    });
    const webhook = JSON.stringify({
      id: "live-webhook",
      threadId: "live-verification",
      text: goal("webhook"),
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const events = [
      {
        channel: "github",
        body: github,
        headers: {
          "X-GitHub-Event": "issue_comment",
          "X-GitHub-Delivery": "live-gh",
          "X-Hub-Signature-256": hmac("isolated-gh-secret", github),
        },
      },
      { channel: "feishu", body: feishu, headers: {} },
      {
        channel: "webhook",
        body: webhook,
        headers: {
          "X-OSA-Timestamp": timestamp,
          "X-OSA-Signature": hmac(
            "isolated-inbound",
            `${timestamp}.${webhook}`,
          ),
        },
      },
    ];
    const acknowledgements = await Promise.all(
      events.map(async (event) => {
        const time = Date.now();
        const r = await fetch(`${api.url}/hooks/${event.channel}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...event.headers },
          body: event.body,
        });
        if (!r.ok) throw new Error(`${event.channel} ingress HTTP ${r.status}`);
        return { channel: event.channel, ackMs: Date.now() - time };
      }),
    );
    console.log(
      "[live] all three inputs acknowledged; real model execution is running",
    );
    const channels = ["github", "feishu", "webhook"];
    const submittedNotice = (channel: string) =>
      app.store.tasks
        .list()
        .find(
          (task) =>
            app.store.triggers.get(task.originTriggerId)?.source === channel &&
            task.status === "completed",
        )?.result?.notice;
    const verifiedReplies = () =>
      channels.every((channel) => {
        const notice = submittedNotice(channel);
        return (
          !!notice &&
          replies.some((r) => r.channel === channel && r.text.includes(notice))
        );
      });
    while (
      (!verifiedReplies() ||
        app.store.runs.listIncomplete().length > 0 ||
        app.store.deliveries.listPending().length > 0) &&
      Date.now() - started < 240000
    )
      await delay(500);
    const tasks = app.store.tasks.list();
    const evidence = tasks.map((task) => {
      const channel =
        app.store.triggers.get(task.originTriggerId)?.source ?? "unknown";
      const file = join(task.workspacePath, `verify-${channel}.txt`);
      let content = "";
      try {
        content = readFileSync(file, "utf8");
      } catch {}
      return {
        channel,
        status: task.status,
        verified: content === `OSA_${channel.toUpperCase()}_VERIFIED`,
        fileName: `verify-${channel}.txt`,
        sha256: content
          ? createHash("sha256").update(content).digest("hex")
          : null,
      };
    });
    const report = {
      at: new Date().toISOString(),
      transport: "local HTTP fixtures matching native platform protocols",
      llm: "real configured provider",
      engine: app.engineMode,
      routerModel: router.routerModel,
      workerModel: worker.workerModel,
      durationMs: Date.now() - started,
      acknowledgements,
      results: evidence,
      replies: replies.map((r) => ({
        channel: r.channel,
        matchesSubmittedNotice:
          !!submittedNotice(r.channel) &&
          r.text.includes(submittedNotice(r.channel)!),
      })),
      passed:
        app.engineMode === "pizza" &&
        evidence.length === 3 &&
        evidence.every((e) => e.verified && e.status === "completed") &&
        verifiedReplies(),
    };
    mkdirSync(resolve("artifacts/verification"), { recursive: true });
    writeFileSync(
      resolve("artifacts/verification/native-live-result.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await api.stop();
    await app.stop();
    await transport.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
