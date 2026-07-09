import type { ChatTurn } from '../llm/contracts';
import type { ChatMessage } from '../kernel/contracts/session';
import { BASE_SYSTEM_PROMPT } from './system-prompt';

/**
 * Context assembly — what the model sees each turn, in layers:
 *  L0 base system prompt (static, cache-friendly)
 *  L1 environment: target tab + open tabs (fresh every turn)
 *  L2 conversation history replayed from the persisted session
 */

export interface EnvironmentInfo {
  targetTab: { url: string; title: string } | null;
  openTabs: Array<{ title: string; url: string }>;
  locale: string;
}

export function renderEnvironment(env: EnvironmentInfo): string {
  const lines: string[] = ['ENVIRONMENT:'];
  lines.push(`- Time: ${new Date().toISOString()} · UI language: ${env.locale}`);
  lines.push(
    env.targetTab
      ? `- Current tab: ${env.targetTab.title || '(untitled)'} — ${env.targetTab.url}`
      : '- Current tab: none reachable (tools that need a page will fail until the user opens one)',
  );
  if (env.openTabs.length) {
    const shown = env.openTabs.slice(0, 12);
    lines.push(`- Open tabs (${env.openTabs.length}):`);
    for (const t of shown) lines.push(`  · ${truncate(t.title || '(untitled)', 60)} — ${truncate(t.url, 80)}`);
    if (env.openTabs.length > shown.length) lines.push(`  · … ${env.openTabs.length - shown.length} more`);
  }
  return lines.join('\n');
}

/** Replay persisted chat messages as provider turns (text ↔ tool call ↔ tool result). */
export function historyToTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ role: 'user', content: m.text });
      continue;
    }
    // Split assistant parts into wire turns: consecutive text accumulates into
    // one assistant turn; each tool call closes it and appends the tool result.
    let text = '';
    for (const part of m.parts) {
      if (part.type === 'text') {
        text += part.text;
      } else {
        turns.push({
          role: 'assistant',
          content: text,
          toolCalls: [{ id: part.call.id, name: part.call.toolId, arguments: JSON.stringify(part.call.params ?? {}) }],
        });
        text = '';
        turns.push({
          role: 'tool',
          toolCallId: part.call.id,
          name: part.call.toolId,
          content: part.call.result?.summary ?? '(no result)',
        });
      }
    }
    if (text) turns.push({ role: 'assistant', content: text });
  }
  return turns;
}

export function assembleTurns(env: EnvironmentInfo, history: ChatMessage[]): ChatTurn[] {
  return [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    { role: 'system', content: renderEnvironment(env) },
    ...historyToTurns(history),
  ];
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
