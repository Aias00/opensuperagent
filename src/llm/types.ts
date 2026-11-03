export interface LlmConfig {
  provider: string;
  protocol?: "openai-compatible" | "anthropic";
  baseUrl: string;
  apiKey: string;
  routerModel: string;
  workerModel: string;
  maxTokens?: number;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
