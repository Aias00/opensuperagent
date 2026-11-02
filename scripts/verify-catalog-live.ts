/** Explicit real-model verification in a temporary instance; no external messages. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { loadLlmConfig } from "../src/llm/client.js";
import { SettingsStore } from "../src/settings/store.js";
import { importSeed } from "../src/catalog/index.js";

async function main() {
  const config = loadConfig();
  const settings = new SettingsStore(
    config.instance.data_root,
    loadLlmConfig(),
  );
  assert.ok(settings.ready, "Configure Router and Worker LLM routes first");
  const router = settings.resolve("router");
  const worker = settings.resolve("worker", "worker-strong");
  const dir = mkdtempSync(join(tmpdir(), "osa-catalog-"));
  config.instance.data_root = dir;
  config.instance.max_active_tasks = 2;
  config.router.instructions =
    "Three independent catalog validation requests arrive together. Create one separate Task for each input using its explicitly named Worker. Preserve every concrete acceptance check. Do not answer instead of dispatching. Do not merge inputs.";
  const app = new App(config, { legacyLlm: null });
  importSeed(app.store, resolve("seed"));
  for (const [id, llm, model] of [
    ["router", router, router.routerModel],
    ["worker", worker, worker.workerModel],
  ] as const) {
    app.settings.saveProvider({
      id,
      name: id,
      protocol: llm.protocol ?? "openai-compatible",
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      models: [model],
      maxTokens: 4096,
    });
  }
  app.settings.saveRouting({
    router: { providerId: "router", model: router.routerModel },
    worker: { providerId: "worker", model: worker.workerModel },
    profiles: {},
  });
  const skillCalls: {
    taskId: string;
    name: string;
    action: string;
    path?: string;
  }[] = [];
  const execResults: { taskId: string; exitCode: number }[] = [];
  const fixture = "export const add = (a, b) => a - b;\n";
  let peakActiveWorkers = 0;
  app.events.on((event) => {
    const payload = event.payload as any;
    if (event.kind === "tool" && event.summary === "skill")
      skillCalls.push({ taskId: event.scope, ...payload.args });
    if (
      event.kind === "tool_result" &&
      event.summary.startsWith("exec →") &&
      typeof payload.result?.exitCode === "number"
    )
      execResults.push({
        taskId: event.scope,
        exitCode: payload.result.exitCode,
      });
    if (
      event.kind === "tool_result" &&
      event.summary.startsWith("start_task →") &&
      payload.result?.taskId
    ) {
      const task = app.store.tasks.get(payload.result.taskId);
      if (task?.definition.id === "qa")
        writeFileSync(join(task.workspacePath, "calc.mjs"), fixture);
    }
    if (["run_completed", "run_failed"].includes(event.kind))
      console.log(`[catalog] ${event.scope} ${event.kind}`);
  });
  const requests = [
    {
      id: "docs",
      skill: "technical-writing",
      text: "请使用 docs Worker。先读取 technical-writing SKILL.md，再写 getting-started.md，说明 GET /health 返回 HTTP 200 和 JSON {ok:true}，包含一个 curl 示例和验证预期。用 read 复核文件后 submit_result completed，notice 包含 CATALOG_DOCS_OK。不运行 shell。",
    },
    {
      id: "data",
      skill: "data-quality",
      text: "请使用 data Worker。读取 data-quality 的 SKILL.md 和 scripts/profile_csv.py。创建 sample.csv，内容为 id,score\\na,10\\nb,\\na,10\\n（这里的\\n表示真正换行）。将技能中的原始脚本写为 profile_csv.py 并执行 python3 profile_csv.py sample.csv > quality.json。读取 JSON，确认 rows=3、duplicate_rows=1、blank_by_column.score=1；保持 sample.csv 原样。submit_result completed，notice 包含 CATALOG_DATA_OK。",
    },
    {
      id: "qa",
      skill: "regression-testing",
      text: "请使用 qa Worker。已有 calc.mjs 故意把 add 写成减法。先读 regression-testing SKILL.md，再读取 calc.mjs，编写 calc.test.mjs，使用 node:test 和 assert 断言 add(2,3)===5。实际运行 node --test calc.test.mjs，确认失败并写 regression.md 记录实际预期和实际值。不要修复或修改 calc.mjs。验证目标是成功复现已知 bug，因此用 submit_result completed，notice 包含 CATALOG_QA_OK。",
    },
  ];
  const started = Date.now();
  try {
    await app.start();
    const inputs = requests.map((request) => ({
      ...request,
      triggerId: app.submitConsole({
        text: request.text,
        threadId: `catalog-${request.id}`,
      }).trigger.id,
    }));
    while (Date.now() - started < 300000) {
      const tasks = app.store.tasks.list();
      const active = app.store.runs
        .listIncomplete()
        .filter(
          (run) => app.store.sessions.get(run.sessionId)?.owner !== "router",
        ).length;
      peakActiveWorkers = Math.max(peakActiveWorkers, active);
      if (
        tasks.length === 3 &&
        tasks.every((task) => app.store.tasks.isTerminal(task.status)) &&
        app.store.runs.listIncomplete().length === 0
      )
        break;
      await new Promise((done) => setTimeout(done, 300));
    }
    const results = inputs.map((input) => {
      const task = app.store.tasks
        .list()
        .find((task) => task.originTriggerId === input.triggerId);
      const read = (name: string) => {
        try {
          return readFileSync(join(task!.workspacePath, name), "utf8");
        } catch {
          return "";
        }
      };
      let artifactsVerified = false;
      if (input.id === "docs")
        artifactsVerified =
          /\/health/.test(read("getting-started.md")) &&
          /curl/.test(read("getting-started.md")) &&
          /200/.test(read("getting-started.md"));
      if (input.id === "data") {
        try {
          const quality = JSON.parse(read("quality.json"));
          artifactsVerified =
            quality.rows === 3 &&
            quality.duplicate_rows === 1 &&
            quality.blank_by_column.score === 1 &&
            read("sample.csv") === "id,score\na,10\nb,\na,10\n" &&
            read("profile_csv.py") ===
              readFileSync(
                "seed/skills/data-quality/scripts/profile_csv.py",
                "utf8",
              );
        } catch {}
      }
      if (input.id === "qa")
        artifactsVerified =
          read("calc.mjs") === fixture &&
          read("calc.test.mjs").includes("node:test") &&
          read("regression.md").length > 30 &&
          execResults.some(
            (result) => result.taskId === task?.id && result.exitCode !== 0,
          );
      return {
        worker: input.id,
        actualWorker: task?.definition.id,
        status: task?.status,
        skillRead: skillCalls.some(
          (call) =>
            call.taskId === task?.id &&
            call.action === "read" &&
            call.name === input.skill,
        ),
        artifactsVerified,
        noticeVerified:
          task?.result?.notice.includes(
            `CATALOG_${input.id.toUpperCase()}_OK`,
          ) ?? false,
      };
    });
    const report = {
      at: new Date().toISOString(),
      llm: "real configured provider; isolated temporary instance",
      routerModel: router.routerModel,
      workerModel: worker.workerModel,
      concurrentInputs: 3,
      capacity: 2,
      peakActiveWorkers,
      durationMs: Date.now() - started,
      results,
      passed:
        results.every(
          (result) =>
            result.actualWorker === result.worker &&
            result.status === "completed" &&
            result.skillRead &&
            result.artifactsVerified &&
            result.noticeVerified,
        ) && peakActiveWorkers === 2,
    };
    writeFileSync(
      "docs/verification/catalog-live-result.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
