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
import { responsesUrl } from '../endpoints';

/**
 * OpenAI Responses API provider (POST {base}/responses) — the API OpenAI now
 * recommends over Chat Completions. Follows the official spec:
 *  - system messages map to `instructions`
 *  - the rest map to `input` items `{ role, content }`
 *  - output text is read from `output[].content[].text` (`output_text` parts),
 *    with the SDK-style `output_text` convenience field as a fallback.
 */
export class OpenAIResponsesProvider implements LLMProvider {
  readonly id: string;
  readonly kind = 'openai-responses' as const;
  constructor(private config: ProviderConfig) {
    this.id = config.id;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };
  }

  async chat(messages: LLMMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const instructions = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(responsesUrl(this.config.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model ?? this.config.model,
          ...(instructions ? { instructions } : {}),
          input,
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) throw new LLMError('auth_failed', `Auth failed (${res.status})`, false, res.status);
        if (res.status === 429) throw new LLMError('rate_limited', 'Rate limited', true, res.status);
        if (res.status >= 500) throw new LLMError('network', `Server error ${res.status}`, true, res.status);
        throw new LLMError('bad_request', `Request failed ${res.status}: ${body.slice(0, 200)}`, false, res.status);
      }
      const data = await res.json();
      return {
        content: readOutputText(data),
        model: data.model ?? this.config.model,
        usage: data.usage
          ? { promptTokens: data.usage.input_tokens ?? 0, completionTokens: data.usage.output_tokens ?? 0 }
          : undefined,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw new LLMError('timeout', 'Request timed out', true);
      throw new LLMError('network', e instanceof Error ? e.message : String(e), true);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async streamChat(messages: LLMMessage[], onDelta: (d: string) => void, opts: ChatOptions = {}): Promise<ChatResult> {
    // One robust code path: non-streaming request, emitted once.
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
    const instructions = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const input = toResponsesInput(messages);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(responsesUrl(this.config.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model ?? this.config.model,
          ...(instructions ? { instructions } : {}),
          input,
          temperature: opts.temperature ?? 0.2,
          ...(tools.length
            ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })) }
            : {}),
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) throw new LLMError('auth_failed', `Auth failed (${res.status})`, false, res.status);
        if (res.status === 429) throw new LLMError('rate_limited', 'Rate limited', true, res.status);
        if (res.status >= 500) throw new LLMError('network', `Server error ${res.status}`, true, res.status);
        throw new LLMError('bad_request', `Request failed ${res.status}: ${body.slice(0, 200)}`, false, res.status);
      }
      const data = await res.json();
      const text = readOutputText(data);
      const toolCalls: ToolCallRequest[] = (data.output ?? [])
        .filter((item: { type?: string }) => item.type === 'function_call')
        .map((item: { call_id?: string; id?: string; name?: string; arguments?: string }, i: number) => ({
          id: item.call_id ?? item.id ?? `call_${i}`,
          name: item.name ?? '',
          arguments: item.arguments ?? '{}',
        }))
        .filter((c: ToolCallRequest) => c.name);
      if (text) onDelta(text);
      return {
        text,
        toolCalls,
        model: data.model ?? this.config.model,
        usage: data.usage
          ? { promptTokens: data.usage.input_tokens ?? 0, completionTokens: data.usage.output_tokens ?? 0 }
          : undefined,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') throw new LLMError('timeout', 'Request timed out', true);
      throw new LLMError('network', e instanceof Error ? e.message : String(e), true);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Map rich turns onto Responses API input items (function_call / function_call_output). */
function toResponsesInput(messages: ChatTurn[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content });
      for (const c of m.toolCalls ?? []) {
        out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments });
      }
    } else {
      out.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
    }
  }
  return out;
}

/** Per spec: concatenate all `output_text` parts of `message` items in `output`. */
function readOutputText(data: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (Array.isArray(data.output)) {
    const text = data.output
      .filter(item => item.type === 'message' || item.content)
      .flatMap(item => item.content ?? [])
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
    if (text) return text;
  }
  return data.output_text ?? '';
}
