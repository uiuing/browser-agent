import { z } from 'zod';
import type {
  LLMProvider,
  LLMMessage,
  ChatOptions,
  ChatResult,
  ChatTurn,
  ChatWithToolsResult,
  StructuredOptions,
  ProviderConfig,
  ToolCallRequest,
  ToolSpec,
} from '../contracts';
import { LLMError } from '../contracts';
import { extractStructured } from '../parse/extract-structured';
import { promptedToolsTurn } from '../parse/prompted-tools';
import { chatCompletionsUrl } from '../endpoints';

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, timeoutMs: number, external?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  external?.addEventListener('abort', onAbort);
  try {
    return await p(ctrl.signal);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

function mapHttpError(status: number, body: string): LLMError {
  if (status === 401 || status === 403) return new LLMError('auth_failed', `Auth failed (${status})`, false, status);
  if (status === 429) return new LLMError('rate_limited', 'Rate limited', true, status);
  if (status >= 500) return new LLMError('network', `Server error ${status}`, true, status);
  return new LLMError('bad_request', `Request failed ${status}: ${body.slice(0, 200)}`, false, status);
}

/** OpenAI-compatible provider (OpenAI, DeepSeek, Qwen, GLM, Kimi, Ollama, custom). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly kind = 'openai-compatible' as const;
  constructor(private config: ProviderConfig) {
    this.id = config.id;
  }

  private endpoint(): string {
    return chatCompletionsUrl(this.config.baseUrl);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };
  }

  async chat(messages: LLMMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const retries = opts.retries ?? 1;
    let attempt = 0;
    for (;;) {
      try {
        return await withTimeout(
          async signal => {
            const res = await fetch(this.endpoint(), {
              method: 'POST',
              headers: this.headers(),
              signal,
              body: JSON.stringify({
                model: opts.model ?? this.config.model,
                messages,
                temperature: opts.temperature ?? 0.2,
                max_tokens: opts.maxTokens,
                stream: false,
              }),
            });
            if (!res.ok) throw mapHttpError(res.status, await res.text());
            const data = await res.json();
            return {
              content: data.choices?.[0]?.message?.content ?? '',
              model: data.model ?? this.config.model,
              usage: data.usage
                ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
                : undefined,
            };
          },
          opts.timeoutMs ?? 60000,
          opts.signal,
        );
      } catch (e) {
        const err = normalize(e);
        if (err.retryable && attempt < retries) {
          attempt++;
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  async streamChat(messages: LLMMessage[], onDelta: (d: string) => void, opts: ChatOptions = {}): Promise<ChatResult> {
    return withTimeout(
      async signal => {
        const res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: this.headers(),
          signal,
          body: JSON.stringify({
            model: opts.model ?? this.config.model,
            messages,
            temperature: opts.temperature ?? 0.2,
            stream: true,
          }),
        });
        if (!res.ok || !res.body) throw mapHttpError(res.status, await res.text().catch(() => ''));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = '';
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                content += delta;
                onDelta(delta);
              }
            } catch {
              /* ignore keepalive lines */
            }
          }
        }
        return { content, model: opts.model ?? this.config.model };
      },
      opts.timeoutMs ?? 120000,
      opts.signal,
    );
  }

  async structuredOutput<T>(schema: z.ZodType<T>, messages: LLMMessage[], opts: StructuredOptions = {}): Promise<T> {
    const repairAttempts = opts.repairAttempts ?? 1;
    let convo = [...messages];
    for (let i = 0; i <= repairAttempts; i++) {
      const result = await this.chat(convo, { ...opts, temperature: opts.temperature ?? 0 });
      const parsed = extractStructured(result.content, schema);
      if (parsed.ok) return parsed.data as T;
      if (i === repairAttempts)
        throw new LLMError('parse_failed', `Structured parse failed: ${parsed.error}${parsed.rawSnippet ? ` | raw: ${parsed.rawSnippet}` : ''}`);
      convo = [
        ...messages,
        { role: 'assistant', content: result.content },
        {
          role: 'user',
          content: `Your previous response could not be parsed (${parsed.error}). Respond again with ONLY valid JSON matching the requested schema, no prose, no markdown.`,
        },
      ];
    }
    throw new LLMError('parse_failed', 'unreachable');
  }

  /** Set after the endpoint rejects native `tools` once; we stop retrying it. */
  private nativeToolsUnsupported = false;

  async chatWithTools(
    messages: ChatTurn[],
    tools: ToolSpec[],
    onDelta: (d: string) => void,
    opts: ChatOptions = {},
  ): Promise<ChatWithToolsResult> {
    if (this.nativeToolsUnsupported) {
      return promptedToolsTurn((m, o) => this.chat(m, o), messages, tools, onDelta, opts);
    }
    try {
      return await this.nativeToolsTurn(messages, tools, onDelta, opts);
    } catch (e) {
      // Older Ollama models / thin gateways 400 on `tools` — remember and degrade.
      if (e instanceof LLMError && e.code === 'bad_request') {
        this.nativeToolsUnsupported = true;
        return promptedToolsTurn((m, o) => this.chat(m, o), messages, tools, onDelta, opts);
      }
      throw e;
    }
  }

  private async nativeToolsTurn(
    messages: ChatTurn[],
    tools: ToolSpec[],
    onDelta: (d: string) => void,
    opts: ChatOptions,
  ): Promise<ChatWithToolsResult> {
    return withTimeout(
      async signal => {
        const res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: this.headers(),
          signal,
          body: JSON.stringify({
            model: opts.model ?? this.config.model,
            messages: messages.map(toWireMessage),
            temperature: opts.temperature ?? 0.2,
            ...(tools.length
              ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
              : {}),
            stream: true,
          }),
        });
        if (!res.ok || !res.body) throw mapHttpError(res.status, await res.text().catch(() => ''));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let buffer = '';
        let model = opts.model ?? this.config.model;
        // tool_call deltas arrive as fragments keyed by index; assemble them here.
        const calls = new Map<number, { id: string; name: string; args: string }>();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              model = json.model ?? model;
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.content) {
                text += delta.content;
                onDelta(delta.content);
              }
              for (const tc of delta.tool_calls ?? []) {
                const idx = tc.index ?? 0;
                const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name += tc.function.name;
                if (tc.function?.arguments) cur.args += tc.function.arguments;
                calls.set(idx, cur);
              }
            } catch {
              /* ignore keepalive lines */
            }
          }
        }

        const toolCalls: ToolCallRequest[] = Array.from(calls.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.args || '{}' }))
          .filter(c => c.name);
        return { text, toolCalls, model };
      },
      opts.timeoutMs ?? 120000,
      opts.signal,
    );
  }
}

/** Map a rich turn onto the Chat Completions wire format. */
function toWireMessage(m: ChatTurn): Record<string, unknown> {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

function normalize(e: unknown): LLMError {
  if (e instanceof LLMError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') return new LLMError('timeout', 'Request timed out', true);
  return new LLMError('network', e instanceof Error ? e.message : String(e), true);
}
