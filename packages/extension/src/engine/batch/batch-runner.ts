import type { Bridge } from '../contracts/bridge';
import type { Skill } from '../contracts/skill';
import type { BatchRun, BatchRow } from '../contracts/batch';
import type { RunRecord } from '../contracts/trace';
import type { Planner, OrchestratorDeps } from '../orchestrator/types';
import { Orchestrator, RunAborted } from '../orchestrator/run';
import { bindSkill, validateRow } from './skill-binding';

export function computeStats(rows: BatchRow[]): BatchRun['stats'] {
  const stats = { total: rows.length, succeeded: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of rows) {
    if (r.status === 'succeeded') stats.succeeded++;
    else if (r.status === 'failed') stats.failed++;
    else if (r.status === 'skipped') stats.skipped++;
    else stats.pending++;
  }
  return stats;
}

interface BatchOptions {
  signal?: AbortSignal;
  onRowUpdate?: (batch: BatchRun) => void;
  onRunRecord?: (row: number, run: RunRecord) => void;
  /** rows to run; if omitted, run all pending rows (supports resume / retry-failed). */
  onlyIndices?: number[];
}

/**
 * L7 batch execution: per-row bind → run (with full verify + heal) → checkpoint.
 * Errors are isolated (a bad row never stops the batch), progress is durable
 * (cursor + row status), and the delivery report is derived from real verify results.
 */
export class BatchRunner {
  constructor(
    private bridge: Bridge,
    private planner: Planner,
    private deps: OrchestratorDeps,
  ) {}

  async run(batch: BatchRun, skill: Skill, opts: BatchOptions = {}): Promise<BatchRun> {
    batch.status = 'running';
    batch.startedAt = batch.startedAt ?? new Date().toISOString();
    const orchestrator = new Orchestrator(this.bridge, this.planner, this.deps);

    const indices =
      opts.onlyIndices ?? batch.rows.filter(r => r.status === 'pending').map(r => r.index);

    for (const index of indices) {
      if (opts.signal?.aborted) {
        batch.status = 'paused';
        opts.onRowUpdate?.(structuredClone(batch));
        return batch;
      }
      const row = batch.rows.find(r => r.index === index);
      if (!row) continue;

      batch.cursor = index;
      row.status = 'running';
      row.attempts++;
      batch.stats = computeStats(batch.rows);
      opts.onRowUpdate?.(structuredClone(batch));

      // pre-flight data validation → isolate bad rows without ever touching the page
      const check = validateRow(skill, row.data);
      if (!check.ok) {
        row.status = 'failed';
        row.error = { diagnosis: 'unknown', message: `缺少必填字段 / missing required: ${check.missing.join(', ')}` };
        batch.stats = computeStats(batch.rows);
        opts.onRowUpdate?.(structuredClone(batch));
        continue;
      }

      try {
        const plan = bindSkill(skill, row.data);
        const run = await orchestrator.run(skill.name, {
          kind: 'batch-row',
          batchId: batch.id,
          skillId: skill.id,
          plan,
          signal: opts.signal,
        });
        row.runId = run.id;
        opts.onRunRecord?.(index, run);
        if (run.status === 'succeeded') {
          row.status = 'succeeded';
          row.error = undefined;
        } else if (run.status === 'cancelled') {
          row.status = 'pending';
          batch.status = 'paused';
          batch.stats = computeStats(batch.rows);
          opts.onRowUpdate?.(structuredClone(batch));
          return batch;
        } else {
          row.status = 'failed';
          row.error = run.failure ?? { diagnosis: 'unknown', message: 'row failed verification' };
        }
      } catch (e) {
        if (e instanceof RunAborted) {
          row.status = 'pending';
          batch.status = 'paused';
          opts.onRowUpdate?.(structuredClone(batch));
          return batch;
        }
        row.status = 'failed';
        row.error = { diagnosis: 'unknown', message: e instanceof Error ? e.message : String(e) };
      }

      batch.stats = computeStats(batch.rows);
      opts.onRowUpdate?.(structuredClone(batch));
    }

    batch.status = 'completed';
    batch.finishedAt = new Date().toISOString();
    batch.stats = computeStats(batch.rows);
    opts.onRowUpdate?.(structuredClone(batch));
    return batch;
  }
}
