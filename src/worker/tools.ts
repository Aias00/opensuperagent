import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { Store } from "../storage/index.js";
import type { DataPaths } from "../paths.js";
import type { CommandRunner } from "../execution/runner.js";
import { BusyError } from "../execution/runner.js";
import type { DeliveryService } from "../delivery/index.js";
import type { SubmitOutcome, TaskResult } from "../types.js";
import { parseSkillFrontmatter } from "../catalog/index.js";

/**
 * Worker tools (§7.4 / §7.5). Path tools stay inside the task workspace.
 */
export class WorkerTools {
  constructor(
    private readonly store: Store,
    private readonly paths: DataPaths,
    private readonly runner: CommandRunner,
    private readonly delivery: DeliveryService,
  ) {}

  private workspaceRoot(taskId: string): string {
    const task = this.store.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task.workspacePath;
  }

  private resolveInWorkspace(taskId: string, relPath: string): string {
    const root = realpathSync(this.workspaceRoot(taskId));
    const target = resolve(root, relPath);
    const real = existsSync(target) ? realpathSync(target) : target;
    if (
      real !== root &&
      !real.startsWith(root + "/") &&
      !real.startsWith(root + "\\")
    ) {
      throw new Error(`Path escapes workspace: ${relPath}`);
    }
    return real;
  }

  definition(taskId: string) {
    const task = this.store.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    if (this.store.tasks.isTerminal(task.status)) throw new Error("Task is closed");
    return task.definition;
  }

  read(taskId: string, path: string): string {
    const abs = this.resolveInWorkspace(taskId, path);
    return readFileSync(abs, "utf8");
  }

  write(
    taskId: string,
    path: string,
    content: string,
  ): { ok: true } | { busy: string } {
    const busy = this.runner.assertIdle(taskId);
    if (busy) return { busy: busy.id };
    const abs = this.resolveInWorkspace(taskId, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return { ok: true };
  }

  edit(
    taskId: string,
    path: string,
    oldText: string,
    newText: string,
  ): { ok: true } | { busy: string } | { error: string } {
    const busy = this.runner.assertIdle(taskId);
    if (busy) return { busy: busy.id };
    const abs = this.resolveInWorkspace(taskId, path);
    const cur = readFileSync(abs, "utf8");
    if (!cur.includes(oldText)) return { error: "oldText not found" };
    writeFileSync(abs, cur.replace(oldText, newText));
    return { ok: true };
  }

  async exec(
    taskId: string,
    cmd: string,
    timeoutSec?: number,
  ): Promise<unknown> {
    try {
      const cwd = this.workspaceRoot(taskId);
      const { operation, result, log } = await this.runner.execSync({
        taskId,
        cmd,
        cwd,
        timeoutSec,
      });
      return {
        operationId: operation.id,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        logTail: log.slice(-8000),
      };
    } catch (err) {
      if (err instanceof BusyError) return { busy: err.operationId };
      throw err;
    }
  }

  start(
    taskId: string,
    cmd: string,
    deadlineAt?: string,
  ): { operationId: string } | { busy: string } {
    try {
      const cwd = this.workspaceRoot(taskId);
      const op = this.runner.startBackground({
        taskId,
        cmd,
        cwd,
        deadlineAt,
      });
      return { operationId: op.id };
    } catch (err) {
      if (err instanceof BusyError) return { busy: err.operationId };
      throw err;
    }
  }

  stop(taskId: string, operationId: string): { ok: boolean } {
    const op = this.store.operations.get(operationId);
    if (!op || op.taskId !== taskId) return { ok: false };
    this.runner.stop(operationId);
    return { ok: true };
  }

  skillList(taskId: string): { name: string; description: string }[] {
    const root = this.paths.taskSkills(taskId);
    if (!existsSync(root)) return [];
    const out: { name: string; description: string }[] = [];
    for (const name of readdirSync(root)) {
      const skillMd = join(root, name, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      try {
        const { description } = parseSkillFrontmatter(
          readFileSync(skillMd, "utf8"),
        );
        out.push({ name, description });
      } catch {
        out.push({ name, description: "" });
      }
    }
    return out;
  }

  skillRead(taskId: string, skillName: string, relPath = "SKILL.md"): string {
    const root = realpathSync(this.paths.taskSkills(taskId));
    const abs = resolve(root, skillName, relPath);
    const real = existsSync(abs) ? realpathSync(abs) : abs;
    if (
      real !== root &&
      !real.startsWith(root + "/") &&
      !real.startsWith(root + "\\")
    ) {
      throw new Error("skill path escapes snapshot");
    }
    return readFileSync(real, "utf8");
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
      const busy = this.runner.assertIdle(input.taskId);
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
