import * as React from 'react';
import {
  MessageSquare,
  History,
  Sparkles,
  Layers,
  Settings,
  Sun,
  Moon,
  Languages,
  Globe,
  RefreshCw,
  Bot,
} from 'lucide-react';
import { useStore } from '../store';
import { Button, Spinner } from '../components/primitives';
import { Tip } from '../components/overlays';
import { Toaster } from '../components/Toaster';
import { CommandPalette } from '../components/CommandPalette';
import { ChatPage } from './ChatPage';
import { RunsPage } from './RunsPage';
import { SkillsPage } from './SkillsPage';
import { BatchPage } from './BatchPage';
import { TraceDrawer } from './TraceDrawer';
import type { RunRecord } from '../../engine/contracts/trace';
import type { Skill } from '../../engine/contracts/skill';
import { cn } from '../lib/cn';

type Tab = 'chat' | 'runs' | 'skills' | 'batch';

function suggestionsFor(locale: string): string[] {
  if (locale === 'en-US') {
    return [
      'Summarize this page for me',
      'Create a customer: Jane Doe, phone 555-0142, email jane@acme.io, region East — then verify it was created',
      'What tabs do I have open?',
    ];
  }
  return [
    '总结一下这个页面讲了什么',
    '新建客户，姓名张伟，手机13800138000，邮箱zhangwei@example.com，区域华东区，然后确认创建成功',
    '我现在开了哪些标签页？',
  ];
}

export function SidePanelApp() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const targetTab = useStore((s) => s.targetTab);
  const refreshTargetTab = useStore((s) => s.refreshTargetTab);

  const [tab, setTab] = React.useState<Tab>('chat');
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [traceRun, setTraceRun] = React.useState<RunRecord | null>(null);
  const [traceOpen, setTraceOpen] = React.useState(false);
  const [batchSkill, setBatchSkill] = React.useState<Skill | null>(null);

  React.useEffect(() => {
    void init();
    const onFocus = () => void refreshTargetTab();
    window.addEventListener('focus', onFocus);
    const listener = () => void refreshTargetTab();
    chrome.tabs?.onActivated?.addListener(listener);
    chrome.tabs?.onUpdated?.addListener(listener);
    return () => {
      window.removeEventListener('focus', onFocus);
      chrome.tabs?.onActivated?.removeListener(listener);
      chrome.tabs?.onUpdated?.removeListener(listener);
    };
  }, [init, refreshTargetTab]);

  const openTrace = (run: RunRecord) => {
    setTraceRun(run);
    setTraceOpen(true);
  };

  const isDark = document.documentElement.classList.contains('dark');

  if (!ready) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <Spinner className='h-6 w-6' />
      </div>
    );
  }

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    {
      id: 'chat',
      icon: <MessageSquare className='h-4 w-4' />,
      label: t('nav.chat'),
    },
    { id: 'runs', icon: <History className='h-4 w-4' />, label: t('nav.runs') },
    {
      id: 'skills',
      icon: <Sparkles className='h-4 w-4' />,
      label: t('nav.skills'),
    },
    {
      id: 'batch',
      icon: <Layers className='h-4 w-4' />,
      label: t('nav.batch'),
    },
  ];

  return (
    <div className='flex h-screen flex-col bg-bg text-fg'>
      {/* top bar */}
      <header className='flex items-center gap-2 px-3 pb-2 pt-3'>
        <div className='flex items-center gap-1.5'>
          <div className='flex h-7 w-7 items-center justify-center rounded-lg text-fg glass-sm'>
            <Bot className='h-4 w-4' />
          </div>
          <span className='text-sm font-semibold tracking-tight'>
            {t('brand.name')}
          </span>
        </div>
        <div className='ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-muted-fg inset'>
          <Globe className='h-3 w-3 shrink-0' />
          <span className='truncate'>
            {targetTab.title || targetTab.url || t('chat.noTab')}
          </span>
          <button
            onClick={() => void refreshTargetTab()}
            className='ml-auto shrink-0 rounded-full p-0.5 transition-colors hover:text-fg'
            aria-label='refresh'
          >
            <RefreshCw className='h-3 w-3' />
          </button>
        </div>
        <div className='flex items-center gap-1'>
          <Tip label={t('cmd.toggleLang')}>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() =>
                updateSettings({
                  locale: settings.locale === 'zh-CN' ? 'en-US' : 'zh-CN',
                })
              }
            >
              <Languages className='h-4 w-4' />
            </Button>
          </Tip>
          <Tip label={t('cmd.toggleTheme')}>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() =>
                updateSettings({ theme: isDark ? 'light' : 'dark' })
              }
            >
              {isDark ? (
                <Sun className='h-4 w-4' />
              ) : (
                <Moon className='h-4 w-4' />
              )}
            </Button>
          </Tip>
          <Tip label={t('nav.settings')}>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              <Settings className='h-4 w-4' />
            </Button>
          </Tip>
        </div>
      </header>

      {/* content */}
      <main className='min-h-0 flex-1'>
        {tab === 'chat' && (
          <ChatPage
            suggestions={suggestionsFor(settings.locale)}
            onViewRun={openTrace}
          />
        )}
        {tab === 'runs' && <RunsPage onOpenTrace={openTrace} />}
        {tab === 'skills' && (
          <SkillsPage
            onRunBatch={(skill) => {
              setBatchSkill(skill);
              setTab('batch');
            }}
          />
        )}
        {tab === 'batch' && <BatchPage initialSkill={batchSkill} />}
      </main>

      {/* bottom dock */}
      <nav className='px-3 pb-3 pt-1.5'>
        <div className='grid grid-cols-4 gap-1 rounded-xl p-1 glass'>
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-all',
                tab === tb.id
                  ? 'font-medium text-fg inset'
                  : 'text-muted-fg hover:text-fg',
              )}
            >
              {tb.icon}
              {tb.label}
            </button>
          ))}
        </div>
      </nav>

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onNavigate={(tabName) => setTab(tabName as Tab)}
      />
      <TraceDrawer
        run={traceRun}
        open={traceOpen}
        onOpenChange={setTraceOpen}
      />
      <Toaster position='top-center' />
    </div>
  );
}
