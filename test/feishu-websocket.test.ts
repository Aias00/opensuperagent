import { it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import protobuf from "protobufjs";
import { FeishuConnection } from "../src/channels/feishu-connection.js";
import { temporaryApp, eventually, jsonBody } from "./helpers/harness.js";

// Feishu pbbp2 frame wire contract used by the official SDK.
const Frame = protobuf
  .parse(
    `syntax = "proto2";
message Header { required string key = 1; required string value = 2; }
message Frame { required uint64 SeqID = 1; required uint64 LogID = 2; required int32 service = 3; required int32 method = 4; repeated Header headers = 5; optional string payloadEncoding = 6; optional string payloadType = 7; optional bytes payload = 8; optional string LogIDNew = 9; }`,
  )
  .root.lookupType("Frame");

it("uses the real Feishu SDK over WebSocket: durable ACK, concurrent deduplication, fragments, retry, reconnect, rotation and shutdown", async () => {
  const h = temporaryApp();
  const appId = "cli_0123456789abcdef";
  const secrets: string[] = [];
  let port = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/callback/ws/endpoint");
    const body = await jsonBody(req);
    assert.equal(body.AppID, appId);
    secrets.push(body.AppSecret);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        code: 0,
        data: {
          URL: `ws://127.0.0.1:${port}/events?ticket=private-ws-ticket&device_id=test-device&service_id=1`,
          ClientConfig: {
            PingInterval: 60,
            ReconnectCount: 5,
            ReconnectInterval: 0.01,
            ReconnectNonce: 0,
          },
        },
      }),
    );
  });
  const sockets = new WebSocketServer({ server });
  const connections: WebSocket[] = [];
  const acks: { id: string; code: number }[] = [];
  sockets.on("connection", (socket) => {
    connections.push(socket);
    socket.on("message", (raw) => {
      const frame = Frame.decode(raw as Buffer) as any;
      if (frame.method !== 1) return;
      const headers = Object.fromEntries(
        frame.headers.map((x: any) => [x.key, x.value]),
      );
      const response = JSON.parse(Buffer.from(frame.payload).toString());
      acks.push({ id: headers.message_id, code: response.code });
      if (response.code === 200 && headers.message_id !== "denied") {
        const eventId = headers.message_id.startsWith("retry")
          ? "retry-event"
          : "event-" + headers.message_id.split("-")[1];
        assert.ok(
          h.app.store.triggers.findByExternal("feishu", eventId),
          "SDK ACK must follow durable ingress",
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  let failOnce = true;
  const connection = new FeishuConnection(
    h.app.settings,
    h.app.adapters.feishu,
    (input) => {
      if (input.externalId === "retry-event" && failOnce) {
        failOnce = false;
        throw new Error("Simulated persistence failure");
      }
      h.app.submitExternal(input);
    },
    h.app.events,
  );
  const body = (id: string, chat = "oc_test") => ({
    schema: "2.0",
    header: {
      app_id: appId,
      event_id: id,
      event_type: "im.message.receive_v1",
    },
    event: {
      sender: { sender_id: { open_id: "ou_user" }, sender_type: "user" },
      message: {
        message_id: `om_${id}`,
        chat_id: chat,
        chat_type: "group",
        root_id: "om_root",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 verify native event" }),
        mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
      },
    },
  });
  const send = (id: string, data: unknown, fragmented = false) => {
    const payload = Buffer.from(JSON.stringify(data));
    const parts = fragmented
      ? [payload.subarray(0, 40), payload.subarray(40)]
      : [payload];
    for (let i = parts.length - 1; i >= 0; i--)
      connections.at(-1)!.send(
        Frame.encode({
          SeqID: 1,
          LogID: 1,
          service: 1,
          method: 1,
          headers: Object.entries({
            type: "event",
            message_id: id,
            sum: String(parts.length),
            seq: String(i),
            trace_id: "test-trace",
          }).map(([key, value]) => ({ key, value })),
          payload: parts[i],
        }).finish(),
      );
  };
  try {
    h.app.settings.saveAdapter("feishu", {
      enabled: true,
      receiveMode: "websocket",
      appId,
      appSecret: "initial-secret",
      chats: ["oc_test"],
      botOpenId: "ou_bot",
      apiBaseUrl: `http://127.0.0.1:${port}/open-apis`,
    });
    connection.reconcile();
    await eventually(() => connection.snapshot().state === "connected");
    assert.throws(
      () => h.app.adapters.feishu.receive(Buffer.from("{}"), {}),
      /HTTP callbacks are disabled/,
    );
    for (let i = 0; i < 10; i++)
      for (let repeat = 0; repeat < 3; repeat++)
        send(`frame-${i}-${repeat}`, body(`event-${i}`), i === 2);
    send("denied", body("denied-event", "oc_outside"));
    await eventually(() => acks.length === 31);
    assert.equal(acks.filter((x) => x.code !== 200).length, 0);
    assert.equal(h.app.store.triggers.listPending().length, 0);
    assert.equal(h.app.store.inbox.listPending("router").length, 10);
    assert.equal(connection.snapshot().ignoredEvents, 1);
    assert.equal(
      h.app.store.triggers.findByExternal("feishu", "denied-event"),
      null,
    );
    send("retry-first", body("retry-event"));
    await eventually(() => acks.length === 32);
    assert.equal(acks.at(-1)!.code, 500);
    send("retry-second", body("retry-event"));
    await eventually(() => acks.length === 33);
    assert.equal(acks.at(-1)!.code, 200);
    connections.at(-1)!.terminate();
    await eventually(
      () =>
        connections.length === 2 && connection.snapshot().state === "connected",
    );
    h.app.settings.saveAdapter("feishu", { appSecret: "rotated-secret" });
    connection.reconcile();
    await eventually(
      () =>
        connections.length === 3 && connection.snapshot().state === "connected",
    );
    assert.deepEqual(secrets, [
      "initial-secret",
      "initial-secret",
      "rotated-secret",
    ]);
    assert.ok(
      !/initial-secret|rotated-secret|private-ws-ticket/.test(
        JSON.stringify(connection.snapshot()),
      ),
    );
    h.app.settings.saveAdapter("feishu", { enabled: false });
    connection.reconcile();
    await eventually(() =>
      [...sockets.clients].every((s) => s.readyState === WebSocket.CLOSED),
    );
    assert.equal(connection.snapshot().state, "disabled");
    assert.equal(connection.snapshot().receivedEvents, 31);
  } finally {
    connection.stop();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await h.close();
  }
});
