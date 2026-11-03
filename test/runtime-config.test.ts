import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

it("uses Pizza exclusively and migrates the former auto selector", () => {
  const dir = mkdtempSync(join(tmpdir(), "osa-runtime-config-"));
  const file = join(dir, "config.json");
  try {
    for (const config of [
      {},
      { agent: {} },
      { agent: { engine: "pizza" } },
      { agent: { engine: "auto" } },
    ]) {
      writeFileSync(file, JSON.stringify(config));
      assert.equal(loadConfig(file).agent.engine, "pizza");
    }
    for (const engine of ["builtin", "mvp", "unknown"]) {
      writeFileSync(file, JSON.stringify({ agent: { engine } }));
      assert.throws(() => loadConfig(file), /pizza/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
