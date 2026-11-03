import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const DEFAULT_DATA_ROOT = "~/.opensuperagent";

export function defaultConfigDir(): string {
  return join(homedir(), ".opensuperagent");
}

/** Expand a leading `~` and make the path absolute relative to `base`. */
export function resolveDataRoot(p: string, base = process.cwd()): string {
  const expanded =
    p === "~"
      ? homedir()
      : p.startsWith("~/") || p.startsWith("~\\")
        ? join(homedir(), p.slice(2))
        : p;
  return resolve(base, expanded);
}

const SourceSchema = z.object({
  source: z.string(),
  chats: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
});

const ConfigSchema = z.object({
  instance: z
    .object({
      data_root: z.string().default(DEFAULT_DATA_ROOT),
      max_active_tasks: z.number().int().positive().default(2),
    })
    .prefault({}),
  models: z
    .object({
      router: z.string().default("router-profile"),
    })
    .prefault({}),
  router: z
    .object({
      instructions: z.string().default(""),
    })
    .default({ instructions: "" }),
  execution: z
    .object({
      exec_timeout_sec: z.number().int().positive().default(120),
      default_deadline_sec: z.number().int().positive().default(1800),
      max_output_mb: z.number().positive().default(50),
    })
    .prefault({}),
  supervisor: z
    .object({
      max_turn_duration_sec: z.number().int().positive().default(1200),
      stall_after_sec: z.number().int().positive().default(1800),
      interval_sec: z.number().int().positive().default(60),
    })
    .prefault({}),
  budget: z
    .object({
      daily_cost_usd: z.number().nonnegative().default(50),
    })
    .prefault({}),
  console: z
    .object({
      listen: z.string().default("127.0.0.1:7420"),
      admin_token: z.string().optional(),
    })
    .prefault({}),
  sources: z.array(SourceSchema).default([{ source: "console" }]),
  agent: z
    .object({
      // Normalize the old default selector for existing config files.
      // Execution is always Pizza; other engine values are rejected.
      engine: z
        .preprocess(
          (value) => (value === "auto" ? "pizza" : value),
          z.literal("pizza"),
        )
        .default("pizza"),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * Config file discovery: explicit path/env wins, then ./config.yaml
 * (project-local), then <defaultConfigDir>/config.yaml, else built-in defaults.
 */
export function discoverConfigPath(): string | undefined {
  const local = resolve(process.cwd(), "config.yaml");
  if (existsSync(local)) return local;
  const global = join(defaultConfigDir(), "config.yaml");
  if (existsSync(global)) return global;
  return undefined;
}

export function loadConfig(configPath?: string): AppConfig {
  const explicit = configPath ?? process.env.OPENSUPERAGENT_CONFIG;
  let path = explicit ?? discoverConfigPath();

  if (explicit && !existsSync(explicit)) {
    throw new Error(
      `Config not found: ${explicit}. Copy config.example.yaml to config.yaml.`,
    );
  }

  const raw = path ? parseYaml(readFileSync(path, "utf8")) : undefined;
  const parsed = ConfigSchema.parse(raw ?? {});

  if (process.env.OPENSUPERAGENT_ADMIN_TOKEN) {
    parsed.console.admin_token = process.env.OPENSUPERAGENT_ADMIN_TOKEN;
  }
  if (process.env.OPENSUPERAGENT_DATA_ROOT) {
    parsed.instance.data_root = process.env.OPENSUPERAGENT_DATA_ROOT;
  }

  // Relative data_root resolves against the config file's directory so a
  // config in ~/.opensuperagent never depends on the launch directory.
  parsed.instance.data_root = resolveDataRoot(
    parsed.instance.data_root,
    path ? dirname(path) : process.cwd(),
  );
  return parsed;
}

export function parseListen(listen: string): { host: string; port: number } {
  const [host, portStr] = listen.includes(":")
    ? listen.split(":")
    : ["127.0.0.1", listen];
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid console.listen: ${listen}`);
  }
  return { host, port };
}
