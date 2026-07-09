import { z } from 'zod';
import { providerConfigSchema } from '../llm/contracts';
import { toolPolicySchema } from '../kernel/contracts/tool';

export const localeSchema = z.enum(['zh-CN', 'en-US']);
export type Locale = z.infer<typeof localeSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const channelPrefSchema = z.enum(['dom', 'cdp']);

/** Remote MCP server (Streamable HTTP). Mounted tools are namespaced mcp.<label>.<tool>. */
export const mcpServerConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
});
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/**
 * Settings — guardrails govern EVERY tool call (not just page actions):
 * risk-tier confirmation, site policies, and per-tool authorization memory.
 */
export const settingsSchema = z.object({
  locale: localeSchema,
  theme: themeSchema,
  channel: channelPrefSchema,
  onboarded: z.boolean(),
  guardrails: z.object({
    confirmDangerous: z.boolean(),
    allowlist: z.array(z.string()),
    blocklist: z.array(z.string()),
    redactSensitive: z.boolean(),
    /** Per-tool authorization memory: ask (default) / always_allow / block. */
    toolPolicies: z.record(z.string(), toolPolicySchema),
  }),
  mcpServers: z.array(mcpServerConfigSchema),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  locale: 'zh-CN',
  theme: 'system',
  channel: 'dom',
  onboarded: false,
  guardrails: {
    confirmDangerous: true,
    allowlist: [],
    blocklist: [],
    redactSensitive: true,
    toolPolicies: {},
  },
  mcpServers: [],
};

export const providerStateSchema = z.object({
  providers: z.array(providerConfigSchema),
  defaultProviderId: z.string().nullable(),
});
export type ProviderState = z.infer<typeof providerStateSchema>;

export const auditEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.string(),
  detail: z.string(),
  /** Tool id when the event is a tool call (every tool is audited, not just page actions). */
  toolId: z.string().optional(),
  url: z.string().optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Session list entry — full transcripts live under their own storage key. */
export const sessionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int(),
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;
