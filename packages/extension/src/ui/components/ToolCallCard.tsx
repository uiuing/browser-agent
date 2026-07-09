import * as React from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ShieldAlert,
  Ban,
  Wrench,
  Sparkles,
  ScrollText,
  Globe,
  Camera,
} from 'lucide-react';
import type { ToolCallRecord } from '../../kernel/contracts/session';
import type { RunRecord } from '../../engine/contracts/trace';
import { StepTimeline } from './RunView';
import { Badge, Button } from './primitives';
import { cn } from '../lib/cn';
import { useStore } from '../store';

function StatusBadge({ status }: { status: ToolCallRecord['status'] }) {
  const t = useStore((s) => s.t);
  switch (status) {
    case 'succeeded':
      return <Badge tone='verified'>{t('common.verified')}</Badge>;
    case 'failed':
      return <Badge tone='failed'>{t('common.failed')}</Badge>;
    case 'denied':
      return <Badge tone='skipped'>{t('tools.denied')}</Badge>;
    case 'awaiting_confirmation':
      return <Badge tone='healing'>{t('tools.awaitingConfirm')}</Badge>;
    default:
      return <Badge tone='running'>{t('common.running')}</Badge>;
  }
}

function StatusIcon({ status }: { status: ToolCallRecord['status'] }) {
  if (status === 'succeeded')
    return <CheckCircle2 className='h-4 w-4 text-verified' />;
  if (status === 'failed') return <XCircle className='h-4 w-4 text-failed' />;
  if (status === 'denied') return <Ban className='h-4 w-4 text-skipped' />;
  if (status === 'awaiting_confirmation')
    return <ShieldAlert className='h-4 w-4 text-healing' />;
  return <Loader2 className='h-4 w-4 pf-spin text-running' />;
}

function toolIcon(toolId: string): React.ReactNode {
  if (
    toolId.startsWith('page_act') ||
    toolId.startsWith('skills_') ||
    toolId.startsWith('batch_')
  )
    return <Wrench className='h-3.5 w-3.5' />;
  if (toolId === 'page_screenshot') return <Camera className='h-3.5 w-3.5' />;
  return <Globe className='h-3.5 w-3.5' />;
}

function isRunRecord(v: unknown): v is RunRecord {
  return (
    !!v &&
    typeof v === 'object' &&
    'steps' in v &&
    'verify' in v &&
    'status' in v
  );
}

/**
 * page_act (and skills_run / batch_start) get the flagship treatment: the live
 * step timeline with per-check evidence rendered INSIDE the chat — the thing
 * that separates this from talk-only sidebars. Other tools collapse to a row.
 */
export function ToolCallCard({
  call,
  onViewRun,
}: {
  call: ToolCallRecord;
  onViewRun?: (run: RunRecord) => void;
}) {
  const t = useStore((s) => s.t);
  const saveRunAsSkill = useStore((s) => s.saveRunAsSkill);
  const run = isRunRecord(call.result?.data) ? call.result?.data : undefined;
  const live =
    call.status === 'running' || call.status === 'awaiting_confirmation';
  const isFlagship =
    call.toolId === 'page_act' ||
    call.toolId === 'skills_run' ||
    call.toolId === 'batch_start';
  const [open, setOpen] = React.useState(false);
  const [savedSkill, setSavedSkill] = React.useState(false);

  const title = t(`tools.${call.toolId}`, undefined);
  const displayTitle = title.startsWith('tools.') ? call.toolId : title;

  /* screenshot: show the image */
  const dataUrl =
    call.toolId === 'page_screenshot' &&
    call.result?.data &&
    typeof call.result.data === 'object'
      ? (call.result.data as { dataUrl?: string }).dataUrl
      : undefined;

  if (isFlagship) {
    const goal =
      call.params && typeof call.params === 'object' && 'goal' in call.params
        ? String((call.params as { goal?: unknown }).goal ?? '')
        : '';
    return (
      <div className='rounded-xl p-2.5 glass pf-fade-up'>
        <div className='flex items-center gap-2 px-1 pb-1.5'>
          {toolIcon(call.toolId)}
          <span className='min-w-0 flex-1 truncate text-[12px] font-medium text-fg'>
            {displayTitle}
            {goal ? (
              <span className='ml-1.5 font-normal text-muted-fg'>
                {goal.slice(0, 60)}
              </span>
            ) : null}
          </span>
          <StatusBadge status={call.status} />
        </div>
        {run ? (
          <>
            <StepTimeline run={run} live={live} />
            {!live && (
              <div className='mt-1.5 flex items-center gap-2 px-1'>
                <div className='flex flex-wrap gap-1.5 text-[11px]'>
                  <Badge tone='verified'>
                    {t('runs.verifyPass', { n: run.verify.passed })}
                  </Badge>
                  {run.verify.failed > 0 && (
                    <Badge tone='failed'>
                      {t('runs.verifyFail', { n: run.verify.failed })}
                    </Badge>
                  )}
                </div>
                <div className='ml-auto flex gap-1'>
                  {run.status === 'succeeded' &&
                    call.toolId === 'page_act' &&
                    !savedSkill && (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={async () => {
                          await saveRunAsSkill(
                            run,
                            run.instruction?.slice(0, 30) ?? 'skill',
                          );
                          setSavedSkill(true);
                        }}
                      >
                        <Sparkles className='h-3 w-3' />
                        {t('chat.saveSkill')}
                      </Button>
                    )}
                  {onViewRun && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => onViewRun(run)}
                    >
                      <ScrollText className='h-3 w-3' />
                      {t('chat.viewTrace')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className='flex items-center gap-2 px-1 py-2 text-[12px] text-muted-fg'>
            <StatusIcon status={call.status} />
            {live
              ? t('tools.working')
              : (call.result?.summary?.slice(0, 200) ?? '')}
          </div>
        )}
        {call.status === 'failed' &&
          call.result?.summary &&
          run === undefined && (
            <div className='px-1 pb-1 text-[12px] text-failed'>
              {call.result.summary.slice(0, 300)}
            </div>
          )}
      </div>
    );
  }

  return (
    <div className='rounded-lg glass-sm pf-fade-up'>
      <button
        onClick={() => setOpen((o) => !o)}
        className='flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-bg'
      >
        <StatusIcon status={call.status} />
        <span className='flex items-center gap-1.5 text-[12px] font-medium text-fg'>
          {toolIcon(call.toolId)}
          {displayTitle}
        </span>
        <span className='ml-auto' />
        <StatusBadge status={call.status} />
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-fg transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {dataUrl && (
        <div className='px-2.5 pb-2.5'>
          <img
            src={dataUrl}
            alt='screenshot'
            className='w-full rounded-lg inset'
          />
        </div>
      )}
      {open && call.result?.summary && (
        <pre className='mx-2.5 mb-2.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 font-mono text-[11px] text-muted-fg inset'>
          {call.result.summary.slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}
