import * as React from 'react';
import {
  Send,
  Square,
  Sparkles,
  Info,
  Cpu,
  Settings,
  MessagesSquare,
  Plus,
  Trash2,
  ShieldAlert,
  KeyRound,
} from 'lucide-react';
import { useStore } from '../store';
import { Button, Textarea, Spinner } from '../components/primitives';
import { Dialog, DialogContent } from '../components/overlays';
import { EmptyState } from '../components/EmptyState';
import { Markdown } from '../components/Markdown';
import { ToolCallCard } from '../components/ToolCallCard';
import { toast } from '../components/Toaster';
import type { RunRecord } from '../../engine/contracts/trace';
import type { AssistantMessage } from '../../kernel/contracts/session';
import { cn } from '../lib/cn';

function AssistantBubble({
  message,
  onViewRun,
}: {
  message: AssistantMessage;
  onViewRun?: (run: RunRecord) => void;
}) {
  const t = useStore((s) => s.t);
  return (
    <div className='space-y-2'>
      {message.parts.map((part, i) =>
        part.type === 'text' ? (
          part.text.trim() ? (
            <div
              key={i}
              className='max-w-full rounded-lg px-3.5 py-2.5 text-[13px] text-fg glass-sm'
            >
              <Markdown text={part.text} />
            </div>
          ) : null
        ) : (
          <ToolCallCard
            key={part.call.id}
            call={part.call}
            onViewRun={onViewRun}
          />
        ),
      )}
      {message.error && message.error !== 'aborted' && (
        <div className='rounded-xl px-3 py-2 text-[12px] text-failed inset'>
          {t('chat.turnError')}: {message.error}
        </div>
      )}
      {message.error === 'aborted' && (
        <div className='px-1 text-[11px] text-muted-fg'>
          {t('chat.stopped')}
        </div>
      )}
    </div>
  );
}

function SessionDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useStore((s) => s.t);
  const sessions = useStore((s) => s.sessions);
  const activeSession = useStore((s) => s.activeSession);
  const openSession = useStore((s) => s.openSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const newSession = useStore((s) => s.newSession);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('sessions.title')}>
        <div className='space-y-1.5'>
          <button
            onClick={() => {
              newSession();
              onOpenChange(false);
            }}
            className='flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium text-fg glass-sm transition-colors active:inset'
          >
            <Plus className='h-4 w-4' />
            {t('sessions.new')}
          </button>
          {sessions.length === 0 && (
            <div className='py-4 text-center text-[12px] text-muted-fg'>
              {t('sessions.empty')}
            </div>
          )}
          <div className='max-h-72 space-y-1 overflow-y-auto'>
            {sessions.map((meta) => (
              <div
                key={meta.id}
                className={cn(
                  'group flex items-center gap-2 rounded-xl px-3 py-2 transition-all',
                  activeSession?.id === meta.id ? 'inset' : 'hover:bg-muted',
                )}
              >
                <button
                  className='min-w-0 flex-1 text-left'
                  onClick={() => {
                    void openSession(meta.id);
                    onOpenChange(false);
                  }}
                >
                  <div className='truncate text-[13px] text-fg'>
                    {meta.title || t('sessions.untitled')}
                  </div>
                  <div className='text-[11px] text-muted-fg'>
                    {new Date(meta.updatedAt).toLocaleString()} ·{' '}
                    {t('sessions.messages', { n: meta.messageCount })}
                  </div>
                </button>
                <button
                  onClick={() => void deleteSession(meta.id)}
                  className='rounded-lg p-1 text-muted-fg opacity-0 transition-all hover:text-failed group-hover:opacity-100'
                  aria-label={t('common.delete')}
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChatPage({
  suggestions,
  onViewRun,
}: {
  suggestions: string[];
  onViewRun?: (run: RunRecord) => void;
}) {
  const t = useStore((s) => s.t);
  const isChatting = useStore((s) => s.isChatting);
  const activeSession = useStore((s) => s.activeSession);
  const sendMessage = useStore((s) => s.sendMessage);
  const stopChat = useStore((s) => s.stopChat);
  const confirmPrompt = useStore((s) => s.confirmPrompt);
  const resolveConfirm = useStore((s) => s.resolveConfirm);
  const permissionPrompt = useStore((s) => s.permissionPrompt);
  const resolvePermission = useStore((s) => s.resolvePermission);
  const plannerLabel = useStore((s) => s.plannerLabel);
  const hasProvider = plannerLabel !== null;

  const [input, setInput] = React.useState('');
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const messages = activeSession?.messages ?? [];

  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isChatting]);

  const submit = async () => {
    const text = input.trim();
    if (!text || isChatting) return;
    setInput('');
    try {
      await sendMessage(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const grantPermissions = async () => {
    if (!permissionPrompt) return;
    try {
      const granted = await chrome.permissions.request({
        permissions:
          permissionPrompt.permissions as chrome.runtime.ManifestPermissions[],
      });
      resolvePermission(granted);
    } catch {
      resolvePermission(false);
    }
  };

  return (
    <div className='flex h-full flex-col'>
      <div
        ref={scrollRef}
        className='min-h-0 flex-1 space-y-3 overflow-y-auto p-3'
      >
        {messages.length === 0 && !hasProvider && (
          <EmptyState
            icon={<Cpu className='h-6 w-6' />}
            title={t('chat.noProviderTitle')}
            desc={t('chat.noProviderDesc')}
            action={
              <Button
                size='sm'
                onClick={() => chrome.runtime?.openOptionsPage?.()}
              >
                <Settings className='h-3.5 w-3.5' />
                {t('chat.goConfigure')}
              </Button>
            }
          />
        )}
        {messages.length === 0 && hasProvider && (
          <EmptyState
            icon={<Sparkles className='h-6 w-6' />}
            title={t('chat.emptyTitle')}
            desc={t('chat.emptyDesc')}
            action={
              <div className='mt-1 w-full space-y-2'>
                <div className='text-left text-[11px] font-medium uppercase tracking-wide text-muted-fg'>
                  {t('chat.suggestions')}
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(s)}
                    className='block w-full rounded-lg px-3 py-2.5 text-left text-[13px] text-fg glass-sm transition-colors hover:bg-muted active:inset'
                  >
                    {s}
                  </button>
                ))}
              </div>
            }
          />
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className='flex justify-end'>
              <div className='max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2 text-[13px] text-primary-fg'>
                {m.text}
              </div>
            </div>
          ) : (
            <AssistantBubble key={m.id} message={m} onViewRun={onViewRun} />
          ),
        )}

        {isChatting && messages[messages.length - 1]?.role === 'user' && (
          <div className='flex items-center gap-2 px-1 py-1 text-[13px] text-muted-fg'>
            <Spinner className='h-4 w-4' />
            {t('chat.thinking')}
          </div>
        )}
      </div>

      <div className='px-3 pb-1 pt-2'>
        <div className='mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-fg'>
          <Info className='h-3 w-3' />
          <span className='min-w-0 flex-1 truncate'>
            {hasProvider
              ? t('chat.usingProvider', { name: plannerLabel ?? '' })
              : t('chat.notConfigured')}
          </span>
          <button
            onClick={() => setDrawerOpen(true)}
            className='flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 transition-colors hover:text-fg'
          >
            <MessagesSquare className='h-3 w-3' />
            {t('sessions.title')}
          </button>
        </div>
        <div className='relative'>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t('chat.placeholder')}
            rows={3}
            disabled={!hasProvider}
            className='rounded-2xl pr-12'
          />
          <div className='absolute bottom-2 right-2'>
            {isChatting ? (
              <Button
                size='icon-sm'
                variant='destructive'
                onClick={stopChat}
                title={t('common.stop')}
                className='rounded-full'
              >
                <Square className='h-3.5 w-3.5' />
              </Button>
            ) : (
              <Button
                size='icon-sm'
                onClick={() => void submit()}
                disabled={!input.trim() || !hasProvider}
                title={t('common.run')}
                className='rounded-full'
              >
                <Send className='h-3.5 w-3.5' />
              </Button>
            )}
          </div>
        </div>
        <div className='mt-1 px-1 text-[11px] text-muted-fg'>
          {t('chat.hint')}
        </div>
      </div>

      <SessionDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />

      {/* confirmation dialog: engine dangerous actions + dangerous-tier tools */}
      <Dialog
        open={!!confirmPrompt}
        onOpenChange={(v) => !v && resolveConfirm(false)}
      >
        <DialogContent title={t('chat.confirmTitle')}>
          <div className='flex items-start gap-2'>
            <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0 text-healing' />
            <p className='text-[13px] text-muted-fg'>
              {confirmPrompt?.reason || t('chat.confirmDanger')}
            </p>
          </div>
          {confirmPrompt?.title && (
            <div className='mt-2 rounded-xl px-3 py-2 text-[12px] inset'>
              <span className='font-medium'>{confirmPrompt.title}</span>
            </div>
          )}
          <div className='mt-4 flex justify-end gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => resolveConfirm(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => resolveConfirm(true)}
            >
              {t('common.proceed')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* on-demand chrome permission request (needs a user gesture) */}
      <Dialog
        open={!!permissionPrompt}
        onOpenChange={(v) => !v && resolvePermission(false)}
      >
        <DialogContent title={t('permissions.title')}>
          <div className='flex items-start gap-2'>
            <KeyRound className='mt-0.5 h-4 w-4 shrink-0 text-fg' />
            <p className='text-[13px] text-muted-fg'>
              {t('permissions.body', {
                perms: permissionPrompt?.permissions.join(', ') ?? '',
              })}
            </p>
          </div>
          <div className='mt-4 flex justify-end gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => resolvePermission(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button size='sm' onClick={() => void grantPermissions()}>
              {t('permissions.grant')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
