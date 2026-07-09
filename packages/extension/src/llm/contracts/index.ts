import { z } from 'zod';

export const providerKindSchema = z.enum(['openai-compatible', 'openai-responses', 'anthropic', 'mock']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerConfigSchema = z.object({
  id: z.string(),
  kind: providerKindSchema,
  label: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type LLMMessage = z.infer<typeof llmMessageSchema>;

/* ---------------- tool calling (kernel conversation) ---------------- */

/** Provider-agnostic tool spec; each provider maps it onto its wire format. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/** A tool invocation as emitted by the model (arguments still raw JSON text). */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Conversation turns for tool-calling chats. Richer than LLMMessage: assistant
 * turns may carry tool calls, and tool turns feed results back to the model.
 */
export type ChatTurn =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatWithToolsResult {
  text: string;
  toolCalls: ToolCallRequest[];
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  retries?: number;
}

export interface StructuredOptions extends ChatOptions {
  schemaName?: string;
  repairAttempts?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export type LLMErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'parse_failed'
  | 'aborted'
  | 'not_configured';

export class LLMError extends Error {
  constructor(
    public code: LLMErrorCode,
    message: string,
    public retryable = false,
    public status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface LLMProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  chat(messages: LLMMessage[], opts?: ChatOptions): Promise<ChatResult>;
  streamChat(messages: LLMMessage[], onDelta: (delta: string) => void, opts?: ChatOptions): Promise<ChatResult>;
  structuredOutput<T>(schema: z.ZodType<T>, messages: LLMMessage[], opts?: StructuredOptions): Promise<T>;
  /**
   * One conversational turn with native tool calling; text streams via onDelta.
   * Providers without native tool support fall back to prompted JSON internally
   * — callers always get the same ChatWithToolsResult shape.
   */
  chatWithTools(
    messages: ChatTurn[],
    tools: ToolSpec[],
    onDelta: (delta: string) => void,
    opts?: ChatOptions,
  ): Promise<ChatWithToolsResult>;
}

export const PROVIDER_TEMPLATES: Array<Omit<ProviderConfig, 'id' | 'apiKey' | 'enabled'>> = [
  { kind: 'openai-compatible', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { kind: 'openai-responses', label: 'OpenAI (Responses API)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { kind: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  { kind: 'openai-compatible', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { kind: 'openai-compatible', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { kind: 'openai-compatible', label: '通义千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { kind: 'openai-compatible', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air' },
  { kind: 'openai-compatible', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { kind: 'openai-compatible', label: 'Ollama (本地/local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
];
