import { readFileSync } from "node:fs";
import type { DataPaths } from "../paths.js";
import type { Trigger } from "../types.js";
export function triggerText(paths: DataPaths, trigger: Trigger): string {
  if (!/^blob_[a-zA-Z0-9]+\.json$/.test(trigger.payloadRef))
    return trigger.preview;
  try {
    const payload = JSON.parse(
      readFileSync(paths.blob(trigger.payloadRef), "utf8"),
    );
    return typeof payload.text === "string" ? payload.text : trigger.preview;
  } catch {
    return trigger.preview;
  }
}
