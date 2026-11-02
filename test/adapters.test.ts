import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hmac } from "../src/channels/http.js";
import {
  temporaryApp,
  httpServer,
  deferred,
  delay,
  eventually,
  jsonBody,
} from "./helpers/harness.js";
import type { App } from "../src/app.js";

function configure(app: App, url: string) {
  app.settings.saveAdapter("github", {
    enabled: true,
    token: "github-pat-test",
    webhookSecret: "github-signing-secret",
    repos: ["test/agent-sandbox"],
    actors: ["octocat"],
    mention: "@opensuperagent",
    apiBaseUrl: url,
  });
  app.settings.saveAdapter("feishu", {
    enabled: true,
    receiveMode: "webhook",
    appId: "cli_test",
    appSecret: "feishu-app-secret",
    verificationToken: "verification-test",
    encryptKey: "feishu-encrypt-test",
    chats: ["oc_test"],
    actors: ["ou_user"],
    botOpenId: "ou_bot",
    apiBaseUrl: url + "/open-apis",
  });
  app.settings.saveAdapter("webhook", {
    enabled: true,
    secret: "webhook-inbound-secret",
    callbackUrl: url + "/callback",
    outboundSecret: "webhook-outbound-secret",
  });
}
function github(
  id: string,
  number: number,
  text = "@opensuperagent 请验证登录流程",
) {
  const body = {
    action: "created",
    issue: {
      number,
      title: "Login request",
      pull_request: {
        url: "https://api.github.com/repos/test/agent-sandbox/pulls/" + number,
      },
    },
    comment: {
      id: Number(id.replace(/\D/g, "")) || 1,
      body: text,
      user: { login: "octocat", type: "User" },
    },
    repository: { full_name: "test/agent-sandbox", private: true },
    sender: { login: "octocat", id: 1, type: "User" },
  };
  const raw = JSON.stringify(body);
  return {
    path: "/hooks/github",
    raw,
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issue_comment",
      "X-GitHub-Delivery": id,
      "X-Hub-Signature-256": hmac("github-signing-secret", raw),
    },
  };
}
function feishu(id: string, root: string, chatType = "group") {
  const body = {
    schema: "2.0",
    header: {
      event_id: id,
      event_type: "im.message.receive_v1",
      create_time: String(Date.now()),
      token: "verification-test",
      app_id: "cli_test",
      tenant_key: "tenant_test",
    },
    event: {
      sender: {
        sender_id: { open_id: "ou_user", user_id: "user_1" },
        sender_type: "user",
        tenant_key: "tenant_test",
      },
      message: {
        message_id: "om_" + id,
        root_id: chatType === "p2p" ? undefined : root,
        parent_id: chatType === "p2p" ? undefined : root,
        chat_id: "oc_test",
        chat_type: chatType,
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 请检查并发消息 " + id }),
        mentions: [
          {
            key: "@_user_1",
            id: { open_id: "ou_bot" },
            name: "OpenSuperAgent",
          },
        ],
      },
    },
  };
  const iv = randomBytes(16),
    cipher = createCipheriv(
      "aes-256-cbc",
      createHash("sha256").update("feishu-encrypt-test").digest(),
      iv,
    );
  const encrypted = Buffer.concat([
    iv,
    cipher.update(JSON.stringify(body)),
    cipher.final(),
  ]).toString("base64");
  const raw = JSON.stringify({ encrypt: encrypted });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce-" + id;
  return {
    path: "/hooks/feishu",
    raw,
    headers: {
      "Content-Type": "application/json",
      "X-Lark-Request-Timestamp": timestamp,
      "X-Lark-Request-Nonce": nonce,
      "X-Lark-Signature": createHash("sha256")
        .update(timestamp + nonce + "feishu-encrypt-test" + raw)
        .digest("hex"),
    },
  };
}
function webhook(id: string, threadId: string) {
  const raw = JSON.stringify({
    id,
    threadId,
    actorId: "ci",
    text: "验证发布流程 " + id,
    callbackUrl: "http://127.0.0.1:1/attacker",
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    path: "/hooks/webhook",
    raw,
    headers: {
      "Content-Type": "application/json",
      "X-OSA-Timestamp": timestamp,
      "X-OSA-Signature": hmac("webhook-inbound-secret", `${timestamp}.${raw}`),
    },
  };
}
async function post(url: string, event: ReturnType<typeof github>) {
  return fetch(url + event.path, {
    method: "POST",
    headers: event.headers,
    body: event.raw,
  });
}

describe("native adapters over HTTP", () => {
  it("accepts 54 concurrent deliveries as 18 unique messages, coalesces 9 conversations, and returns results through all transports", async () => {
    const routerGate = deferred();
    let active = 0,
      maxActive = 0;
    const callbacks: any[] = [];
    let tokens = 0;
    const remote = await httpServer(async (req, res) => {
      const body = await jsonBody(req);
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/open-apis/auth/v3/tenant_access_token/internal") {
        tokens++;
        assert.equal(body.app_secret, "feishu-app-secret");
        res.end(
          JSON.stringify({
            code: 0,
            tenant_access_token: "tenant-token",
            expire: 7200,
          }),
        );
        return;
      }
      if (req.url === "/callback") {
        const timestamp = String(req.headers["x-osa-timestamp"]);
        assert.equal(
          req.headers["x-osa-signature"],
          hmac(
            "webhook-outbound-secret",
            `${timestamp}.${JSON.stringify(body)}`,
          ),
        );
        assert.equal(req.headers["idempotency-key"], body.id);
      }
      callbacks.push({ path: req.url, body, headers: req.headers });
      await delay(20);
      res.end(
        JSON.stringify(
          req.url?.includes("/im/v1/messages/")
            ? { code: 0, data: { message_id: "om_sent_" + callbacks.length } }
            : { id: "reply_" + callbacks.length },
        ),
      );
    });
    const h = temporaryApp((factory) => async (input) => {
      const handle = await factory(input);
      return {
        ...handle,
        prompt: async (text) => {
          if (input.session.owner === "router") await routerGate.promise;
          else {
            active++;
            maxActive = Math.max(maxActive, active);
            await delay(40);
          }
          try {
            await handle.prompt(text);
          } finally {
            if (input.session.owner !== "router") active--;
          }
        },
      };
    });
    configure(h.app, remote.url);
    await h.app.start();
    await h.api.start();
    try {
      const events = [];
      for (let i = 0; i < 6; i++)
        events.push(
          github("gh-" + i, 100 + Math.floor(i / 2)),
          feishu("fs-" + i, "om_root_" + Math.floor(i / 2)),
          webhook("wh-" + i, "workflow-" + Math.floor(i / 2)),
        );
      const started = Date.now();
      const responses = await Promise.all(
        events.flatMap((event) => [
          post(h.api.url, event),
          post(h.api.url, event),
          post(h.api.url, event),
        ]),
      );
      assert.ok(
        Date.now() - started < 3000,
        "ACK must not wait for gated Router",
      );
      for (const response of responses) assert.equal(response.status, 200);
      const acknowledgements = (await Promise.all(
        responses.map((r) => r.json()),
      )) as any[];
      assert.equal(acknowledgements.filter((r) => r.duplicate).length, 36);
      assert.equal(
        h.app.store.db.prepare("SELECT COUNT(*) AS n FROM triggers").get()?.n,
        18,
      );
      routerGate.resolve();
      for (let i = 0; i < 200 && callbacks.length < 9; i++) {
        await h.app.pump();
        await delay(10);
      }
      await eventually(
        () =>
          h.app.store.tasks.list().filter((t) => t.status === "completed")
            .length === 9,
      );
      await h.app.delivery.flushPending();
      assert.equal(
        h.app.store.tasks.list().length,
        9,
        "same-conversation messages must not fork duplicate Tasks",
      );
      assert.equal(
        maxActive,
        2,
        "independent Workers must execute concurrently within configured capacity",
      );
      assert.equal(callbacks.length, 9);
      assert.equal(callbacks.filter((c) => c.path === "/callback").length, 3);
      assert.equal(
        callbacks.filter((c) => c.path.includes("/issues/")).length,
        3,
      );
      assert.equal(
        callbacks.filter((c) => c.path.includes("/im/v1/messages/")).length,
        3,
      );
      assert.equal(tokens, 1);
      assert.equal(
        h.app.store.db
          .prepare("SELECT COUNT(*) AS n FROM deliveries WHERE status='sent'")
          .get()?.n,
        9,
      );
      assert.equal(
        h.app.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM inbox WHERE status IN ('pending','accepted')",
          )
          .get()?.n,
        0,
      );
      const persisted = h.app.store.db
        .prepare(
          "SELECT payload_ref FROM triggers WHERE source='feishu' LIMIT 1",
        )
        .get()!;
      assert.ok(
        !readFileSync(
          h.app.paths.blob(String(persisted.payload_ref)),
          "utf8",
        ).includes("verification-test"),
      );
      for (const target of h.app.store.tasks.list())
        assert.equal(
          h.app.store.db
            .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE task_id=?")
            .get(target.id)?.n,
          1,
        );
    } finally {
      routerGate.resolve();
      await h.close();
      await remote.close();
    }
  });
  it("rejects tampering, expired signatures and disallowed actors; handles challenge and stable p2p routing", async () => {
    const h = temporaryApp();
    configure(h.app, "http://127.0.0.1:1");
    await h.api.start();
    try {
      assert.equal(
        hmac("It's a Secret to Everybody", "Hello, World!"),
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      );
      const invalid = github("bad", 1);
      invalid.headers["X-Hub-Signature-256"] = "sha256=bad";
      assert.equal((await post(h.api.url, invalid)).status, 401);
      const actor = github("forbidden", 1);
      const parsed = JSON.parse(actor.raw);
      parsed.sender.login = "intruder";
      actor.raw = JSON.stringify(parsed);
      actor.headers["X-Hub-Signature-256"] = hmac(
        "github-signing-secret",
        actor.raw,
      );
      assert.equal((await post(h.api.url, actor)).status, 403);
      const expired = webhook("expired", "test");
      expired.headers["X-OSA-Timestamp"] = "1";
      assert.equal((await post(h.api.url, expired)).status, 401);
      const fs = feishu("bad-signature", "om_root");
      fs.headers["X-Lark-Signature"] = "invalid";
      assert.equal((await post(h.api.url, fs)).status, 401);
      const challenge = await fetch(h.api.url + "/hooks/feishu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "url_verification",
          token: "verification-test",
          challenge: "challenge-123",
        }),
      });
      assert.deepEqual(await challenge.json(), { challenge: "challenge-123" });
      assert.equal(
        h.app.store.db.prepare("SELECT COUNT(*) AS n FROM triggers").get()?.n,
        0,
      );
      const echoDelivery=h.app.store.deliveries.insert({channel:'github',target:'github:test/agent-sandbox#1',content:'ack',idempotencyKey:'own-echo'});
      const echo=github('own-echo',1,`@opensuperagent acknowledgement <!-- opensuperagent:${echoDelivery.id} -->`);
      const echoResponse=await post(h.api.url,echo);assert.equal(echoResponse.status,200);assert.match(String((await echoResponse.json() as any).ignored),/echo/);
      const first = feishu("p2p-first", "unused", "p2p"),
        second = feishu("p2p-second", "unused", "p2p");
      const a = h.app.adapters.feishu.receive(
        Buffer.from(first.raw),
        Object.fromEntries(
          Object.entries(first.headers).map(([k, v]) => [k.toLowerCase(), v]),
        ),
      );
      const b = h.app.adapters.feishu.receive(
        Buffer.from(second.raw),
        Object.fromEntries(
          Object.entries(second.headers).map(([k, v]) => [k.toLowerCase(), v]),
        ),
      );
      assert.ok("source" in a && "source" in b);
      if ("source" in a && "source" in b) assert.equal(a.threadId, b.threadId);
    } finally {
      await h.close();
    }
  });
  it("queues concurrent follow-ups into the same active Task and resumes them in a new Run", async () => {
    const gate = deferred(),
      entered = deferred();
    let first = true;
    const h = temporaryApp((factory) => async (input) => {
      const handle = await factory(input);
      return {
        ...handle,
        prompt: async (text) => {
          if (input.session.owner !== "router" && first) {
            first = false;
            entered.resolve();
            await gate.promise;
          }
          await handle.prompt(text);
        },
      };
    });
    const remote = await httpServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end('{"id":42}');
    });
    configure(h.app, remote.url);
    await h.app.start();
    await h.api.start();
    try {
      assert.equal((await post(h.api.url, github("initial", 77))).status, 200);
      await eventually(() => h.app.store.tasks.list().length === 1);
      void h.app.pump();
      await eventually(() => !first);
      const task = h.app.store.tasks.list()[0]!;
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          post(h.api.url, github("follow-" + i, 77, "请继续验证并发边界 " + i)),
        ),
      );
      for (const r of responses) {
        assert.equal(r.status, 200);
        const body = (await r.json()) as any;
        assert.equal(body.route.taskId, task.id);
      }
      assert.equal(h.app.store.tasks.list().length, 1);
      assert.equal(h.app.store.inbox.listPending(task.id).length, 30);
      gate.resolve();
      for (
        let i = 0;
        i < 100 && h.app.store.tasks.get(task.id)?.status !== "completed";
        i++
      ) {
        await h.app.pump();
        await delay(10);
      }
      await eventually(
        () => h.app.store.tasks.get(task.id)?.status === "completed",
      );
      const session = h.app.store.sessions.getByOwner(task.id)!;
      assert.equal(
        h.app.store.db
          .prepare("SELECT COUNT(*) AS n FROM runs WHERE session_id=?")
          .get(session.id)?.n,
        2,
      );
      assert.equal(h.app.store.inbox.listPending(task.id).length, 0);
    } finally {
      gate.resolve();
      await h.close();
      await remote.close();
    }
  });
});
