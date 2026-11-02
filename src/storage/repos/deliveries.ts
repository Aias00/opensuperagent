import type { Db } from "../db.js";
import { row, rows } from "../db.js";
import type { Delivery, DeliveryStatus } from "../../types.js";
import { newId, nowIso } from "../../ids.js";

interface DeliveryRow {
  id: string;
  idempotency_key: string;
  channel: string;
  target: string;
  content: string;
  status: string;
  external_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDelivery(r: DeliveryRow): Delivery {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    channel: r.channel,
    target: r.target,
    content: r.content,
    status: r.status as DeliveryStatus,
    externalMessageId: r.external_message_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class DeliveryRepo {
  constructor(private readonly db: Db) {}

  get(id: string): Delivery | null {
    const r = row<DeliveryRow>(
      this.db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id),
    );
    return r ? mapDelivery(r) : null;
  }

  findByKey(idempotencyKey: string): Delivery | null {
    const r = row<DeliveryRow>(
      this.db
        .prepare("SELECT * FROM deliveries WHERE idempotency_key = ?")
        .get(idempotencyKey),
    );
    return r ? mapDelivery(r) : null;
  }

  insert(input: {
    idempotencyKey: string;
    channel: string;
    target: string;
    content: string;
  }): Delivery {
    const existing = this.findByKey(input.idempotencyKey);
    if (existing) return existing;

    const id = newId("dlv");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO deliveries
         (id, idempotency_key, channel, target, content, status, external_message_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      )
      .run(
        id,
        input.idempotencyKey,
        input.channel,
        input.target,
        input.content,
        now,
        now,
      );
    return {
      id,
      idempotencyKey: input.idempotencyKey,
      channel: input.channel,
      target: input.target,
      content: input.content,
      status: "pending",
      externalMessageId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  markSent(id: string, externalMessageId: string | null): boolean {
    const result = this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'sent', external_message_id = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'sending')`,
      )
      .run(externalMessageId, nowIso(), id);
    return Number(result.changes) > 0;
  }

  markStatus(id: string, from: DeliveryStatus, to: DeliveryStatus): boolean {
    const result = this.db
      .prepare(
        "UPDATE deliveries SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(to, nowIso(), id, from);
    return Number(result.changes) > 0;
  }

  listPending(): Delivery[] {
    return rows<DeliveryRow>(
      this.db
        .prepare(
          "SELECT * FROM deliveries WHERE status = 'pending' ORDER BY created_at",
        )
        .all(),
    ).map(mapDelivery);
  }

  listByTarget(channel: string, target: string, limit = 100): Delivery[] {
    return rows<DeliveryRow>(
      this.db
        .prepare(
          `SELECT * FROM deliveries
           WHERE channel = ? AND target = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(channel, target, limit),
    ).map(mapDelivery);
  }

  hasExternalMessageId(externalMessageId: string): boolean {
    const r = row<{ x: number }>(
      this.db
        .prepare(
          "SELECT 1 AS x FROM deliveries WHERE external_message_id = ? LIMIT 1",
        )
        .get(externalMessageId),
    );
    return !!r;
  }
}
