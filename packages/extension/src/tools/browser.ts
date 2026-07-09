import { z } from 'zod';
import type { AnyTool, ToolDefinition } from '../kernel/contracts/tool';

/**
 * Browser-data pack. These use optional_permissions: the registry requests the
 * permission on first use (user gesture via dialog) — install stays lean and
 * community tools inherit the same pattern.
 */

export function createBrowserTools(): AnyTool[] {
  const historySearch: ToolDefinition<{ query: string; maxResults?: number; daysBack?: number }> = {
    id: 'history_search',
    titleKey: 'tools.history_search',
    description: 'Search the browser history by text. Use when the user asks about previously visited pages ("那个昨天看的文档").',
    paramsSchema: z.object({
      query: z.string().describe('Text to match in title/URL'),
      maxResults: z.number().int().min(1).max(50).optional(),
      daysBack: z.number().int().min(1).max(365).optional().describe('Look-back window, default 30 days'),
    }),
    riskTier: 'read',
    requiredPermissions: ['history'],
    async execute(params) {
      const items = await chrome.history.search({
        text: params.query,
        maxResults: params.maxResults ?? 15,
        startTime: Date.now() - (params.daysBack ?? 30) * 86400000,
      });
      if (!items.length) return { ok: true, summary: `No history matches for "${params.query}".` };
      const lines = items.map(i => `- ${(i.title ?? '(untitled)').slice(0, 70)} — ${i.url} (visits: ${i.visitCount ?? 0})`);
      return { ok: true, summary: lines.join('\n') };
    },
  };

  const bookmarksSearch: ToolDefinition<{ query: string }> = {
    id: 'bookmarks_search',
    titleKey: 'tools.bookmarks_search',
    description: 'Search bookmarks by text.',
    paramsSchema: z.object({ query: z.string() }),
    riskTier: 'read',
    requiredPermissions: ['bookmarks'],
    async execute(params) {
      const items = await chrome.bookmarks.search(params.query);
      const withUrl = items.filter(i => i.url).slice(0, 20);
      if (!withUrl.length) return { ok: true, summary: `No bookmarks match "${params.query}".` };
      return { ok: true, summary: withUrl.map(i => `- ${i.title} — ${i.url}`).join('\n') };
    },
  };

  const bookmarksAdd: ToolDefinition<{ url?: string; title?: string }> = {
    id: 'bookmarks_add',
    titleKey: 'tools.bookmarks_add',
    description: 'Bookmark a URL (defaults to the current tab).',
    paramsSchema: z.object({
      url: z.string().optional().describe('Defaults to the current tab URL'),
      title: z.string().optional(),
    }),
    riskTier: 'act',
    requiredPermissions: ['bookmarks'],
    async execute(params, ctx) {
      let url = params.url;
      let title = params.title;
      if (!url && ctx.tabId !== null) {
        const tab = await chrome.tabs.get(ctx.tabId);
        url = tab.url;
        title = title ?? tab.title;
      }
      if (!url) return { ok: false, summary: 'No URL to bookmark.', error: 'no_url' };
      const node = await chrome.bookmarks.create({ url, title: title ?? url });
      return { ok: true, summary: `Bookmarked: ${node.title} — ${node.url}` };
    },
  };

  const downloadsList: ToolDefinition<{ limit?: number }> = {
    id: 'downloads_list',
    titleKey: 'tools.downloads_list',
    description: 'List recent downloads with state and file path.',
    paramsSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    riskTier: 'read',
    requiredPermissions: ['downloads'],
    async execute(params) {
      const items = await chrome.downloads.search({ limit: params.limit ?? 10, orderBy: ['-startTime'] });
      if (!items.length) return { ok: true, summary: 'No downloads.' };
      const lines = items.map(d => `- ${d.filename.split(/[\\/]/).pop()} — ${d.state}${d.state === 'complete' ? '' : ` (${Math.round((d.bytesReceived / (d.totalBytes || 1)) * 100)}%)`}`);
      return { ok: true, summary: lines.join('\n') };
    },
  };

  const downloadsSave: ToolDefinition<{ url: string; filename?: string }> = {
    id: 'downloads_save',
    titleKey: 'tools.downloads_save',
    description: 'Download a file from a URL to the user\'s download folder.',
    paramsSchema: z.object({
      url: z.string(),
      filename: z.string().optional().describe('Suggested file name'),
    }),
    riskTier: 'act',
    requiredPermissions: ['downloads'],
    async execute(params) {
      const id = await chrome.downloads.download({ url: params.url, filename: params.filename });
      return { ok: true, summary: `Download started (id ${id}): ${params.url}` };
    },
  };

  return [historySearch, bookmarksSearch, bookmarksAdd, downloadsList, downloadsSave] as unknown as AnyTool[];
}
