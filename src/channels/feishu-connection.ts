import { EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type { SettingsStore } from "../settings/store.js";
import type { FeishuAdapter } from "./adapters/feishu.js";
import type { IngressInput } from "../types.js";
import type { EventBus } from "../events/bus.js";
import { HttpError } from "./http.js";

type SdkClient = Pick<WSClient, "start" | "close" | "getConnectionStatus">;
export type FeishuWsFactory = (
  options: ConstructorParameters<typeof WSClient>[0],
) => SdkClient;
// SDK debug/error arguments may contain request bodies or short-lived WS tickets.
const quietLogger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
};

/** One authenticated SDK connection per instance; model execution never delays the SDK ACK. */
export class FeishuConnection {
  private client: SdkClient | null = null;
  private identity = "";
  private generation = 0;
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
  private receivedEvents = 0;
  private ignoredEvents = 0;
  constructor(
    private readonly settings: SettingsStore,
    private readonly adapter: FeishuAdapter,
    private readonly accept: (input: IngressInput) => void,
    private readonly events: EventBus,
    private readonly factory: FeishuWsFactory = (options) =>
      new WSClient(options),
  ) {}
  snapshot() {
    const config = this.settings.adapters.feishu;
    const connection = this.client?.getConnectionStatus();
    return {
      mode: config.receiveMode,
      enabled: config.enabled,
      state: !config.enabled
        ? "disabled"
        : config.receiveMode === "webhook"
          ? "webhook"
          : (connection?.state ?? (this.lastError ? "failed" : "idle")),
      reconnectAttempts: connection?.reconnectAttempts ?? 0,
      lastConnectAt: connection?.lastConnectTime
        ? new Date(connection.lastConnectTime).toISOString()
        : null,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      receivedEvents: this.receivedEvents,
      ignoredEvents: this.ignoredEvents,
    };
  }
  reconcile() {
    const config = this.settings.adapters.feishu;
    const identity =
      config.enabled && config.receiveMode === "websocket"
        ? JSON.stringify([config.appId, config.appSecret, config.apiBaseUrl])
        : "";
    if (this.identity === identity) return;
    this.stop();
    this.identity = identity;
    if (!identity) return;
    this.lastError = null;
    const generation = this.generation;
    const current = () => this.generation === generation;
    const changed = (state: string) => {
      if (current())
        this.events.emit({
          scope: "system",
          kind: "connection",
          summary: `Feishu SDK WebSocket ${state}`,
          payload: { channel: "feishu", state },
        });
    };
    const failed = (error: unknown) => {
      if (!current()) return;
      const code = /code[=:]\s*(-?\d+)/i.exec(String(error));
      this.lastError = code
        ? `飞书长连接建立失败（code ${code[1]}）`
        : "飞书长连接建立失败，请检查应用、网络与订阅方式，然后重新连接";
      changed("failed");
    };
    try {
      this.client = this.factory({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: config.apiBaseUrl.replace(/\/open-apis$/, ""),
        autoReconnect: true,
        handshakeTimeoutMs: 15000,
        wsConfig: { pingTimeout: 30 },
        logger: quietLogger,
        onReady: () => {
          if (current()) {
            this.lastError = null;
            changed("connected");
          }
        },
        onError: failed,
        onReconnecting: () => changed("reconnecting"),
        onReconnected: () => {
          if (current()) {
            this.lastError = null;
            changed("connected");
          }
        },
      });
      const dispatcher = new EventDispatcher({ logger: quietLogger }).register({
        "im.message.receive_v1": async (data) => {
          if (!current()) return {};
          try {
            const input = this.adapter.receiveSdkEvent(data);
            if ("ignored" in input) {
              this.ignoredEvents++;
              return {};
            }
            this.accept(input); // Durably persist before returning the SDK acknowledgement.
            this.receivedEvents++;
            this.lastEventAt = new Date().toISOString();
            return {};
          } catch (error) {
            if (error instanceof HttpError && error.status < 500) {
              this.ignoredEvents++;
              changed("event rejected by source policy");
              return {};
            }
            // A persistence failure must reach the SDK so Feishu can retry.
            throw new Error("Unable to persist Feishu event");
          }
        },
      });
      changed("connecting");
      void this.client.start({ eventDispatcher: dispatcher }).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
  reconnect() {
    this.stop();
    this.reconcile();
  }
  stop() {
    this.generation++;
    this.client?.close({ force: true });
    this.client = null;
    this.identity = "";
  }
}
