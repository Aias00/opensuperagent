import type { IncomingMessage } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readBody(
  req: IncomingMessage,
  maxBytes = 1024 * 1024,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > maxBytes) throw new HttpError(413, "Request body is too large");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
export function parseBody(raw: Buffer): Record<string, any> {
  try {
    const result = JSON.parse(raw.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch {
    throw new HttpError(400, "Expected a JSON object");
  }
}
export function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function hmac(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function verifyHmac(
  secret: string,
  raw: Buffer | string,
  signature: string,
): void {
  if (!secret || !equalSecret(hmac(secret, raw), signature))
    throw new HttpError(401, "Invalid webhook signature");
}
export function freshTimestamp(timestamp: string): void {
  const ms = Number(timestamp) * 1000;
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300000)
    throw new HttpError(401, "Webhook timestamp expired");
}
export async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(
      response.status >= 500 ? 502 : 400,
      `Remote API returned HTTP ${response.status}`,
    );
  return response.json();
}
