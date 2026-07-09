import { z } from 'zod';
import type { AnyTool, ToolDefinition, ToolExecutionContext } from '../kernel/contracts/tool';
import type { ToolResult } from '../kernel/contracts/session';
import type { PageSnapshot } from '../engine/contracts/perception';
import type { PlanStep } from '../engine/contracts/plan';
import type { RunRecord } from '../engine/contracts/trace';
import { AgentLoop } from '../engine/orchestrator/agent-loop';
import { Orchestrator, RunAborted } from '../engine/orchestrator/run';
import { TraceBus } from '../trace/trace-bus';
import { createSecurityGate } from '../guardrails/security';
import type { ToolHost } from './host';

/**
 * The page pack. page_act is the flagship: it hands the goal to the closed-loop
 * engine (perceive → ground → act → verify → heal) and returns a verification
 * report measured against the live DOM — the one thing sidebar assistants
 * cannot do. The kernel never trusts page claims that didn't come from here.
 */

/* ---------------- page_read ---------------- */

function digestSnapshot(snap: PageSnapshot, bodyText: string, maxChars: number): string {
  const lines: string[] = [`PAGE: ${snap.title} — ${snap.url}`];
  if (snap.dialogs.length) lines.push(`OPEN DIALOGS: ${snap.dialogs.join(' | ')}`);
  if (snap.errors.length) lines.push(`VISIBLE ERRORS: ${snap.errors.join(' | ')}`);
  if (snap.toasts.length) lines.push(`TOASTS: ${snap.toasts.join(' | ')}`);

  const groups = Object.entries(snap.groupCounts).filter(([, n]) => n >= 3);
  if (groups.length) lines.push(`REPEATED GROUPS: ${groups.map(([k, n]) => `${k} ×${n}`).join(', ')}`);

  const headings = snap.nodes.filter(n => n.role === 'heading' && n.name).slice(0, 20);
  if (headings.length) lines.push(`HEADINGS: ${headings.map(h => h.name).join(' · ')}`);

  const fields = snap.nodes
    .filter(n => ['textbox', 'combobox', 'checkbox', 'radio', 'switch', 'spinbutton', 'listbox'].includes(n.role))
    .slice(0, 30);
  if (fields.length) {
    lines.push('FORM FIELDS:');
    for (const f of fields) lines.push(`  - ${f.role} "${f.name}"${f.value ? ` = "${f.value}"` : ''}`);
  }

  const actions = snap.nodes.filter(n => (n.role === 'button' || n.role === 'link') && n.name).slice(0, 30);
  if (actions.length) lines.push(`BUTTONS/LINKS: ${actions.map(a => a.name).join(' · ')}`);

  if (bodyText) lines.push('MAIN TEXT:', bodyText);
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(truncated)` : out;
}

async function readBodyText(tabId: number): Promise<string> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText ?? '',
    });
    return typeof result?.result === 'string' ? result.result.replace(/\n{3,}/g, '\n\n') : '';
  } catch {
    return '';
  }
}

/* ---------------- page_act ---------------- */

function summarizeRun(run: RunRecord): string {
  const lines: string[] = [];
  lines.push(`RUN ${run.status.toUpperCase()} — verified checks: ${run.verify.passed} passed, ${run.verify.failed} failed.`);
  if (run.finalAnswer) lines.push(`ANSWER: ${run.finalAnswer}`);
  if (run.failure) lines.push(`FAILURE (${run.failure.diagnosis}): ${run.failure.message}`);
  const evidence: string[] = [];
  for (const step of run.steps) {
    for (const v of step.verifications) {
      evidence.push(`${v.passed ? '✓' : '✗'} ${v.condition.kind}: expected ${v.expected}, actual ${v.actual}`);
      if (evidence.length >= 8) break;
    }
    if (evidence.length >= 8) break;
  }
  if (evidence.length) lines.push('EVIDENCE:', ...evidence.map(e => `  ${e}`));
  lines.push(`(${run.steps.length} steps · run id ${run.id})`);
  return lines.join('\n');
}

export function createPageTools(host: ToolHost): AnyTool[] {
  const pageRead: ToolDefinition<{ maxChars?: number }> = {
    id: 'page_read',
    titleKey: 'tools.page_read',
    description:
      'Read the current page as a semantic digest: title, headings, main text, form fields with current values, buttons/links, open dialogs and error messages. Use before answering any question about the page. Read-only.',
    paramsSchema: z.object({
      maxChars: z.number().int().min(500).max(20000).optional().describe('Digest size cap, default 6000'),
    }),
    riskTier: 'read',
    async execute(params) {
      const acquired = await host.acquireBridge();
      try {
        await acquired.bridge.call('waitReady', { timeoutMs: 5000, quietMs: 250 });
        const snap = await acquired.bridge.call('snapshot', { maxNodes: 200 });
        const body = await readBodyText(acquired.tabId);
        const digest = digestSnapshot(snap, body, params.maxChars ?? 6000);
        return { ok: true, summary: digest };
      } finally {
        acquired.dispose();
      }
    },
  };

  const pageAct: ToolDefinition<{ goal: string }> = {
    id: 'page_act',
    titleKey: 'tools.page_act',
    description:
      'Delegate page work to the verification engine: it operates the page like a careful human (fill, click, select, navigate, multi-step flows) and PROVES the outcome against the live DOM. This is the ONLY way to change a page. Give one complete goal, including concrete values to enter. Returns a verified success/failure report — relay it honestly.',
    paramsSchema: z.object({
      goal: z.string().min(4).describe('Complete instruction with concrete values, e.g. "Add customer 张三, phone 13800138000, then confirm it appears in the list"'),
    }),
    riskTier: 'act',
    async execute(params, ctx) {
      const settings = host.getSettings();
      const bus = new TraceBus();
      const acquired = await host.acquireBridge(params.goal);
      try {
        const security = createSecurityGate({
          confirmDangerous: settings.guardrails.confirmDangerous,
          allowlist: settings.guardrails.allowlist,
          blocklist: settings.guardrails.blocklist,
        });
        const deps = {
          trace: bus,
          security,
          confirmer: { confirm: (step: PlanStep, reason: string) => host.confirmAction(step, reason) },
        };
        const decider = host.getDecider();
        const onUpdate = (r: RunRecord) => ctx.emit({ run: r });
        let run: RunRecord;
        try {
          run = decider
            ? await new AgentLoop(acquired.bridge, decider, deps).run(params.goal, { signal: ctx.signal, onUpdate })
            : await new Orchestrator(acquired.bridge, host.getPlanner(), deps).run(params.goal, { signal: ctx.signal, onUpdate });
        } catch (e) {
          if (e instanceof RunAborted) return { ok: false, summary: 'Cancelled by the user.', error: 'aborted' };
          throw e;
        }
        run.sessionId = ctx.provenance?.sessionId;
        run.toolCallId = ctx.provenance?.toolCallId;
        await host.persistRun(run, bus.events(run.id));
        ctx.emit({ run });
        return { ok: run.status === 'succeeded', summary: summarizeRun(run), data: run, runId: run.id };
      } finally {
        acquired.dispose();
      }
    },
  };

  const pageScreenshot: ToolDefinition<Record<string, never>> = {
    id: 'page_screenshot',
    titleKey: 'tools.page_screenshot',
    description:
      'Capture the visible viewport of the current tab as an image shown to the user in the chat. Use when the user asks for a screenshot. You will not see the pixels yourself.',
    paramsSchema: z.object({}),
    riskTier: 'read',
    async execute(_params, ctx: ToolExecutionContext): Promise<ToolResult> {
      if (ctx.tabId === null) return { ok: false, summary: 'No capturable tab.', error: 'no_tab' };
      const tab = await chrome.tabs.get(ctx.tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return {
        ok: true,
        summary: 'Screenshot captured and shown to the user in the chat.',
        data: { dataUrl },
      };
    },
  };

  return [pageRead, pageAct, pageScreenshot] as unknown as AnyTool[];
}
