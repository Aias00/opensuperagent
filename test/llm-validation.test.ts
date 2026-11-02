import { it } from "node:test";
import assert from "node:assert/strict";
import { runToolLoop } from "../src/llm/loop.js";
import { WORKER_CHAT_TOOLS } from "../src/llm/tools-worker.js";
import type { LlmClient } from "../src/llm/client.js";
import type { ChatMessage } from "../src/llm/types.js";
import { temporaryApp } from "./helpers/harness.js";

it("rejects malformed model submissions before execution and lets the model retry with valid arguments", async () => {
  const h = temporaryApp();
  const valid = {
    outcome: "completed",
    notice: "Verified",
    summary: "File written and read back",
    artifacts: ["verified.txt"],
  };
  const invalid = [
    null,
    [],
    {
      outcome: "completed",
      notice: "Malformed </notice><parameter name=summary>",
    },
    { ...valid, outcome: "invented" },
    { ...valid, summary: null },
    { ...valid, artifacts: [123] },
    { ...valid, extra: true },
  ];
  let count = 0;
  let executed = 0;
  let replies: ChatMessage[] = [];
  const client = {
    async chat(input: { messages: ChatMessage[] }) {
      if (count++ === 0)
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [...invalid, valid].map((args, i) => ({
              id: `call-${i}`,
              type: "function",
              function: {
                name: "submit_result",
                arguments: JSON.stringify(args),
              },
            })),
          },
        };
      replies = input.messages.filter((m) => m.role === "tool");
      return { message: { role: "assistant", content: "Done" } };
    },
  } as unknown as LlmClient;
  try {
    await runToolLoop({
      client,
      model: "test",
      systemPrompt: "test",
      userPrompt: "test",
      tools: WORKER_CHAT_TOOLS,
      events: h.app.events,
      scope: "router",
      execute: async ({ args }) => {
        executed++;
        assert.deepEqual(args, valid);
        return { accepted: true };
      },
    });
    assert.equal(executed, 1);
    assert.equal(replies.length, invalid.length + 1);
    for (const message of replies.slice(0, -1))
      assert.match(
        JSON.parse(message.content!).error,
        /Invalid tool arguments/,
      );
    assert.deepEqual(JSON.parse(replies.at(-1)!.content!), { accepted: true });
  } finally {
    await h.close();
  }
});
