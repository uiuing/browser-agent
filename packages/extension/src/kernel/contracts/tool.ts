import { z } from 'zod';
import type { ToolResult } from './session';
import type { ToolSpec } from '../../llm/contracts';

export type { ToolSpec };

/**
 * Tool contract — the harness's first extension point.
 *
 * One tool = one definition object: identity, a Zod params schema (the registry
 * derives each provider's JSON-Schema tool spec from it), a risk tier that the
 * guardrails act on, the chrome permissions it needs (requested on first use),
 * and a handler. Community tools implement exactly this shape.
 */

/**
 * read      — observes only (page summaries, tab lists, history). Never confirmed.
 * act       — changes state (page actions, opening tabs, downloads). Subject to
 *             site policies and per-tool authorization memory.
 * dangerous — irreversible or high-blast-radius (closing tabs, batch runs).
 *             Always confirmed unless the user granted always-allow.
 */
export const riskTierSchema = z.enum(['read', 'act', 'dangerous']);
export type RiskTier = z.infer<typeof riskTierSchema>;

/** Per-tool authorization memory (kept in settings, editable in Options). */
export const toolPolicySchema = z.enum(['ask', 'always_allow', 'block']);
export type ToolPolicy = z.infer<typeof toolPolicySchema>;

export interface ToolEvent {
  /** Progress line for the UI card (localized upstream). */
  note?: string;
  /** Live RunRecord updates while page.act is running. */
  run?: unknown;
}

/** Everything a handler may touch. Handlers never reach for globals. */
export interface ToolExecutionContext {
  /** Tab the conversation is currently anchored to (null when none suitable). */
  tabId: number | null;
  signal: AbortSignal;
  /** Streams progress to the tool call card in the chat. */
  emit: (event: ToolEvent) => void;
  /**
   * Asks the user to approve this call (guardrails decide *whether* to ask;
   * the kernel wires it to the confirm dialog). Resolves false on deny/stop.
   */
  confirm: (reason: string) => Promise<boolean>;
  /**
   * Requests optional chrome permissions through a UI interaction (permission
   * prompts need a user gesture, so the host routes this via a dialog).
   */
  requestPermissions: (permissions: string[]) => Promise<boolean>;
  /** Chat provenance stamped onto artifacts the tool persists (RunRecords). */
  provenance?: { sessionId?: string; toolCallId?: string };
}

export interface ToolDefinition<P = unknown> {
  /** Namespaced id the model calls, e.g. "page_act", "tabs_list", "mcp_github_search". */
  id: string;
  /** i18n key for the UI card title. */
  titleKey: string;
  /** Model-facing description — English, specific, says when NOT to use it. */
  description: string;
  paramsSchema: z.ZodType<P>;
  /**
   * Pre-built JSON Schema for the model-facing spec. Only for tools whose real
   * schema lives elsewhere (MCP servers); local tools derive it from Zod.
   */
  jsonSchemaOverride?: Record<string, unknown>;
  riskTier: RiskTier;
  /** Optional chrome permissions requested on first use (e.g. ["history"]). */
  requiredPermissions?: string[];
  execute: (params: P, ctx: ToolExecutionContext) => Promise<ToolResult>;
}

/**
 * Existentially-typed tool for registry storage — params are validated by the
 * tool's own schema before execute runs, so erasing P here is safe.
 */
export type AnyTool = ToolDefinition<unknown>;

