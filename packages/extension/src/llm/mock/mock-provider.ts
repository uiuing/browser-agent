import { z } from 'zod';
import type {
  LLMProvider,
  LLMMessage,
  ChatResult,
  ChatTurn,
  ChatWithToolsResult,
  StructuredOptions,
  ToolSpec,
} from '../contracts';
import { LLMError } from '../contracts';
import { pageSnapshotSchema } from '../../engine/contracts/perception';
import { llmPlanSchema } from '../../engine/contracts/plan';
import { firstJson } from '../parse/extract-structured';
import { planTask } from './mock-planner-core';

/**
 * MockProvider — a deterministic "model" that implements the exact same LLMProvider
 * contract as real providers. Its structuredOutput builds a plan from the real page
 * snapshot and validates it through the SAME zod schema the real providers use
 * (llmPlanSchema), satisfying the "all providers pass one schema" requirement and
 * guaranteeing the full loop runs with no API key.
 */
export class MockProvider implements LLMProvider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;

  async chat(messages: LLMMessage[]): Promise<ChatResult> {
    const last = messages[messages.length - 1]?.content ?? '';
    return { content: `[MockPlanner] I will operate on the page described. (${last.length} chars of context)`, model: 'mock-planner' };
  }

  async streamChat(messages: LLMMessage[], onDelta: (d: string) => void): Promise<ChatResult> {
    const res = await this.chat(messages);
    for (const word of res.content.split(' ')) {
      onDelta(word + ' ');
      await new Promise(r => setTimeout(r, 8));
    }
    return res;
  }

  async structuredOutput<T>(schema: z.ZodType<T>, messages: LLMMessage[], opts: StructuredOptions = {}): Promise<T> {
    if (opts.schemaName === 'Plan' || schema === (llmPlanSchema as unknown as z.ZodType<T>)) {
      // Read only the user message — the system prompt contains schema examples with
      // JSON braces that would otherwise be mistaken for the page snapshot.
      const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      const task = extractTagged(user, 'TASK') ?? extractFirstLine(user);
      const snapJson = firstJson(sliceAfter(user, 'PAGE SNAPSHOT'));
      let snapshot;
      try {
        snapshot = pageSnapshotSchema.parse(JSON.parse(snapJson ?? '{}'));
      } catch {
        throw new LLMError('bad_request', 'MockProvider could not read page snapshot from prompt');
      }
      const plan = planTask(task, snapshot);
      // Validate through the SAME schema real providers must satisfy.
      const parsed = schema.safeParse(plan);
      if (!parsed.success) {
        throw new LLMError('parse_failed', `Mock plan failed schema: ${parsed.error.issues.map(i => i.message).join('; ')}`);
      }
      return parsed.data;
    }
    // Generic fallback: return an empty object validated by schema if possible.
    const parsed = schema.safeParse({});
    if (parsed.success) return parsed.data;
    throw new LLMError('parse_failed', 'MockProvider has no deterministic output for this schema');
  }

  /**
   * Scripted conversation playbook for e2e. Stateless by design — the decision
   * derives entirely from the message history, like a real model:
   *  - last turn is a tool result → summarize it as text;
   *  - user asks about the page → call page.read;
   *  - user asks to close a tab → call tabs.close (exercises the dangerous gate);
   *  - user asks to do work → call page.act with the goal;
   *  - anything else → plain streamed chat.
   */
  async chatWithTools(
    messages: ChatTurn[],
    tools: ToolSpec[],
    onDelta: (d: string) => void,
  ): Promise<ChatWithToolsResult> {
    const stream = async (text: string): Promise<ChatWithToolsResult> => {
      for (const word of text.split(/(?<=\s)/)) {
        onDelta(word);
        await new Promise(r => setTimeout(r, 4));
      }
      return { text, toolCalls: [], model: 'mock' };
    };

    const last = messages[messages.length - 1];
    if (last?.role === 'tool') {
      const body = last.content.slice(0, 400);
      if (last.name === 'page_act') return stream(`[Mock] 执行完成。工具返回：${body}`);
      if (last.name === 'page_read') return stream(`[Mock] 页面内容如下：${body}`);
      return stream(`[Mock] ${last.name} 结果：${body}`);
    }

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const input = lastUser && lastUser.role === 'user' ? lastUser.content : '';
    const has = (name: string) => tools.some(t => t.name === name);
    const call = (name: string, args: Record<string, unknown>): ChatWithToolsResult => ({
      text: '',
      toolCalls: [{ id: `mock_call_${Date.now().toString(36)}`, name, arguments: JSON.stringify(args) }],
      model: 'mock',
    });

    if (/关闭.*标签|close (this |the )?tab/i.test(input) && has('tabs_close')) return call('tabs_close', {});
    if (/总结|读一下|页面(内容|讲|说)|summar|what.*page.*about|read (this |the )?page/i.test(input) && has('page_read'))
      return call('page_read', {});
    if (/添加|新增|新建|填写|录入|创建|提交|删除|修改|add|create|fill|submit|delete|update/i.test(input) && has('page_act'))
      return call('page_act', { goal: input });
    return stream(`[Mock] 你说：“${input}”。我是测试构建里的确定性模型；让我读页面或替你操作页面时我会调用工具。`);
  }
}

function extractTagged(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`${tag}:\\s*([\\s\\S]*?)(?:\\n\\n|PAGE|SNAPSHOT|$)`, 'i'));
  return m ? m[1].trim() : null;
}
function extractFirstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? text;
}
function sliceAfter(text: string, marker: string): string {
  const i = text.indexOf(marker);
  return i === -1 ? text : text.slice(i);
}
