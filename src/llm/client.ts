import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LlmConfig } from "./types.js";

export function loadLlmConfig(
  cwd = process.cwd(),
  dataRoot?: string,
): LlmConfig | null {
  const fromEnvKey =
    process.env.DEEPSEEK_API_KEY ?? process.env.OPENSUPERAGENT_LLM_API_KEY;
  const baseUrl =
    process.env.OPENSUPERAGENT_LLM_BASE_URL ?? "https://api.deepseek.com";
  const routerModel =
    process.env.OPENSUPERAGENT_LLM_ROUTER_MODEL ?? "deepseek-flash";
  const workerModel =
    process.env.OPENSUPERAGENT_LLM_WORKER_MODEL ?? "deepseek-flash";

  const secretPaths = [
    resolve(cwd, "secrets/llm.json"),
    resolve(cwd, "data/secrets/llm.json"),
    ...(dataRoot ? [resolve(dataRoot, "secrets/llm.json")] : []),
  ];
  for (const p of secretPaths) {
    if (!existsSync(p)) continue;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<LlmConfig> & {
      api_key?: string;
    };
    const apiKey = raw.apiKey ?? raw.api_key ?? fromEnvKey;
    if (!apiKey) continue;
    return {
      provider: raw.provider ?? "deepseek",
      protocol: raw.protocol ?? "openai-compatible",
      baseUrl: raw.baseUrl ?? baseUrl,
      apiKey,
      routerModel: raw.routerModel ?? routerModel,
      workerModel: raw.workerModel ?? workerModel,
      maxTokens: raw.maxTokens ?? 8192,
    };
  }

  if (!fromEnvKey) return null;
  return {
    provider: "deepseek",
    baseUrl,
    apiKey: fromEnvKey,
    routerModel,
    workerModel,
    maxTokens: 8192,
  };
}

/** Model discovery and connectivity probes only; Pizza owns agent execution. */
export class LlmClient {
  constructor(
    private readonly config: Pick<
      LlmConfig,
      "provider" | "protocol" | "baseUrl" | "apiKey"
    >,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> =
      this.config.protocol === "anthropic"
        ? {
            "x-api-key": this.config.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          }
        : {
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {}),
            "Content-Type": "application/json",
          };
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      },
    );
    if (!response.ok)
      throw new Error(
        `LLM provider ${this.config.provider} returned HTTP ${response.status}`,
      );
    return (await response.json()) as T;
  }

  async models(): Promise<string[]> {
    const data = await this.request<{ data?: { id: unknown }[] }>("/models", {
      method: "GET",
    });
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
  }

  async test(model: string): Promise<void> {
    const anthropic = this.config.protocol === "anthropic";
    const tokenParameter =
      !anthropic && new URL(this.config.baseUrl).hostname === "api.openai.com"
        ? "max_completion_tokens"
        : "max_tokens";
    const data = await this.request<{
      content?: unknown[];
      choices?: { message?: unknown }[];
    }>(anthropic ? "/messages" : "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK only." }],
        [tokenParameter]: 32,
      }),
    });
    if (
      anthropic
        ? !Array.isArray(data.content) || !data.content.length
        : !data.choices?.[0]?.message
    )
      throw new Error("LLM returned an empty probe response");
  }
}
