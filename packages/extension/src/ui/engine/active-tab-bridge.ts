import type { Bridge } from '../../engine/contracts/bridge';
import { ChromeBridge } from '../../messaging/chrome-bridge';
import { injectContentScript } from '../../messaging/inject';

export interface ActiveTab {
  tabId: number | null;
  windowId?: number;
  url: string;
  title: string;
}

interface Candidate {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  focusedWindow: boolean;
  lastAccessed: number;
}

const isOperable = (url?: string) => !!url && /^(https?|file):/.test(url);

/** Every operable tab across ALL windows — the agent's reachable world. */
export async function listOperableTabs(): Promise<Candidate[]> {
  const [tabs, focused] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getLastFocused().catch(() => null),
  ]);
  return tabs
    .filter((t) => isOperable(t.url) && t.id !== undefined)
    .map((t) => ({
      tabId: t.id!,
      windowId: t.windowId!,
      url: t.url ?? '',
      title: t.title ?? '',
      active: !!t.active,
      focusedWindow: t.windowId === focused?.id,
      lastAccessed: (t as { lastAccessed?: number }).lastAccessed ?? 0,
    }));
}

/* ------------------------------------------------------------------ */
/* Task-aware routing: pick the tab the task is talking about, across */
/* every window, without asking the user. */
/* ------------------------------------------------------------------ */

/** Meaningful tokens from a URL host: "www.github.com" → ["github"]. */
function hostTokens(url: string): string[] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host
      .split('.')
      .filter(
        (p) =>
          p.length >= 3 &&
          !['www', 'com', 'org', 'net', 'cn', 'io', 'localhost'].includes(p),
      );
  } catch {
    return [];
  }
}

/** Tokens from a page title: latin words (≥3 chars) + CJK bigrams. */
function titleTokens(title: string): string[] {
  const tokens: string[] = [];
  for (const m of title.toLowerCase().matchAll(/[a-z][a-z0-9]{2,}/g))
    tokens.push(m[0]);
  const cjk = title.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/**
 * Score how strongly a task refers to a tab. Sum of:
 * - host token matches (weight 3 — "在 github 上…" should beat title noise)
 * - title token matches (weight 1, capped so long titles don't dominate)
 */
function scoreTab(taskLower: string, tab: Candidate): number {
  let score = 0;
  for (const tok of new Set(hostTokens(tab.url))) {
    if (taskLower.includes(tok)) score += 3;
  }
  let titleHits = 0;
  for (const tok of new Set(titleTokens(tab.title))) {
    if (taskLower.includes(tok)) titleHits++;
  }
  score += Math.min(titleHits, 4);
  return score;
}

export interface RouteResult {
  tab: Candidate | null;
  /** Why this tab: 'mentioned' (task refers to it) | 'active' | 'recent'. */
  reason: 'mentioned' | 'active' | 'recent' | 'none';
}

/**
 * Resolve which tab a task should run on:
 * 1. the tab the task itself mentions (host/title match, any window), else
 * 2. the active tab of the last-focused window, else
 * 3. the most recently used operable tab anywhere.
 */
export function routeTask(task: string, tabs: Candidate[]): RouteResult {
  if (tabs.length === 0) return { tab: null, reason: 'none' };
  const taskLower = task.toLowerCase();

  const scored = tabs
    .map((tab) => ({ tab, score: scoreTab(taskLower, tab) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.tab.active && b.tab.focusedWindow) -
          Number(a.tab.active && a.tab.focusedWindow) ||
        b.tab.lastAccessed - a.tab.lastAccessed,
    );
  if (scored[0].score >= 2) return { tab: scored[0].tab, reason: 'mentioned' };

  const focusedActive = tabs.find((t) => t.active && t.focusedWindow);
  if (focusedActive) return { tab: focusedActive, reason: 'active' };

  const recent = [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
  return { tab: recent, reason: 'recent' };
}

/** Resolve the tab the agent would operate on right now (for the UI pill). */
export async function getActiveTab(task?: string): Promise<ActiveTab> {
  try {
    const tabs = await listOperableTabs();
    const { tab } = routeTask(task ?? '', tabs);
    return tab
      ? {
          tabId: tab.tabId,
          windowId: tab.windowId,
          url: tab.url,
          title: tab.title,
        }
      : { tabId: null, url: '', title: '' };
  } catch {
    return { tabId: null, url: '', title: '' };
  }
}

/** Bring the chosen tab into view (its window too) so the user sees the work. */
export async function focusTab(
  tabId: number,
  windowId?: number,
): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
    if (windowId !== undefined)
      await chrome.windows.update(windowId, { focused: true });
  } catch {
    // focusing is best-effort; the bridge works on background tabs regardless
  }
}

async function ping(bridge: Bridge): Promise<boolean> {
  try {
    const hello = await bridge.call('hello');
    return hello.ok;
  } catch {
    return false;
  }
}

/**
 * Make the content-script page agent reachable on the tab. Tabs opened before the
 * extension was installed/reloaded don't have the content script yet — inject it
 * on demand (the script itself guards against double execution) and re-ping.
 */
export async function connectAgent(
  tabId: number,
  bridge: Bridge,
): Promise<boolean> {
  if (await ping(bridge)) return true;
  if (!(await injectContentScript(tabId))) return false;
  for (let i = 0; i < 6; i++) {
    if (await ping(bridge)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/**
 * While a run is live, follow the work when it spawns a new tab (target=_blank
 * links, window.open): retarget the bridge, connect the agent there, tell the UI.
 * Returns an unsubscribe function.
 */
export function followNewTabs(
  bridge: ChromeBridge,
  onFollow: (tab: ActiveTab) => void,
): () => void {
  const created = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId !== bridge.tabId || tab.id === undefined) return;
    const newTabId = tab.id;
    const settle = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      updated: chrome.tabs.Tab,
    ) => {
      if (
        tabId !== newTabId ||
        changeInfo.status !== 'complete' ||
        !isOperable(updated.url)
      )
        return;
      chrome.tabs.onUpdated.removeListener(settle);
      bridge.retarget(newTabId);
      void connectAgent(newTabId, bridge).then((ok) => {
        if (ok)
          onFollow({
            tabId: newTabId,
            windowId: updated.windowId,
            url: updated.url ?? '',
            title: updated.title ?? '',
          });
      });
    };
    chrome.tabs.onUpdated.addListener(settle);
  };
  chrome.tabs.onCreated.addListener(created);
  return () => chrome.tabs.onCreated.removeListener(created);
}

export function createActiveTabBridge(
  tabId: number,
  channel: 'dom' | 'cdp',
): ChromeBridge {
  return new ChromeBridge(tabId, channel);
}
