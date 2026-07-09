import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { launchExtension, buildTestExtension } from './ext-launch';
import { serveStatic } from './serve';
import { Reporter } from './assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../../fixtures/dist');

async function pageFor(ctx: Awaited<ReturnType<typeof launchExtension>>['context'], extId: string, file: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/${file}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/**
 * Extension e2e against the TEST build (VITE_USE_MOCK=1 → deterministic planner, no
 * API key). Exercises the real product surfaces: onboarding, options, and the killer
 * journey — a fixtures page in one tab driven from the side panel in another tab via
 * the content-script bridge (the exact path a user's task takes).
 */
async function main() {
  if (process.env.SKIP_EXT_BUILD !== '1') buildTestExtension();

  const r = new Reporter();
  const server = await serveStatic(FIX, 4181);
  const { context, extensionId, close } = await launchExtension();

  try {
    r.section('MV3 加载');
    r.check('扩展加载并拿到 extensionId', !!extensionId, extensionId);

    r.section('Onboarding');
    const ob = await pageFor(context, extensionId, 'onboarding.html');
    await ob.waitForTimeout(400);
    r.check('步骤 1 渲染（语言选择）', (await ob.getByText(/简体中文|English/).count()) > 0);
    await ob.getByRole('button', { name: /下一步|Next/ }).click();
    await ob.waitForTimeout(200);
    r.check('步骤 2 渲染模型连接表单（Base URL / Key / 模板）', (await ob.locator('input').count()) >= 3);
    r.check('步骤 2 无“演示模式”话术', (await ob.getByText(/演示模式|demo mode/i).count()) === 0);
    await ob.close();

    r.section('设置页');
    const options = await pageFor(context, extensionId, 'options.html');
    await options.waitForTimeout(400);
    r.check('设置页渲染模型 Provider 区', (await options.getByText(/Provider|模型/).count()) > 0);
    // add a provider from template and verify persistence
    await options.getByRole('button', { name: /DeepSeek/ }).first().click().catch(() => undefined);
    await options.waitForTimeout(300);
    const persisted = await options.evaluate(async () => {
      const s = await chrome.storage.local.get('browser-agent:providers');
      return (s['browser-agent:providers']?.providers ?? []).length;
    });
    r.check('添加 Provider 后持久化到 storage', persisted > 0, `providers=${persisted}`);
    r.check('通用设置不再有市场开关', (await options.getByText(/^市场$|^Market$/).count()) === 0);
    await options.close();

    r.section('聊天内核（纯对话回合，不触发工具）');
    // fixtures page first so the panel has an operable target tab
    const fx = await context.newPage();
    await fx.goto(`${server.url}/customer.html?lang=zh`);
    await fx.waitForLoadState('domcontentloaded');
    await fx.waitForTimeout(600); // content script runs at document_idle

    const sp = await pageFor(context, extensionId, 'sidepanel.html');
    await sp.waitForTimeout(600);
    const targetShown = (await sp.getByText(/新建客户|localhost/).count()) > 0;
    r.check('侧板锁定 fixtures 标签页为操作目标', targetShown);

    const textarea = sp.locator('textarea').last();
    await textarea.fill('你好，介绍一下你自己');
    await textarea.press('Enter');
    await sp.getByText(/\[Mock\] 你说/).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    r.check('纯聊天回合流式回复（无工具调用）', (await sp.getByText(/\[Mock\] 你说/).count()) > 0);

    r.section('页面问答（page_read 工具回合）');
    await textarea.fill('总结一下这个页面');
    await textarea.press('Enter');
    await sp.getByText(/\[Mock\] 页面内容如下/).first().waitFor({ timeout: 20000 }).catch(() => undefined);
    r.check('page_read 调用并基于页面摘要作答', (await sp.getByText(/\[Mock\] 页面内容如下/).count()) > 0);
    const sessionPersisted = await sp.evaluate(async () => {
      const s = await chrome.storage.local.get('browser-agent:sessions');
      return (s['browser-agent:sessions'] ?? []).length;
    });
    r.check('会话持久化到 storage', sessionPersisted > 0, `sessions=${sessionPersisted}`);

    r.section('杀手旅程（page_act：聊天派活 → 引擎执行 → 页面证据）');
    await textarea.fill('新建客户，姓名测试员，手机13800001234，邮箱tester@example.com，区域华东区，备注端到端');
    await textarea.press('Enter');

    // The submit step inside page_act is high-risk → the engine guardrail raises a
    // confirmation. Approve it (this exercises the safety-confirm path end to end).
    const proceed = sp.getByRole('button', { name: /继续执行|Proceed/ });
    await proceed.waitFor({ timeout: 20000 }).catch(() => undefined);
    if (await proceed.count()) {
      r.check('高危提交触发二次确认', true);
      await proceed.click();
    } else {
      r.check('高危提交触发二次确认', false, 'no confirm dialog appeared');
    }

    // wait for the model's wrap-up after the verified tool result
    await sp.getByText(/\[Mock\] 执行完成/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
    const actDone = (await sp.getByText(/\[Mock\] 执行完成/).count()) > 0;
    r.check('page_act 完成并回到对话（工具结果驱动总结）', actDone);
    if (!actDone) {
      // Diagnose: dump the persisted transcript — tool call params/status/summary.
      const dump = await sp.evaluate(async () => {
        const idx = await chrome.storage.local.get('browser-agent:sessions');
        const metas = (idx['browser-agent:sessions'] ?? []) as Array<{ id: string }>;
        if (!metas[0]) return 'no session';
        const key = `browser-agent:session:${metas[0].id}`;
        const sess = (await chrome.storage.local.get(key))[key];
        const msgs = (sess as { messages?: unknown[] })?.messages ?? [];
        return JSON.stringify(msgs.slice(-3), null, 1).slice(0, 3000);
      });
      console.log('SESSION DUMP:\n' + dump);
    }
    r.check('工具卡片渲染验证徽章', (await sp.getByText(/已核对|Checked/).count()) > 0);

    // page truth on the fixtures tab: the record actually landed
    const rows = await fx.locator('[data-testid="record-row"]').count();
    r.check('客户真实入库（3 行：2 seed + 1 新建）', rows === 3, `rows=${rows}`);
    const hasName = (await fx.getByText('测试员').count()) > 0;
    r.check('新建客户姓名出现在列表', hasName);

    // provenance: the run this chat spawned carries the session id
    const provenance = await sp.evaluate(async () => {
      const s = await chrome.storage.local.get(['browser-agent:runs', 'browser-agent:sessions']);
      const run = (s['browser-agent:runs'] ?? [])[0];
      const sess = (s['browser-agent:sessions'] ?? [])[0];
      return { runSession: run?.sessionId ?? null, sessionId: sess?.id ?? null, toolCallId: run?.toolCallId ?? null };
    });
    r.check(
      '执行记录带会话溯源（sessionId + toolCallId）',
      !!provenance.runSession && provenance.runSession === provenance.sessionId && !!provenance.toolCallId,
      JSON.stringify(provenance),
    );

    await sp.close();
    await fx.close();
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
