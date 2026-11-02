import type { ChatTool } from "./types.js";
import type { WorkerTools } from "../worker/tools.js";
import type { SubmitOutcome } from "../types.js";

export const WORKER_CHAT_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file inside the task workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Write a file inside the task workspace. Fails if a command is running.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description: "Replace oldText with newText in a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description:
        "Run a short synchronous shell command (≤120s) in the workspace.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string" },
          timeoutSec: { type: "number" },
        },
        required: ["cmd"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start",
      description: "Start a background command; returns operationId.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string" },
          deadlineAt: { type: "string" },
        },
        required: ["cmd"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop",
      description: "Stop a background operation by id.",
      parameters: {
        type: "object",
        properties: { operationId: { type: "string" } },
        required: ["operationId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill",
      description: "List or read skills snapshotted for this task.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "read"] },
          name: { type: "string" },
          path: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_result",
      description:
        "Submit final result to the user. completed requires no running command and no pending inbox.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["completed", "failed", "needs_input"],
          },
          notice: { type: "string" },
          summary: { type: "string" },
          artifacts: { type: "array", items: { type: "string" } },
        },
        required: ["outcome", "notice", "summary"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeWorkerTool(input: {
  tools: WorkerTools;
  taskId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const { tools, taskId, name, args } = input;
  const definition = tools.definition(taskId);
  if (!definition.tools.includes(name))
    return { error: `Tool ${name} is not permitted by the Worker definition` };
  switch (name) {
    case "read":
      return { content: tools.read(taskId, String(args.path)) };
    case "write":
      return tools.write(taskId, String(args.path), String(args.content));
    case "edit":
      return tools.edit(
        taskId,
        String(args.path),
        String(args.oldText),
        String(args.newText),
      );
    case "exec":
      return tools.exec(
        taskId,
        String(args.cmd),
        args.timeoutSec == null ? undefined : Number(args.timeoutSec),
      );
    case "start":
      return tools.start(
        taskId,
        String(args.cmd),
        args.deadlineAt == null ? undefined : String(args.deadlineAt),
      );
    case "stop":
      return tools.stop(taskId, String(args.operationId));
    case "skill":
      if (args.action === "list") return tools.skillList(taskId);
      return {
        content: tools.skillRead(
          taskId,
          String(args.name),
          args.path == null ? "SKILL.md" : String(args.path),
        ),
      };
    case "submit_result":
      return tools.submitResult({
        sessionId: input.sessionId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        taskId,
        outcome: args.outcome as SubmitOutcome,
        notice: String(args.notice),
        summary: String(args.summary),
        artifacts: args.artifacts as string[] | undefined,
      });
    default:
      return { error: `unknown tool ${name}` };
  }
}
