import type { BridgeRequest } from '../engine/contracts/bridge';

export const PAGE_AGENT_MESSAGE = 'browser-agent:bridge';

export interface PageAgentEnvelope {
  channel: typeof PAGE_AGENT_MESSAGE;
  request: BridgeRequest;
}

export interface PageAgentResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function isEnvelope(msg: unknown): msg is PageAgentEnvelope {
  return !!msg && typeof msg === 'object' && (msg as PageAgentEnvelope).channel === PAGE_AGENT_MESSAGE;
}
