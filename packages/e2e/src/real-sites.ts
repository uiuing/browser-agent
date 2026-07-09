import type { Page } from 'playwright';
import { launchExtension, buildProdExtension } from './ext-launch';
import { Reporter } from './assert';

/**
 * REAL-WORLD sites + real LLM, driven through the closed agent loop. This is the
 * generality test the fixtures can't give: live DOM, real navigation, unknown
 * markup. Sites are public, login-free and side-effect-free.
 *
 *   REAL_BASE=… REAL_KEY=… [REAL_MODEL=gpt-4o-mini] pnpm test:sites
 */
const BASE = process.env.REAL_BASE ?? '';
const KEY = process.env.REAL_KEY ?? '';
const MODEL = process.env.REAL_MODEL ?? 'gpt-4o-mini';

interface Scenario {
  name: string;
  /** Candidate URLs — the first one that loads wins (survives regional blocking). */
  urls: string[];
  task: string;
  /** Playwright-side ground truth after the run. */
  truth: (page: Page) => Promise<{ ok: boolean; note?: string }>;
  /** Optional check on the model's final answer. */
  answerCheck?: RegExp;
}

const SCENARIOS: Scenario[] = [
  {
    name: '真实搜索引擎（输入+提交+结果页导航）',
    urls: ['https://cn.bing.com/?mkt=zh-CN', 'https://www.bing.com', 'https://www.baidu.com'],
    task: 'In the search box, search for "Alan Turing" and confirm the results page shows results about him.',
    truth: async page => {
      const url = page.url();
      const body = await page.locator('body').innerText().catch(() => '');
      const ok = /[?&](q|wd|word)=/.test(url) && /turing|图灵/i.test(body);
      return { ok, note: url.slice(0, 100) };
    },
  },
  {
    name: 'httpbin 静态页信息提取（读页面答问题）',
    urls: ['https://httpbin.org/html'],
    task: 'Read this page and tell me the author and the book in the main heading.',
    truth: async () => ({ ok: true }), // extraction task: truth lives in the answer check
    answerCheck: /melville|moby/i,
  },
  {
    name: 'httpbin 真实表单提交并核对回显',
    urls: ['https://httpbin.org/forms/post'],
    task: 'Fill this order form: customer name "Lin Real", telephone "13900002222", email "real@test.dev", pick pizza size "Medium", then submit the order. Confirm the submitted data is echoed back.',
    truth: async page => {
      const body = await page.locator('body').innerText().catch(() => '');
      const ok = body.includes('Lin Real') && body.includes('13900002222');
      return { ok, note: ok ? 'echo contains submitted values' : body.slice(0, 200) };
    },
  },
];

async function seedProvider(ctx: Awaited<ReturnType<typeof launchExtension>>['context'], extId: string): Promise<void> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    async ({ base, key, model }) => {
      await chrome.storage.local.set({
        'browser-agent:providers': {
          providers: [{ id: 'real', kind: 'openai-compatible', label: 'Real Model', baseUrl: base, apiKey: key, model, enabled: true }],
          defaultProviderId: 'real',
        },
        // real sites: don't pause on the submit confirmation in headless runs
        'browser-agent:settings': {
          locale: 'zh-CN',
          theme: 'light',
          channel: 'dom',
          onboarded: true,
          guardrails: { confirmDangerous: false, allowlist: [], blocklist: [], redactSensitive: true, toolPolicies: {} },
          mcpServers: [],
        },
      });
    },
    { base: BASE, key: KEY, model: MODEL },
  );
  await page.close();
}

const SCENARIO_BUDGET_MS = 330000;

async function runScenario(
  ctx: Awaited<ReturnType<typeof launchExtension>>['context'],
  extId: string,
  sc: Scenario,
  r: Reporter,
): Promise<void> {
  r.section(sc.name);

  // Fresh page per candidate: a failed goto can leave a redirect in flight that
  // aborts the next navigation on the same page ("interrupted by another navigation").
  let site: Page | null = null;
  let reached = '';
  for (const url of sc.urls) {
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      site = p;
      reached = url;
      break;
    } catch (e) {
      console.log(`   candidate unreachable: ${url} — ${String(e).slice(0, 90)}`);
      await p.close().catch(() => undefined);
    }
  }
  if (!site) {
    r.check(`${sc.name} — 站点可达`, false, '所有候选站点均不可达');
    return;
  }
  r.check('站点可达', true, reached);
  await site.waitForTimeout(1200); // content script at document_idle

  const sp = await ctx.newPage();
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sp.waitForLoadState('domcontentloaded');
  await sp.waitForTimeout(500);

  const textarea = sp.locator('textarea').last();
  await textarea.fill(sc.task);
  await textarea.press('Enter');

  // v2: assert on the persisted RunRecord page_act saved, not on model-authored chat
  // text. Baseline the latest run id first — earlier scenarios left finished runs.
  const readLatestRun = () =>
    sp.evaluate(async () => {
      const s = await chrome.storage.local.get('browser-agent:runs');
      const run = (s['browser-agent:runs'] as Array<Record<string, unknown>> | undefined)?.[0];
      return run ? { id: String(run.id), status: String(run.status) } : null;
    });
  const baselineRunId = (await readLatestRun())?.id ?? null;
  const deadline = Date.now() + SCENARIO_BUDGET_MS;
  let status: string | null = null;
  while (Date.now() < deadline) {
    const run = await readLatestRun();
    if (run && run.id !== baselineRunId && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      status = run.status;
      break;
    }
    await sp.waitForTimeout(5000);
  }

  const succeeded = status === 'succeeded';
  r.check('闭环任务完成且证据核验通过', succeeded, `run status=${status}`);

  const runInfo = await sp.evaluate(async () => {
    const s = await chrome.storage.local.get('browser-agent:runs');
    const run = (s['browser-agent:runs'] as Array<Record<string, any>> | undefined)?.[0];
    if (!run) return null;
    return {
      status: run.status as string,
      turns: (run.steps as unknown[]).length,
      answer: (run.finalAnswer as string) ?? '',
      failure: run.failure?.message ?? '',
      steps: (run.steps as Array<Record<string, any>>).map(st => ({
        intent: String(st.step?.intent ?? '').slice(0, 90),
        action: st.step?.action?.type,
        status: st.status,
        error: st.outcome?.error?.message?.slice(0, 120),
        failedChecks: (st.verifications ?? [])
          .filter((v: Record<string, any>) => !v.passed)
          .map((v: Record<string, any>) => `${v.condition?.kind}: expected ${v.expected} / actual ${String(v.actual).slice(0, 80)}`),
      })),
    };
  });
  if (runInfo) {
    console.log(`   status=${runInfo.status} turns=${runInfo.turns}${runInfo.answer ? ` answer=${runInfo.answer.slice(0, 120)}` : ''}${runInfo.failure ? ` failure=${runInfo.failure.slice(0, 160)}` : ''}`);
    if (!succeeded) {
      for (const st of runInfo.steps) {
        console.log(`   · [${st.status}] ${st.action} ${st.intent}${st.error ? ` EXEC_ERR=${st.error}` : ''}${st.failedChecks.length ? ` FAILED=${st.failedChecks.join(' ; ')}` : ''}`);
      }
    }
  }

  if (sc.answerCheck) {
    r.check('模型结论包含正确信息', !!runInfo && sc.answerCheck.test(runInfo.answer), runInfo?.answer.slice(0, 80));
  }

  const truth = await sc.truth(site);
  r.check('Playwright 侧页面真值', truth.ok, truth.note);

  await sp.close().catch(() => undefined);
  await site.close().catch(() => undefined);
}

async function main() {
  if (!BASE || !KEY) {
    console.error('Set REAL_BASE and REAL_KEY env vars (REAL_MODEL optional).');
    process.exit(2);
  }
  const r = new Reporter();
  const only = process.env.ONLY ?? '';
  const scenarios = only ? SCENARIOS.filter(s => s.name.includes(only)) : SCENARIOS;
  buildProdExtension(); // a stale VITE_USE_MOCK build would silently swap in the mock planner

  // Hard watchdog: a wedged page/model call must never hang the suite for hours.
  const watchdog = setTimeout(() => {
    console.error(`WATCHDOG: suite exceeded budget, aborting.`);
    process.exit(3);
  }, scenarios.length * (SCENARIO_BUDGET_MS + 90000));
  watchdog.unref?.();

  const { context, extensionId, close } = await launchExtension();
  try {
    await seedProvider(context, extensionId);
    for (const sc of scenarios) {
      // per-scenario guard so one wedged scenario can't eat the others' budget
      await Promise.race([
        runScenario(context, extensionId, sc, r),
        new Promise<void>(resolve =>
          setTimeout(() => {
            r.check(`${sc.name} — 场景超预算被跳过`, false, `${SCENARIO_BUDGET_MS + 60000}ms`);
            resolve();
          }, SCENARIO_BUDGET_MS + 60000),
        ),
      ]);
    }
  } finally {
    await close().catch(() => undefined);
  }
  const ok = r.summary();
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
