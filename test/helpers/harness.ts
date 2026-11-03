import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { App } from "../../src/app.js";
import { ApiServer } from "../../src/api/server.js";
import { loadConfig } from "../../src/config.js";
import { importSeed } from "../../src/catalog/index.js";
import { createFixtureFacadeFactory } from "./fixture-session.js";
import type { FacadeFactory } from "../../src/session/manager.js";
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export function temporaryApp(wrap?: (factory: FacadeFactory) => FacadeFactory) {
  const dir = mkdtempSync(join(tmpdir(), "osa-integration-"));
  const config = loadConfig(resolve("config.example.yaml"));
  config.instance.data_root = dir;
  config.console.listen = "127.0.0.1:0";
  config.supervisor.interval_sec = 100;
  let fixture: FacadeFactory;
  const app = new App(config, {
    legacyLlm: null,
    testFacadeFactory: (opts) => fixture(opts),
  });
  const factory = createFixtureFacadeFactory({
    store: app.store,
    routerTools: app.routerTools,
    workerControls: app.workerControls,
    events: app.events,
  });
  fixture = wrap ? wrap(factory) : factory;
  importSeed(app.store, resolve("seed"));
  const api = new ApiServer(app);
  return {
    app,
    api,
    dir,
    async close() {
      await api.stop();
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export async function httpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
) {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    async close() {
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    },
  };
}
export const delay = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export async function eventually(predicate: () => boolean, timeout = 10000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) throw new Error("Timed out waiting for condition");
    await delay(10);
  }
}
export async function jsonBody(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text || "{}");
}
