import * as React from 'react';
import {
  Check,
  Cpu,
  Globe,
  ArrowRight,
  Sparkles,
  MousePointerClick,
  PanelRight,
  MessageSquareText,
} from 'lucide-react';
import { useStore } from '../store';
import { Button, Card, Input, Label } from '../components/primitives';
import { Select } from '../components/overlays';
import { Toaster, toast } from '../components/Toaster';
import { PROVIDER_TEMPLATES, type ProviderConfig } from '../../llm/contracts';
import { createProvider } from '../../llm/router';
import { providersRepo } from '../../storage/repos';

export function OnboardingApp() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const reloadProviders = useStore((s) => s.reloadProviders);
  const [step, setStep] = React.useState(1);

  React.useEffect(() => {
    void init();
  }, [init]);

  if (!ready) return <div className='min-h-screen bg-bg' />;

  const finish = async () => {
    await updateSettings({ onboarded: true });
    window.close();
  };

  return (
    <div className='flex min-h-screen items-center justify-center bg-bg px-5 py-10 text-fg'>
      <div className='w-full max-w-lg'>
        <div className='mb-6 flex items-center justify-center gap-2.5'>
          <div className='flex h-10 w-10 items-center justify-center rounded-xl text-fg glass'>
            <Sparkles className='h-5 w-5' />
          </div>
          <span className='text-lg font-semibold tracking-tight'>
            {t('onboarding.title')}
          </span>
        </div>

        {/* stepper */}
        <div className='mb-6 flex items-center justify-center gap-2'>
          {[1, 2, 3].map((n) => (
            <div key={n} className='flex items-center gap-2'>
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
                  step > n
                    ? 'text-verified inset'
                    : step === n
                      ? 'bg-primary text-primary-fg'
                      : 'text-muted-fg glass-sm'
                }`}
              >
                {step > n ? <Check className='h-4 w-4' /> : n}
              </div>
              {n < 3 && (
                <div
                  className={`h-1 w-8 rounded-full ${step > n ? 'inset' : 'glass-sm'}`}
                />
              )}
            </div>
          ))}
        </div>

        <Card className='p-6'>
          {step === 1 && (
            <div className='space-y-4'>
              <StepHeader
                icon={<Globe className='h-5 w-5' />}
                title={t('onboarding.step1.title')}
                desc={t('onboarding.step1.desc')}
              />
              <label className='flex items-center justify-between'>
                <span className='text-[13px] font-medium'>
                  {t('settings.general.language')}
                </span>
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
              </label>
              <Button className='w-full' onClick={() => setStep(2)}>
                {t('common.next')}
                <ArrowRight className='h-4 w-4' />
              </Button>
            </div>
          )}

          {step === 2 && (
            <ConnectModelStep
              onDone={() => setStep(3)}
              onBack={() => setStep(1)}
              reloadProviders={reloadProviders}
            />
          )}

          {step === 3 && (
            <div className='space-y-4'>
              <StepHeader
                icon={<Sparkles className='h-5 w-5' />}
                title={t('onboarding.step3.title')}
                desc={t('onboarding.step3.desc')}
              />
              <ol className='space-y-2.5'>
                <HowStep
                  icon={<Globe className='h-4 w-4' />}
                  n={1}
                  text={t('onboarding.step3.how1')}
                />
                <HowStep
                  icon={<PanelRight className='h-4 w-4' />}
                  n={2}
                  text={t('onboarding.step3.how2')}
                />
                <HowStep
                  icon={<MessageSquareText className='h-4 w-4' />}
                  n={3}
                  text={t('onboarding.step3.how3')}
                />
              </ol>
              <div className='flex items-start gap-2 rounded-xl p-3 text-[12px] leading-relaxed text-muted-fg inset'>
                <MousePointerClick className='mt-0.5 h-4 w-4 shrink-0 text-fg' />
                {t('onboarding.step3.tip')}
              </div>
              <Button className='w-full' onClick={finish}>
                {t('onboarding.finish')}
              </Button>
            </div>
          )}
        </Card>
      </div>
      <Toaster />
    </div>
  );
}

function HowStep({
  icon,
  n,
  text,
}: {
  icon: React.ReactNode;
  n: number;
  text: string;
}) {
  return (
    <li className='flex items-center gap-3 rounded-lg p-3 glass-sm'>
      <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg inset'>
        {icon}
      </div>
      <span className='text-[13px]'>
        <span className='mr-1.5 font-semibold'>{n}.</span>
        {text}
      </span>
    </li>
  );
}

/**
 * Step 2 — connect a model right here: pick a template, paste key/URL, test, save.
 * Skipping is allowed; the chat page will guide back to Settings until a model works.
 */
function ConnectModelStep({
  onDone,
  onBack,
  reloadProviders,
}: {
  onDone: () => void;
  onBack: () => void;
  reloadProviders: () => Promise<void>;
}) {
  const t = useStore((s) => s.t);
  const [tplIndex, setTplIndex] = React.useState<number | null>(null);
  const [baseUrl, setBaseUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const pickTemplate = (index: number) => {
    const tpl = PROVIDER_TEMPLATES[index];
    setTplIndex(index);
    setBaseUrl(tpl.baseUrl);
    setModel(tpl.model);
  };

  const buildConfig = (): ProviderConfig => {
    const tpl = tplIndex !== null ? PROVIDER_TEMPLATES[tplIndex] : null;
    return {
      id: `p_${Date.now().toString(36)}`,
      kind: tpl?.kind ?? 'openai-compatible',
      label: tpl?.label ?? 'My model',
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      enabled: true,
    };
  };

  const canSave = baseUrl.trim().length > 0 && model.trim().length > 0;

  const testConn = async () => {
    setTesting(true);
    try {
      const provider = createProvider(buildConfig());
      await provider.chat([{ role: 'user', content: 'ping, reply with OK' }], {
        timeoutMs: 15000,
        maxTokens: 5,
      });
      toast.success(t('onboarding.step2.testOk'));
    } catch (e) {
      toast.error(
        t('onboarding.step2.testFail', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setTesting(false);
    }
  };

  const saveAndNext = async () => {
    setSaving(true);
    try {
      await providersRepo.upsert(buildConfig());
      await reloadProviders();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-4'>
      <StepHeader
        icon={<Cpu className='h-5 w-5' />}
        title={t('onboarding.step2.title')}
        desc={t('onboarding.step2.desc')}
      />

      <div>
        <Label>{t('onboarding.step2.templates')}</Label>
        <div className='mt-2 flex flex-wrap gap-2'>
          {PROVIDER_TEMPLATES.map((tpl, index) => (
            <button
              key={tpl.label}
              onClick={() => pickTemplate(index)}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                tplIndex === index
                  ? 'font-medium text-fg inset'
                  : 'text-muted-fg glass-sm hover:text-fg'
              }`}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      <div className='space-y-2.5'>
        <div className='space-y-1'>
          <Label>{t('onboarding.step2.baseUrl')}</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder='https://api.openai.com/v1'
            className='font-mono text-[12px]'
          />
        </div>
        <div className='grid gap-2.5 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>{t('onboarding.step2.apiKey')}</Label>
            <Input
              type='password'
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder='sk-…'
              className='font-mono text-[12px]'
            />
          </div>
          <div className='space-y-1'>
            <Label>{t('onboarding.step2.model')}</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder='gpt-4o-mini'
              className='font-mono text-[12px]'
            />
          </div>
        </div>
        <p className='text-[12px] text-muted-fg'>
          {t('onboarding.step2.keyHint')}
        </p>
      </div>

      <div className='flex gap-2'>
        <Button
          variant='secondary'
          className='flex-1'
          onClick={testConn}
          loading={testing}
          disabled={!canSave}
        >
          {testing ? t('onboarding.step2.testing') : t('onboarding.step2.test')}
        </Button>
        <Button
          className='flex-1'
          onClick={saveAndNext}
          loading={saving}
          disabled={!canSave}
        >
          {t('onboarding.step2.saveAndNext')}
          <ArrowRight className='h-4 w-4' />
        </Button>
      </div>

      <div className='flex items-center justify-between'>
        <Button variant='ghost' size='sm' onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button variant='ghost' size='sm' onClick={onDone}>
          {t('onboarding.step2.skipForNow')}
        </Button>
      </div>
    </div>
  );
}

function StepHeader({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className='text-center'>
      <div className='mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-full text-fg inset'>
        {icon}
      </div>
      <h2 className='text-base font-semibold'>{title}</h2>
      <p className='mt-1 text-[13px] text-muted-fg'>{desc}</p>
    </div>
  );
}
