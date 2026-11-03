import type { Store } from "../storage/index.js";
import type { DeliveryService } from "../delivery/index.js";
import type { SubmitOutcome, TaskResult } from "../types.js";

/** Application task controls. Generic tools execute in Pizza. */
export class WorkerControls {
  constructor(
    private readonly store: Store,
    private readonly delivery: DeliveryService,
  ) {}

  definition(taskId: string) {
    const task = this.store.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    if (this.store.tasks.isTerminal(task.status)) throw new Error("Task is closed");
    return task.definition;
  }

  submitResult(input: {
    sessionId: string;
    toolCallId: string;
    runId: string;
    taskId: string;
    outcome: SubmitOutcome;
    notice: string;
    summary: string;
    artifacts?: string[];
  }): { ok: true; deliveryId?: string } | { ok: false; reason: string } {
    const existing = this.store.toolActions.get(
      input.sessionId,
      input.toolCallId,
    );
    if (existing) {
      return existing.result as
        | { ok: true; deliveryId?: string }
        | { ok: false; reason: string };
    }

    const task = this.store.tasks.get(input.taskId);
    if (!task || this.store.tasks.isTerminal(task.status)) {
      const result = { ok: false as const, reason: "task not open" };
      this.store.toolActions.recordOrGet({
        sessionId: input.sessionId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        tool: "submit_result",
        result,
      });
      return result;
    }

    if (input.outcome === "completed") {
      const busy = this.store.operations.findActiveForTask(input.taskId);
      if (busy) {
        const result = {
          ok: false as const,
          reason: `command still running: ${busy.id}`,
        };
        this.store.toolActions.recordOrGet({
          sessionId: input.sessionId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          tool: "submit_result",
          result,
        });
        return result;
      }
      const pending = this.store.inbox.listPending(input.taskId);
      if (pending.length > 0) {
        const result = {
          ok: false as const,
          reason: `pending inbox items: ${pending.length}`,
        };
        this.store.toolActions.recordOrGet({
          sessionId: input.sessionId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          tool: "submit_result",
          result,
        });
        return result;
      }
    }

    const taskResult: TaskResult = {
      outcome: input.outcome,
      notice: input.notice,
      summary: input.summary,
      artifacts: input.artifacts,
    };

    const status =
      input.outcome === "needs_input"
        ? "waiting"
        : input.outcome === "failed"
          ? "failed"
          : "completed";

    const delivery = this.store.transaction(() => {
      this.store.tasks.complete(
        task.id,
        ["pending", "active", "waiting"],
        status === "waiting" ? "waiting" : status,
        taskResult,
      );

      const origin = this.store.triggers.get(task.originTriggerId);
      const channel =
        origin?.source === "console"
          ? "console"
          : (origin?.source ?? "console");
      const target = origin?.threadId ?? task.originTriggerId;
      return this.delivery.enqueue({
        channel,
        target,
        content: input.notice,
        idempotencyKey: `submit:${input.sessionId}:${input.toolCallId}`,
      });
    });

    const result = { ok: true as const, deliveryId: delivery.id };
    this.store.toolActions.recordOrGet({
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      runId: input.runId,
      tool: "submit_result",
      result,
    });
    return result;
  }
}
