import { randomUUID } from "node:crypto";

export function newId(prefix?: string): string {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}
