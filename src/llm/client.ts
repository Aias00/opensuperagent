import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ChatCompletionResult,
  ChatMessage,
  ChatTool,
  LlmConfig,
} from "./types.js";

export function loadLlmConfig(cwd = process.cwd()): LlmConfig | null {
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

export class LlmClient {
  constructor(private readonly config: LlmConfig) {}
  get routerModel(): string {
    return this.config.routerModel;
  }
  get workerModel(): string {
    return this.config.workerModel;
  }
  private get headers(): Record<string, string> {
    return this.config.protocol === "anthropic"
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
  }
  async models(): Promise<string[]> {
    const data = await this.request("/models", { method: "GET" });
    return (data.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter((id: unknown) => typeof id === "string");
  }
  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<any> {
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        headers: this.headers,
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok)
      throw new Error(
        `LLM provider ${this.config.provider} returned HTTP ${response.status}`,
      );
    return response.json();
  }
  async chat(input: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<ChatCompletionResult> {
    if (this.config.protocol === "anthropic") return this.anthropic(input);
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
    };
    // OpenAI reasoning models reject the old max_tokens and custom temperature.
    body[
      new URL(this.config.baseUrl).hostname === "api.openai.com"
        ? "max_completion_tokens"
        : "max_tokens"
    ] = this.config.maxTokens ?? 8192;
    if (input.temperature != null) body.temperature = input.temperature;
    if (input.tools?.length) {
      body.tools = input.tools;
      body.tool_choice = "auto";
    }
    const data = await this.request(
      "/chat/completions",
      { method: "POST", body: JSON.stringify(body) },
      input.signal,
    );
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error("LLM returned empty choices");
    return {
      message: choice.message,
      finishReason: choice.finish_reason ?? null,
      usage: data.usage,
    };
  }
  private async anthropic(input: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    signal?: AbortSignal;
  }): Promise<ChatCompletionResult> {
    const messages: { role: string; content: any[] }[] = [];
    for (const message of input.messages.filter((m) => m.role !== "system")) {
      const role = message.role === "assistant" ? "assistant" : "user";
      const content: any[] =
        message.role === "tool"
          ? [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id,
                content: message.content ?? "",
              },
            ]
          : [
              ...(message.content
                ? [{ type: "text", text: message.content }]
                : []),
              ...(message.tool_calls ?? []).map((c) => ({
                type: "tool_use",
                id: c.id,
                name: c.function.name,
                input: JSON.parse(c.function.arguments || "{}"),
              })),
            ];
      if (messages.at(-1)?.role === role)
        messages.at(-1)!.content.push(...content);
      else
        messages.push({
          role,
          content: content.length ? content : [{ type: "text", text: " " }],
        });
    }
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: this.config.maxTokens ?? 8192,
      system: input.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content ?? "")
        .join("\n"),
      messages,
    };
    if (input.tools?.length)
      body.tools = input.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    const data = await this.request(
      "/messages",
      { method: "POST", body: JSON.stringify(body) },
      input.signal,
    );
    const blocks = data.content ?? [];
    return {
      message: {
        role: "assistant",
        content:
          blocks
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n") || null,
        tool_calls: blocks
          .filter((b: any) => b.type === "tool_use")
          .map((b: any) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })),
      },
      finishReason: data.stop_reason ?? null,
      usage: {
        prompt_tokens: data.usage?.input_tokens,
        completion_tokens: data.usage?.output_tokens,
      },
    };
  }
}
