import { z } from 'zod';
import { pageSnapshotSchema, readyReportSchema } from './perception';
import { semanticFingerprintSchema, groundingResultSchema } from './grounding';
import { actionSchema, actionOutcomeSchema, channelSchema } from './action';
import { postConditionSchema, verificationResultSchema, baselineSchema } from './verification';

/**
 * Marker for a transport failure DURING an execute call: the action was delivered and
 * may well have run, but the reply channel died (typically because the action itself
 * navigated the page — a form submit unloading the document). Transports must NOT
 * retry these; orchestrators settle the truth via post-condition verification.
 */
export const CHANNEL_LOST_DURING_EXECUTE = 'CHANNEL_LOST_DURING_EXECUTE';

/**
 * ExecutorBridge — the typed port protocol between the orchestrator (side panel / node)
 * and the page agent (content script / injected IIFE).
 * The same page agent implementation answers all of these regardless of environment.
 */
export const bridgeRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('hello') }),
  z.object({
    method: z.literal('snapshot'),
    params: z.object({ maxNodes: z.number().optional(), interactiveOnly: z.boolean().optional() }).optional(),
  }),
  z.object({ method: z.literal('resolve'), params: z.object({ fingerprint: semanticFingerprintSchema }) }),
  z.object({
    method: z.literal('execute'),
    params: z.object({ action: actionSchema, channel: channelSchema.optional() }),
  }),
  z.object({
    method: z.literal('verify'),
    params: z.object({ conditions: z.array(postConditionSchema), baseline: baselineSchema.optional() }),
  }),
  z.object({ method: z.literal('baseline'), params: z.object({ conditions: z.array(postConditionSchema) }) }),
  z.object({
    method: z.literal('waitReady'),
    params: z.object({ timeoutMs: z.number().optional(), quietMs: z.number().optional() }).optional(),
  }),
  z.object({ method: z.literal('probeScroll'), params: z.object({ maxRounds: z.number().optional() }).optional() }),
  z.object({ method: z.literal('highlight'), params: z.object({ nodeId: z.number(), label: z.string().optional() }) }),
  z.object({ method: z.literal('clearHighlight') }),
  z.object({
    method: z.literal('extract'),
    params: z.object({ fingerprint: semanticFingerprintSchema.optional(), attr: z.string().optional() }).optional(),
  }),
]);
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeMethod = BridgeRequest['method'];

export const helloResultSchema = z.object({ ok: z.boolean(), framePath: z.string(), url: z.string() });
export const probeScrollResultSchema = z.object({ grew: z.boolean(), rounds: z.number() });
export const extractResultSchema = z.object({ value: z.string() });
export const okResultSchema = z.object({ ok: z.boolean() });

export interface BridgeResultMap {
  hello: z.infer<typeof helloResultSchema>;
  snapshot: z.infer<typeof pageSnapshotSchema>;
  resolve: z.infer<typeof groundingResultSchema>;
  execute: z.infer<typeof actionOutcomeSchema>;
  verify: z.infer<typeof verificationResultSchema>[];
  baseline: z.infer<typeof baselineSchema>;
  waitReady: z.infer<typeof readyReportSchema>;
  probeScroll: z.infer<typeof probeScrollResultSchema>;
  highlight: z.infer<typeof okResultSchema>;
  clearHighlight: z.infer<typeof okResultSchema>;
  extract: z.infer<typeof extractResultSchema>;
}

/** Explicit param map keeps call() inference clean across optional-param methods. */
export interface BridgeParamMap {
  hello: undefined;
  snapshot: { maxNodes?: number; interactiveOnly?: boolean } | undefined;
  resolve: { fingerprint: z.infer<typeof semanticFingerprintSchema> };
  execute: { action: z.infer<typeof actionSchema>; channel?: z.infer<typeof channelSchema> };
  verify: { conditions: z.infer<typeof postConditionSchema>[]; baseline?: z.infer<typeof baselineSchema> };
  baseline: { conditions: z.infer<typeof postConditionSchema>[] };
  waitReady: { timeoutMs?: number; quietMs?: number } | undefined;
  probeScroll: { maxRounds?: number } | undefined;
  highlight: { nodeId: number; label?: string };
  clearHighlight: undefined;
  extract: { fingerprint?: z.infer<typeof semanticFingerprintSchema>; attr?: string } | undefined;
}

/**
 * Environment-agnostic transport. Extension provides a chrome.runtime port impl;
 * bench/e2e provides a Playwright page.evaluate impl. Orchestrator only sees this.
 */
export interface Bridge {
  call<M extends BridgeMethod>(method: M, params?: BridgeParamMap[M]): Promise<BridgeResultMap[M]>;
}
