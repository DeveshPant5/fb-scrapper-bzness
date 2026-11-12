/* FB Page Scraper — service worker: opens the dashboard and runs scrape jobs. */
importScripts('content/fb.js');

const FBS = globalThis.FBScraper;
const DASHBOARD = chrome.runtime.getURL('dashboard.html');

let running = false;
let stopRequested = false;
let stopReason = '';
let workerWindowId = null;
let keepWorkerOpen = false;
let heartbeat = null;
let job = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// --------------------------------------------------------------- helpers

async function openWorker(scr) {
  const opts = { url: 'about:blank', focused: true, type: 'normal' };
  if (scr && scr.width > 900 && scr.height > 500) {
    const width = Math.round(scr.width / 2);
    Object.assign(opts, { left: scr.left + scr.width - width, top: scr.top, width, height: scr.height });
  }
  const win = await chrome.windows.create(opts);
  workerWindowId = win.id;
  return win.tabs[0].id;
}

function closeWorker() {
  if (workerWindowId == null) return;
  const id = workerWindowId;
  workerWindowId = null;
  chrome.windows.remove(id).catch(() => {});
}

/** Loads a URL in the worker tab and resolves once it has finished loading. */
function navigate(tabId, url, timeout = 25000) {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      err ? reject(err) : resolve();
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      else if (info.status === 'complete' && sawLoading) finish();
    };
    const onRemoved = (id) => id === tabId && finish(new Error('Scraper tab was closed'));
    // Facebook sometimes never reports "complete"; extraction waits for content anyway.
    const timer = setTimeout(() => finish(), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url }).catch(finish);
  });
}

async function runInTab(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/fb.js'] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res ? res.result : undefined;
}

async function visitAndExtract(tabId, url) {
  await navigate(tabId, url);
  const res = await runInTab(tabId, () => globalThis.FBScraper.extractPageData());
  if (!res) throw new Error('Page did not load');
  return res;
}

