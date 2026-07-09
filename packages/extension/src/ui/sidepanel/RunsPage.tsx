import * as React from 'react';
import { History, ArrowLeft, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { useStore } from '../store';
import { Badge, Button, Card } from '../components/primitives';
import { EmptyState } from '../components/EmptyState';
import { StepTimeline } from '../components/RunView';
import type { RunRecord } from '../../engine/contracts/trace';

function statusBadge(status: RunRecord['status'], t: (k: string) => string) {
  if (status === 'succeeded')
    return <Badge tone='verified'>{t('common.succeeded')}</Badge>;
  if (status === 'failed')
    return <Badge tone='failed'>{t('common.failed')}</Badge>;
  if (status === 'cancelled')
    return <Badge tone='skipped'>{t('common.stop')}</Badge>;
  return <Badge tone='running'>{t('common.running')}</Badge>;
}

export function RunsPage({
  onOpenTrace,
}: {
  onOpenTrace: (run: RunRecord) => void;
}) {
  const t = useStore((s) => s.t);
  const runs = useStore((s) => s.runs);
  const reloadRuns = useStore((s) => s.reloadRuns);
  const [selected, setSelected] = React.useState<RunRecord | null>(null);

  React.useEffect(() => {
    void reloadRuns();
  }, [reloadRuns]);

  if (selected) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex items-center gap-2 p-3'>
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={() => setSelected(null)}
            aria-label={t('common.back')}
          >
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div className='min-w-0 flex-1'>
            <div className='truncate text-sm font-medium'>
              {selected.instruction || selected.skillId}
            </div>
            <div className='truncate text-[11px] text-muted-fg'>
              {selected.title || selected.url}
            </div>
          </div>
          {statusBadge(selected.status, t)}
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-3'>
          <div className='mb-3 flex flex-wrap items-center gap-2'>
            <Badge tone='verified'>
              {t('runs.verifyPass', { n: selected.verify.passed })}
            </Badge>
            {selected.verify.failed > 0 && (
              <Badge tone='failed'>
                {t('runs.verifyFail', { n: selected.verify.failed })}
              </Badge>
            )}
            <Button
              variant='link'
              size='sm'
              className='h-auto p-0'
              onClick={() => onOpenTrace(selected)}
            >
              {t('runs.replay')}
            </Button>
          </div>
          <Card className='p-2.5'>
            <StepTimeline run={selected} />
          </Card>
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        className='h-full'
        icon={<History className='h-6 w-6' />}
        title={t('runs.emptyTitle')}
        desc={t('runs.emptyDesc')}
      />
    );
  }

  return (
    <div className='h-full overflow-y-auto p-3'>
      <div className='space-y-2.5'>
        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => setSelected(run)}
            className='flex w-full items-center gap-3 rounded-xl p-3 text-left glass-sm transition-colors hover:bg-muted active:inset'
          >
            <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full inset'>
              {run.status === 'succeeded' ? (
                <CheckCircle2 className='h-4.5 w-4.5 text-verified' />
              ) : run.status === 'cancelled' ? (
                <Ban className='h-4.5 w-4.5 text-skipped' />
              ) : (
                <XCircle className='h-4.5 w-4.5 text-failed' />
              )}
            </div>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-[13px] font-medium text-fg'>
                {run.instruction || run.skillId || run.id}
              </div>
              <div className='mt-0.5 flex items-center gap-2 text-[11px] text-muted-fg'>
                <span className='truncate'>{hostOf(run.url)}</span>
                <span>·</span>
                <span>{t('runs.steps', { n: run.steps.length })}</span>
                <span>·</span>
                <span>{new Date(run.startedAt).toLocaleString()}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
