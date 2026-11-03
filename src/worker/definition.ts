import type { WorkerDefinitionSpec } from "../types.js";

export const NATIVE_WORKER_COMMANDS = new Set([
  "_read", "_write", "_edit", "_skill",
]);

/** Validate command permissions without rewriting definitions or snapshots. */
export function validateWorkerTools(spec: WorkerDefinitionSpec): void {
  if (!Array.isArray(spec.tools) || !spec.tools.every((name) => typeof name === "string"))
    throw new Error(`Worker ${spec.id}: tools must be an array of allowed CLI commands`);
  const unsupported = spec.tools.filter((name) =>
    !NATIVE_WORKER_COMMANDS.has(name) && !["_submit_result", "submit_result"].includes(name),
  );
  if (unsupported.length)
    throw new Error(
      `Worker ${spec.id}: obsolete or unsupported tools ${unsupported.join(", ")}. CLI is enabled automatically; tools must list _read/_write/_edit/_skill permissions. Update the definition and create a new Task. Background start/stop have no CLI equivalent and are not migrated automatically.`,
    );
  if (spec.tools.includes("_submit_result") || spec.tools.includes("submit_result"))
    throw new Error(`Worker ${spec.id}: remove submit_result from tools; _submit_result is registered automatically`);
  if (new Set(spec.tools).size !== spec.tools.length)
    throw new Error(`Worker ${spec.id}: duplicate CLI commands`);
  if (spec.cli !== undefined && (
    !spec.cli ||
    typeof spec.cli.allowShell !== "boolean" ||
    Object.keys(spec.cli).some((key) => key !== "allowShell")
  )) throw new Error(`Worker ${spec.id}: cli only accepts allowShell; declare underscore commands in tools`);
}
