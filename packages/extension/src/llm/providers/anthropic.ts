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
import { anthropicMessagesUrl } from '../endpoints';

/** Anthropic Messages API provider. */
export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly kind = 'anthropic' as const;
  constructor(private config: ProviderConfig) {
    this.id = config.id;
  }

  private split(messages: LLMMessage[]): { system: string; msgs: { role: 'user' | 'assistant'; content: string }[] } {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const msgs = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    return { system, msgs };
  }

  async chat(messages: LLMMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const { system, msgs } = this.split(messages);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch(anthropicMessagesUrl(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...this.config.headers,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model ?? this.config.model,
          system,
          messages: msgs,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.2,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) throw new LLMError('auth_failed', 'Auth failed', false, res.status);
        if (res.status === 429) throw new LLMError('rate_limited', 'Rate limited', true, res.status);
        throw new LLMError('bad_request', `Anthropic ${res.status}: ${body.slice(0, 200)}`, res.status >= 500, res.status);
      }
      const data = await res.json();
      const content = Array.isArray(data.content) ? data.content.map((c: { text?: string }) => c.text ?? '').join('') : '';
      return {
        content,
        model: data.model ?? this.config.model,
        usage: data.usage ? { promptTokens: data.usage.input_tokens ?? 0, completionTokens: data.usage.output_tokens ?? 0 } : undefined,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw new LLMError('timeout', 'Timed out', true);
      throw new LLMError('network', e instanceof Error ? e.message : String(e), true);
    } finally {
      clearTimeout(timer);
    }
  }

  async streamChat(messages: LLMMessage[], onDelta: (d: string) => void, opts: ChatOptions = {}): Promise<ChatResult> {
    // Simplicity: use non-streaming then emit once. Keeps one code path robust.
    const result = await this.chat(messages, opts);
    onDelta(result.content);
    return result;
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
        { role: 'user', content: `Could not parse (${parsed.error}). Reply with ONLY valid JSON, no markdown.` },
      ];
    }
    throw new LLMError('parse_failed', 'unreachable');
  }

  async chatWithTools(
    messages: ChatTurn[],
    tools: ToolSpec[],
    onDelta: (d: string) => void,
    opts: ChatOptions = {},
  ): Promise<ChatWithToolsResult> {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const msgs = toAnthropicMessages(messages);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch(anthropicMessagesUrl(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...this.config.headers,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model ?? this.config.model,
          ...(system ? { system } : {}),
          messages: msgs,
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.2,
          ...(tools.length
            ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) throw new LLMError('auth_failed', 'Auth failed', false, res.status);
        if (res.status === 429) throw new LLMError('rate_limited', 'Rate limited', true, res.status);
        throw new LLMError('bad_request', `Anthropic ${res.status}: ${body.slice(0, 200)}`, res.status >= 500, res.status);
      }
      const data = await res.json();
      let text = '';
      const toolCalls: ToolCallRequest[] = [];
      for (const block of data.content ?? []) {
        if (block.type === 'text' && block.text) text += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
        }
      }
      if (text) onDelta(text);
      return {
        text,
        toolCalls,
        model: data.model ?? this.config.model,
        usage: data.usage ? { promptTokens: data.usage.input_tokens ?? 0, completionTokens: data.usage.output_tokens ?? 0 } : undefined,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw new LLMError('timeout', 'Timed out', true);
      throw new LLMError('network', e instanceof Error ? e.message : String(e), true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Map rich turns onto Anthropic content blocks (tool_use / tool_result). */
function toAnthropicMessages(messages: ChatTurn[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: safeParseJson(c.arguments) });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else {
      // Anthropic requires tool_result inside a user message.
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
    }
  }
  return out;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
