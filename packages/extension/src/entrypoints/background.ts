export default defineBackground(() => {
  // First install: open onboarding (language → connect model → how to use).
  chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') }).catch(() => undefined);
    }
  });

  // Toolbar click opens the side panel (the orchestration host).
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  }

  // Lightweight glue only — no state lives here (avoids MV3 SW-sleep bugs that plague
  // background-hosted orchestration).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'browser-agent:getActiveTab') {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => {
        const tab = tabs[0];
        sendResponse({ tabId: tab?.id ?? null, url: tab?.url ?? '', title: tab?.title ?? '' });
      });
      return true;
    }
    if (msg?.type === 'browser-agent:openPage') {
      chrome.tabs.create({ url: chrome.runtime.getURL(msg.path) }).catch(() => undefined);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
});
