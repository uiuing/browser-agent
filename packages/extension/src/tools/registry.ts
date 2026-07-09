import { z } from 'zod';
import type { AnyTool, ToolDefinition, ToolExecutionContext, ToolSpec } from '../kernel/contracts/tool';
import type { ToolResult } from '../kernel/contracts/session';
import { checkToolCall } from '../guardrails/tool-gate';
import type { Settings } from '../storage/types';
import { auditRepo } from '../storage/repos';

/**
 * Tool registry — the community's first extension point. Registering a
 * ToolDefinition is all it takes to give the harness a capability: the
 * registry derives the model-facing spec from the Zod schema, and every
 * execution passes the guardrails gate (policy memory, risk tier, site
 * lists), on-demand chrome permission requests, and the audit log.
 */
export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register<P>(tool: ToolDefinition<P>): void {
    this.tools.set(tool.id, tool as unknown as AnyTool);
  }

  unregister(id: string): void {
    this.tools.delete(id);
  }

  /** Drop all tools under a namespace prefix (used when an MCP server is unmounted). */
  unregisterNamespace(prefix: string): void {
    for (const id of Array.from(this.tools.keys())) {
      if (id.startsWith(prefix)) this.tools.delete(id);
    }
  }

  get(id: string): AnyTool | undefined {
    return this.tools.get(id);
  }

  list(): AnyTool[] {
    return Array.from(this.tools.values());
  }

  specs(): ToolSpec[] {
    return this.list().map(t => ({
      name: t.id,
      description: t.description,
      parameters:
        t.jsonSchemaOverride ?? (z.toJSONSchema(t.paramsSchema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>),
    }));
  }

  /**
   * Validate → gate → (permissions) → execute → audit. Never throws: the model
   * gets an honest failure summary it can react to, matching how it perceives
   * every other page fact.
   */
  async execute(
    toolId: string,
    rawParams: unknown,
    ctx: ToolExecutionContext,
    settings: Settings,
    targetUrl?: string,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) return { ok: false, summary: `Unknown tool "${toolId}". Use only the tools listed.`, error: 'unknown_tool' };

    const parsed = tool.paramsSchema.safeParse(rawParams ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { ok: false, summary: `Invalid parameters for ${toolId}: ${issues}`, error: 'invalid_params' };
    }

    const gate = checkToolCall({
      toolId,
      riskTier: tool.riskTier,
      policy: settings.guardrails.toolPolicies[toolId],
      url: targetUrl,
      allowlist: settings.guardrails.allowlist,
      blocklist: settings.guardrails.blocklist,
      confirmDangerous: settings.guardrails.confirmDangerous,
    });
    if ('allowed' in gate && !gate.allowed) {
      await auditRepo.append({ kind: 'tool_blocked', detail: gate.reason, toolId, url: targetUrl });
      return { ok: false, summary: `Blocked by guardrails: ${gate.reason}`, error: 'blocked' };
    }
    if ('needsConfirm' in gate) {
      const approved = await ctx.confirm(gate.reason);
      await auditRepo.append({
        kind: approved ? 'tool_confirmed' : 'tool_denied',
        detail: gate.reason,
        toolId,
        url: targetUrl,
      });
      if (!approved) return { ok: false, summary: 'The user declined this tool call.', error: 'denied' };
    }

    if (tool.requiredPermissions?.length) {
      const granted = await ensurePermissions(tool.requiredPermissions, ctx);
      if (!granted) {
        return {
          ok: false,
          summary: `The user declined the browser permissions (${tool.requiredPermissions.join(', ')}) this tool needs.`,
          error: 'permission_denied',
        };
      }
    }

    try {
      const result = await tool.execute(parsed.data, ctx);
      await auditRepo.append({
        kind: result.ok ? 'tool_succeeded' : 'tool_failed',
        detail: result.summary.slice(0, 200),
        toolId,
        url: targetUrl,
      });
      return result;
    } catch (e) {
      if (ctx.signal.aborted) return { ok: false, summary: 'Cancelled by the user.', error: 'aborted' };
      const message = e instanceof Error ? e.message : String(e);
      await auditRepo.append({ kind: 'tool_failed', detail: message.slice(0, 200), toolId, url: targetUrl });
      return { ok: false, summary: `Tool ${toolId} failed: ${message}`, error: 'execution_failed' };
    }
  }
}

/** Ask chrome for optional permissions, routing the prompt through the UI gesture. */
async function ensurePermissions(permissions: string[], ctx: ToolExecutionContext): Promise<boolean> {
  const has = await chrome.permissions.contains({ permissions: permissions as chrome.runtime.ManifestPermissions[] });
  if (has) return true;
  return ctx.requestPermissions(permissions);
}
