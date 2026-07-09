import * as React from 'react';
import {
  Layers,
  Play,
  RotateCcw,
  Download,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  CircleDot,
} from 'lucide-react';
import { useStore } from '../store';
import { Badge, Button, Card, Label, Textarea } from '../components/primitives';
import { Select } from '../components/overlays';
import { EmptyState } from '../components/EmptyState';
import { toast } from '../components/Toaster';
import type { Skill } from '../../engine/contracts/skill';
import type { BatchRun, BatchRow } from '../../engine/contracts/batch';
import { buildDeliveryReport, reportToCsv } from '../../engine/batch/report';

function parseTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (l: string) =>
    (l.includes('\t') ? l.split('\t') : l.split(',')).map((s) => s.trim());
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export function BatchPage({ initialSkill }: { initialSkill: Skill | null }) {
  const t = useStore((s) => s.t);
  const skills = useStore((s) => s.skills);
  const batches = useStore((s) => s.batches);
  const startBatch = useStore((s) => s.startBatch);
  const isRunning = useStore((s) => s.isRunning);
  const reloadBatches = useStore((s) => s.reloadBatches);

  const [skillId, setSkillId] = React.useState(
    initialSkill?.id ?? skills[0]?.id ?? '',
  );
  const [raw, setRaw] = React.useState('');
  const [current, setCurrent] = React.useState<BatchRun | null>(null);

  React.useEffect(() => {
    void reloadBatches();
  }, [reloadBatches]);
  React.useEffect(() => {
    if (initialSkill) setSkillId(initialSkill.id);
  }, [initialSkill]);

  const skill = skills.find((s) => s.id === skillId) ?? null;
  const liveBatch = current
    ? (batches.find((b) => b.id === current.id) ?? current)
    : null;

  const parsed = React.useMemo(() => parseTable(raw), [raw]);

  const sample = () => {
    if (!skill) return;
    const cols = skill.slots.map((s) => s.name);
    const header = cols.join(',');
    const examples = skill.slots.map((s) => s.example ?? '');
    const rows = SAMPLE_ROWS(skill).map((r) =>
      cols.map((c) => r[c] ?? '').join(','),
    );
    setRaw([header, ...(rows.length ? rows : [examples.join(',')])].join('\n'));
  };

  const start = async () => {
    if (!skill) return;
    const cols = parsed.headers;
    const rows: BatchRow[] = parsed.rows.map((cells, i) => ({
      index: i,
      data: Object.fromEntries(
        skill.slots.map((slot) => {
          const ci = cols.findIndex((c) => c === slot.name || c === slot.label);
          return [slot.name, ci >= 0 ? (cells[ci] ?? '') : ''];
        }),
      ),
      status: 'pending' as const,
      attempts: 0,
    }));
    const batch: BatchRun = {
      id: `batch_${Date.now().toString(36)}`,
      skillId: skill.id,
      name: `${skill.name} · ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      status: 'draft',
      cursor: 0,
      rows,
      stats: {
        total: rows.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        pending: rows.length,
      },
    };
    setCurrent(batch);
    try {
      const result = await startBatch(batch, skill);
      setCurrent(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const rerunFailed = async () => {
    if (!liveBatch || !skill) return;
    const failed = liveBatch.rows
      .filter((r) => r.status === 'failed')
      .map((r) => r.index);
    if (!failed.length) return;
    const reset = {
      ...liveBatch,
      rows: liveBatch.rows.map((r) =>
        r.status === 'failed'
          ? { ...r, status: 'pending' as const, error: undefined }
          : r,
      ),
    };
    setCurrent(reset);
    const result = await startBatch(reset, skill, failed);
    setCurrent(result);
  };

  const exportReport = () => {
    if (!liveBatch || !skill) return;
    const report = buildDeliveryReport(liveBatch, skill);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${skill.name}-report.json`;
    a.click();
    const csv = new Blob([reportToCsv(report)], { type: 'text/csv' });
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(csv);
    a2.download = `${skill.name}-report.csv`;
    a2.click();
    toast.success(t('common.export'));
  };

  if (skills.length === 0) {
    return (
      <EmptyState
        className='h-full'
        icon={<Layers className='h-6 w-6' />}
        title={t('batch.emptyTitle')}
        desc={t('batch.emptyDesc')}
      />
    );
  }

  // report / progress view
  if (liveBatch) {
    const report = skill ? buildDeliveryReport(liveBatch, skill) : null;
    const done = liveBatch.status === 'completed';
    return (
      <div className='flex h-full flex-col'>
        <div className='p-3'>
          <div className='flex items-center justify-between'>
            <div className='text-sm font-semibold'>
              {done ? t('batch.report') : t('batch.progress')}
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCurrent(null)}
              disabled={isRunning}
            >
              {t('common.back')}
            </Button>
          </div>
          <BatchStatsBar stats={liveBatch.stats} t={t} />
          {done && report && (
            <div className='mt-2 flex items-center gap-2'>
              <Badge
                tone={
                  report.accuracy === 100
                    ? 'verified'
                    : report.accuracy >= 80
                      ? 'primary'
                      : 'failed'
                }
              >
                {t('batch.accuracy')}: {report.accuracy}%
              </Badge>
            </div>
          )}
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-3'>
          <div className='space-y-2'>
            {liveBatch.rows.map((row) => (
              <div
                key={row.index}
                className='flex items-start gap-2 rounded-lg px-3 py-2 glass-sm'
              >
                <RowIcon status={row.status} />
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-[12px] font-medium'>
                    #{row.index + 1} ·{' '}
                    {Object.values(row.data)
                      .slice(0, 3)
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {row.error && (
                    <div className='mt-0.5 text-[11px] text-failed'>
                      {row.error.message}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className='flex gap-2 p-3 pt-1'>
          {done && liveBatch.stats.failed > 0 && (
            <Button
              variant='secondary'
              size='sm'
              onClick={rerunFailed}
              disabled={isRunning}
              loading={isRunning}
            >
              <RotateCcw className='h-3.5 w-3.5' />
              {t('batch.rerunFailed')}
            </Button>
          )}
          {done && (
            <Button variant='ghost' size='sm' onClick={exportReport}>
              <Download className='h-3.5 w-3.5' />
              {t('batch.exportReport')}
            </Button>
          )}
          {isRunning && (
            <div className='flex items-center gap-2 text-[12px] text-muted-fg'>
              <Loader2 className='h-4 w-4 pf-spin' /> {t('batch.running')}
            </div>
          )}
        </div>
      </div>
    );
  }

  // setup view
  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      <div className='space-y-4 p-3'>
        <div className='space-y-1.5'>
          <Label>{t('batch.selectSkill')}</Label>
          <Select
            value={skillId}
            onValueChange={setSkillId}
            options={skills.map((s) => ({ value: s.id, label: s.name }))}
            className='w-full'
            ariaLabel={t('batch.selectSkill')}
          />
        </div>

        <div className='space-y-1.5'>
          <div className='flex items-center justify-between'>
            <Label>{t('batch.pasteData')}</Label>
            <Button
              variant='link'
              size='sm'
              className='h-auto p-0'
              onClick={sample}
            >
              {t('batch.sampleData')}
            </Button>
          </div>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            placeholder={skill?.slots.map((s) => s.name).join(',')}
            className='font-mono text-[12px]'
          />
          <div className='text-[11px] text-muted-fg'>
            {t('batch.pasteHint')}
          </div>
        </div>

        {parsed.rows.length > 0 && skill && (
          <Card className='p-3'>
            <div className='mb-2 text-[12px] font-medium'>
              {t('batch.mapping')}
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {skill.slots.map((slot) => {
                const matched = parsed.headers.some(
                  (h) => h === slot.name || h === slot.label,
                );
                return (
                  <Badge key={slot.name} tone={matched ? 'verified' : 'failed'}>
                    {slot.label} {matched ? '✓' : '✗'}
                  </Badge>
                );
              })}
            </div>
            <div className='mt-2 text-[11px] text-muted-fg'>
              {t('batch.rows', { n: parsed.rows.length })}
            </div>
          </Card>
        )}
      </div>
      <div className='mt-auto p-3 pt-1'>
        <Button
          className='w-full'
          onClick={start}
          disabled={!skill || parsed.rows.length === 0 || isRunning}
          loading={isRunning}
        >
          <Play className='h-4 w-4' />
          {t('batch.start')}
        </Button>
      </div>
    </div>
  );
}

function BatchStatsBar({
  stats,
  t,
}: {
  stats: BatchRun['stats'];
  t: (k: string) => string;
}) {
  const total = Math.max(1, stats.total);
  const seg = (n: number, color: string) => (
    <div
      style={{ width: `${(n / total) * 100}%`, background: color }}
      className='h-full'
    />
  );
  return (
    <div className='mt-2 space-y-1.5'>
      <div className='flex h-2.5 overflow-hidden rounded-full inset'>
        {seg(stats.succeeded, 'var(--verified)')}
        {seg(stats.failed, 'var(--failed)')}
        {seg(stats.skipped, 'var(--skipped)')}
      </div>
      <div className='flex flex-wrap gap-2 text-[11px]'>
        <span className='text-verified'>
          ● {t('batch.succeeded')} {stats.succeeded}
        </span>
        <span className='text-failed'>
          ● {t('batch.failed')} {stats.failed}
        </span>
        <span className='text-skipped'>
          ● {t('batch.pending')} {stats.pending}
        </span>
        <span className='text-muted-fg'>
          {t('common.total')} {stats.total}
        </span>
      </div>
    </div>
  );
}

function RowIcon({ status }: { status: BatchRow['status'] }) {
  if (status === 'succeeded')
    return <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-verified' />;
  if (status === 'failed')
    return <XCircle className='mt-0.5 h-4 w-4 shrink-0 text-failed' />;
  if (status === 'running')
    return <Loader2 className='mt-0.5 h-4 w-4 shrink-0 pf-spin text-running' />;
  if (status === 'skipped')
    return <MinusCircle className='mt-0.5 h-4 w-4 shrink-0 text-skipped' />;
  return <CircleDot className='mt-0.5 h-4 w-4 shrink-0 text-muted-fg' />;
}

function SAMPLE_ROWS(skill: Skill): Record<string, string>[] {
  // realistic, business-like sample data mapped to whatever slots the skill has
  const pools: Record<string, string[]> = {
    name: [
      '张伟',
      '李娜',
      '王芳',
      '陈杰',
      '刘洋',
      '杨敏',
      '赵磊',
      '周涛',
      'Jane Doe',
      'Mark Lin',
    ],
    company: [
      '云图科技',
      '合众贸易',
      '星和物流',
      '锐博医疗',
      '海岸零售',
      'Acme Inc',
      'Northwind',
      'Globex',
    ],
    phone: [
      '13800138000',
      '13912345678',
      '13700007777',
      '13566668888',
      '555-0142',
      '555-0199',
    ],
    email: [
      'zhangwei@example.com',
      'lina@yun-tu.com',
      'wangfang@hezhong.cn',
      'jane@acme.io',
      'mark@globex.com',
    ],
    region: ['华东区', '华南区', '华北区', '西部区', 'East', 'South'],
    level: ['重点', '普通', '战略', 'Key', 'Standard'],
    note: ['重点客户', '老客户复购', '新签约', '待跟进', 'VIP', 'follow up'],
    title: [
      '无线鼠标',
      '机械键盘',
      '4K 显示器',
      'USB-C 扩展坞',
      'Wireless Mouse',
    ],
    price: ['129', '399', '1799', '299', '59'],
    stock: ['200', '50', '30', '120', '500'],
    category: ['外设', '显示', '配件', 'Peripherals'],
    date: ['2026-07-01', '2026-06-15', '2026-05-20', '2026-07-02'],
  };
  const n = 6;
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, string> = {};
    for (const slot of skill.slots) {
      const pool = pools[slot.name] ?? [
        slot.example ?? `${slot.label}${i + 1}`,
      ];
      row[slot.name] = pool[i % pool.length];
    }
    rows.push(row);
  }
  return rows;
}
