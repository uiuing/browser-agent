import { z } from 'zod';
import type { ChatOptions, ChatResult, ChatTurn, ChatWithToolsResult, LLMMessage, ToolSpec } from '../contracts';
import { extractStructured } from './extract-structured';

/**
 * Prompted-JSON tool calling — the fallback for endpoints that reject native
 * `tools` (older Ollama models, thin OpenAI-compatible gateways). The tool
 * catalog goes into a system prompt, the model answers with one JSON object,
 * and we normalize it to the same ChatWithToolsResult native paths return.
 */

const promptedTurnSchema = z.object({
  reply: z.string().default(''),
  tool_calls: z
    .array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }))
    .default([]),
});

function toolCatalog(tools: ToolSpec[]): string {
  return tools
    .map(t => `- ${t.name}: ${t.description}\n  parameters (JSON Schema): ${JSON.stringify(t.parameters)}`)
    .join('\n');
}

function promptedSystem(tools: ToolSpec[]): string {
  return [
    'You can call tools. Respond with ONLY one JSON object, no prose, no markdown:',
    '{"reply": "<text for the user, may be empty>", "tool_calls": [{"name": "<tool name>", "arguments": {...}}]}',
    'Call at most one tool per turn. When no tool is needed, return an empty tool_calls array.',
    'AVAILABLE TOOLS:',
    toolCatalog(tools),
  ].join('\n');
}

/** Flatten rich turns into plain messages for providers speaking text only. */
export function flattenTurns(messages: ChatTurn[]): LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user') {
      out.push({ role: m.role, content: m.content });
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls?.length
        ? `\n[tool calls] ${JSON.stringify(m.toolCalls.map(c => ({ name: c.name, arguments: c.arguments })))}`
        : '';
      out.push({ role: 'assistant', content: `${m.content}${calls}` });
    } else {
      out.push({ role: 'user', content: `[tool result: ${m.name}]\n${m.content}` });
    }
  }
  return out;
}

let promptedSeq = 0;

export async function promptedToolsTurn(
  chat: (messages: LLMMessage[], opts?: ChatOptions) => Promise<ChatResult>,
  messages: ChatTurn[],
  tools: ToolSpec[],
  onDelta: (delta: string) => void,
  opts: ChatOptions = {},
): Promise<ChatWithToolsResult> {
  const flat: LLMMessage[] = [{ role: 'system', content: promptedSystem(tools) }, ...flattenTurns(messages)];
  const result = await chat(flat, { ...opts, temperature: opts.temperature ?? 0.2 });
  const parsed = extractStructured(result.content, promptedTurnSchema);
  if (!parsed.ok || !parsed.data) {
    // Model ignored the format — treat the whole output as a plain reply.
    onDelta(result.content);
    return { text: result.content, toolCalls: [], model: result.model, usage: result.usage };
  }
  if (parsed.data.reply) onDelta(parsed.data.reply);
  return {
    text: parsed.data.reply,
    toolCalls: parsed.data.tool_calls.map(c => ({
      id: `prompted_${Date.now().toString(36)}_${promptedSeq++}`,
      name: c.name,
      arguments: JSON.stringify(c.arguments),
    })),
    model: result.model,
    usage: result.usage,
  };
}
