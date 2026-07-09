import { z } from 'zod';
import type { AnyTool } from '../../kernel/contracts/tool';
import type { McpServerConfig } from '../../storage/types';
import type { ToolRegistry } from '../registry';
import { McpClient } from './client';

/**
 * Mount remote MCP tools into the registry under a namespace:
 *   mcp_<label>_<tool>. Remote tools default to the `act` risk tier — the
 * harness cannot know a remote tool's blast radius, so they ride the same
 * guardrails as local state-changing tools (and users can block/allow each
 * one individually in settings).
 */

const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function namespaceFor(server: McpServerConfig): string {
  return `mcp_${sanitize(server.label) || server.id}`;
}

export async function mountMcpServer(registry: ToolRegistry, server: McpServerConfig): Promise<number> {
  const client = new McpClient(server.url, server.headers ?? {});
  const tools = await client.listTools();
  const ns = namespaceFor(server);
  registry.unregisterNamespace(`${ns}_`);
  for (const tool of tools) {
    const def: AnyTool = {
      id: `${ns}_${sanitize(tool.name)}`,
      titleKey: 'tools.mcp_generic',
      description: `[MCP · ${server.label}] ${tool.description ?? tool.name}`,
      // The remote server owns validation; accept any object and pass it through,
      // but advertise the server's own input schema to the model.
      paramsSchema: z.record(z.string(), z.unknown()) as z.ZodType<unknown>,
      jsonSchemaOverride: tool.inputSchema ?? { type: 'object', properties: {} },
      riskTier: 'act',
      async execute(params) {
        const { ok, text } = await client.callTool(tool.name, params);
        return { ok, summary: text.slice(0, 4000), error: ok ? undefined : 'mcp_tool_error' };
      },
    };
    registry.register(def);
  }
  return tools.length;
}

export function unmountMcpServer(registry: ToolRegistry, server: McpServerConfig): void {
  registry.unregisterNamespace(`${namespaceFor(server)}_`);
}

/** Connectivity probe for the Options page. */
export async function testMcpServer(server: McpServerConfig): Promise<{ ok: boolean; tools: number; error?: string }> {
  try {
    const client = new McpClient(server.url, server.headers ?? {});
    const tools = await client.listTools();
    return { ok: true, tools: tools.length };
  } catch (e) {
    return { ok: false, tools: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
