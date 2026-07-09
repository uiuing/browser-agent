import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { launchExtension, buildTestExtension } from './ext-launch';
import { serveStatic } from './serve';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '../../../shots');
const FIX = path.resolve(here, '../../fixtures/dist');

type Theme = 'light' | 'dark';
type Locale = 'zh-CN' | 'en-US';

const BREAKPOINTS = [
  { name: 'mobile', w: 390, h: 800 },
  { name: 'tablet', w: 900, h: 1000 },
  { name: 'desktop', w: 1440, h: 900 },
];
const PANEL_BP = [
  { name: 'panel-narrow', w: 360, h: 800 },
  { name: 'panel-wide', w: 460, h: 860 },
];

async function seedSettings(page: Page, extId: string, theme: Theme, locale: Locale, extra: Record<string, unknown> = {}) {
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.evaluate(
    async ({ theme, locale, extra }) => {
      await chrome.storage.local.set({
        'browser-agent:settings': {
          locale,
          theme,
          channel: 'dom',
          onboarded: true,
          guardrails: { confirmDangerous: true, allowlist: [], blocklist: [], redactSensitive: true, toolPolicies: {} },
          mcpServers: [],
        },
        ...extra,
      });
    },
    { theme, locale, extra },
  );
}

async function shoot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  console.log('  📸', name);
}

async function main() {
  if (process.env.SKIP_EXT_BUILD !== '1') buildTestExtension();

  const server = await serveStatic(FIX, 4182);
  const { context, extensionId, close } = await launchExtension();
  console.log('extensionId:', extensionId);
  const page = await context.newPage();

  const combos: { theme: Theme; locale: Locale }[] = [
    { theme: 'light', locale: 'zh-CN' },
    { theme: 'dark', locale: 'zh-CN' },
    { theme: 'light', locale: 'en-US' },
    { theme: 'dark', locale: 'en-US' },
  ];

  try {
    for (const { theme, locale } of combos) {
      await seedSettings(page, extensionId, theme, locale);
      const tag = `${theme}-${locale}`;

      // full-width pages across 3 breakpoints
      for (const bp of BREAKPOINTS) {
        await page.setViewportSize({ width: bp.w, height: bp.h });
        for (const [file, key] of [
          ['onboarding.html', 'onboarding'],
          ['options.html', 'options'],
        ] as const) {
          await page.goto(`chrome-extension://${extensionId}/${file}`);
          await shoot(page, `${key}_${bp.name}_${tag}`);
        }
      }

      // side panel across panel breakpoints (empty chat state)
      for (const bp of PANEL_BP) {
        await page.setViewportSize({ width: bp.w, height: bp.h });
        await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        await shoot(page, `sidepanel_${bp.name}_${tag}`);
      }
    }

    // onboarding step 2 (connect model) and step 3 (how to use), both locales
    for (const locale of ['zh-CN', 'en-US'] as const) {
      await seedSettings(page, extensionId, 'light', locale);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /下一步|Next/ }).click();
      await shoot(page, `onboarding_step2_light-${locale}`);
      await page.getByRole('button', { name: /暂时跳过|Skip for now/ }).click();
      await shoot(page, `onboarding_step3_light-${locale}`);
    }

    // killer journey states: fixtures tab + side panel tab (active-tab bridge), both
    // locales. Disable the dangerous-action confirm so the flow streams to the result.
    const journeys = [
      {
        locale: 'zh-CN' as const,
        fixtureLang: 'zh',
        task: '新建客户，姓名张伟，手机13800138000，邮箱zhangwei@example.com，区域华东区，备注重点客户',
        doneRe: /\[Mock\] 执行完成/,
      },
      {
        locale: 'en-US' as const,
        fixtureLang: 'en',
        task: 'Create a customer: name Jane Doe, phone 555-0142, email jane@acme.io, region East, note VIP',
        doneRe: /\[Mock\] 执行完成/,
      },
    ];
    for (const j of journeys) {
      await seedSettings(page, extensionId, 'light', j.locale, {
        'browser-agent:settings': {
          locale: j.locale,
          theme: 'light',
          channel: 'dom',
          onboarded: true,
          guardrails: { confirmDangerous: false, allowlist: [], blocklist: [], redactSensitive: true, toolPolicies: {} },
          mcpServers: [],
        },
      });
      const fx = await context.newPage();
      await fx.goto(`${server.url}/customer.html?lang=${j.fixtureLang}`);
      await fx.waitForTimeout(600);

      const sp = await context.newPage();
      await sp.setViewportSize({ width: 460, height: 900 });
      await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await sp.waitForTimeout(600);
      const textarea = sp.locator('textarea').last();
      await textarea.fill(j.task);
      await textarea.press('Enter');
      await sp.waitForTimeout(1500);
      await shoot(sp, `sidepanel_running_light-${j.locale}`);
      await sp.getByText(j.doneRe).first().waitFor({ timeout: 25000 }).catch(() => undefined);
      await sp.waitForTimeout(600);
      await shoot(sp, `sidepanel_result_light-${j.locale}`);
      await shoot(fx, `fixtures_after_run_light-${j.locale}`);
      await sp.close();
      await fx.close();
    }
  } finally {
    await close();
    await server.close();
  }
  console.log('\nScreenshots written to shots/');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
