import type { EventBus } from "../events/bus.js";
import type { LlmClient } from "./client.js";
import type { ChatMessage, ChatTool } from "./types.js";

export type ToolExecutor = (input: {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}) => Promise<unknown>;

/**
 * OpenAI-compatible tool loop for one Run.
 * Stops when the model returns no tool calls, or maxSteps reached.
 */
export async function runToolLoop(input: {
  client: LlmClient;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: ChatTool[];
  execute: ToolExecutor;
  events: EventBus;
  scope: string;
  maxSteps?: number;
  signal?: AbortSignal;
  runId?: string;
  yieldOnBusy?: boolean;
}): Promise<{ steps: number; finalText: string | null }> {
  const maxSteps = input.maxSteps ?? 24;
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];

  let finalText: string | null = null;
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    input.signal?.throwIfAborted();
    steps = i + 1;
    const result = await input.client.chat({
      model: input.model,
      signal: input.signal,
      messages,
      tools: input.tools,
    });

    const msg = result.message;
    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    if (msg.content) {
      input.events.emit({
        scope: input.scope,
        kind: "assistant",
        summary: msg.content.slice(0, 240),
      });
    }

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      finalText = msg.content;
      break;
    }

    for (const call of calls) {
      input.signal?.throwIfAborted();
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = { _raw: call.function.arguments };
      }

      input.events.emit({
        scope: input.scope,
        kind: "tool",
        summary: `${call.function.name}`,
        payload: { runId: input.runId, toolCallId: call.id, args },
      });

      let toolResult: unknown;
      try {
        const tool = input.tools.find(
          (t) => t.function.name === call.function.name,
        );
        if (!tool)
          throw new Error(`Tool ${call.function.name} is not available`);
        const invalid = validateToolArguments(args, tool.function.parameters);
        if (invalid)
          throw new Error(
            `Invalid tool arguments: ${invalid}. Retry with a complete JSON object matching the tool schema.`,
          );
        toolResult = await input.execute({
          toolCallId: call.id,
          name: call.function.name,
          args,
        });
      } catch (err) {
        toolResult = { error: String(err) };
      }

      input.events.emit({
        scope: input.scope,
        kind: "tool_result",
        summary: `${call.function.name} → ${summarize(toolResult)}`,
        payload: {
          runId: input.runId,
          toolCallId: call.id,
          result: toolResult,
        },
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(toolResult),
      });
      if (
        input.yieldOnBusy &&
        toolResult &&
        typeof toolResult === "object" &&
        "busy" in toolResult
      )
        return { steps, finalText: null };
    }
  }

  return { steps, finalText };
}

/** Provider tool schemas guide generation; validate again before any side effect. */
function validateToolArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = "arguments",
): string | null {
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return `${path} must be an object`;
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of (schema.required ?? []) as string[])
      if (!Object.hasOwn(object, key)) return `${path}.${key} is required`;
    for (const [key, item] of Object.entries(object)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false)
          return `${path}.${key} is not allowed`;
      } else {
        const error = validateToolArguments(
          item,
          properties[key]!,
          `${path}.${key}`,
        );
        if (error) return error;
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (let i = 0; i < value.length; i++) {
      const error = validateToolArguments(
        value[i],
        (schema.items ?? {}) as Record<string, unknown>,
        `${path}[${i}]`,
      );
      if (error) return error;
    }
  } else if (
    type &&
    (typeof value !== type || (type === "number" && !Number.isFinite(value)))
  )
    return `${path} must be ${type}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return `${path} must be one of ${schema.enum.join(", ")}`;
  return null;
}

function summarize(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return String(value);
  }
}
