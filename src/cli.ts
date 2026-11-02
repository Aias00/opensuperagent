#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, defaultConfigDir } from "./config.js";
import { DataPaths } from "./paths.js";
import { Store } from "./storage/index.js";
import { importSeed, importDefinitionFile, importSkillDir } from "./catalog/index.js";
import { ensureDataDirs, App } from "./app.js";
import { ApiServer } from "./api/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "init":
      await cmdInit(args);
      break;
    case "serve":
      await cmdServe(args);
      break;
    case "def":
      await cmdDef(args);
      break;
    case "skill":
      await cmdSkill(args);
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`opensuperagent <command>

Commands:
  init [--config path]     Create data dirs, migrate schema, import seed
  serve [--config path]    Start main process (API + loops)
  def import <file.json>   Import a worker definition
  def export <id>          Print definition JSON
  skill import <dir>       Import a skill directory (SKILL.md)
  skill list               List skills
`);
}

function configPathFromArgs(args: string[]): string | undefined {
  const i = args.indexOf("--config");
  if (i >= 0) return args[i + 1];
  return undefined;
}

async function cmdInit(args: string[]): Promise<void> {
  let configPath = configPathFromArgs(args);
  if (!configPath) {
    const local = resolve(process.cwd(), "config.yaml");
    const global = join(defaultConfigDir(), "config.yaml");
    // Project-local config wins; otherwise seed a user-level config so the
    // data root and its config live together under ~/.opensuperagent.
    configPath = existsSync(local) ? local : global;
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      copyFileSync(join(ROOT, "config.example.yaml"), configPath);
      console.log(`Wrote ${configPath}`);
    }
  }

  const config = loadConfig(configPath);
  ensureDataDirs(config.instance.data_root);
  const paths = new DataPaths(config.instance.data_root);
  const store = Store.open(paths.stateDb);

  const seedRoot = join(ROOT, "seed");
  const imported = importSeed(store, seedRoot);
  console.log(`Data root: ${paths.root}`);
  console.log(`Definitions: ${imported.definitions.join(", ") || "(none)"}`);
  console.log(`Skills: ${imported.skills.join(", ") || "(none)"}`);
  store.close();
  console.log("Init complete.");
}

async function cmdServe(args: string[]): Promise<void> {
  const config = loadConfig(configPathFromArgs(args));
  const app = new App(config);
  const api = new ApiServer(app);

  const shutdown = async () => {
    console.log("\nShutting down…");
    await api.stop();
    await app.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.start();
  await api.start();
}

async function cmdDef(args: string[]): Promise<void> {
  const [sub, fileOrId] = args;
  const config = loadConfig(configPathFromArgs(args));
  const store = Store.open(new DataPaths(config.instance.data_root).stateDb);

  if (sub === "import") {
    if (!fileOrId) throw new Error("def import <file.json>");
    const spec = importDefinitionFile(store, resolve(fileOrId));
    console.log(`Imported definition ${spec.id}`);
  } else if (sub === "export") {
    if (!fileOrId) throw new Error("def export <id>");
    const spec = store.catalog.getDefinition(fileOrId);
    if (!spec) throw new Error(`Unknown definition: ${fileOrId}`);
    console.log(JSON.stringify(spec, null, 2));
  } else {
    throw new Error("def import|export");
  }
  store.close();
}

async function cmdSkill(args: string[]): Promise<void> {
  const [sub, dir] = args;
  const config = loadConfig(configPathFromArgs(args));
  const store = Store.open(new DataPaths(config.instance.data_root).stateDb);

  if (sub === "import") {
    if (!dir) throw new Error("skill import <dir>");
    const name = importSkillDir(store, resolve(dir));
    console.log(`Imported skill ${name}`);
  } else if (sub === "list") {
    for (const s of store.catalog.listSkills()) {
      console.log(`${s.name}\t${s.description}`);
    }
  } else {
    throw new Error("skill import|list");
  }
  store.close();
}

// Ensure seed exists relative to package root when running via tsx from src/
mkdirSync(join(ROOT, "seed"), { recursive: true });

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
