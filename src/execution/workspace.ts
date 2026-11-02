import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { DataPaths } from "../paths.js";

export class WorkspaceManager {
  constructor(private readonly paths: DataPaths) {}

  ensureTaskWorkspace(taskId: string): string {
    const dir = this.paths.workspace(taskId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Create an isolated worktree from a local repo cache.
   * Fetch + worktree creation for the same repo must be serialized by the caller.
   */
  createWorktree(input: {
    taskId: string;
    repoCachePath: string;
    branch: string;
    baseRef?: string;
  }): { workspacePath: string; branch: string } {
    const workspacePath = this.ensureTaskWorkspace(input.taskId);
    const worktreePath = `${workspacePath}/repo`;
    if (existsSync(worktreePath)) {
      return { workspacePath: worktreePath, branch: input.branch };
    }

    if (!existsSync(input.repoCachePath)) {
      throw new Error(`Repo cache missing: ${input.repoCachePath}`);
    }

    const base = input.baseRef ?? "HEAD";
    execFileSync(
      "git",
      ["worktree", "add", "-b", input.branch, worktreePath, base],
      { cwd: input.repoCachePath, stdio: "pipe" },
    );
    return { workspacePath: worktreePath, branch: input.branch };
  }
}
