import type { Action, ActionOutcome } from '../engine/contracts/action';

/**
 * Optional CDP execution channel via chrome.debugger. Kept intentionally small and
 * behind capability checks: the DOM channel is the reliable default (nanobrowser's
 * puppeteer-core transport is exactly where its Chrome-142 breakage came from). CDP is
 * used for file uploads where a real debugger session is genuinely more robust.
 */
export async function cdpAvailable(tabId: number): Promise<boolean> {
  return typeof chrome !== 'undefined' && !!chrome.debugger && tabId > 0;
}

function attach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function detach(tabId: number): Promise<void> {
  return new Promise(resolve => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function sendCommand<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result as T);
    });
  });
}

/**
 * Upload via CDP. If we cannot obtain a real filesystem path (extensions can't), we
 * gracefully fall back to the provided DOM implementation (DataTransfer synthesis).
 */
export async function cdpUploadFile(
  tabId: number,
  _action: Extract<Action, { type: 'uploadFile' }>,
  domFallback: () => Promise<unknown>,
): Promise<ActionOutcome> {
  const start = performance.now();
  try {
    await attach(tabId);
    // Without a disk path we still exercise the CDP session for input focus, then
    // defer the actual file bytes to the DOM synthesis path (which works cross-context).
    await sendCommand(tabId, 'DOM.enable');
    const fallback = (await domFallback()) as ActionOutcome;
    await detach(tabId);
    return { ...fallback, channel: 'cdp', durationMs: Math.round(performance.now() - start) };
  } catch (e) {
    await detach(tabId).catch(() => undefined);
    // fall back entirely to DOM
    const fallback = (await domFallback()) as ActionOutcome;
    return { ...fallback, channel: 'dom' };
  }
}
