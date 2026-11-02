import type { IncomingHttpHeaders } from "node:http";
import { createDecipheriv, createHash } from "node:crypto";
import type { SettingsStore } from "../../settings/store.js";
import type { Store } from "../../storage/index.js";
import type { IngressInput, Delivery } from "../../types.js";
import {
  equalSecret,
  fetchJson,
  freshTimestamp,
  HttpError,
  parseBody,
} from "../http.js";
import type { DeliveryChannel } from "../../delivery/index.js";

export class FeishuAdapter implements DeliveryChannel {
  readonly name = "feishu";
  isEnabled() {
    return this.settings.adapters.feishu.enabled;
  }
  private tokenCache: {
    identity: string;
    token: string;
    until: number;
  } | null = null;
  private tokenPending: { identity: string; promise: Promise<string> } | null =
    null;
  constructor(
    private readonly settings: SettingsStore,
    private readonly store: Store,
  ) {}
  receive(
    raw: Buffer,
    headers: IncomingHttpHeaders,
  ): IngressInput | { ignored: string } | { challenge: string } {
    const config = this.settings.adapters.feishu;
    if (!config.enabled) throw new HttpError(503, "Feishu adapter is disabled");
    if (config.receiveMode !== "webhook")
      throw new HttpError(
        503,
        "Feishu uses SDK WebSocket events; HTTP callbacks are disabled",
      );
    let body = parseBody(raw);
    if (body.encrypt) {
      if (!config.encryptKey)
        throw new HttpError(401, "No Feishu encryption key configured");
      try {
        const encrypted = Buffer.from(body.encrypt, "base64");
        const key = createHash("sha256").update(config.encryptKey).digest();
        const decipher = createDecipheriv(
          "aes-256-cbc",
          key,
          encrypted.subarray(0, 16),
        );
        body = parseBody(
          Buffer.concat([
            decipher.update(encrypted.subarray(16)),
            decipher.final(),
          ]),
        );
      } catch {
        throw new HttpError(401, "Invalid encrypted Feishu event");
      }
    }
    if (
      !equalSecret(
        String(body.header?.token ?? body.token ?? ""),
        config.verificationToken,
      )
    )
      throw new HttpError(401, "Invalid Feishu verification token");
    if (body.type === "url_verification") {
      if (typeof body.challenge !== "string")
        throw new HttpError(400, "Missing challenge");
      return { challenge: body.challenge };
    }
    if (config.encryptKey) {
      const timestamp = String(headers["x-lark-request-timestamp"] ?? "");
      const nonce = String(headers["x-lark-request-nonce"] ?? "");
      freshTimestamp(timestamp);
      const signature = createHash("sha256")
        .update(timestamp + nonce + config.encryptKey)
        .update(raw)
        .digest("hex");
      if (
        !nonce ||
        !equalSecret(signature, String(headers["x-lark-signature"] ?? ""))
      )
        throw new HttpError(401, "Invalid Feishu signature");
    }
    return this.normalizeEvent(body);
  }
  /** Only called by the authenticated SDK connection, never by the HTTP endpoint. */
  receiveSdkEvent(
    data: Record<string, any>,
  ): IngressInput | { ignored: string } {
    const config = this.settings.adapters.feishu;
    if (!config.enabled || config.receiveMode !== "websocket")
      throw new HttpError(503, "Feishu SDK connection is disabled");
    return this.normalizeEvent({
      schema: "2.0",
      header: {
        app_id: data.app_id,
        event_id: data.event_id,
        event_type: data.event_type,
      },
      event: { sender: data.sender, message: data.message },
    });
  }
  private normalizeEvent(
    body: Record<string, any>,
  ): IngressInput | { ignored: string } {
    const config = this.settings.adapters.feishu;
    if (body.header?.app_id !== config.appId)
      throw new HttpError(403, "Feishu app ID mismatch");
    if (body.header?.event_type !== "im.message.receive_v1")
      return { ignored: "Unsupported Feishu event" };
    const message = body.event?.message;
    const sender = body.event?.sender;
    if (!message?.message_id || !body.header?.event_id || !message.chat_id)
      throw new HttpError(400, "Incomplete Feishu message event");
    const actor = String(sender?.sender_id?.open_id ?? "");
    if (!config.chats.includes(message.chat_id))
      throw new HttpError(403, "Chat is outside the allowlist");
    if (config.actors.length && !config.actors.includes(actor))
      throw new HttpError(403, "Actor is outside the allowlist");
    if (
      sender?.sender_type !== "user" ||
      (config.botOpenId && actor === config.botOpenId) ||
      this.store.deliveries.hasExternalMessageId(message.message_id)
    )
      return { ignored: "Bot or outbound echo" };
    if (message.message_type !== "text")
      return { ignored: "Only text messages are supported" };
    let text: string;
    try {
      text = JSON.parse(message.content).text;
    } catch {
      throw new HttpError(400, "Invalid Feishu text content");
    }
    if (typeof text !== "string" || !text.trim())
      return { ignored: "Empty message" };
    const root =
      message.chat_type === "p2p"
        ? "p2p"
        : message.root_id || message.parent_id || message.message_id;
    const threadId = `feishu:${message.chat_id}:${root}`;
    const subscribed = this.store.tasks.findOpenByThread(threadId).length > 0;
    const mentioned =
      config.botOpenId &&
      (message.mentions ?? []).some(
        (m: any) => m.id?.open_id === config.botOpenId,
      );
    if (message.chat_type !== "p2p" && !subscribed && !mentioned)
      return { ignored: "Group requests must mention the configured bot" };
    for (const mention of message.mentions ?? [])
      text = text.replaceAll(String(mention.key), "");
    delete body.token;
    if (body.header) delete body.header.token;
    return {
      source: "feishu",
      externalId: String(body.header.event_id),
      actorId: actor,
      threadId,
      preview: text.trim().slice(0, 200),
      payload: {
        text: text.trim(),
        messageId: message.message_id,
        chatId: message.chat_id,
        raw: body,
      },
    };
  }
  private async tenantToken(): Promise<string> {
    const config = this.settings.adapters.feishu;
    const identity = `${config.apiBaseUrl}:${config.appId}:${config.appSecret}`;
    if (
      this.tokenCache?.identity === identity &&
      this.tokenCache.until > Date.now()
    )
      return this.tokenCache.token;
    if (this.tokenPending?.identity === identity)
      return this.tokenPending.promise;
    const pending = (async () => {
      const data = await fetchJson(
        `${config.apiBaseUrl}/auth/v3/tenant_access_token/internal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: config.appId,
            app_secret: config.appSecret,
          }),
        },
      );
      if (data.code !== 0 || !data.tenant_access_token)
        throw new HttpError(
          400,
          `Feishu tenant token request failed (code ${Number(data.code) || "invalid_response"})`,
        );
      this.tokenCache = {
        identity,
        token: data.tenant_access_token,
        until:
          Date.now() + Math.max(0, Number(data.expire ?? 7200) - 60) * 1000,
      };
      return String(data.tenant_access_token);
    })();
    this.tokenPending = { identity, promise: pending };
    try {
      return await pending;
    } finally {
      if (this.tokenPending?.promise === pending) this.tokenPending = null;
    }
  }
  async testCredentials() {
    const config = this.settings.adapters.feishu;
    if (!config.appId || !config.appSecret)
      throw new HttpError(400, "Save Feishu App ID and App Secret first");
    const token = await this.tenantToken();
    const data = await fetchJson(
      `${config.apiBaseUrl}/im/v1/chats?page_size=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    // Never return provider text, tokens, or arbitrary remote fields.
    return {
      ok: true,
      chats:
        data.code === 0 && Array.isArray(data.data?.items)
          ? data.data.items.map((c: any) => ({
              id: String(c.chat_id),
              name: String(c.name ?? ""),
            }))
          : [],
      hasMore: data.data?.has_more === true,
      ...(data.code !== 0
        ? {
            warning: `Chat listing failed (code ${Number(data.code) || "invalid_response"})`,
          }
        : {}),
    };
  }
  async send(delivery: Delivery): Promise<{ externalMessageId: string }> {
    const config = this.settings.adapters.feishu;
    if (!config.enabled) throw new HttpError(503, "Feishu adapter is disabled");
    const match = /^feishu:([^:]+):([^:]+)$/.exec(delivery.target);
    if (!match || !config.chats.includes(match[1]!))
      throw new HttpError(403, "Delivery target is outside the chat allowlist");
    const route = this.store.db
      .prepare(
        "SELECT target FROM channel_routes WHERE channel = 'feishu' AND thread_id = ?",
      )
      .get(delivery.target);
    const messageId = route
      ? (JSON.parse(String(route.target)) as { messageId: string }).messageId
      : match[2]!;
    const token = await this.tenantToken();
    const uuid = createHash("sha256")
      .update(delivery.id)
      .digest("hex")
      .slice(0, 32);
    const data = await fetchJson(
      `${config.apiBaseUrl}/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msg_type: "text",
          content: JSON.stringify({ text: delivery.content }),
          reply_in_thread: true,
          uuid,
        }),
      },
    );
    if (data.code !== 0 || !data.data?.message_id)
      throw new HttpError(
        data.code !== 0 ? 400 : 502,
        `Feishu reply failed (code ${Number(data.code) || "invalid_response"})`,
      );
    return { externalMessageId: data.data.message_id };
  }
}
