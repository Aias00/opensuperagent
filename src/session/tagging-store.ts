/**
 * Tagging store wrapper for Pizza SessionEventStore (§9.2).
 *
 * Marks the first USER_MESSAGE of a prompt with idempotency_key = `run:<runId>`.
 * Concrete Pizza types are duck-typed so the module compiles without a hard
 * dependency on @tomsun28/pizza at build time.
 */

export interface EventAppendInput {
  type: string;
  idempotency_key?: string | null;
  [key: string]: unknown;
}

export interface SessionEventStoreLike {
  append(e: EventAppendInput): unknown;
  appendBatch?(events: EventAppendInput[]): unknown;
  flush?(): Promise<void>;
  closeAsync?(): Promise<void>;
  close?(): void;
  query?(...args: unknown[]): unknown;
  subscribe?(...args: unknown[]): unknown;
}

export class TaggingStore {
  pendingRunId: string | undefined;
  private taggedForRun: string | null = null;

  constructor(private readonly inner: SessionEventStoreLike) {}

  beginRun(runId: string): void {
    this.pendingRunId = runId;
    this.taggedForRun = null;
  }

  append(e: EventAppendInput): unknown {
    return this.inner.append(this.maybeTag(e));
  }

  appendBatch(events: EventAppendInput[]): unknown {
    if (!this.inner.appendBatch) {
      return events.map((e) => this.append(e));
    }
    return this.inner.appendBatch(events.map((e) => this.maybeTag(e)));
  }

  private maybeTag(e: EventAppendInput): EventAppendInput {
    if (e.type === "USER_MESSAGE" && this.pendingRunId) {
      if (this.taggedForRun === this.pendingRunId) {
        console.error(
          `[session] multiple USER_MESSAGE for run ${this.pendingRunId}`,
        );
        return e;
      }
      const tagged = {
        ...e,
        idempotency_key: `run:${this.pendingRunId}`,
      };
      this.taggedForRun = this.pendingRunId;
      this.pendingRunId = undefined;
      return tagged;
    }
    return e;
  }

  flush(): Promise<void> {
    return this.inner.flush?.() ?? Promise.resolve();
  }

  closeAsync(): Promise<void> {
    return this.inner.closeAsync?.() ?? Promise.resolve();
  }

  close(): void {
    this.inner.close?.();
  }

  /** Proxy remaining store methods. */
  get raw(): SessionEventStoreLike {
    return this.inner;
  }
}

export function runIdempotencyKey(runId: string): string {
  return `run:${runId}`;
}
