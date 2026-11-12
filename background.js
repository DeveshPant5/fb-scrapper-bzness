/* FB Page Scraper — service worker: opens the dashboard and runs scrape jobs. */
importScripts('content/fb.js');

const FBS = globalThis.FBScraper;
const DASHBOARD = chrome.runtime.getURL('dashboard.html');

// ------------------------------------------------------------- UI entry

chrome.action.onClicked.addListener(async (tab) => {
  // Clicking the icon while on a Facebook page pre-fills it in the dashboard.
  const pageUrl = tab && tab.url ? FBS.normalizePageUrl(tab.url) : null;
  if (pageUrl) await chrome.storage.local.set({ prefillUrl: pageUrl });

  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [DASHBOARD] });
  if (ctx) {
    await chrome.tabs.update(ctx.tabId, { active: true });
    await chrome.windows.update(ctx.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD });
  }
});

