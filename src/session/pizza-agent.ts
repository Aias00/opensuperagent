import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Store } from "../storage/index.js";
import type { DataPaths } from "../paths.js";
import type { RouterTools } from "../router/tools.js";
import type { WorkerTools } from "../worker/tools.js";
import type { EventBus } from "../events/bus.js";
import type { LlmConfig } from "../llm/types.js";
import type { FacadeFactory, SessionFacadeHandle } from "./manager.js";
import { TaggingStore, type EventAppendInput } from "./tagging-store.js";
import { ROUTER_CHAT_TOOLS, executeRouterTool } from "../llm/tools-router.js";
import { WORKER_CHAT_TOOLS, executeWorkerTool } from "../llm/tools-worker.js";

type Pizza = typeof import("@tomsun28/pizza");

type EventQuery = {
  after_sequence?: number;
  thread_id?: string;
  types?: string[];
  reverse?: boolean;
  limit?: number;
};

/** Duck-typed surface of pizza's SqliteEventStore (not exported at package root). */
type EventStoreLike = {
  append?(e: EventAppendInput): unknown;
  appendBatch?(e: EventAppendInput[]): unknown;
  query?(filter: EventQuery): { payload?: unknown }[];
  subscribe?(h: (e: { type: string }) => void, o?: unknown): () => void;
  flush?(): Promise<void>;
  close?(): void;
  closeAsync?(): Promise<void>;
  head_sequence?: number;
  [key: string]: unknown;
};

const ROUTER_MAX_CALLS = 16;

/**
 * Pizza-backed session facade (§9.2): the durable event log at
 * sessions/<owner>/<id>/events.sqlite gives runs resumable context, and
 * TaggingStore marks each run's first USER_MESSAGE for replay dedup.
 */
export function createPizzaFacadeFactory(deps: {
  store: Store;
  paths: DataPaths;
  routerTools: RouterTools;
  workerTools: WorkerTools;
  events: EventBus;
  resolveModel: (owner: "router" | "worker", profile?: string) => LlmConfig;
}): FacadeFactory {
  let loaded: Promise<Pizza> | undefined;
  const loadPizza = () => (loaded ??= import("@tomsun28/pizza"));

  return async ({ session, cwd, systemPrompt, modelProfile }) => {
    const pizza = await loadPizza();
    const owner = session.owner;
    const isRouter = owner === "router";
    const task = isRouter ? null : deps.store.tasks.get(owner);
    if (!isRouter && !task) {
      throw new Error(`Worker session ${owner} has no task`);
    }

    const cfg = deps.resolveModel(
      isRouter ? "router" : "worker",
      modelProfile,
    );
    const agentDir = join(dirname(session.eventsPath), "agent");
    mkdirSync(agentDir, { recursive: true });

    const auth = pizza.AuthStorage.inMemory();
    const registry = pizza.ModelRegistry.inMemory(auth);
    registry.registerProvider(cfg.provider, {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      api:
        cfg.protocol === "anthropic"
          ? "anthropic-messages"
          : "openai-completions",
      models: [
        {
          id: cfg.routerModel,
          name: cfg.routerModel,
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: cfg.maxTokens ?? 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    if (cfg.apiKey) auth.setRuntimeApiKey(cfg.provider, cfg.apiKey);
    const model = registry.find(cfg.provider, cfg.routerModel);
    if (!model) {
      throw new Error(`Model ${cfg.provider}/${cfg.routerModel} unavailable`);
    }

    const chatTools = isRouter
      ? ROUTER_CHAT_TOOLS
      : WORKER_CHAT_TOOLS.filter((t) =>
          task!.definition.tools.includes(t.function.name),
        );

    let activeRunId = "";
    const customTools = chatTools.map((tool) => ({
      name: tool.function.name,
      label: tool.function.name,
      description: tool.function.description ?? "",
      parameters: pizza.Type.Unsafe(tool.function.parameters),
      execute: async (toolCallId: string, params: unknown) => {
        const args = (params ?? {}) as Record<string, unknown>;
        const result = isRouter
          ? await executeRouterTool({
              tools: deps.routerTools,
              store: deps.store,
              sessionId: session.id,
              runId: activeRunId,
              toolCallId,
              name: tool.function.name,
              args,
            })
          : await executeWorkerTool({
              tools: deps.workerTools,
              taskId: owner,
              sessionId: session.id,
              runId: activeRunId,
              toolCallId,
              name: tool.function.name,
              args,
            });
        return {
          content: [
            {
              type: "text" as const,
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result),
            },
          ],
        };
      },
    }));

    const created = await pizza.createSessionFacade({
      cwd: cwd ?? deps.paths.root,
      agentDir,
      storagePath: session.eventsPath,
      workspaceId: "opensuperagent",
      threadId: session.id,
      authStorage: auth,
      modelRegistry: registry,
      settingsManager: pizza.SettingsManager.inMemory({}),
      resourceLoaderOptions: {
        systemPrompt: systemPrompt ?? "",
        noExtensions: true,
        noBuiltinExtensions: true,
        noSkills: true,
        noBuiltinSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      },
      model,
      thinkingLevel: "off",
      tools: chatTools.map((t) => t.function.name),
      customTools,
      safeModeDefault: false,
      approvalUi: false,
      isMainAgent: false,
    });
    const facade = created.facade;
    const eventStore = created.runtime.store as unknown as EventStoreLike;

    // Route appends through TaggingStore so each run's first USER_MESSAGE
    // carries idempotency_key = run:<runId>. SqliteEventStore is not exported
    // by the package, so the proxy is applied onto the live instance.
    const tagging = new TaggingStore({
      append: eventStore.append?.bind(eventStore),
      appendBatch: eventStore.appendBatch?.bind(eventStore),
      flush: eventStore.flush?.bind(eventStore),
      closeAsync: eventStore.closeAsync?.bind(eventStore),
      close: eventStore.close?.bind(eventStore),
      query: eventStore.query?.bind(eventStore),
      subscribe: eventStore.subscribe?.bind(eventStore),
    } as never);
    try {
      if (typeof eventStore.append === "function")
        eventStore.append = (e: EventAppendInput) => tagging.append(e);
      if (typeof eventStore.appendBatch === "function")
        eventStore.appendBatch = (es: EventAppendInput[]) =>
          tagging.appendBatch(es);
    } catch {
      /* store is sealed; events go untagged */
    }

    let aborted = false;
    let llmCalls = 0;
    let overBudget = false;
    const maxCalls = isRouter
      ? ROUTER_MAX_CALLS
      : Math.min(task!.definition.limits.maxTurns, 40);

    facade.subscribe((event) => {
      const payload =
        (event as { payload?: Record<string, unknown> }).payload ?? {};
      switch (event.type) {
        case "LLM_CALL_REQUESTED":
          if (++llmCalls > maxCalls) {
            overBudget = true;
            facade.abort();
          }
          break;
        case "AGENT_MESSAGE_END": {
          const text = contentText(payload.content);
          if (text)
            deps.events.emit({
              scope: owner,
              kind: "assistant",
              summary: text.slice(0, 240),
            });
          break;
        }
        case "TOOL_EXECUTION_START":
          deps.events.emit({
            scope: owner,
            kind: "tool",
            summary: String(payload.tool_name ?? "tool"),
            payload: {
              runId: activeRunId,
              toolCallId: payload.tool_call_id,
            },
          });
          break;
        case "TOOL_EXECUTION_END":
          deps.events.emit({
            scope: owner,
            kind: "tool_result",
            summary: `${String(payload.tool_name ?? "tool")} → ${summarize(payload.result)}`,
            payload: {
              runId: activeRunId,
              toolCallId: payload.tool_call_id,
              isError: !!payload.is_error,
            },
          });
          break;
        case "AGENT_ERROR":
          deps.events.emit({
            scope: owner,
            kind: "error",
            summary: String(payload.error ?? "agent error"),
          });
          break;
      }
    });

    const lastMessageEnd = (afterSequence: number) =>
      eventStore.query?.({
        after_sequence: afterSequence,
        thread_id: session.id,
        types: ["AGENT_MESSAGE_END"],
        reverse: true,
        limit: 1,
      })?.[0];

    const handle: SessionFacadeHandle = {
      session,
      tagging,
      async prompt(text) {
        const active = deps.store.runs.findActive(session.id);
        if (!active) return;
        activeRunId = active.id;
        tagging.beginRun(active.id);
        deps.events.emit({
          scope: owner,
          kind: "prompt",
          summary: text.slice(0, 200),
          payload: { runId: active.id, modelProfile },
        });
        const startSequence = eventStore.head_sequence ?? 0;
        try {
          await facade.prompt(text);
          if (overBudget)
            throw new Error(`Model call budget exceeded (${maxCalls})`);
          const payload = (lastMessageEnd(startSequence)?.payload ?? {}) as {
            stop_reason?: string;
            error_message?: string;
          };
          if (
            payload.stop_reason &&
            payload.stop_reason !== "stop" &&
            payload.stop_reason !== "aborted"
          )
            throw new Error(
              stopReasonMessage(payload.stop_reason, payload.error_message),
            );
        } catch (err) {
          deps.store.runs.transition(
            active.id,
            "submitted",
            aborted ? "aborted" : "failed",
          );
          deps.events.emit({
            scope: owner,
            kind: "error",
            summary: String(err),
          });
          throw err;
        } finally {
          const run = deps.store.runs.get(active.id);
          if (run?.status === "submitted" && !aborted) {
            deps.store.runs.transition(active.id, "submitted", "completed");
          }
          deps.events.emit({
            scope: owner,
            kind: thisRunStatus(deps.store.runs.get(active.id)?.status),
            summary: `Run ${active.id} ${deps.store.runs.get(active.id)?.status ?? "ended"}`,
            payload: { runId: active.id },
          });
        }
      },
      async abort(reason) {
        aborted = true;
        facade.abort();
        const active = deps.store.runs.findActive(session.id);
        if (active)
          deps.store.runs.transition(
            active.id,
            active.status as "pending" | "submitted",
            "aborted",
          );
        deps.events.emit({
          scope: owner,
          kind: "aborted",
          summary: reason ?? "aborted",
        });
      },
      async close() {
        facade.abort();
        await facade.disposeAsync();
      },
    };
    return handle;
  };
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c): c is { type: string; text?: string } =>
        !!c && c.type === "text" && typeof c.text === "string",
    )
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
}

function summarize(value: unknown): string {
  try {
    const s =
      typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return String(value);
  }
}

function stopReasonMessage(stop: string, message?: string): string {
  if (stop === "length") {
    return "Response exceeded the length limit; narrow the task scope.";
  }
  const code = message?.match(/^(\d{3}):/)?.[1];
  if (code === "401" || code === "403") return "Model auth failed (401/403)";
  if (code === "402") return "Model provider balance insufficient (402)";
  if (code === "429") return "Model rate limited (429)";
  if (code && Number(code) >= 500)
    return `Model provider unavailable (${code})`;
  return message ?? `Agent turn ended without completing (${stop})`;
}

function thisRunStatus(status?: string): string {
  return status === "completed"
    ? "run_completed"
    : status === "aborted"
      ? "aborted"
      : "run_failed";
}
