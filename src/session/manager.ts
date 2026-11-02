import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Store } from "../storage/index.js";
import type { DataPaths } from "../paths.js";
import type { SessionRow, Run, InboxItem } from "../types.js";
import { TaggingStore } from "./tagging-store.js";

/**
 * Session facade handle. Pizza wiring is injected; until then prompt is a stub
 * that advances Run state for local dry-runs.
 */
export interface SessionFacadeHandle {
  session: SessionRow;
  tagging: TaggingStore | null;
  prompt(text: string): Promise<void>;
  abort(reason?: string): Promise<void>;
  close(): Promise<void>;
}

export type FacadeFactory = (input: {
  session: SessionRow;
  cwd?: string;
  systemPrompt?: string;
  modelProfile?: string;
}) => Promise<SessionFacadeHandle>;

/** Default dry-run facade — no LLM; marks runs completed after prompt. */
export function createDryRunFacadeFactory(store: Store): FacadeFactory {
  return async ({ session }) => {
    let aborted = false;
    return {
      session,
      tagging: null,
      async prompt(_text: string) {
        if (aborted) return;
        const active = store.runs.findActive(session.id);
        if (active?.status === "pending") {
          store.runs.transition(active.id, "pending", "submitted");
        }
        const run = store.runs.findActive(session.id);
        if (run) {
          store.runs.transition(run.id, "submitted", "completed");
          if (run.id) {
            const items = store.inbox
              .listPending(session.owner)
              .filter((i) => i.runId === run.id);
            // Dry-run: mark any bound items done via direct SQL if needed.
            void items;
          }
        }
      },
      async abort() {
        aborted = true;
        const active = store.runs.findActive(session.id);
        if (active) {
          store.runs.transition(
            active.id,
            active.status as "pending" | "submitted",
            "aborted",
          );
        }
      },
      async close() {
        /* no-op */
      },
    };
  };
}

export class SessionManager {
  private readonly facades = new Map<string, SessionFacadeHandle>();

  constructor(
    private readonly store: Store,
    private readonly paths: DataPaths,
    private readonly facadeFactory: FacadeFactory,
  ) {}

  ensureSession(owner: string): SessionRow {
    const eventsPath = this.paths.sessionEvents(owner, "main");
    mkdirSync(dirname(eventsPath), { recursive: true });
    return this.store.sessions.ensure(owner, eventsPath);
  }

  async open(
    owner: string,
    opts?: { cwd?: string; systemPrompt?: string; modelProfile?: string },
  ): Promise<SessionFacadeHandle> {
    const existing = this.facades.get(owner);
    if (existing) return existing;

    const session = this.ensureSession(owner);
    const handle = await this.facadeFactory({
      session,
      cwd: opts?.cwd,
      systemPrompt: opts?.systemPrompt,
      modelProfile: opts?.modelProfile,
    });
    this.facades.set(owner, handle);
    return handle;
  }

  get(owner: string): SessionFacadeHandle | undefined {
    return this.facades.get(owner);
  }

  isIdle(owner: string): boolean {
    const session = this.store.sessions.getByOwner(owner);
    if (!session) return true;
    return this.store.runs.findActive(session.id) === null;
  }

  /**
   * Create a Run, bind pending inbox items, submit prompt (§9.2 steps 1–2).
   * Returns null if session busy or inbox empty.
   */
  beginRun(
    owner: string,
    formatPrompt: (items: InboxItem[]) => string,
  ): { run: Run; items: InboxItem[]; promptText: string } | null {
    if (!this.isIdle(owner)) return null;
    const items = this.store.inbox.listPending(owner);
    if (items.length === 0) return null;

    const session = this.ensureSession(owner);
    return this.store.transaction(() => {
      // Re-check single-writer inside tx
      if (this.store.runs.findActive(session.id)) return null;
      const pending = this.store.inbox.listPending(owner);
      if (pending.length === 0) return null;

      const run = this.store.runs.create(session.id);
      this.store.inbox.bindToRun(
        pending.map((i) => i.id),
        run.id,
      );
      const promptText = formatPrompt(pending);
      return { run, items: pending, promptText };
    });
  }

  async recoverIncomplete(): Promise<number> {
    const incomplete = this.store.runs.listIncomplete();
    let n = 0;
    for (const run of incomplete) {
      // Without Pizza event store lookup yet: mark failed and leave accepted
      // inbox items for a follow-up run with interrupt note (see §9.2).
      if (run.status === "pending") {
        // No receipt — leave pending for re-submit by owner loop.
        n += 1;
        continue;
      }
      this.store.runs.transition(run.id, "submitted", "failed");
      n += 1;
    }
    return n;
  }

  async closeAll(): Promise<void> {
    for (const handle of this.facades.values()) {
      await handle.close();
    }
    this.facades.clear();
  }
}
