import type { Bridge, BridgeMethod, BridgeParamMap, BridgeRequest, BridgeResultMap } from '../engine/contracts/bridge';
import { CHANNEL_LOST_DURING_EXECUTE } from '../engine/contracts/bridge';
import { PAGE_AGENT_MESSAGE, type PageAgentResponse } from './protocol';
import { cdpUploadFile, cdpAvailable } from './cdp-channel';
import { injectContentScript } from './inject';

/** The message never reached a listener — safe to reinject and retry, even for actions. */
const DELIVERY_FAILED = /receiving end does not exist|could not establish connection/i;
/** The listener got the message but the channel died mid-flight (typically the page
 *  navigated away while processing). The action may well have run — NOT safe to retry. */
const MIDFLIGHT_LOST = /message channel closed|message port closed/i;

/**
 * ChromeBridge — the extension-side transport for the ExecutorBridge protocol.
 * Talks to the content-script page agent via chrome.tabs.sendMessage. When the
 * 'cdp' channel is selected it routes file uploads (and could route stable input)
 * through chrome.debugger, demonstrating the pluggable execution channel.
 *
 * Resilient by design: a step that navigates the page (or a tab the agent just
 * followed to) briefly has no content script — sends auto-reinject and retry.
 * `retarget()` lets a run follow the work into a new tab.
 */
export class ChromeBridge implements Bridge {
  constructor(
    private _tabId: number,
    private channel: 'dom' | 'cdp' = 'dom',
  ) {}

  get tabId(): number {
    return this._tabId;
  }

  /** Point this bridge at another tab (e.g. the page opened a new tab mid-run). */
  retarget(tabId: number): void {
    this._tabId = tabId;
  }

  private async sendOnce(request: BridgeRequest): Promise<unknown> {
    const res = (await chrome.tabs.sendMessage(this._tabId, {
      channel: PAGE_AGENT_MESSAGE,
      request,
    })) as PageAgentResponse | undefined;
    if (!res) throw new Error('No response from page agent (content script not injected?)');
    if (!res.ok) throw new Error(res.error ?? 'page agent error');
    return res.result;
  }

  private async send(request: BridgeRequest): Promise<unknown> {
    let lastError: unknown;
    // 6 backed-off attempts ≈ 5s of navigation grace: a slow POST navigation
    // (submit → server render) must not strand a verify between documents.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.sendOnce(request);
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (MIDFLIGHT_LOST.test(msg)) {
          if (request.method === 'execute') {
            // A submit/click that unloads the page kills the channel AFTER the action
            // fired. Re-executing could double-submit — surface it so the orchestrator
            // settles the truth via post-condition verification on the new document.
            throw new Error(`${CHANNEL_LOST_DURING_EXECUTE}: ${msg}`);
          }
          // Idempotent reads: fall through to reinject + retry.
        } else if (!DELIVERY_FAILED.test(msg)) {
          throw e;
        }
        // Page navigated / tab freshly opened: give the document a beat, then
        // (re)inject the agent and retry.
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        await injectContentScript(this._tabId);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async call<M extends BridgeMethod>(method: M, params?: BridgeParamMap[M]): Promise<BridgeResultMap[M]> {
    const request = { method, ...(params ? { params } : {}) } as BridgeRequest;

    // CDP channel: intercept file uploads (setFileInputFiles needs a debugger session).
    if (
      this.channel === 'cdp' &&
      request.method === 'execute' &&
      request.params.action.type === 'uploadFile' &&
      (await cdpAvailable(this._tabId))
    ) {
      const outcome = await cdpUploadFile(this._tabId, request.params.action, () => this.send(request));
      return outcome as BridgeResultMap[M];
    }

    return (await this.send(request)) as BridgeResultMap[M];
  }
}
