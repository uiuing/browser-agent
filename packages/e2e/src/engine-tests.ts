import { chromium, type Browser, type Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './serve';
import { buildAgentIIFE } from './bundle-agent';
import { PlaywrightBridge } from './playwright-bridge';
import { Reporter } from './assert';

import { Orchestrator } from '../../extension/src/engine/orchestrator/run';
import { TraceBus } from '../../extension/src/trace/trace-bus';
import { createSecurityGate } from '../../extension/src/guardrails/security';
import { LLMPlanner } from '../../extension/src/llm/planner';
import { MockProvider } from '../../extension/src/llm/mock/mock-provider';
import { extractSkill } from '../../extension/src/engine/batch/skill-extract';
import { BatchRunner } from '../../extension/src/engine/batch/batch-runner';
import type { BatchRun } from '../../extension/src/engine/contracts/batch';
import type { OrchestratorDeps } from '../../extension/src/engine/orchestrator/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../../fixtures/dist');
const HEADLESS = process.env.HEADED !== '1';

function deps(bus = new TraceBus()): OrchestratorDeps {
  return {
    trace: bus,
    security: createSecurityGate({ confirmDangerous: false, allowlist: [], blocklist: [] }),
    confirmer: { confirm: async () => true },
  };
}

function planner() {
  return new LLMPlanner(new MockProvider());
}

async function newPage(browser: Browser, agentJs: string, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript({ content: agentJs });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as unknown as { __browserAgent?: unknown }).__browserAgent, undefined, { timeout: 5000 });
  return page;
}

async function main() {
  const r = new Reporter();
  const server = await serveStatic(FIX, 4178);
  const agentJs = await buildAgentIIFE();
  const browser = await chromium.launch({ headless: HEADLESS });
  const base = server.url;

  try {
    /* ---------- L1 perception: whole-page, off-screen ---------- */
    r.section('L1 感知 · 全页语义图（含屏幕外字段）');
    {
      const page = await newPage(browser, agentJs, `${base}/longform.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const snap = await bridge.call('snapshot', { maxNodes: 300 });
      const invoice = snap.nodes.find(n => n.name.includes('发票抬头'));
      r.check('整页快照包含屏幕外字段“发票抬头”', !!invoice, invoice ? `node#${invoice.id} inViewport=${invoice.inViewport}` : 'missing');
      r.check('该字段位于首屏之外仍被感知', !!invoice && invoice.inViewport === false, invoice ? `y=${invoice.rect.y}` : '');
      const inputs = snap.nodes.filter(n => n.componentType === 'native-input' || n.componentType === 'textarea');
      r.check('长表单字段全部被感知（≥16）', inputs.length >= 16, `got ${inputs.length}`);
      await page.close();
    }

    /* ---------- L1 iframe: same-origin descent ---------- */
    r.section('L1 感知 · 同源 iframe 穿透');
    {
      const page = await newPage(browser, agentJs, `${base}/iframe.html?lang=zh`);
      await page.waitForTimeout(400);
      const bridge = new PlaywrightBridge(page);
      const snap = await bridge.call('snapshot', {});
      const invoiceInFrame = snap.nodes.find(n => n.framePath.includes('iframe') && n.attrs['data-testid'] === 'field-invoice');
      r.check('感知进入同源 iframe 内的字段', !!invoiceInFrame, invoiceInFrame ? `framePath=${invoiceInFrame.framePath}` : 'missing');
      await page.close();
    }

    /* ---------- L2 grounding: fingerprint match ---------- */
    r.section('L2 接地 · 语义指纹定位');
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const g = await bridge.call('resolve', { fingerprint: { role: 'textbox', name: '手机号', attrs: { 'data-testid': 'field-phone' } } });
      r.check('按指纹命中“手机号”输入框', g.nodeId !== null && g.confidence >= 0.6, `confidence=${g.confidence}`);
      await page.close();
    }

    /* ---------- L2 custom controls adapters ---------- */
    r.section('L2 接地 · 自定义控件适配（antd 下拉 / 日期 / 级联 / 多选 / 上传）');
    {
      const page = await newPage(browser, agentJs, `${base}/controls.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);

      const dept = await bridge.call('execute', { action: { type: 'setValue', target: { fingerprint: { componentType: 'custom-select', attrs: { 'data-testid': 'field-dept' } } }, value: '销售部' } });
      r.check('Ant 风格下拉：选择“销售部”', dept.ok, dept.readback ?? dept.error?.message);

      const date = await bridge.call('execute', { action: { type: 'setValue', target: { fingerprint: { componentType: 'datepicker', attrs: { 'data-testid': 'field-date' } } }, value: '2026-07-01' } });
      r.check('日期选择：写入 2026-07-01', date.ok, date.readback ?? date.error?.message);

      const casc = await bridge.call('execute', { action: { type: 'setValue', target: { fingerprint: { componentType: 'cascader', attrs: { 'data-testid': 'field-cascader' } } }, value: '广东/深圳' } });
      r.check('级联选择：广东/深圳', casc.ok, casc.readback ?? casc.error?.message);

      const multi = await bridge.call('execute', { action: { type: 'setValue', target: { fingerprint: { componentType: 'multiselect', attrs: { 'data-testid': 'field-tags' } } }, value: '促销, 新品' } });
      r.check('多选标签：促销 + 新品', multi.ok, multi.readback ?? multi.error?.message);

      const upload = await bridge.call('execute', { action: { type: 'uploadFile', target: { fingerprint: { componentType: 'file-upload', attrs: { 'data-testid': 'field-upload' } } }, file: { name: 'contract.pdf', mimeType: 'application/pdf', contentText: 'dummy' } } });
      r.check('文件上传：contract.pdf', upload.ok, upload.readback ?? upload.error?.message);

      const state = await page.evaluate(() => (document.getElementById('result') as HTMLElement).textContent || '');
      r.check('页面真值反映所有控件取值', state.includes('销售部') && state.includes('2026-07-01') && state.includes('深圳') && state.includes('促销') && state.includes('contract.pdf'), '');
      await page.close();
    }

    /* ---------- L5 verification + full task (mock, no key) ---------- */
    r.section('L5 验证 · 无 key 跑通「感知→执行→验证」闭环');
    let successfulRun = null as Awaited<ReturnType<Orchestrator['run']>> | null;
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const orch = new Orchestrator(bridge, planner(), deps());
      const run = await orch.run('新建客户，姓名张伟，手机13800138000，邮箱zhangwei@example.com，区域华东区，备注重点客户');
      successfulRun = run;
      r.check('任务状态 = succeeded', run.status === 'succeeded', run.failure?.message ?? '');
      r.check('后置条件有通过项', run.verify.passed > 0, `passed=${run.verify.passed} failed=${run.verify.failed}`);
      const rows = await page.locator('[data-testid="record-row"]').count();
      r.check('列表真实新增一行（2→3）', rows === 3, `rows=${rows}`);
      const nameFilled = run.steps.some(s => s.step.action.type === 'fill' && s.verifications.some(v => v.passed && v.condition.kind === 'value_equals'));
      r.check('字段写入后 value_equals 验证通过', nameFilled, '');
      await page.close();
    }

    /* ---------- L5 fake-success detection ---------- */
    r.section('L5 验证 · 识破“假成功”（弹 toast 但未入库）');
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh&inject=fakeSuccess`);
      const bridge = new PlaywrightBridge(page);
      const orch = new Orchestrator(bridge, planner(), deps());
      const run = await orch.run('新建客户，姓名李娜，手机13911112222，邮箱lina@example.com，区域华南区');
      r.check('任务被判定为失败', run.status === 'failed', `status=${run.status}`);
      const deltaFailed = run.steps.some(s => s.verifications.some(v => !v.passed && v.condition.kind === 'list_count_delta'));
      r.check('识破依据：列表行数未 +1', deltaFailed, '');
      const rows = await page.locator('[data-testid="record-row"]').count();
      r.check('DOM 真值确认未入库（仍 2 行）', rows === 2, `rows=${rows}`);
      await page.close();
    }

    /* ---------- L5 bad prediction rescue: fingerprint never grounds ---------- */
    r.section('L5 验证 · 预测指纹写错时以页面真值裁决（不冤枉正确操作）');
    {
      // The model phrases the list fingerprint wrong — it matches NOTHING, so the
      // baseline counts 0. The row IS really added; the verdict must come from
      // page-truth group counts instead of failing a correct action.
      const badDelta = {
        kind: 'list_count_delta' as const,
        list: { attrs: { selector: '#no-such-list .row' } },
        delta: 1,
      };
      const fp = (testid: string) => ({ attrs: { 'data-testid': testid } });

      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const baseline = await bridge.call('baseline', { conditions: [badDelta] });
      await bridge.call('execute', { action: { type: 'fill', target: { fingerprint: fp('field-name') }, value: '赵观测' } });
      await bridge.call('execute', { action: { type: 'fill', target: { fingerprint: fp('field-phone') }, value: '13112345678' } });
      await bridge.call('execute', { action: { type: 'click', target: { fingerprint: fp('submit') } } });
      const res = await bridge.call('verify', { conditions: [badDelta], baseline });
      r.check('指纹从未命中但行真实新增 → 判通过', res[0].passed === true, `${res[0].actual} · ${res[0].evidence ?? ''}`);
      await page.close();

      // Counterpart: fake success (toast, no row) must STILL fail with the same
      // bad fingerprint — the page-truth fallback must not soften fake-success detection.
      const page2 = await newPage(browser, agentJs, `${base}/customer.html?lang=zh&inject=fakeSuccess`);
      const bridge2 = new PlaywrightBridge(page2);
      const baseline2 = await bridge2.call('baseline', { conditions: [badDelta] });
      await bridge2.call('execute', { action: { type: 'fill', target: { fingerprint: fp('field-name') }, value: '假成功' } });
      await bridge2.call('execute', { action: { type: 'fill', target: { fingerprint: fp('field-phone') }, value: '13100001111' } });
      await bridge2.call('execute', { action: { type: 'click', target: { fingerprint: fp('submit') } } });
      const res2 = await bridge2.call('verify', { conditions: [badDelta], baseline: baseline2 });
      r.check('指纹写错且行未新增（假成功）→ 仍判失败', res2[0].passed === false, res2[0].actual);
      await page2.close();
    }

    /* ---------- L6 self-heal under flaky ---------- */
    r.section('L6 自愈 · 抖动下重试完成');
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh&inject=flaky`);
      const bridge = new PlaywrightBridge(page);
      const orch = new Orchestrator(bridge, planner(), deps());
      const run = await orch.run('新建客户，姓名王芳，手机13733334444，邮箱wangfang@example.com，区域华北区');
      const healed = run.steps.some(s => s.healings.length > 0);
      r.check('抖动触发了自愈重试', healed, `healings=${run.steps.reduce((a, s) => a + s.healings.length, 0)}`);
      r.check('最终仍然成功', run.status === 'succeeded', run.failure?.message ?? '');
      await page.close();
    }

    /* ---------- L6 smart wait under slow load ---------- */
    r.section('L6 自愈 · 慢加载下智能等待');
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh&inject=slow`);
      const bridge = new PlaywrightBridge(page);
      const orch = new Orchestrator(bridge, planner(), deps());
      const run = await orch.run('新建客户，姓名赵磊，手机13822223333，邮箱zhaolei@example.com，区域西部区');
      r.check('慢加载下任务成功', run.status === 'succeeded', run.failure?.message ?? '');
      await page.close();
    }

    /* ---------- L7 skill + batch + delivery report ---------- */
    r.section('L7 批量 · 技能化 + 逐行验证 + 交付报告 + 错误隔离');
    if (successfulRun) {
      const skill = extractSkill(successfulRun, { id: 'skill_test', name: '新建客户', now: new Date().toISOString() });
      r.check('从成功任务抽取出数据槽', skill.slots.length >= 3, `slots=${skill.slots.map(s => s.name).join(',')}`);

      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const bus = new TraceBus();
      const runner = new BatchRunner(bridge, planner(), deps(bus));

      const slotNames = skill.slots.map(s => s.name);
      const good = (i: number): Record<string, string> => {
        const row: Record<string, string> = {};
        for (const s of skill.slots) {
          if (/name|姓名/.test(s.name) || s.example?.match(/[\u4e00-\u9fa5]/)) row[s.name] = `测试${i}`;
        }
        // map by slot label heuristics
        skill.slots.forEach(s => {
          if (s.label.includes('姓名') || s.label.toLowerCase().includes('name')) row[s.name] = `批量客户${i}`;
          else if (s.label.includes('手机') || s.label.toLowerCase().includes('phone')) row[s.name] = `1380000${String(1000 + i).slice(-4)}`;
          else if (s.label.includes('邮箱') || s.label.toLowerCase().includes('email')) row[s.name] = `user${i}@example.com`;
          else if (s.label.includes('区域') || s.label.toLowerCase().includes('region')) row[s.name] = ['华东区', '华南区', '华北区', '西部区'][i % 4];
          else row[s.name] = s.example ?? `${s.label}${i}`;
        });
        return row;
      };
      const rowsData: Record<string, string>[] = [];
      for (let i = 1; i <= 6; i++) rowsData.push(good(i));
      // inject 2 bad rows (missing required phone)
      const phoneSlot = skill.slots.find(s => s.label.includes('手机') || s.label.toLowerCase().includes('phone'));
      if (phoneSlot) {
        rowsData[2] = { ...rowsData[2], [phoneSlot.name]: '' };
        rowsData[4] = { ...rowsData[4], [phoneSlot.name]: '' };
      }

      const batch: BatchRun = {
        id: 'batch_test',
        skillId: skill.id,
        name: 'test batch',
        createdAt: new Date().toISOString(),
        status: 'draft',
        cursor: 0,
        rows: rowsData.map((data, index) => ({ index, data, status: 'pending', attempts: 0 })),
        stats: { total: rowsData.length, succeeded: 0, failed: 0, skipped: 0, pending: rowsData.length },
      };

      const result = await runner.run(batch, skill);
      const good6 = phoneSlot ? 4 : 6;
      r.check('逐行执行完成', result.status === 'completed', `status=${result.status}`);
      r.check('坏数据行被隔离为失败（2 行）', result.stats.failed === (phoneSlot ? 2 : 0), `failed=${result.stats.failed}`);
      r.check(`好数据行全部成功（${good6} 行）`, result.stats.succeeded === good6, `succeeded=${result.stats.succeeded}`);

      const domRows = await page.locator('[data-testid="record-row"]').count();
      r.check('交付报告与页面真值一致', domRows === 2 + result.stats.succeeded, `dom=${domRows} expected=${2 + result.stats.succeeded}`);

      // re-run failed rows after fixing data
      if (phoneSlot) {
        const fixed = result.rows.map(row => (row.status === 'failed' ? { ...row, data: { ...row.data, [phoneSlot.name]: `1390000${String(row.index).padStart(4, '0')}` }, status: 'pending' as const, error: undefined } : row));
        const failedIdx = fixed.filter(x => x.status === 'pending').map(x => x.index);
        const rerun = await runner.run({ ...result, rows: fixed, status: 'draft' }, skill, { onlyIndices: failedIdx });
        r.check('重跑失败行后全部成功', rerun.stats.failed === 0 && rerun.stats.succeeded === rowsData.length, `succeeded=${rerun.stats.succeeded}/${rowsData.length}`);
      }
      await page.close();
    } else {
      r.check('依赖前置成功任务', false, 'no successful run to extract skill');
    }

    /* ---------- Observability: trace ---------- */
    r.section('可观测 · Trace 事件完整');
    {
      const page = await newPage(browser, agentJs, `${base}/customer.html?lang=zh`);
      const bridge = new PlaywrightBridge(page);
      const bus = new TraceBus();
      const orch = new Orchestrator(bridge, planner(), deps(bus));
      const run = await orch.run('新建客户，姓名周涛，手机13600009999，邮箱zhoutao@example.com，区域华东区');
      const events = bus.events(run.id);
      const types = new Set(events.map(e => e.type));
      r.check('包含 run_started/plan_created/action_executed/verify_result', ['run_started', 'plan_created', 'action_executed', 'verify_result'].every(t => types.has(t as never)), `${events.length} events`);
      r.check('每个动作都有验证结果事件', events.filter(e => e.type === 'verify_result').length > 0, '');
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const ok = r.summary();
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
