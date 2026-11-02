import type { Db } from "../db.js";
import { row, rows } from "../db.js";
import type { Trigger, TriggerStatus } from "../../types.js";
import { newId, nowIso } from "../../ids.js";

interface TriggerRow {
  id: string;
  source: string;
  external_id: string;
  thread_id: string | null;
  actor_id: string | null;
  payload_ref: string;
  preview: string;
  status: string;
  created_at: string;
}

function mapTrigger(r: TriggerRow): Trigger {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    threadId: r.thread_id,
    actorId: r.actor_id,
    payloadRef: r.payload_ref,
    preview: r.preview,
    status: r.status as TriggerStatus,
    createdAt: r.created_at,
  };
}

export class TriggerRepo {
  constructor(private readonly db: Db) {}

  findByExternal(source: string, externalId: string): Trigger | null {
    const r = row<TriggerRow>(
      this.db
        .prepare(
          "SELECT * FROM triggers WHERE source = ? AND external_id = ?",
        )
        .get(source, externalId),
    );
    return r ? mapTrigger(r) : null;
  }

  get(id: string): Trigger | null {
    const r = row<TriggerRow>(
      this.db.prepare("SELECT * FROM triggers WHERE id = ?").get(id),
    );
    return r ? mapTrigger(r) : null;
  }

  insert(input: {
    source: string;
    externalId: string;
    threadId?: string | null;
    actorId?: string | null;
    payloadRef: string;
    preview: string;
    status: TriggerStatus;
  }): Trigger {
    const id = newId("trg");
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO triggers
         (id, source, external_id, thread_id, actor_id, payload_ref, preview, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.source,
        input.externalId,
        input.threadId ?? null,
        input.actorId ?? null,
        input.payloadRef,
        input.preview,
        input.status,
        createdAt,
      );
    return {
      id,
      source: input.source,
      externalId: input.externalId,
      threadId: input.threadId ?? null,
      actorId: input.actorId ?? null,
      payloadRef: input.payloadRef,
      preview: input.preview,
      status: input.status,
      createdAt,
    };
  }

  setStatus(id: string, from: TriggerStatus, to: TriggerStatus): boolean {
    const result = this.db
      .prepare(
        "UPDATE triggers SET status = ? WHERE id = ? AND status = ?",
      )
      .run(to, id, from);
    return Number(result.changes) > 0;
  }

  listPending(): Trigger[] {
    return rows<TriggerRow>(
      this.db
        .prepare(
          "SELECT * FROM triggers WHERE status = 'pending' ORDER BY created_at",
        )
        .all(),
    ).map(mapTrigger);
  }
}
