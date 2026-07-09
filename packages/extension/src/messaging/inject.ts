/**
 * On-demand content-script injection. Tabs opened before the extension was
 * installed/reloaded (or freshly navigated) may not have the page agent yet;
 * the script itself guards against double execution.
 */
export async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    return true;
  } catch {
    return false; // restricted page (chrome://, Web Store, …) or tab gone
  }
}
