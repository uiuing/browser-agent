import { z } from 'zod';
import type { AnyTool, ToolDefinition } from '../kernel/contracts/tool';

/** Tab pack — the basis for cross-page work. All in-manifest permissions. */

const operable = (url?: string) => !!url && /^(https?|file):/.test(url);

export function createTabTools(): AnyTool[] {
  const tabsList: ToolDefinition<Record<string, never>> = {
    id: 'tabs_list',
    titleKey: 'tools.tabs_list',
    description: 'List all open browser tabs (id, title, url, active). Use to find a tab before switching or to see what the user has open.',
    paramsSchema: z.object({}),
    riskTier: 'read',
    async execute() {
      const tabs = await chrome.tabs.query({});
      const lines = tabs
        .filter(t => t.id !== undefined)
        .map(t => `[${t.id}] ${t.active ? '● ' : ''}${(t.title ?? '(untitled)').slice(0, 60)} — ${(t.url ?? '').slice(0, 100)}`);
      return { ok: true, summary: lines.length ? lines.join('\n') : 'No open tabs.' };
    },
  };

  const tabsOpen: ToolDefinition<{ url: string; background?: boolean }> = {
    id: 'tabs_open',
    titleKey: 'tools.tabs_open',
    description: 'Open a URL in a new tab. Use for navigation to a different site; to navigate the CURRENT tab as part of page work, prefer page_act.',
    paramsSchema: z.object({
      url: z.string().describe('Absolute URL, e.g. https://example.com'),
      background: z.boolean().optional().describe('Open without focusing (default false)'),
    }),
    riskTier: 'act',
    async execute(params) {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(params.url) ? params.url : `https://${params.url}`;
      const tab = await chrome.tabs.create({ url, active: !params.background });
      return { ok: true, summary: `Opened tab [${tab.id}] ${url}` };
    },
  };

  const tabsActivate: ToolDefinition<{ tabId: number }> = {
    id: 'tabs_activate',
    titleKey: 'tools.tabs_activate',
    description: 'Switch to an open tab by id (from tabs_list). Subsequent page tools target the active tab.',
    paramsSchema: z.object({ tabId: z.number().int() }),
    riskTier: 'act',
    async execute(params) {
      const tab = await chrome.tabs.update(params.tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, summary: `Switched to tab [${params.tabId}] ${tab?.title ?? ''}` };
    },
  };

  const tabsClose: ToolDefinition<{ tabId?: number }> = {
    id: 'tabs_close',
    titleKey: 'tools.tabs_close',
    description: 'Close a tab by id, or the current tab when omitted. Irreversible — unsaved page state is lost.',
    paramsSchema: z.object({ tabId: z.number().int().optional() }),
    riskTier: 'dangerous',
    async execute(params, ctx) {
      const id = params.tabId ?? ctx.tabId ?? undefined;
      if (id === undefined) return { ok: false, summary: 'No tab to close.', error: 'no_tab' };
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab || !operable(tab.url)) return { ok: false, summary: `Tab [${id}] is not closable.`, error: 'not_operable' };
      await chrome.tabs.remove(id);
      return { ok: true, summary: `Closed tab [${id}] ${tab.title ?? ''}` };
    },
  };

  return [tabsList, tabsOpen, tabsActivate, tabsClose] as unknown as AnyTool[];
}
