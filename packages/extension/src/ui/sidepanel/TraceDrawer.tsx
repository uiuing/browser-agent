import * as React from 'react';
import { Download, ScrollText } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/primitives';
import { Dialog, DialogContent } from '../components/overlays';
import { tracesRepo } from '../../storage/repos';
import type { RunRecord, TraceEvent } from '../../engine/contracts/trace';

const TYPE_TONE: Record<string, string> = {
  run_started: 'text-running',
  plan_created: 'text-primary',
  step_started: 'text-fg',
  grounded: 'text-muted-fg',
  action_executed: 'text-fg',
  verify_result: 'text-verified',
  heal_started: 'text-healing',
  heal_result: 'text-healing',
  step_completed: 'text-verified',
  step_failed: 'text-failed',
  confirmation_required: 'text-healing',
  security_blocked: 'text-failed',
  run_completed: 'text-verified',
  run_failed: 'text-failed',
};

export function TraceDrawer({
  run,
  open,
  onOpenChange,
}: {
  run: RunRecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useStore((s) => s.t);
  const liveTrace = useStore((s) => s.liveTrace);
  const [events, setEvents] = React.useState<TraceEvent[]>([]);

  React.useEffect(() => {
    if (!run || !open) return;
    tracesRepo.list(run.id).then((stored) => {
      setEvents(
        stored.length ? stored : liveTrace.filter((e) => e.runId === run.id),
      );
    });
  }, [run, open, liveTrace]);

  const exportTrace = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ run, events }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trace-${run.id}.json`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('trace.title')} className='w-[min(94vw,560px)]'>
        <div className='mb-2 flex justify-end'>
          <Button variant='ghost' size='sm' onClick={exportTrace}>
            <Download className='h-3.5 w-3.5' />
            {t('trace.export')}
          </Button>
        </div>
        <div className='max-h-[60vh] space-y-1 overflow-y-auto'>
          {events.length === 0 && (
            <div className='flex flex-col items-center gap-2 py-8 text-muted-fg'>
              <ScrollText className='h-6 w-6' />
              <span className='text-sm'>{t('trace.empty')}</span>
            </div>
          )}
          {events.map((ev) => (
            <div
              key={ev.id}
              className='flex items-start gap-2 rounded-xl px-2.5 py-1.5 font-mono text-[11px] inset'
            >
              <span className='shrink-0 text-muted-fg'>
                {ev.seq.toString().padStart(2, '0')}
              </span>
              <span
                className={`shrink-0 font-medium ${TYPE_TONE[ev.type] ?? 'text-fg'}`}
              >
                {t(`trace.event.${ev.type}`)}
              </span>
              <span className='min-w-0 flex-1 truncate text-muted-fg'>
                {summarize(ev)}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function summarize(ev: TraceEvent): string {
  const p = ev.payload as Record<string, unknown>;
  if (ev.type === 'action_executed')
    return `${p.channel ?? ''} ${p.ok ? 'ok' : 'fail'} ${p.readback ? '→ ' + p.readback : ''}`;
  if (ev.type === 'verify_result' && Array.isArray(p.results)) {
    const results = p.results as { passed: boolean }[];
    return `${results.filter((r) => r.passed).length}/${results.length} passed`;
  }
  if (ev.type === 'heal_started' || ev.type === 'heal_result')
    return `${p.diagnosis ?? ''} → ${p.strategy ?? ''}`;
  if (ev.type === 'grounded') return `confidence ${p.confidence ?? ''}`;
  if (ev.type === 'plan_created') return `${p.steps ?? ''} steps`;
  return typeof p.intent === 'string'
    ? p.intent
    : JSON.stringify(p).slice(0, 80);
}
