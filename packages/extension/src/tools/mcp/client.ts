import { z } from 'zod';

/**
 * Minimal MCP client — JSON-RPC 2.0 over Streamable HTTP, just the three
 * calls the harness needs: initialize, tools/list, tools/call. No SDK: the
 * extension environment has no stdio transport, and a hand-rolled client
 * keeps the bundle lean and the wire format auditable.
 */

const PROTOCOL_VERSION = '2025-06-18';

export const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type McpTool = z.infer<typeof mcpToolSchema>;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(
    private url: string,
    private headers: Record<string, string> = {},
  ) {}

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, ...(params !== undefined ? { params } : {}) }),
    });
    if (!res.ok) throw new Error(`MCP server ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;

    const contentType = res.headers.get('Content-Type') ?? '';
    const payload = contentType.includes('text/event-stream')
      ? this.lastSseJson(await res.text())
      : ((await res.json()) as JsonRpcResponse);
    if (!payload) throw new Error('MCP server returned no JSON-RPC response');
    if (payload.error) throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }

  /** Streamable HTTP may answer a POST as a short SSE stream; the response is its last data event. */
  private lastSseJson(body: string): JsonRpcResponse | null {
    let last: JsonRpcResponse | null = null;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        const json = JSON.parse(trimmed.slice(5).trim()) as JsonRpcResponse;
        if (json.id !== undefined || json.result !== undefined || json.error !== undefined) last = json;
      } catch {
        /* keepalive */
      }
    }
    return last;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'browser-agent', version: '0.0.1' },
    });
    // Fire-and-forget per spec; some servers require it before further calls.
    await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => {});
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = (await this.rpc('tools/list')) as { tools?: unknown[] };
    return (result.tools ?? []).flatMap(t => {
      const parsed = mcpToolSchema.safeParse(t);
      return parsed.success ? [parsed.data] : [];
    });
  }

  /** Returns the tool's text content blocks joined; isError maps to ok=false. */
  async callTool(name: string, args: unknown): Promise<{ ok: boolean; text: string }> {
    await this.initialize();
    const result = (await this.rpc('tools/call', { name, arguments: args ?? {} })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text)
      .join('\n');
    return { ok: !result.isError, text: text || '(empty result)' };
  }
}
