import * as React from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  Wrench,
  ShieldAlert,
  CircleDot,
  MinusCircle,
} from 'lucide-react';
import type { RunRecord, StepRecord } from '../../engine/contracts/trace';
import type { VerificationResult } from '../../engine/contracts/verification';
import { Badge } from './primitives';
import { cn } from '../lib/cn';
import { useStore } from '../store';

function useT() {
  return useStore((s) => s.t);
}

function StatusIcon({ status }: { status: StepRecord['status'] }) {
  if (status === 'succeeded')
    return <CheckCircle2 className='h-4 w-4 text-verified' />;
  if (status === 'failed') return <XCircle className='h-4 w-4 text-failed' />;
  if (status === 'running')
    return <Loader2 className='h-4 w-4 pf-spin text-running' />;
  if (status === 'skipped')
    return <MinusCircle className='h-4 w-4 text-skipped' />;
  return <CircleDot className='h-4 w-4 text-muted-fg' />;
}

function VerifyRow({ v }: { v: VerificationResult }) {
  const t = useT();
  return (
    <div className='flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-[12px] inset'>
      {v.passed ? (
        <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 shrink-0 text-verified' />
      ) : (
        <XCircle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-failed' />
      )}
      <div className='min-w-0 flex-1'>
        <div className='font-medium text-fg'>
          {prettyCondition(v.condition.kind)}
        </div>
        <div className='mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-fg'>
          <span className='text-[11px]'>{t('common.expected')}</span>
          <span className='truncate font-mono text-[11px] text-fg'>
            {v.expected}
          </span>
          <span className='text-[11px]'>{t('common.actual')}</span>
          <span
            className={cn(
              'truncate font-mono text-[11px]',
              v.passed ? 'text-verified' : 'text-failed',
            )}
          >
            {v.actual}
          </span>
        </div>
      </div>
    </div>
  );
}

function prettyCondition(kind: string): string {
  const map: Record<string, string> = {
    value_equals: 'value =',
    element_exists: 'element exists',
    element_gone: 'element gone',
    url_matches: 'url matches',
    text_present: 'text present',
    text_absent: 'text absent',
    list_count_delta: 'list count Δ',
    attribute_equals: 'attribute =',
    element_state: 'element state',
  };
  return map[kind] ?? kind;
}

function StepItem({
  rec,
  index,
  defaultOpen,
}: {
  rec: StepRecord;
  index: number;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const totalMs =
    rec.finishedAt && rec.startedAt
      ? new Date(rec.finishedAt).getTime() - new Date(rec.startedAt).getTime()
      : undefined;
  const badge =
    rec.status === 'succeeded' ? (
      <Badge tone='verified'>{t('common.verified')}</Badge>
    ) : rec.status === 'failed' ? (
      <Badge tone='failed'>{t('common.failed')}</Badge>
    ) : rec.status === 'running' ? (
      <Badge tone='running'>{t('common.running')}</Badge>
    ) : rec.status === 'skipped' ? (
      <Badge tone='skipped'>{t('common.skipped')}</Badge>
    ) : null;

  return (
    <div className='pf-fade-up'>
      <button
        onClick={() => setOpen((o) => !o)}
        className='flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-all hover:bg-bg hover:inset'
      >
        <StatusIcon status={rec.status} />
        <span className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-muted-fg inset'>
          {index + 1}
        </span>
        <span className='min-w-0 flex-1 truncate text-[13px] text-fg'>
          {rec.step.intent}
        </span>
        {rec.healings.length > 0 && (
          <Badge tone='healing' title={t('common.healing')}>
            <Wrench className='h-3 w-3' />
            {rec.healings.length}
          </Badge>
        )}
        {badge}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-fg transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div className='ml-9 space-y-2 border-l border-border pb-2 pl-3'>
          <div className='text-[12px] text-muted-fg'>
            <span className='font-medium text-fg'>{t('step.action')}:</span>{' '}
            {rec.step.action.type}
            {rec.outcome && (
              <>
                {' · '}
                <span className='font-medium text-fg'>
                  {t('step.channel')}:
                </span>{' '}
                {rec.outcome.channel}
                {typeof totalMs === 'number' && ` · ${totalMs}ms`}
              </>
            )}
          </div>
          {rec.step.action.type !== 'navigate' &&
            'value' in rec.step.action && (
              <div className='truncate font-mono text-[11px] text-muted-fg'>
                = {String(rec.step.action.value)}
              </div>
            )}
          {rec.healings.length > 0 && (
            <div className='space-y-1'>
              <div className='flex items-center gap-1 text-[12px] font-medium text-healing'>
                <Wrench className='h-3 w-3' /> {t('step.healing')}
              </div>
              {rec.healings.map((h, i) => (
                <div
                  key={i}
                  className='flex items-center gap-2 text-[11px] text-muted-fg'
                >
                  {h.diagnosis === 'policy_blocked' ? (
                    <ShieldAlert className='h-3 w-3 text-healing' />
                  ) : (
                    <Wrench className='h-3 w-3 text-healing' />
                  )}
                  <span className='font-mono'>{h.diagnosis}</span>
                  <ChevronRight className='h-3 w-3' />
                  <span className='font-mono'>{h.strategy}</span>
                  {h.ok ? (
                    <span className='text-verified'>ok</span>
                  ) : (
                    <span className='text-failed'>×</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {rec.verifications.length > 0 && (
            <div className='space-y-1.5'>
              <div className='text-[12px] font-medium text-fg'>
                {t('step.verifications')}
              </div>
              {rec.verifications.map((v, i) => (
                <VerifyRow key={i} v={v} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StepTimeline({
  run,
  live,
}: {
  run: RunRecord;
  live?: boolean;
}) {
  return (
    <div className='space-y-0.5'>
      {run.steps.map((rec, i) => (
        <StepItem
          key={rec.step.id}
          rec={rec}
          index={i}
          defaultOpen={live && rec.status !== 'succeeded'}
        />
      ))}
    </div>
  );
}

export function RunResultCard({ run }: { run: RunRecord }) {
  const t = useT();
  const ok = run.status === 'succeeded';
  return (
    <div className='rounded-xl p-3.5 glass pf-fade-up'>
      <div className='flex items-center gap-2.5'>
        <div className='flex h-9 w-9 items-center justify-center rounded-full inset'>
          {ok ? (
            <CheckCircle2 className='h-5 w-5 text-verified pf-pop' />
          ) : (
            <XCircle className='h-5 w-5 text-failed' />
          )}
        </div>
        <span className='text-sm font-semibold text-fg'>
          {ok ? t('chat.resultSuccess') : t('chat.resultFail')}
        </span>
      </div>
      <div className='mt-2.5 flex flex-wrap gap-2 text-[12px]'>
        <Badge tone='verified'>
          {t('runs.verifyPass', { n: run.verify.passed })}
        </Badge>
        {run.verify.failed > 0 && (
          <Badge tone='failed'>
            {t('runs.verifyFail', { n: run.verify.failed })}
          </Badge>
        )}
        <Badge tone='neutral'>{t('runs.steps', { n: run.steps.length })}</Badge>
      </div>
      {run.failure && (
        <div className='mt-2 text-[12px] text-failed'>
          {run.failure.message}
        </div>
      )}
    </div>
  );
}
