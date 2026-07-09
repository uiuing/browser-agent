import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { launchExtension, buildProdExtension } from './ext-launch';
import { serveStatic } from './serve';
import { Reporter } from './assert';

/**
 * REAL-LLM end-to-end: production build + a real OpenAI-compatible endpoint.
 * Also proves cross-window smart targeting — the page under automation lives in a
 * SECOND, unfocused Chrome window; the user never picks a tab.
 *
 *   REAL_BASE=https://api.example.com/v1 REAL_KEY=sk-… [REAL_MODEL=gpt-4o-mini] pnpm test:real
 *
 * The key stays in env/chrome.storage of a throwaway profile — never written to disk.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../../fixtures/dist');

const BASE = process.env.REAL_BASE ?? '';
const KEY = process.env.REAL_KEY ?? '';
const MODEL = process.env.REAL_MODEL ?? 'gpt-4o-mini';

async function pageFor(ctx: Awaited<ReturnType<typeof launchExtension>>['context'], extId: string, file: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/${file}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Set REAL_BASE and REAL_KEY env vars (REAL_MODEL optional).');
    process.exit(2);
  }

  const r = new Reporter();
  buildProdExtension(); // a stale VITE_USE_MOCK build would silently swap in the mock planner
  const server = await serveStatic(FIX, 4183);
  const { context, extensionId, close } = await launchExtension();

  try {
    r.section('真实模型接入（production 构建，无 mock）');

    // Seed the provider exactly as the options UI would persist it.
    const seeder = await pageFor(context, extensionId, 'options.html');
    await seeder.evaluate(
      async ({ base, key, model }) => {
        await chrome.storage.local.set({
          'browser-agent:providers': {
            providers: [
              { id: 'real', kind: 'openai-compatible', label: 'Real Model', baseUrl: base, apiKey: key, model, enabled: true },
            ],
            defaultProviderId: 'real',
          },
        });
      },
      { base: BASE, key: KEY, model: MODEL },
    );
    await seeder.close();

    // Window 1 (focused): a distractor page. Window 2 (unfocused): the real work page.
    const distractor = await context.newPage();
    await distractor.goto(`${server.url}/index.html`);

    const helper = await pageFor(context, extensionId, 'options.html');
    const pagePromise = context.waitForEvent('page', p => p.url().includes('customer.html'));
    await helper.evaluate(
      ({ url }) => chrome.windows.create({ url, focused: false }),
      { url: `${server.url}/customer.html?lang=zh` },
    );
    const fx = await pagePromise;
    await fx.waitForLoadState('domcontentloaded');
    await helper.close();
    await distractor.bringToFront(); // the user is looking at the WRONG window on purpose

    const rowsBefore = await fx.locator('[data-testid="record-row"]').count();
    r.check('客户页在第二个未聚焦窗口，初始 2 行', rowsBefore === 2, `rows=${rowsBefore}`);

    // Side panel in window 1. The task talks about 客户 — the router must find the
    // customer tab in the OTHER window on its own.
    const sp = await pageFor(context, extensionId, 'sidepanel.html');
    await sp.waitForTimeout(600);

    r.section('跨窗口自动路由 + 真实 LLM 规划执行');
    const textarea = sp.locator('textarea').last();
    await textarea.fill('在客户管理页新建客户：姓名林真实，手机13900002222，邮箱real@test.dev，区域华南区，备注真实模型端到端');
    await textarea.press('Enter');

    // Real planning takes a few seconds; then the dangerous submit asks for confirmation.
    const proceed = sp.getByRole('button', { name: /继续执行|Proceed/ });
    const confirmed = await proceed
      .waitFor({ timeout: 90000 })
      .then(() => true)
      .catch(() => false);
    r.check('高危提交触发确认（真实计划包含 dangerous 步骤）', confirmed);
    if (confirmed) await proceed.click();

    // v2: the chat wrap-up text is model-authored (not assertable) — the source of
    // truth is the persisted RunRecord that page_act saved. Poll it up to 5 minutes;
    // dump the visible timeline periodically so a hang shows where it sits.
    const readRunStatus = () =>
      sp.evaluate(async () => {
        const s = await chrome.storage.local.get('browser-agent:runs');
        const run = (s['browser-agent:runs'] as Array<Record<string, unknown>> | undefined)?.[0];
        return run ? String(run.status) : null;
      });
    const deadline = Date.now() + 300000;
    let status: string | null = null;
    while (Date.now() < deadline) {
      status = await readRunStatus();
      if (status && ['succeeded', 'failed', 'cancelled'].includes(status)) break;
      await sp.waitForTimeout(10000);
      const text = (await sp.locator('main, body').first().innerText().catch(() => '')).slice(0, 600);
      console.log(`[${new Date().toISOString().slice(11, 19)}] sidepanel:\n${text.replace(/\n{2,}/g, '\n')}\n---`);
    }
    const succeeded = status === 'succeeded';
    r.check('真实模型端到端跑通并通过结果核对', succeeded, `run status=${status}`);

    if (!succeeded) {
      // Pull the persisted run record: which step / which post-condition failed?
      const diag = await sp.evaluate(async () => {
        const s = await chrome.storage.local.get('browser-agent:runs');
        const run = (s['browser-agent:runs'] as Array<Record<string, any>> | undefined)?.[0];
        if (!run) return 'no run persisted';
        return JSON.stringify(
          {
            status: run.status,
            failure: run.failure,
            verify: run.verify,
            steps: (run.steps as Array<Record<string, any>>).map(st => ({
              intent: st.step?.intent,
              status: st.status,
              action: st.step?.action?.type,
              attempts: st.attempts,
              failedChecks: (st.verifications ?? [])
                .filter((v: Record<string, any>) => !v.passed)
                .map((v: Record<string, any>) => ({ kind: v.condition?.kind, expected: v.expected, actual: v.actual })),
              healing: (st.healings ?? []).map((h: Record<string, any>) => `${h.diagnosis}->${h.strategy}`),
            })),
          },
          null,
          1,
        );
      });
      console.log('RUN DIAGNOSIS:\n' + diag);
      await sp.screenshot({ path: 'real-llm-final.png', fullPage: true }).catch(() => undefined);
    }

    const pill = (await sp.getByText(/客户管理|customer/i).count()) > 0;
    r.check('侧板目标页自动切到第二窗口的客户页', pill);

    r.section('页面真值（另一窗口的 DOM）');
    const rowsAfter = await fx.locator('[data-testid="record-row"]').count();
    r.check('客户真实入库（2 → 3 行）', rowsAfter === rowsBefore + 1, `rows=${rowsAfter}`);
    r.check('新建客户姓名出现在列表', (await fx.getByText('林真实').count()) > 0);

    await sp.close();
  } finally {
    await close();
    await server.close();
  }

  const ok = r.summary();
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
