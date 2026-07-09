import { handleBridge, setFramePath } from '@/engine/page/page-agent';
import { installReadyTracker } from '@/engine/page/ready';
import { isEnvelope, type PageAgentResponse } from '@/messaging/protocol';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',
  main() {
    // Only the top frame hosts the agent; same-origin iframes are reached via
    // contentDocument from perception. Cross-origin frames are never entered
    // (deliberately avoiding nanobrowser's extension-origin poisoning failures).
    if (window.top !== window) return;

    // Guard against double execution: the side panel injects this file on demand
    // into tabs that were open before the extension was (re)loaded.
    const w = window as Window & { __browserAgentContentLoaded?: boolean };
    if (w.__browserAgentContentLoaded) return;
    w.__browserAgentContentLoaded = true;

    setFramePath('');
    installReadyTracker();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isEnvelope(msg)) return false;
      handleBridge(msg.request)
        .then(result => sendResponse({ ok: true, result } satisfies PageAgentResponse))
        .catch((e: unknown) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies PageAgentResponse),
        );
      return true; // async response
    });
  },
});
