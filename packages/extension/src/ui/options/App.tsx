import * as React from 'react';
import {
  Cpu,
  SlidersHorizontal,
  ShieldCheck,
  Database,
  Info,
  Plus,
  Trash2,
  Star,
  CheckCircle2,
  XCircle,
  Github,
  Bot,
  Server,
  Wrench,
} from 'lucide-react';
import { useStore } from '../store';
import {
  Button,
  Input,
  Label,
  Card,
  Badge,
  Spinner,
  Textarea,
} from '../components/primitives';
import { Select, Switch } from '../components/overlays';
import { Toaster, toast } from '../components/Toaster';
import { providersRepo, dataRepo, auditRepo } from '../../storage/repos';
import { PROVIDER_TEMPLATES, type ProviderConfig } from '../../llm/contracts';
import { createProvider } from '../../llm/router';
import { testMcpServer } from '../../tools/mcp/mount';
import type { ToolPolicy } from '../../kernel/contracts/tool';
import type { AuditEvent, McpServerConfig } from '../../storage/types';
import { GITHUB_URL } from '../constants';

type Tab =
  | 'provider'
  | 'general'
  | 'security'
  | 'tools'
  | 'mcp'
  | 'data'
  | 'about';

export function OptionsApp() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const t = useStore((s) => s.t);
  const [tab, setTab] = React.useState<Tab>('provider');

  React.useEffect(() => {
    void init();
  }, [init]);

  if (!ready)
    return (
      <div className='flex h-screen items-center justify-center bg-bg'>
        <Spinner className='h-6 w-6' />
      </div>
    );

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    {
      id: 'provider',
      icon: <Cpu className='h-4 w-4' />,
      label: t('settings.tabs.provider'),
    },
    {
      id: 'general',
      icon: <SlidersHorizontal className='h-4 w-4' />,
      label: t('settings.tabs.general'),
    },
    {
      id: 'security',
      icon: <ShieldCheck className='h-4 w-4' />,
      label: t('settings.tabs.security'),
    },
    {
      id: 'tools',
      icon: <Wrench className='h-4 w-4' />,
      label: t('settings.tabs.tools'),
    },
    {
      id: 'mcp',
      icon: <Server className='h-4 w-4' />,
      label: t('settings.tabs.mcp'),
    },
    {
      id: 'data',
      icon: <Database className='h-4 w-4' />,
      label: t('settings.tabs.data'),
    },
    {
      id: 'about',
      icon: <Info className='h-4 w-4' />,
      label: t('settings.tabs.about'),
    },
  ];

  return (
    <div className='min-h-screen bg-bg text-fg'>
      <div className='mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 md:flex-row'>
        <aside className='md:w-56 md:shrink-0'>
          <div className='mb-5 flex items-center gap-2'>
            <div className='flex h-8 w-8 items-center justify-center rounded-lg text-fg glass-sm'>
              <Bot className='h-4 w-4' />
            </div>
            <span className='font-semibold tracking-tight'>
              {t('settings.title')}
            </span>
          </div>
          <nav className='flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible'>
            {tabs.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  tab === tb.id
                    ? 'font-medium text-fg inset'
                    : 'text-muted-fg hover:text-fg'
                }`}
              >
                {tb.icon}
                {tb.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className='min-w-0 flex-1'>
          {tab === 'provider' && <ProviderSection />}
          {tab === 'general' && <GeneralSection />}
          {tab === 'security' && <SecuritySection />}
          {tab === 'tools' && <ToolsSection />}
          {tab === 'mcp' && <McpSection />}
          {tab === 'data' && <DataSection />}
          {tab === 'about' && <AboutSection />}
        </main>
      </div>
      <Toaster position='bottom-right' />
    </div>
  );
}

/* ---------------- Provider ---------------- */
function ProviderSection() {
  const t = useStore((s) => s.t);
  const providerState = useStore((s) => s.providerState);
  const reloadProviders = useStore((s) => s.reloadProviders);
  const plannerLabel = useStore((s) => s.plannerLabel);
  const [testing, setTesting] = React.useState<string | null>(null);

  const addFromTemplate = async (tplIndex: number) => {
    const tpl = PROVIDER_TEMPLATES[tplIndex];
    const config: ProviderConfig = {
      id: `p_${Date.now().toString(36)}`,
      kind: tpl.kind,
      label: tpl.label,
      baseUrl: tpl.baseUrl,
      apiKey: '',
      model: tpl.model,
      enabled: true,
    };
    await providersRepo.upsert(config);
    await reloadProviders();
  };

  const update = async (config: ProviderConfig) => {
    await providersRepo.upsert(config);
    await reloadProviders();
  };
  const remove = async (id: string) => {
    await providersRepo.remove(id);
    await reloadProviders();
  };
  const setDefault = async (id: string) => {
    await providersRepo.setDefault(id);
    await reloadProviders();
  };

  const testConn = async (config: ProviderConfig) => {
    setTesting(config.id);
    try {
      const provider = createProvider(config);
      const res = await provider.chat(
        [{ role: 'user', content: 'ping, reply with OK' }],
        { timeoutMs: 15000, maxTokens: 5 },
      );
      toast.success(
        t('settings.provider.testOk') +
          (res.content ? `: ${res.content.slice(0, 20)}` : ''),
      );
    } catch (e) {
      toast.error(
        t('settings.provider.testFail', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className='space-y-4'>
      <SectionHeader
        title={t('settings.provider.title')}
        desc={t('settings.provider.desc')}
      />
      {plannerLabel === null && (
        <div className='flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12px] text-fg inset'>
          <Info className='mt-0.5 h-4 w-4 shrink-0 text-healing' />
          {t('settings.provider.notConfigured')}
        </div>
      )}

      <div className='flex flex-wrap gap-1.5'>
        <span className='self-center text-[12px] text-muted-fg'>
          {t('settings.provider.templates')}:
        </span>
        {PROVIDER_TEMPLATES.map((tpl, i) => (
          <Button
            key={tpl.label}
            variant='outline'
            size='sm'
            onClick={() => addFromTemplate(i)}
          >
            <Plus className='h-3 w-3' />
            {tpl.label}
          </Button>
        ))}
      </div>

      <div className='space-y-4'>
        {providerState.providers.map((p) => (
          <Card key={p.id} className='p-4'>
            <div className='flex items-center gap-2'>
              <Input
                value={p.label}
                onChange={(e) => update({ ...p, label: e.target.value })}
                className='max-w-[180px] font-medium'
              />
              {providerState.defaultProviderId === p.id ? (
                <Badge tone='primary'>
                  <Star className='h-3 w-3' /> {t('settings.provider.default')}
                </Badge>
              ) : (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setDefault(p.id)}
                >
                  {t('settings.provider.setDefault')}
                </Button>
              )}
              <div className='ml-auto flex items-center gap-2'>
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(v) => update({ ...p, enabled: v })}
                />
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => remove(p.id)}
                  aria-label='delete'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            </div>
            <div className='mt-2 grid gap-2 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label>{t('settings.provider.baseUrl')}</Label>
                <Input
                  value={p.baseUrl}
                  onChange={(e) => update({ ...p, baseUrl: e.target.value })}
                  className='font-mono text-[12px]'
                />
              </div>
              <div className='space-y-1'>
                <Label>{t('settings.provider.model')}</Label>
                <Input
                  value={p.model}
                  onChange={(e) => update({ ...p, model: e.target.value })}
                  className='font-mono text-[12px]'
                />
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <Label>{t('settings.provider.apiKey')}</Label>
                <Input
                  type='password'
                  value={p.apiKey}
                  onChange={(e) => update({ ...p, apiKey: e.target.value })}
                  placeholder='sk-…'
                  className='font-mono text-[12px]'
                />
              </div>
            </div>
            <div className='mt-2'>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => testConn(p)}
                loading={testing === p.id}
              >
                {testing === p.id
                  ? t('settings.provider.testing')
                  : t('settings.provider.test')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- General ---------------- */
function GeneralSection() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  return (
    <div className='space-y-4'>
      <SectionHeader title={t('settings.general.title')} />
      <Card className='divide-y divide-border'>
        <Row label={t('settings.general.language')}>
          <Select
            value={settings.locale}
            onValueChange={(v) =>
              updateSettings({ locale: v as typeof settings.locale })
            }
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en-US', label: 'English' },
            ]}
          />
        </Row>
        <Row label={t('settings.general.theme')}>
          <Select
            value={settings.theme}
            onValueChange={(v) =>
              updateSettings({ theme: v as typeof settings.theme })
            }
            options={[
              { value: 'light', label: t('settings.general.themeLight') },
              { value: 'dark', label: t('settings.general.themeDark') },
              { value: 'system', label: t('settings.general.themeSystem') },
            ]}
          />
        </Row>
        <Row
          label={t('settings.general.channel')}
          hint={t('settings.general.channelHint')}
        >
          <Select
            value={settings.channel}
            onValueChange={(v) =>
              updateSettings({ channel: v as typeof settings.channel })
            }
            options={[
              { value: 'dom', label: t('settings.general.channelDom') },
              { value: 'cdp', label: t('settings.general.channelCdp') },
            ]}
          />
        </Row>
      </Card>
    </div>
  );
}

/* ---------------- Security ---------------- */
function SecuritySection() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [audit, setAudit] = React.useState<AuditEvent[]>([]);

  React.useEffect(() => {
    auditRepo.list({ limit: 50 }).then((r) => setAudit(r.items));
  }, []);

  const sec = settings.guardrails;
  return (
    <div className='space-y-4'>
      <SectionHeader title={t('settings.guardrails.title')} />
      <Card className='divide-y divide-border'>
        <Row
          label={t('settings.guardrails.confirmDangerous')}
          hint={t('settings.guardrails.confirmDesc')}
        >
          <Switch
            checked={sec.confirmDangerous}
            onCheckedChange={(v) =>
              updateSettings({ guardrails: { ...sec, confirmDangerous: v } })
            }
          />
        </Row>
        <Row
          label={t('settings.guardrails.redact')}
          hint={t('settings.guardrails.redactDesc')}
        >
          <Switch
            checked={sec.redactSensitive}
            onCheckedChange={(v) =>
              updateSettings({ guardrails: { ...sec, redactSensitive: v } })
            }
          />
        </Row>
      </Card>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>{t('settings.guardrails.allowlist')}</Label>
          <Textarea
            rows={4}
            value={sec.allowlist.join('\n')}
            onChange={(e) =>
              updateSettings({
                guardrails: {
                  ...sec,
                  allowlist: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
            placeholder={t('settings.guardrails.listHint')}
            className='font-mono text-[12px]'
          />
        </div>
        <div className='space-y-1'>
          <Label>{t('settings.guardrails.blocklist')}</Label>
          <Textarea
            rows={4}
            value={sec.blocklist.join('\n')}
            onChange={(e) =>
              updateSettings({
                guardrails: {
                  ...sec,
                  blocklist: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
            placeholder={t('settings.guardrails.listHint')}
            className='font-mono text-[12px]'
          />
        </div>
      </div>
      <div>
        <Label>{t('settings.guardrails.audit')}</Label>
        <Card className='mt-1 max-h-64 overflow-y-auto p-2'>
          {audit.length === 0 ? (
            <div className='py-4 text-center text-[12px] text-muted-fg'>
              {t('settings.guardrails.auditEmpty')}
            </div>
          ) : (
            audit.map((a) => (
              <div
                key={a.id}
                className='border-b border-border py-1.5 text-[12px] last:border-0'
              >
                <span className='text-muted-fg'>
                  {new Date(a.at).toLocaleString()}
                </span>{' '}
                · <span className='font-medium'>{a.kind}</span> · {a.detail}
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Tools (permission memory) ---------------- */
function ToolsSection() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const listRegisteredTools = useStore((s) => s.listRegisteredTools);
  const tools = listRegisteredTools();

  const tierTone = (tier: string): 'verified' | 'failed' | 'neutral' =>
    tier === 'read' ? 'verified' : tier === 'dangerous' ? 'failed' : 'neutral';

  const setPolicy = (toolId: string, policy: ToolPolicy) => {
    const toolPolicies = { ...settings.guardrails.toolPolicies };
    if (policy === 'ask') delete toolPolicies[toolId];
    else toolPolicies[toolId] = policy;
    void updateSettings({
      guardrails: { ...settings.guardrails, toolPolicies },
    });
  };

  return (
    <div className='space-y-4'>
      <SectionHeader
        title={t('settings.tools.title')}
        desc={t('settings.tools.desc')}
      />
      <div className='flex flex-wrap gap-2 text-[12px] text-muted-fg'>
        <Badge tone='verified'>{t('settings.tools.tierRead')}</Badge>
        <Badge tone='neutral'>{t('settings.tools.tierAct')}</Badge>
        <Badge tone='failed'>{t('settings.tools.tierDangerous')}</Badge>
      </div>
      <Card className='divide-y divide-border'>
        {tools.map((tool) => (
          <div key={tool.id} className='flex items-center gap-3 p-3'>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='font-mono text-[13px] font-medium'>
                  {tool.id}
                </span>
                <Badge tone={tierTone(tool.riskTier)}>
                  {t(`settings.tools.tier_${tool.riskTier}`)}
                </Badge>
              </div>
              {tool.requiredPermissions?.length ? (
                <div className='mt-0.5 text-[11px] text-muted-fg'>
                  {t('settings.tools.needsPermission', {
                    perms: tool.requiredPermissions.join(', '),
                  })}
                </div>
              ) : null}
            </div>
            <Select
              value={settings.guardrails.toolPolicies[tool.id] ?? 'ask'}
              onValueChange={(v) => setPolicy(tool.id, v as ToolPolicy)}
              options={[
                { value: 'ask', label: t('settings.tools.policyAsk') },
                {
                  value: 'always_allow',
                  label: t('settings.tools.policyAllow'),
                },
                { value: 'block', label: t('settings.tools.policyBlock') },
              ]}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------- MCP servers ---------------- */
function McpSection() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const remountMcp = useStore((s) => s.remountMcp);
  const [testing, setTesting] = React.useState<string | null>(null);

  const servers = settings.mcpServers;
  const save = async (next: McpServerConfig[]) => {
    await updateSettings({ mcpServers: next });
    await remountMcp();
  };

  const add = () =>
    void save([
      ...servers,
      {
        id: `mcp_${Date.now().toString(36)}`,
        label: '',
        url: 'https://',
        enabled: false,
      },
    ]);
  const update = (server: McpServerConfig) =>
    void save(servers.map((s) => (s.id === server.id ? server : s)));
  const remove = (id: string) => void save(servers.filter((s) => s.id !== id));

  const test = async (server: McpServerConfig) => {
    setTesting(server.id);
    try {
      const result = await testMcpServer(server);
      if (result.ok)
        toast.success(t('settings.mcp.testOk', { n: result.tools }));
      else toast.error(t('settings.mcp.testFail', { msg: result.error ?? '' }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className='space-y-4'>
      <SectionHeader
        title={t('settings.mcp.title')}
        desc={t('settings.mcp.desc')}
      />
      <Button variant='outline' size='sm' onClick={add}>
        <Plus className='h-3 w-3' />
        {t('settings.mcp.add')}
      </Button>
      <div className='space-y-4'>
        {servers.length === 0 && (
          <div className='rounded-xl px-3 py-4 text-center text-[12px] text-muted-fg inset'>
            {t('settings.mcp.empty')}
          </div>
        )}
        {servers.map((server) => (
          <Card key={server.id} className='p-4'>
            <div className='flex items-center gap-2'>
              <Input
                value={server.label}
                onChange={(e) => update({ ...server, label: e.target.value })}
                placeholder={t('settings.mcp.label')}
                className='max-w-[180px] font-medium'
              />
              <div className='ml-auto flex items-center gap-2'>
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(v) => update({ ...server, enabled: v })}
                />
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => remove(server.id)}
                  aria-label='delete'
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            </div>
            <div className='mt-2 space-y-1'>
              <Label>{t('settings.mcp.url')}</Label>
              <Input
                value={server.url}
                onChange={(e) => update({ ...server, url: e.target.value })}
                placeholder='https://mcp.example.com/mcp'
                className='font-mono text-[12px]'
              />
              <div className='text-[11px] text-muted-fg'>
                {t('settings.mcp.urlHint')}
              </div>
            </div>
            <div className='mt-2'>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => test(server)}
                loading={testing === server.id}
              >
                {testing === server.id
                  ? t('settings.provider.testing')
                  : t('settings.provider.test')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Data ---------------- */
function DataSection() {
  const t = useStore((s) => s.t);
  const init = useStore((s) => s.init);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const data = await dataRepo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `browser-agent-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast.success(t('settings.data.exported'));
  };
  const doImport = async (file: File) => {
    const data = JSON.parse(await file.text());
    await dataRepo.importAll(data);
    await init();
    toast.success(t('settings.data.imported'));
  };
  const doClear = async () => {
    if (!confirm(t('settings.data.clearConfirm'))) return;
    await dataRepo.clearAll();
    await init();
    toast.success(t('settings.data.cleared'));
  };

  return (
    <div className='space-y-4'>
      <SectionHeader
        title={t('settings.data.title')}
        desc={t('settings.data.desc')}
      />
      <div className='flex flex-wrap gap-2'>
        <Button variant='secondary' onClick={doExport}>
          {t('settings.data.exportAll')}
        </Button>
        <Button variant='secondary' onClick={() => fileRef.current?.click()}>
          {t('settings.data.importAll')}
        </Button>
        <input
          ref={fileRef}
          type='file'
          accept='.json'
          hidden
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
        <Button variant='destructive' onClick={doClear}>
          {t('settings.data.clearAll')}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- About ---------------- */
function AboutSection() {
  const t = useStore((s) => s.t);
  return (
    <div className='space-y-4'>
      <SectionHeader title={t('settings.about.title')} />
      <Card className='space-y-3 p-4 text-[13px]'>
        <div className='flex items-center gap-2'>
          <Badge tone='primary'>{t('settings.about.version')} {chrome.runtime.getManifest().version}</Badge>
          <Badge tone='neutral'>MIT</Badge>
        </div>
        <div>
          <div className='font-medium'>{t('settings.about.openSource')}</div>
          <p className='mt-1 leading-relaxed text-muted-fg'>
            {t('settings.about.openSourceBody')}
          </p>
          <a
            href={GITHUB_URL}
            target='_blank'
            rel='noreferrer'
            className='mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline'
          >
            <Github className='h-4 w-4' />
            {t('settings.about.github')}
          </a>
        </div>
        <div>
          <div className='font-medium'>{t('settings.about.privacy')}</div>
          <p className='mt-1 leading-relaxed text-muted-fg'>
            {t('settings.about.privacyBody')}
          </p>
        </div>
        <p className='text-[12px] text-muted-fg'>
          {t('settings.about.credits')}
        </p>
      </Card>
    </div>
  );
}

/* ---------------- shared ---------------- */
function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <h2 className='text-lg font-semibold'>{title}</h2>
      {desc && <p className='mt-1 text-[13px] text-muted-fg'>{desc}</p>}
    </div>
  );
}
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex items-center justify-between gap-4 p-3'>
      <div className='min-w-0'>
        <div className='text-[13px] font-medium'>{label}</div>
        {hint && <div className='mt-0.5 text-[12px] text-muted-fg'>{hint}</div>}
      </div>
      <div className='shrink-0'>{children}</div>
    </div>
  );
}

export { CheckCircle2, XCircle };
