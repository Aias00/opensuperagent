import type { Store } from "../storage/index.js";
import type { RouterTools } from "../router/tools.js";
import type { WorkerTools } from "../worker/tools.js";
import type { EventBus } from "../events/bus.js";
import type { AppConfig } from "../config.js";
import type { FacadeFactory, SessionFacadeHandle } from "./manager.js";
import { LlmClient } from "../llm/client.js";
import { runToolLoop } from "../llm/loop.js";
import { ROUTER_CHAT_TOOLS, executeRouterTool } from "../llm/tools-router.js";
import { WORKER_CHAT_TOOLS, executeWorkerTool } from "../llm/tools-worker.js";
import { buildRouterSystemPrompt } from "../router/prompts.js";

export function createLlmFacadeFactory(deps: {
  store: Store;
  routerTools: RouterTools;
  workerTools: WorkerTools;
  events: EventBus;
  config: AppConfig;
  client: LlmClient | ((owner: string, profile?: string) => LlmClient);
}): FacadeFactory {
  // Per-owner conversation memory across runs (lightweight; Pizza will replace).
  const histories = new Map<string, string>();

  return async ({ session, systemPrompt, modelProfile }) => {
    let controller: AbortController | null = null;
    const handle: SessionFacadeHandle = {
      session,
      tagging: null,
      async prompt(text: string) {
        controller = new AbortController();
        const client =
          typeof deps.client === "function"
            ? deps.client(session.owner, modelProfile)
            : deps.client;
        const active = deps.store.runs.findActive(session.id);
        if (!active) return;
        if (active.status === "pending") {
          deps.store.runs.transition(active.id, "pending", "submitted");
        }

        deps.events.emit({
          scope: session.owner,
          kind: "prompt",
          summary: text.slice(0, 200),
          payload: { runId: active.id, modelProfile },
        });

        const prior =
          session.owner === "router" ? histories.get(session.owner) : undefined;
        const userPrompt = prior
          ? `## Prior context (already processed; do not repeat actions)\n${prior}\n\n## New input (act on this input)\n${text}`
          : text;

        try {
          if (session.owner === "router") {
            const defs = deps.store.catalog.listActiveDefinitions();
            const sys =
              systemPrompt ?? buildRouterSystemPrompt(deps.config, defs);
            await runToolLoop({
              client,
              signal: controller.signal,
              runId: active.id,
              model: client.routerModel,
              systemPrompt: sys,
              userPrompt,
              tools: ROUTER_CHAT_TOOLS,
              events: deps.events,
              scope: "router",
              maxSteps: 16,
              execute: async ({ toolCallId, name, args }) =>
                executeRouterTool({
                  tools: deps.routerTools,
                  store: deps.store,
                  sessionId: session.id,
                  runId: active.id,
                  toolCallId,
                  name,
                  args,
                }),
            });
          } else {
            const task = deps.store.tasks.get(session.owner);
            if (!task || deps.store.tasks.isTerminal(task.status)) {
              return;
            }
            const sys =
              systemPrompt ??
              `${task.definition.systemPrompt}\n\nAvailable skills: ${task.definition.skills.join(", ")}`;
            await runToolLoop({
              client,
              signal: controller.signal,
              runId: active.id,
              model: client.workerModel,
              systemPrompt: sys,
              userPrompt,
              tools: WORKER_CHAT_TOOLS.filter((tool) =>
                task.definition.tools.includes(tool.function.name),
              ),
              events: deps.events,
              scope: task.id,
              maxSteps: Math.min(task.definition.limits.maxTurns, 40),
              yieldOnBusy: true,
              execute: async ({ toolCallId, name, args }) =>
                executeWorkerTool({
                  tools: deps.workerTools,
                  taskId: task.id,
                  sessionId: session.id,
                  runId: active.id,
                  toolCallId,
                  name,
                  args,
                }),
            });
          }

          if (session.owner === "router")
            histories.set(session.owner, text.slice(0, 2000));
        } catch (err) {
          deps.store.runs.transition(
            active.id,
            "submitted",
            controller.signal.aborted ? "aborted" : "failed",
          );
          deps.events.emit({
            scope: session.owner,
            kind: "error",
            summary: String(err),
          });
          throw err;
        } finally {
          const run = deps.store.runs.get(active.id);
          if (run?.status === "submitted") {
            deps.store.runs.transition(active.id, "submitted", "completed");
          }
          deps.events.emit({
            scope: session.owner,
            kind: thisRunStatus(deps.store.runs.get(active.id)?.status),
            summary: `Run ${active.id} ${deps.store.runs.get(active.id)?.status ?? "ended"}`,
            payload: { runId: active.id },
          });
        }
      },
      async abort(reason?: string) {
        controller?.abort(reason);
        const active = deps.store.runs.findActive(session.id);
        if (active) {
          deps.store.runs.transition(
            active.id,
            active.status as "pending" | "submitted",
            "aborted",
          );
        }
        deps.events.emit({
          scope: session.owner,
          kind: "aborted",
          summary: reason ?? "aborted",
        });
      },
      async close() {
        controller?.abort("shutdown");
      },
    };
    return handle;
  };
}

function thisRunStatus(status?: string): string {
  return status === "completed"
    ? "run_completed"
    : status === "aborted"
      ? "aborted"
      : "run_failed";
}
