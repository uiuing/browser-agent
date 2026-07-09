import type { BatchRun } from '../contracts/batch';
import type { Skill } from '../contracts/skill';

export interface DeliveryReport {
  batchId: string;
  batchName: string;
  skillName: string;
  generatedAt: string;
  stats: BatchRun['stats'];
  accuracy: number;
  rows: {
    index: number;
    data: Record<string, string>;
    status: string;
    reason?: string;
    runId?: string;
  }[];
}

export function buildDeliveryReport(batch: BatchRun, skill: Skill): DeliveryReport {
  const done = batch.stats.succeeded + batch.stats.failed;
  return {
    batchId: batch.id,
    batchName: batch.name,
    skillName: skill.name,
    generatedAt: new Date().toISOString(),
    stats: batch.stats,
    accuracy: done > 0 ? Math.round((batch.stats.succeeded / done) * 1000) / 10 : 0,
    rows: batch.rows.map(r => ({
      index: r.index,
      data: r.data,
      status: r.status,
      reason: r.error?.message,
      runId: r.runId,
    })),
  };
}

export function reportToCsv(report: DeliveryReport): string {
  const cols = Array.from(new Set(report.rows.flatMap(r => Object.keys(r.data))));
  const header = ['#', ...cols, 'status', 'reason'].join(',');
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const lines = report.rows.map(r =>
    [String(r.index + 1), ...cols.map(c => esc(r.data[c] ?? '')), r.status, esc(r.reason ?? '')].join(','),
  );
  return [header, ...lines].join('\n');
}
