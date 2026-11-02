import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../storage/index.js";
import { rows, row } from "../storage/db.js";
import type { RouterTools } from "../router/tools.js";
import type { WorkerTools } from "../worker/tools.js";
import type { EventBus } from "../events/bus.js";
import type { FacadeFactory, SessionFacadeHandle } from "./manager.js";
import { newId, nowIso } from "../ids.js";

/**
 * MVP agent runtime without Pizza LLM.
 * Router auto-dispatches to `coding`; Worker writes artifacts, runs a probe
 * command, and submits a completed result — enough to exercise the full pipeline.
 */
export function createMvpFacadeFactory(deps: {
  store: Store;
  routerTools: RouterTools;
  workerTools: WorkerTools;
  events: EventBus;
}): FacadeFactory {
  return async ({ session, cwd }) => {
    let aborted = false;
    const handle: SessionFacadeHandle = {
      session,
      tagging: null,
      async prompt(text: string) {
        if (aborted) return;
        const active = deps.store.runs.findActive(session.id);
        if (!active) return;
        if (active.status === "pending") {
          deps.store.runs.transition(active.id, "pending", "submitted");
        }

        deps.events.emit({
          scope: session.owner,
          kind: "prompt",
          summary: text.slice(0, 160),
          payload: { runId: active.id },
        });

        if (session.owner === "router") {
          await runRouterTurn(deps, session.id, active.id);
        } else {
          await runWorkerTurn(deps, session.owner, session.id, active.id, cwd);
        }

        const run = deps.store.runs.get(active.id);
        if (run?.status === "submitted") {
          deps.store.runs.transition(active.id, "submitted", "completed");
        }
        deps.events.emit({
          scope: session.owner,
          kind: "run_completed",
          summary: `Run ${active.id} completed`,
          payload: { runId: active.id },
        });
      },
      async abort(reason?: string) {
        aborted = true;
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
        /* no-op */
      },
    };
    return handle;
  };
}

async function runRouterTurn(
  deps: {
    store: Store;
    routerTools: RouterTools;
    events: EventBus;
  },
  sessionId: string,
  runId: string,
): Promise<void> {
  const coding = deps.store.catalog.getDefinition("coding");
  if (!coding) {
    deps.events.emit({
      scope: "router",
      kind: "error",
      summary: "No coding worker definition",
    });
    return;
  }

  const bound = rows<{ trigger_id: string }>(
    deps.store.db
      .prepare(
        `SELECT trigger_id FROM inbox WHERE run_id = ? AND status = 'accepted'`,
      )
      .all(runId),
  );

  for (const item of bound) {
    const triggerId = item.trigger_id;
    const assigned = row<{ x: number }>(
      deps.store.db
        .prepare(
          `SELECT 1 AS x FROM inbox WHERE trigger_id = ? AND target != 'router' LIMIT 1`,
        )
        .get(triggerId),
    );
    if (assigned) continue;

    const trigger = deps.store.triggers.get(triggerId);
    if (!trigger) continue;

    const result = deps.routerTools.startTask({
      sessionId,
      toolCallId: `mvp:${newId("tc")}`,
      runId,
      triggerIds: [triggerId],
      definition: "coding",
      objective: trigger.preview,
    });

    deps.events.emit({
      scope: "router",
      kind: "tool",
      summary: `start_task → ${result.taskId}`,
      payload: { tool: "start_task", result },
    });
  }
}

async function runWorkerTurn(
  deps: {
    store: Store;
    workerTools: WorkerTools;
    events: EventBus;
  },
  taskId: string,
  sessionId: string,
  runId: string,
  cwd?: string,
): Promise<void> {
  const task = deps.store.tasks.get(taskId);
  if (!task || deps.store.tasks.isTerminal(task.status)) return;

  const workspace = cwd ?? task.workspacePath;
  mkdirSync(workspace, { recursive: true });

  // Follow-up messages after an open task: append note and re-complete.
  const bound = rows<{ preview: string }>(
    deps.store.db
      .prepare(
        `SELECT t.preview FROM inbox i
         JOIN triggers t ON t.id = i.trigger_id
         WHERE i.run_id = ?`,
      )
      .all(runId),
  ).map((r) => r.preview);

  const objectiveBlock = [
    `# Task ${task.id}`,
    "",
    `Objective: ${task.objective}`,
    `Updated: ${nowIso()}`,
    "",
    "## Inputs this turn",
    ...bound.map((p) => `- ${p}`),
    "",
  ].join("\n");

  const writeObj = deps.workerTools.write(
    taskId,
    "OBJECTIVE.md",
    objectiveBlock,
  );
  deps.events.emit({
    scope: taskId,
    kind: "tool",
    summary: "write OBJECTIVE.md",
    payload: { tool: "write", result: writeObj },
  });

  const notesPath = join(workspace, "NOTES.md");
  writeFileSync(
    notesPath,
    [
      `# Working notes`,
      ``,
      `- Agent: MVP (no Pizza LLM)`,
      `- Workspace: ${workspace}`,
      `- Definition: ${task.definition.id}`,
      `- Skills: ${task.definition.skills.join(", ") || "(none)"}`,
      ``,
      `## Progress`,
      `- Captured objective and inputs`,
      `- Ran workspace probe`,
      ``,
    ].join("\n"),
  );
  deps.events.emit({
    scope: taskId,
    kind: "tool",
    summary: "write NOTES.md",
    payload: { tool: "write", path: "NOTES.md" },
  });

  const execResult = await deps.workerTools.exec(
    taskId,
    "pwd && date && ls -la",
    30,
  );
  deps.events.emit({
    scope: taskId,
    kind: "tool",
    summary: "exec probe",
    payload: { tool: "exec", result: execResult },
  });

  // Skill snapshot check
  const skills = deps.workerTools.skillList(taskId);
  deps.events.emit({
    scope: taskId,
    kind: "tool",
    summary: `skill list (${skills.length})`,
    payload: { tool: "skill", skills },
  });

  const submit = deps.workerTools.submitResult({
    sessionId,
    toolCallId: `mvp:${newId("tc")}`,
    runId,
    taskId,
    outcome: "completed",
    notice: `已完成：${task.objective}`,
    summary: `MVP worker wrote OBJECTIVE.md / NOTES.md and ran a workspace probe.`,
    artifacts: [`${workspace}/OBJECTIVE.md`, `${workspace}/NOTES.md`],
  });

  deps.events.emit({
    scope: taskId,
    kind: "tool",
    summary: submit.ok
      ? `submit_result completed`
      : `submit_result rejected: ${"reason" in submit ? submit.reason : ""}`,
    payload: { tool: "submit_result", result: submit },
  });
}
