import type { Store } from "../storage/index.js";
import type { Delivery } from "../types.js";
import { newId } from "../ids.js";
import { HttpError } from "../channels/http.js";
export interface DeliveryChannel {
  readonly name: string;
  isEnabled?(): boolean;
  send(delivery: Delivery): Promise<{ externalMessageId: string | null }>;
}
export class ConsoleChannel implements DeliveryChannel {
  readonly name = "console";
  async send(delivery: Delivery) {
    return { externalMessageId: `console:${delivery.id}` };
  }
}
export class DeliveryService {
  private readonly channels = new Map<string, DeliveryChannel>();
  private flushing: Promise<number> | null = null;
  constructor(
    private readonly store: Store,
    private readonly onStatus?: (delivery: Delivery, error?: string) => void,
  ) {
    this.register(new ConsoleChannel());
  }
  register(channel: DeliveryChannel) {
    this.channels.set(channel.name, channel);
  }
  recoverInterrupted(): number {
    return Number(
      this.store.db
        .prepare(
          "UPDATE deliveries SET status = 'unknown' WHERE status = 'sending'",
        )
        .run().changes,
    );
  }
  enqueue(input: {
    channel: string;
    target: string;
    content: string;
    idempotencyKey: string;
  }): Delivery {
    return this.store.deliveries.insert(input);
  }
  enqueueForTrigger(input: {
    channel: string;
    target: string;
    content: string;
    originTriggerId: string;
    seq?: number;
  }): Delivery {
    return this.enqueue({
      channel: input.channel,
      target: input.target,
      content: input.content,
      idempotencyKey: `${input.originTriggerId}:${input.target}:${input.seq ?? Date.now()}`,
    });
  }
  flushPending(): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
  private async flush(): Promise<number> {
    const groups = new Map<string, Delivery[]>();
    const blocked = new Set(
      this.store.db
        .prepare(
          "SELECT DISTINCT channel, target FROM deliveries WHERE status IN ('sending','unknown')",
        )
        .all()
        .map((r) => `${r.channel}:${r.target}`),
    );
    for (const delivery of this.store.deliveries.listPending()) {
      if (blocked.has(`${delivery.channel}:${delivery.target}`)) continue;
      const key = `${delivery.channel}:${delivery.target}`;
      groups.set(key, [...(groups.get(key) ?? []), delivery]);
    }
    let sent = 0;
    const queues = [...groups.values()];
    // Preserve ordering in one destination; unrelated destinations progress independently.
    await Promise.all(
      Array.from({ length: Math.min(8, queues.length) }, async () => {
        while (queues.length)
          for (const delivery of queues.shift()!) {
            const channel = this.channels.get(delivery.channel);
            if (channel?.isEnabled && !channel.isEnabled()) break;
            if (
              !this.store.deliveries.markStatus(
                delivery.id,
                "pending",
                "sending",
              )
            )
              continue;
            try {
              if (!channel)
                throw new HttpError(400, "No registered delivery channel");
              const result = await channel.send(delivery);
              this.store.deliveries.markSent(
                delivery.id,
                result.externalMessageId,
              );
              sent++;
              this.onStatus?.(this.store.deliveries.get(delivery.id)!);
            } catch (error) {
              // A timeout/5xx may have happened after the remote side accepted the message.
              const status =
                error instanceof HttpError && error.status < 500
                  ? "failed"
                  : "unknown";
              this.store.deliveries.markStatus(delivery.id, "sending", status);
              this.onStatus?.(
                this.store.deliveries.get(delivery.id)!,
                String(error),
              );
              if (status === "unknown") break;
            }
          }
      }),
    );
    return sent;
  }
}
export function deliverySeqKey(): string {
  return newId("seq");
}
