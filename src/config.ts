import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SourceSchema = z.object({
  source: z.string(),
  chats: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
});

const ConfigSchema = z.object({
  instance: z.object({
    data_root: z.string(),
    max_active_tasks: z.number().int().positive().default(2),
  }),
  models: z.object({
    router: z.string().default("router-profile"),
  }),
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
    .default({}),
  supervisor: z
    .object({
      max_turn_duration_sec: z.number().int().positive().default(1200),
      stall_after_sec: z.number().int().positive().default(1800),
      interval_sec: z.number().int().positive().default(60),
    })
    .default({}),
  budget: z
    .object({
      daily_cost_usd: z.number().nonnegative().default(50),
    })
    .default({}),
  console: z
    .object({
      listen: z.string().default("127.0.0.1:7420"),
      admin_token: z.string().optional(),
    })
    .default({}),
  sources: z.array(SourceSchema).default([{ source: "console" }]),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(configPath?: string): AppConfig {
  const path =
    configPath ??
    process.env.OPENSUPERAGENT_CONFIG ??
    resolve(process.cwd(), "config.yaml");

  if (!existsSync(path)) {
    throw new Error(
      `Config not found: ${path}. Copy config.example.yaml to config.yaml.`,
    );
  }

  const raw = parseYaml(readFileSync(path, "utf8"));
  const parsed = ConfigSchema.parse(raw);

  if (process.env.OPENSUPERAGENT_ADMIN_TOKEN) {
    parsed.console.admin_token = process.env.OPENSUPERAGENT_ADMIN_TOKEN;
  }
  if (process.env.OPENSUPERAGENT_DATA_ROOT) {
    parsed.instance.data_root = process.env.OPENSUPERAGENT_DATA_ROOT;
  }

  parsed.instance.data_root = resolve(parsed.instance.data_root);
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
