import type { ChatTurn, ChatWithToolsResult, LLMProvider } from '../llm/contracts';
import { LLMError } from '../llm/contracts';
import type { AssistantMessage, AssistantPart, ChatMessage, ToolCallRecord } from './contracts/session';
import type { ToolEvent, ToolExecutionContext } from './contracts/tool';
import type { ToolRegistry } from '../tools/registry';
import type { Settings } from '../storage/types';
import { assembleTurns, type EnvironmentInfo } from '../context/assemble';

/**
 * The kernel — the harness's heartbeat. One user turn = one run of this state
 * machine: assemble context → stream the model → dispatch tool calls through
 * the guardrailed registry → feed results back → repeat within budget.
 *
 * The kernel never judges page work itself; page effects are page.act's job
 * and arrive here only as verified tool results.
 */

/** Max model↔tool round-trips per user turn; the model is told when it runs out. */
const MAX_TOOL_ROUNDS = 8;

export interface KernelDeps {
  provider: LLMProvider;
  registry: ToolRegistry;
  getSettings: () => Settings;
  describeEnvironment: () => Promise<EnvironmentInfo>;
  /** Tab the tools should target right now (fresh per call — tabs move). */
  getTargetTab: () => { tabId: number | null; url?: string };
  confirm: (toolId: string, reason: string) => Promise<boolean>;
  requestPermissions: (permissions: string[]) => Promise<boolean>;
}

export interface TurnCallbacks {
  /** Fired on every mutation of the in-progress assistant message. */
  onUpdate: (message: AssistantMessage) => void;
  signal: AbortSignal;
  /** Stamped onto artifacts tools persist (RunRecord provenance). */
  sessionId?: string;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class Kernel {
  constructor(private deps: KernelDeps) {}

  /**
   * Run one user turn to completion. Always resolves to an AssistantMessage —
   * model failures and aborts land in `message.error`, never as exceptions,
   * so the transcript stays consistent.
   */
  async runTurn(history: ChatMessage[], callbacks: TurnCallbacks): Promise<AssistantMessage> {
    const { signal, onUpdate } = callbacks;
    const message: AssistantMessage = { role: 'assistant', id: uid('msg'), parts: [], at: new Date().toISOString() };
    const emit = () => onUpdate({ ...message, parts: [...message.parts] });

    const appendText = (delta: string) => {
      const last = message.parts[message.parts.length - 1];
      if (last?.type === 'text') message.parts[message.parts.length - 1] = { type: 'text', text: last.text + delta };
      else message.parts.push({ type: 'text', text: delta });
      emit();
    };

    const env = await this.deps.describeEnvironment();
    const turns: ChatTurn[] = assembleTurns(env, history);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) {
        message.error = 'aborted';
        emit();
        return message;
      }

      let result: ChatWithToolsResult;
      try {
        result = await this.deps.provider.chatWithTools(turns, this.deps.registry.specs(), appendText, { signal });
      } catch (e) {
        message.error = e instanceof LLMError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        emit();
        return message;
      }

      if (!result.toolCalls.length) {
        emit();
        return message;
      }

      // Close this model turn on the wire, then execute its calls in order.
      turns.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const record: ToolCallRecord = {
          id: call.id,
          toolId: call.name,
          params: parseArgs(call.arguments),
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        const part: AssistantPart = { type: 'tool', call: record };
        message.parts.push(part);
        emit();

        const target = this.deps.getTargetTab();
        const ctx: ToolExecutionContext = {
          tabId: target.tabId,
          signal,
          emit: (ev: ToolEvent) => {
            if (ev.run !== undefined) {
              record.result = { ...(record.result ?? { ok: false, summary: '' }), data: ev.run };
            }
            emit();
          },
          confirm: reason => {
            record.status = 'awaiting_confirmation';
            emit();
            return this.deps.confirm(call.name, reason).then(approved => {
              record.status = 'running';
              emit();
              return approved;
            });
          },
          requestPermissions: perms => this.deps.requestPermissions(perms),
          provenance: { sessionId: callbacks.sessionId, toolCallId: call.id },
        };

        const result_ = await this.deps.registry.execute(call.name, record.params, ctx, this.deps.getSettings(), target.url);
        record.result = result_;
        record.runId = result_.runId;
        record.status = result_.error === 'denied' ? 'denied' : result_.ok ? 'succeeded' : 'failed';
        record.finishedAt = new Date().toISOString();
        emit();

        turns.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result_.summary });
      }
    }

    // Budget exhausted: one last text-only turn so the user gets a wrap-up.
    turns.push({
      role: 'system',
      content: 'Tool budget for this turn is exhausted. Summarize what was accomplished and what remains, without calling more tools.',
    });
    try {
      await this.deps.provider.chatWithTools(turns, [], appendText, { signal });
    } catch {
      message.error = 'tool_budget_exhausted';
    }
    emit();
    return message;
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
