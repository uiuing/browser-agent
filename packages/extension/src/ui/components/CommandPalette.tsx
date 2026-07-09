import * as React from 'react';
import { Command } from 'cmdk';
import {
  MessageSquare,
  History,
  Sparkles,
  Layers,
  Settings,
  Sun,
  Languages,
  Plus,
} from 'lucide-react';
import { useStore } from '../store';

export interface CommandAction {
  id: string;
  group: 'nav' | 'actions' | 'prefs';
  labelKey: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  extraActions = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate?: (tab: string) => void;
  extraActions?: CommandAction[];
}) {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  const actions: CommandAction[] = [
    ...(onNavigate
      ? [
          {
            id: 'chat',
            group: 'nav' as const,
            labelKey: 'cmd.goChat',
            icon: <MessageSquare className='h-4 w-4' />,
            run: () => onNavigate('chat'),
          },
          {
            id: 'runs',
            group: 'nav' as const,
            labelKey: 'cmd.goRuns',
            icon: <History className='h-4 w-4' />,
            run: () => onNavigate('runs'),
          },
          {
            id: 'skills',
            group: 'nav' as const,
            labelKey: 'cmd.goSkills',
            icon: <Sparkles className='h-4 w-4' />,
            run: () => onNavigate('skills'),
          },
          {
            id: 'batch',
            group: 'nav' as const,
            labelKey: 'cmd.goBatch',
            icon: <Layers className='h-4 w-4' />,
            run: () => onNavigate('batch'),
          },
        ]
      : []),
    ...extraActions,
    {
      id: 'settings',
      group: 'actions',
      labelKey: 'cmd.openSettings',
      icon: <Settings className='h-4 w-4' />,
      run: () => chrome.runtime?.openOptionsPage?.(),
    },
    {
      id: 'theme',
      group: 'prefs',
      labelKey: 'cmd.toggleTheme',
      icon: <Sun className='h-4 w-4' />,
      run: () =>
        updateSettings({
          theme: document.documentElement.classList.contains('dark')
            ? 'light'
            : 'dark',
        }),
    },
    {
      id: 'lang',
      group: 'prefs',
      labelKey: 'cmd.toggleLang',
      icon: <Languages className='h-4 w-4' />,
      run: () =>
        updateSettings({
          locale: settings.locale === 'zh-CN' ? 'en-US' : 'zh-CN',
        }),
    },
  ];

  const groups: { key: CommandAction['group']; label: string }[] = [
    { key: 'nav', label: t('cmd.nav') },
    { key: 'actions', label: t('cmd.actions') },
    { key: 'prefs', label: t('cmd.prefs') },
  ];

  if (!open) return null;

  return (
    <div
      className='fixed inset-0 z-[60] flex items-start justify-center bg-[var(--scrim)] pt-[12vh] backdrop-blur-sm'
      onClick={() => onOpenChange(false)}
    >
      <Command
        className='w-[min(92vw,520px)] overflow-hidden rounded-xl glass-strong pf-fade-up'
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <div className='p-2.5 pb-0'>
          <Command.Input
            autoFocus
            placeholder={t('cmd.placeholder')}
            className='w-full rounded-xl px-4 py-2.5 text-sm outline-none inset placeholder:text-muted-fg'
          />
        </div>
        <Command.List className='max-h-[320px] overflow-y-auto p-2.5'>
          <Command.Empty className='px-3 py-6 text-center text-sm text-muted-fg'>
            {t('common.search')}…
          </Command.Empty>
          {groups.map((g) => {
            const items = actions.filter((a) => a.group === g.key);
            if (!items.length) return null;
            return (
              <Command.Group
                key={g.key}
                heading={g.label}
                className='px-1 text-[11px] text-muted-fg [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1'
              >
                {items.map((a) => (
                  <Command.Item
                    key={a.id}
                    onSelect={() => {
                      a.run();
                      onOpenChange(false);
                    }}
                    className='flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-fg data-[selected=true]:inset'
                  >
                    <span className='text-muted-fg'>{a.icon}</span>
                    {t(a.labelKey)}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}

export { Plus };
