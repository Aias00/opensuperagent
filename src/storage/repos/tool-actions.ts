import type { Db } from "../db.js";
import { row, rows } from "../db.js";
import type { ToolAction } from "../../types.js";
import { nowIso } from "../../ids.js";

interface ToolActionRow {
  session_id: string;
  tool_call_id: string;
  run_id: string;
  tool: string;
  result: string;
  created_at: string;
}

function mapAction(r: ToolActionRow): ToolAction {
  return {
    sessionId: r.session_id,
    toolCallId: r.tool_call_id,
    runId: r.run_id,
    tool: r.tool,
    result: JSON.parse(r.result) as unknown,
    createdAt: r.created_at,
  };
}

export class ToolActionRepo {
  constructor(private readonly db: Db) {}

  get(sessionId: string, toolCallId: string): ToolAction | null {
    const r = row<ToolActionRow>(
      this.db
        .prepare(
          "SELECT * FROM tool_actions WHERE session_id = ? AND tool_call_id = ?",
        )
        .get(sessionId, toolCallId),
    );
    return r ? mapAction(r) : null;
  }

  recordOrGet(input: {
    sessionId: string;
    toolCallId: string;
    runId: string;
    tool: string;
    result: unknown;
  }): { action: ToolAction; created: boolean } {
    const existing = this.get(input.sessionId, input.toolCallId);
    if (existing) return { action: existing, created: false };

    const createdAt = nowIso();
    try {
      this.db
        .prepare(
          `INSERT INTO tool_actions
           (session_id, tool_call_id, run_id, tool, result, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          input.toolCallId,
          input.runId,
          input.tool,
          JSON.stringify(input.result),
          createdAt,
        );
      return {
        action: {
          sessionId: input.sessionId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          tool: input.tool,
          result: input.result,
          createdAt,
        },
        created: true,
      };
    } catch {
      const again = this.get(input.sessionId, input.toolCallId);
      if (again) return { action: again, created: false };
      throw new Error(
        `Failed to record tool action ${input.sessionId}/${input.toolCallId}`,
      );
    }
  }

  listByRun(runId: string): ToolAction[] {
    return rows<ToolActionRow>(
      this.db
        .prepare(
          "SELECT * FROM tool_actions WHERE run_id = ? ORDER BY created_at",
        )
        .all(runId),
    ).map(mapAction);
  }
}
