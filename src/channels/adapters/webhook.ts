import type { IncomingHttpHeaders } from "node:http";
import type { SettingsStore } from "../../settings/store.js";
import type { IngressInput, Delivery } from "../../types.js";
import {
  freshTimestamp,
  hmac,
  HttpError,
  parseBody,
  verifyHmac,
} from "../http.js";
import type { DeliveryChannel } from "../../delivery/index.js";
export class WebhookAdapter implements DeliveryChannel {
  readonly name = "webhook";
  isEnabled() {
    return this.settings.adapters.webhook.enabled;
  }
  constructor(private readonly settings: SettingsStore) {}
  receive(raw: Buffer, headers: IncomingHttpHeaders): IngressInput | { ignored: string } {
    const config = this.settings.adapters.webhook;
    if (!config.enabled)
      throw new HttpError(503, "Webhook adapter is disabled");
    const timestamp = String(headers["x-osa-timestamp"] ?? "");
    freshTimestamp(timestamp);
    verifyHmac(
      config.secret,
      `${timestamp}.${raw.toString("utf8")}`,
      String(headers["x-osa-signature"] ?? ""),
    );
    const body = parseBody(raw);
    if (body.type === "agent.reply") return { ignored: "Outbound reply echo" };
    if (
      typeof body.id !== "string" ||
      !body.id ||
      body.id.length > 200 ||
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 100000 ||
      typeof body.threadId !== "string" ||
      !body.threadId ||
      body.threadId.length > 200
    )
      throw new HttpError(400, "id, threadId and text are required");
    const actorId = String(body.actorId ?? "webhook");
    if (config.actors.length && !config.actors.includes(actorId))
      throw new HttpError(403, "Actor is outside the allowlist");
    // Incoming payload cannot select an outbound URL or change connector credentials.
    return {
      source: "webhook",
      externalId: body.id,
      threadId: `webhook:${body.threadId}`,
      actorId,
      preview: body.text.slice(0, 200),
      payload: { text: body.text, raw: body },
    };
  }
  async send(delivery: Delivery): Promise<{ externalMessageId: string }> {
    const config = this.settings.adapters.webhook;
    if (
      !config.enabled ||
      !config.callbackUrl ||
      !delivery.target.startsWith("webhook:")
    )
      throw new HttpError(503, "Webhook callback is not configured");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: delivery.id,
      type: "agent.reply",
      threadId: delivery.target.slice(8),
      text: delivery.content,
      createdAt: delivery.createdAt,
    });
    const response = await fetch(config.callbackUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-OSA-Timestamp": timestamp,
        "X-OSA-Signature": hmac(config.outboundSecret, `${timestamp}.${body}`),
        "Idempotency-Key": delivery.id,
      },
      body,
    });
    if (!response.ok)
      throw new HttpError(
        response.status >= 500 ? 502 : 400,
        `Webhook callback returned HTTP ${response.status}`,
      );
    const result = (await response.json().catch(() => ({}))) as { id?: string };
    return { externalMessageId: String(result.id ?? delivery.id) };
  }
}
