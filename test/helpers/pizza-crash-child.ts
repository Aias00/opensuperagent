import { App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
const app = new App(loadConfig(process.argv[2]), { legacyLlm: null });
app.lock.acquire();
await app.workerLoop.tick(process.argv[3]!);
process.exit(2);
