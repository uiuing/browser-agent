import type { Page } from 'playwright';
import type { Bridge, BridgeMethod, BridgeParamMap, BridgeResultMap } from '../../extension/src/engine/contracts/bridge';

/**
 * PlaywrightBridge — drives the injected page agent (window.__browserAgent) via
 * page.evaluate. This is the bench/e2e transport; the orchestrator can't tell it apart
 * from the extension's ChromeBridge.
 */
export class PlaywrightBridge implements Bridge {
  constructor(private page: Page) {}

  async call<M extends BridgeMethod>(method: M, params?: BridgeParamMap[M]): Promise<BridgeResultMap[M]> {
    return this.page.evaluate(
      async ({ method, params }) => {
        const agent = (window as unknown as { __browserAgent?: { handle: (r: unknown) => Promise<unknown> } }).__browserAgent;
        if (!agent) throw new Error('page agent not injected');
        const request = params === undefined ? { method } : { method, params };
        return agent.handle(request);
      },
      { method, params } as { method: string; params: unknown },
    ) as Promise<BridgeResultMap[M]>;
  }
}
