import { z } from 'zod';
import type { AnyTool, ToolDefinition } from '../kernel/contracts/tool';
import type { PlanStep } from '../engine/contracts/plan';
import type { RunRecord } from '../engine/contracts/trace';
import type { BatchRun } from '../engine/contracts/batch';
import { Orchestrator, RunAborted } from '../engine/orchestrator/run';
import { BatchRunner, computeStats } from '../engine/batch/batch-runner';
import { bindSkill } from '../engine/batch/skill-binding';
import { TraceBus } from '../trace/trace-bus';
import { createSecurityGate } from '../guardrails/security';
import type { ToolHost } from './host';

/** Skill pack — deterministic replay of taught skills from the chat. */

export function createSkillTools(host: ToolHost): AnyTool[] {
  const skillsList: ToolDefinition<Record<string, never>> = {
    id: 'skills_list',
    titleKey: 'tools.skills_list',
    description: 'List the user\'s saved skills (reusable, verified page workflows) with the input slots each one needs.',
    paramsSchema: z.object({}),
    riskTier: 'read',
    async execute() {
      const skills = await host.listSkills();
      if (!skills.length) return { ok: true, summary: 'No saved skills. Skills are extracted from successful runs on the Skills page.' };
      const lines = skills.map(s => {
        const slots = s.slots.map(sl => `${sl.name}${sl.required ? '' : '?'}`).join(', ');
        return `- id "${s.id}": ${s.name} — ${s.description || s.urlPattern}${slots ? ` (slots: ${slots})` : ''}`;
      });
      return { ok: true, summary: lines.join('\n') };
    },
  };

  const skillsRun: ToolDefinition<{ skillId: string; data?: Record<string, string> }> = {
    id: 'skills_run',
    titleKey: 'tools.skills_run',
    description:
      'Run a saved skill once with slot values. Deterministic compiled replay with per-step verification — prefer this over page_act when a matching skill exists. Get ids and slot names from skills_list.',
    paramsSchema: z.object({
      skillId: z.string(),
      data: z.record(z.string(), z.string()).optional().describe('Slot values keyed by slot name'),
    }),
    riskTier: 'act',
    async execute(params, ctx) {
      const skills = await host.listSkills();
      const skill = skills.find(s => s.id === params.skillId) ?? skills.find(s => s.name === params.skillId);
      if (!skill) return { ok: false, summary: `Skill "${params.skillId}" not found. Call skills_list first.`, error: 'not_found' };

      const missing = skill.slots.filter(s => s.required && !(params.data ?? {})[s.name]);
      if (missing.length) {
        return {
          ok: false,
          summary: `Missing required slot values: ${missing.map(s => s.name).join(', ')}. Ask the user, then retry.`,
          error: 'missing_slots',
        };
      }

      const settings = host.getSettings();
      const bus = new TraceBus();
      const acquired = await host.acquireBridge(`${skill.name} ${skill.urlPattern}`);
      try {
        const security = createSecurityGate({
          confirmDangerous: settings.guardrails.confirmDangerous,
          allowlist: settings.guardrails.allowlist,
          blocklist: settings.guardrails.blocklist,
        });
        const orchestrator = new Orchestrator(acquired.bridge, host.getPlanner(), {
          trace: bus,
          security,
          confirmer: { confirm: (step: PlanStep, reason: string) => host.confirmAction(step, reason) },
        });
        const plan = bindSkill(skill, params.data ?? {});
        let run: RunRecord;
        try {
          run = await orchestrator.run(skill.name, {
            kind: 'skill',
            skillId: skill.id,
            plan,
            signal: ctx.signal,
            onUpdate: r => ctx.emit({ run: r }),
          });
        } catch (e) {
          if (e instanceof RunAborted) return { ok: false, summary: 'Cancelled by the user.', error: 'aborted' };
          throw e;
        }
        run.sessionId = ctx.provenance?.sessionId;
        run.toolCallId = ctx.provenance?.toolCallId;
        await host.persistRun(run, bus.events(run.id));
        ctx.emit({ run });
        const verdict = `SKILL "${skill.name}" ${run.status.toUpperCase()} — verified checks: ${run.verify.passed} passed, ${run.verify.failed} failed.${run.failure ? ` Failure: ${run.failure.message}` : ''}`;
        return { ok: run.status === 'succeeded', summary: verdict, data: run, runId: run.id };
      } finally {
        acquired.dispose();
      }
    },
  };

  const batchStart: ToolDefinition<{ skillId: string; rows: Array<Record<string, string>> }> = {
    id: 'batch_start',
    titleKey: 'tools.batch_start',
    description:
      'Run a saved skill over MULTIPLE data rows (e.g. the user pasted a table). Per-row verification, bad rows isolated, progress checkpointed. High-impact: touches many records in one go.',
    paramsSchema: z.object({
      skillId: z.string(),
      rows: z.array(z.record(z.string(), z.string())).min(1).max(200).describe('One record per row, keyed by slot name'),
    }),
    riskTier: 'dangerous',
    async execute(params, ctx) {
      const skills = await host.listSkills();
      const skill = skills.find(s => s.id === params.skillId) ?? skills.find(s => s.name === params.skillId);
      if (!skill) return { ok: false, summary: `Skill "${params.skillId}" not found. Call skills_list first.`, error: 'not_found' };

      const settings = host.getSettings();
      const bus = new TraceBus();
      const acquired = await host.acquireBridge(`${skill.name} ${skill.urlPattern}`);
      try {
        // Batch rows auto-proceed the per-action gate — the user already approved
        // the batch itself through the dangerous-tier confirmation.
        const security = createSecurityGate({
          confirmDangerous: false,
          allowlist: settings.guardrails.allowlist,
          blocklist: settings.guardrails.blocklist,
        });
        const runner = new BatchRunner(acquired.bridge, host.getPlanner(), { trace: bus, security });
        const batch: BatchRun = {
          id: `batch_${Date.now().toString(36)}`,
          skillId: skill.id,
          name: `${skill.name} × ${params.rows.length}`,
          createdAt: new Date().toISOString(),
          status: 'draft',
          cursor: 0,
          rows: params.rows.map((data, index) => ({ index, data, status: 'pending' as const, attempts: 0 })),
          stats: { total: params.rows.length, succeeded: 0, failed: 0, skipped: 0, pending: params.rows.length },
        };
        const result = await runner.run(batch, skill, {
          signal: ctx.signal,
          onRowUpdate: async b => {
            ctx.emit({ note: `${b.stats.succeeded + b.stats.failed}/${b.stats.total}` });
            await host.persistBatch(b);
          },
          onRunRecord: async (_i, run) => {
            run.sessionId = ctx.provenance?.sessionId;
            run.toolCallId = ctx.provenance?.toolCallId;
            await host.persistRun(run, bus.events(run.id));
          },
        });
        result.stats = computeStats(result.rows);
        await host.persistBatch(result);
        const failedRows = result.rows.filter(r => r.status === 'failed').map(r => r.index + 1);
        return {
          ok: result.stats.failed === 0 && result.status === 'completed',
          summary:
            `BATCH ${result.status.toUpperCase()} — ${result.stats.succeeded}/${result.stats.total} rows verified succeeded, ${result.stats.failed} failed.` +
            (failedRows.length ? ` Failed rows: ${failedRows.join(', ')} (re-runnable on the Batch page).` : ''),
          data: result,
        };
      } finally {
        acquired.dispose();
      }
    },
  };

  return [skillsList, skillsRun, batchStart] as unknown as AnyTool[];
}
