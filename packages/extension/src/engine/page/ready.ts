import type { ReadyReport } from '../contracts/perception';
import { sleep } from './dom-utils';

/**
 * Ready-signal tracker. Replaces nanobrowser's fixed `sleep(1000)` after each action
 * with real readiness: document readyState + in-flight fetch/XHR count + a DOM mutation
 * quiet window. Installed once per page context.
 */
let pending = 0;
let installed = false;
let lastMutation = Date.now();

export function installReadyTracker(): void {
  if (installed) return;
  installed = true;

  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function patchedFetch(...args: Parameters<typeof fetch>) {
        pending++;
        return origFetch.apply(this, args).finally(() => {
          pending = Math.max(0, pending - 1);
        });
      };
    }
  } catch {
    /* ignore */
  }

  try {
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      OrigXHR.prototype.open = function (...args: unknown[]) {
        // @ts-expect-error passthrough
        return origOpen.apply(this, args);
      };
      OrigXHR.prototype.send = function (...args: unknown[]) {
        pending++;
        this.addEventListener('loadend', () => {
          pending = Math.max(0, pending - 1);
        });
        // @ts-expect-error passthrough
        return origSend.apply(this, args);
      };
    }
  } catch {
    /* ignore */
  }

  try {
    const mo = new MutationObserver(() => {
      lastMutation = Date.now();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
    /* ignore */
  }
}

export async function waitReady(opts?: { timeoutMs?: number; quietMs?: number }): Promise<ReadyReport> {
  installReadyTracker();
  const timeoutMs = opts?.timeoutMs ?? 6000;
  const quietMs = opts?.quietMs ?? 300;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const domReady = document.readyState === 'complete' || document.readyState === 'interactive';
    const quiet = Date.now() - lastMutation >= quietMs;
    const noRequests = pending <= 0;
    if (domReady && quiet && noRequests) {
      return {
        readyState: document.readyState,
        pendingRequests: pending,
        quietMs: Date.now() - lastMutation,
        waitedMs: Date.now() - start,
        timedOut: false,
      };
    }
    await sleep(50);
  }
  return {
    readyState: document.readyState,
    pendingRequests: pending,
    quietMs: Date.now() - lastMutation,
    waitedMs: Date.now() - start,
    timedOut: true,
  };
}

export function getPendingRequests(): number {
  return pending;
}
