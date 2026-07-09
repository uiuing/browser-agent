import type { BridgeRequest, BridgeResultMap } from '../contracts/bridge';
import { buildSnapshot } from './perception';
import { groundFingerprint } from './grounding';
import { executeAction } from './execute';
import { verifyConditions, computeBaseline } from './verify';
import { waitReady, installReadyTracker } from './ready';
import { highlightNode, clearHighlight } from './highlight';
import { sleep } from './dom-utils';

/**
 * The page agent: the single environment-agnostic entry point that answers every
 * ExecutorBridge method. The SAME implementation runs in:
 *  - the extension content script (wrapped by chrome.runtime messaging)
 *  - the injected IIFE used by bench/e2e (window.__browserAgent)
 * That guarantees the engine we benchmark is the engine we ship.
 */

let currentFramePath = '';

export function setFramePath(fp: string): void {
  currentFramePath = fp;
}

async function probeScroll(maxRounds = 4): Promise<{ grew: boolean; rounds: number }> {
  installReadyTracker();
  const startHeight = document.documentElement.scrollHeight;
  const startCount = buildSnapshot({ interactiveOnly: true }).nodes.length;
  let rounds = 0;
  let grew = false;
  const originalScroll = window.scrollY;
  for (let i = 0; i < maxRounds; i++) {
    rounds++;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior });
    await waitReady({ timeoutMs: 2500, quietMs: 250 });
    await sleep(120);
    const h = document.documentElement.scrollHeight;
    const c = buildSnapshot({ interactiveOnly: true }).nodes.length;
    if (h > startHeight + 4 || c > startCount) grew = true;
    if (h <= startHeight + 4 && c <= startCount) break;
  }
  window.scrollTo({ top: originalScroll, behavior: 'instant' as ScrollBehavior });
  return { grew, rounds };
}

export async function handleBridge<M extends BridgeRequest['method']>(request: BridgeRequest): Promise<BridgeResultMap[M]> {
  installReadyTracker();
  switch (request.method) {
    case 'hello':
      return { ok: true, framePath: currentFramePath, url: location.href } as BridgeResultMap[M];
    case 'snapshot':
      return buildSnapshot(request.params) as BridgeResultMap[M];
    case 'resolve':
      return groundFingerprint(request.params.fingerprint, buildSnapshot()) as BridgeResultMap[M];
    case 'execute':
      return (await executeAction(request.params.action)) as BridgeResultMap[M];
    case 'verify':
      return (await verifyConditions(request.params.conditions, request.params.baseline)) as BridgeResultMap[M];
    case 'baseline':
      return computeBaseline(request.params.conditions) as BridgeResultMap[M];
    case 'waitReady':
      return (await waitReady(request.params)) as BridgeResultMap[M];
    case 'probeScroll':
      return (await probeScroll(request.params?.maxRounds)) as BridgeResultMap[M];
    case 'highlight':
      return { ok: highlightNode(request.params.nodeId, request.params.label) } as BridgeResultMap[M];
    case 'clearHighlight':
      return { ok: clearHighlight() } as BridgeResultMap[M];
    case 'extract': {
      const { executeAction: exec } = await import('./execute');
      const out = await exec({
        type: 'extract',
        target: request.params?.fingerprint ? { fingerprint: request.params.fingerprint } : undefined,
        attr: request.params?.attr,
      });
      return { value: out.readback ?? '' } as BridgeResultMap[M];
    }
    default:
      throw new Error(`unknown bridge method`);
  }
}

/** Register on window for injected/IIFE usage (bench/e2e). */
export function installGlobalAgent(framePath = ''): void {
  setFramePath(framePath);
  installReadyTracker();
  (window as unknown as { __browserAgent?: unknown }).__browserAgent = {
    handle: (req: BridgeRequest) => handleBridge(req),
    version: 1,
  };
}
