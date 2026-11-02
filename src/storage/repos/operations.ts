import type { Db } from "../db.js";
import { row, rows } from "../db.js";
import type { Operation, OperationStatus } from "../../types.js";
import { newId, nowIso } from "../../ids.js";

interface OpRow {
  id: string;
  task_id: string;
  cmd: string;
  status: string;
  pgid: number | null;
  proc_start_time: string | null;
  deadline_at: string | null;
  log_path: string | null;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
}

function mapOp(r: OpRow): Operation {
  return {
    id: r.id,
    taskId: r.task_id,
    cmd: r.cmd,
    status: r.status as OperationStatus,
    pgid: r.pgid,
    procStartTime: r.proc_start_time,
    deadlineAt: r.deadline_at,
    logPath: r.log_path,
    exitCode: r.exit_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class OperationRepo {
  constructor(private readonly db: Db) {}

  get(id: string): Operation | null {
    const r = row<OpRow>(
      this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id),
    );
    return r ? mapOp(r) : null;
  }

  findActiveForTask(taskId: string): Operation | null {
    const r = row<OpRow>(
      this.db
        .prepare(
          `SELECT * FROM operations
           WHERE task_id = ? AND status IN ('pending', 'running', 'unknown')
           LIMIT 1`,
        )
        .get(taskId),
    );
    return r ? mapOp(r) : null;
  }

  insert(input: {
    taskId: string;
    cmd: string;
    deadlineAt?: string | null;
    logPath?: string | null;
  }): Operation {
    const id = newId("op");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO operations
         (id, task_id, cmd, status, pgid, proc_start_time, deadline_at, log_path, exit_code, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.cmd,
        input.deadlineAt ?? null,
        input.logPath ?? null,
        now,
        now,
      );
    return {
      id,
      taskId: input.taskId,
      cmd: input.cmd,
      status: "pending",
      pgid: null,
      procStartTime: null,
      deadlineAt: input.deadlineAt ?? null,
      logPath: input.logPath ?? null,
      exitCode: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  markRunning(
    id: string,
    pgid: number,
    procStartTime: string,
    logPath: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE operations
         SET status = 'running', pgid = ?, proc_start_time = ?, log_path = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(pgid, procStartTime, logPath, nowIso(), id);
    return Number(result.changes) > 0;
  }

  finish(
    id: string,
    from: OperationStatus[],
    to: Exclude<OperationStatus, "pending" | "running">,
    exitCode: number | null,
  ): boolean {
    const placeholders = from.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `UPDATE operations SET status = ?, exit_code = ?, updated_at = ?
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(to, exitCode, nowIso(), id, ...from);
    return Number(result.changes) > 0;
  }

  listIncomplete(): Operation[] {
    return rows<OpRow>(
      this.db
        .prepare(
          `SELECT * FROM operations
           WHERE status IN ('pending', 'running')
           ORDER BY created_at`,
        )
        .all(),
    ).map(mapOp);
  }

  listUnknown(): Operation[] {
    return rows<OpRow>(
      this.db
        .prepare("SELECT * FROM operations WHERE status = 'unknown'")
        .all(),
    ).map(mapOp);
  }
}
