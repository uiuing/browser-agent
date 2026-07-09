import { chromium, type BrowserContext } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(here, '../../extension/.output/chrome-mv3');

/**
 * Build the extension in TEST mode (VITE_USE_MOCK=1): the planner router resolves the
 * deterministic MockProvider, so e2e/shots run the full loop with zero API key. User
 * builds (`pnpm build`) never take this path.
 */
export function buildTestExtension(): void {
  console.log('Building test extension (VITE_USE_MOCK=1)…');
  execSync('pnpm build', {
    cwd: path.resolve(here, '../../extension'),
    env: { ...process.env, VITE_USE_MOCK: '1' },
    stdio: 'inherit',
  });
}

/**
 * Build the PRODUCTION extension. Real-LLM suites must call this: a leftover test
 * build silently routes to the MockProvider (planner label "MockPlanner (test
 * build)") and the real model never gets called. SKIP_BUILD=1 reuses the last build
 * when you know it's a production one.
 */
export function buildProdExtension(): void {
  if (process.env.SKIP_BUILD === '1') {
    console.log('SKIP_BUILD=1 — reusing existing extension build.');
    return;
  }
  console.log('Building production extension…');
  const env = { ...process.env };
  delete env.VITE_USE_MOCK;
  execSync('pnpm build', {
    cwd: path.resolve(here, '../../extension'),
    env,
    stdio: 'inherit',
  });
}

/**
 * Extensions require a full (non-headless-shell) Chromium and headed mode. Resolve a
 * usable full-Chromium binary: env override → any chromium-* build in the Playwright
 * cache → let Playwright pick its default.
 */
function resolveChromium(): string | undefined {
  if (process.env.PW_CHROMIUM_EXECUTABLE && existsSync(process.env.PW_CHROMIUM_EXECUTABLE)) {
    return process.env.PW_CHROMIUM_EXECUTABLE;
  }
  // Prefer the Playwright-managed full Chromium build that matches this Playwright
  // version — a Playwright-launched build avoids the system-Chrome singleton hand-off
  // (which closes the automation context).
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
        : path.join(os.homedir(), '.cache', 'ms-playwright'));
  const exeCandidates =
    process.platform === 'win32'
      ? [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']]
      : process.platform === 'darwin'
        ? [['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]
        : [['chrome-linux', 'chrome']];
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter(d => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      for (const parts of exeCandidates) {
        const exe = path.join(cache, b, ...parts);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

export interface LaunchedExt {
  context: BrowserContext;
  extensionId: string;
  close: () => Promise<void>;
}

/**
 * Launch a persistent context with the built MV3 extension loaded, following the
 * documented Playwright workaround (headed, --load-extension, extensionId from the
 * service worker URL).
 */
export async function launchExtension(): Promise<LaunchedExt> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'pf-profile-'));
  const executablePath = resolveChromium();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      // Chrome 137+ gates --load-extension behind this feature flag.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // find the MV3 service worker to read the extension id. It can take a moment to
  // register after load, so poll (and nudge with a blank page) rather than assume.
  const readId = (): string => {
    const sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    return sw ? new URL(sw.url()).host : '';
  };
  let extensionId = readId();
  if (!extensionId) {
    const nudge = await context.newPage();
    await nudge.goto('about:blank').catch(() => undefined);
    const deadline = Date.now() + 30000;
    while (!extensionId && Date.now() < deadline) {
      const sw = await context.waitForEvent('serviceworker', { timeout: 2500 }).catch(() => null);
      if (sw) extensionId = new URL(sw.url()).host;
      else extensionId = readId();
    }
    await nudge.close().catch(() => undefined);
  }

  return {
    context,
    extensionId,
    close: async () => {
      await context.close();
    },
  };
}
