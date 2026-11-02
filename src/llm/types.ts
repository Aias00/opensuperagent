export interface LlmConfig {
  provider: string;
  protocol?: "openai-compatible" | "anthropic";
  baseUrl: string;
  apiKey: string;
  routerModel: string;
  workerModel: string;
  maxTokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  message: ChatMessage;
  finishReason: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
