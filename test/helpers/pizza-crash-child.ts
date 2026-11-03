import { App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
const app = new App(loadConfig(process.argv[2]), { legacyLlm: null });
app.lock.acquire();
const write = app.workerTools.write.bind(app.workerTools);
app.workerTools.write = (...args) => {
  write(...args);
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
};
await app.workerLoop.tick(process.argv[3]!);
process.exit(2);
