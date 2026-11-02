import {
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  constants,
} from "node:fs";

/**
 * Exclusive instance lock so only one main process owns a data directory (P4).
 * Uses O_EXCL create; stale locks from dead pids are reclaimable.
 */
export class InstanceLock {
  private fd: number | null = null;

  constructor(private readonly lockPath: string) {}

  acquire(): void {
    if (this.fd !== null) return;

    if (existsSync(this.lockPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.lockPath, "utf8")) as {
          pid?: number;
        };
        if (raw.pid && isAlive(raw.pid)) {
          throw new Error(
            `Instance lock held by pid ${raw.pid}: ${this.lockPath}`,
          );
        }
        unlinkSync(this.lockPath);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Instance lock")) {
          throw err;
        }
        try {
          unlinkSync(this.lockPath);
        } catch {
          /* ignore */
        }
      }
    }

    try {
      this.fd = openSync(
        this.lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      );
    } catch {
      throw new Error(`Failed to acquire instance lock: ${this.lockPath}`);
    }

    writeFileSync(
      this.fd,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
  }

  release(): void {
    if (this.fd === null) return;
    try {
      closeSync(this.fd);
    } catch {
      /* ignore */
    }
    this.fd = null;
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
