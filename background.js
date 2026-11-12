/* FB Page Scraper — service worker: opens the dashboard and runs scrape jobs. */
importScripts('content/fb.js');

const FBS = globalThis.FBScraper;
const DASHBOARD = chrome.runtime.getURL('dashboard.html');
const SEARCH_URL = (q) => `https://www.facebook.com/search/pages/?q=${encodeURIComponent(q)}`;

const BLOCK_MESSAGES = {
  login: 'Facebook is asking you to log in. Log in to facebook.com in this browser, then press Start again.',
  checkpoint:
    'Facebook is showing a security check. Complete it yourself in the scraper window, then press Start again with a longer delay.',
  rate_limited:
    'Facebook says this feature is being used too fast and has limited it. Stopped. Wait several hours and use a longer delay before trying again.',
};

let running = false;
let stopRequested = false;
let stopReason = '';
let workerWindowId = null;
let keepWorkerOpen = false;
let heartbeat = null;
let job = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fresh service worker means any previous run's loop is gone.
const ready = (async () => {
  const { job: old } = await chrome.storage.local.get('job');
  if (old && old.running) {
    old.running = false;
    old.phase = 'stopped';
    old.message = 'Interrupted (browser or extension restarted). Press Start to continue; saved pages are skipped.';
    await chrome.storage.local.set({ job: old });
  }
})();

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return;
  if (msg.cmd === 'start') {
    ready
      .then(() => startJob(msg))
      .then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.cmd === 'stop') {
    requestStop('Stopped by you.');
    sendResponse({ ok: true });
  }
});

chrome.windows.onRemoved.addListener((id) => {
  if (id !== workerWindowId) return;
  workerWindowId = null;
  if (running) requestStop('Stopped: the scraper window was closed.');
});

// --------------------------------------------------------------- helpers

function requestStop(reason) {
  if (!running) return;
  stopRequested = true;
  stopReason = stopReason || reason;
  closeWorker(); // makes any in-flight navigation fail fast
}

function sanitize(s = {}) {
  const num = (v, d, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  return {
    limit: num(s.limit, 50, 1, 1000),
    delay: num(s.delay, 6, 3, 120),
    skipExisting: s.skipExisting !== false,
    thorough: !!s.thorough,
  };
}

async function saveJob() {
  await chrome.storage.local.set({ job });
}

function log(msg, level = 'info') {
  job.log.push({ t: Date.now(), msg, level });
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}

async function interruptibleSleep(ms) {
  const end = Date.now() + ms;
  while (!stopRequested && Date.now() < end) await sleep(Math.min(250, end - Date.now()));
}

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

async function scrapeOne(tabId, url, s) {
  const canon = FBS.normalizePageUrl(url);
  if (!canon) return { error: 'not a Facebook page URL' };

  let merged = null;
  const a = await visitAndExtract(tabId, FBS.aboutUrl(canon));
  if (a.blocked) return { blocked: a.blocked };
  if (a.isPersonal) return { skipped: 'personal profile, not a business page' };
  if (a.data) merged = a.data;

  // Home tab: always in thorough mode, otherwise only when the About tab gave nothing useful.
  if (s.thorough || !FBS.hasContact(merged)) {
    if (stopRequested) return { stopped: true };
    await interruptibleSleep(1500);
    const b = await visitAndExtract(tabId, canon);
    if (b.blocked) return { blocked: b.blocked };
    if (b.isPersonal) return { skipped: 'personal profile, not a business page' };
    if (b.data) merged = FBS.mergeParsed(merged, b.data);
  }

  if (!merged) return { error: 'page not found or not available' };
  return { record: FBS.toRecord(canon, merged) };
}

function upsertRecord(records, rec) {
  const i = records.findIndex((r) => r.key === rec.key);
  if (i < 0) return records.push(rec);
  const old = records[i];
  const merged = { ...old };
  for (const [k, v] of Object.entries(rec)) if (v) merged[k] = v;
  records[i] = merged;
}

function parseUrlList(urls) {
  const seen = new Set();
  const out = [];
  let invalid = 0;
  for (const raw of urls || []) {
    const u = FBS.normalizePageUrl(raw);
    if (!u) { invalid++; continue; }
    const k = u.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(u); }
  }
  return { urls: out, invalid };
}

// ------------------------------------------------------------------ job

async function startJob(p) {
  if (running) return { ok: false, error: 'A job is already running.' };
  if (p.mode === 'keyword' && !String(p.keyword || '').trim()) return { ok: false, error: 'Enter a keyword.' };
  if (p.mode !== 'keyword' && !(p.urls && p.urls.length)) return { ok: false, error: 'Paste at least one page URL.' };

  running = true;
  stopRequested = false;
  stopReason = '';
  keepWorkerOpen = false;
  const settings = sanitize(p.settings);
  job = {
    running: true, phase: 'starting', message: 'Starting…', mode: p.mode,
    total: 0, done: 0, saved: 0, skipped: 0, failed: 0, current: '', startedAt: Date.now(), log: [],
  };
  await saveJob();

  // Calling an extension API regularly keeps the service worker alive during long jobs.
  heartbeat = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);

  runJob(p, settings)
    .catch((err) => {
      if (stopRequested) return;
      job.phase = 'error';
      job.message = `Error: ${err.message}`;
      log(job.message, 'error');
    })
    .finally(async () => {
      if (stopRequested && job.phase !== 'blocked') {
        job.phase = 'stopped';
        job.message = stopReason || 'Stopped.';
        log(job.message, 'warn');
      }
      clearInterval(heartbeat);
      if (!keepWorkerOpen) closeWorker();
      running = false;
      job.running = false;
      job.current = '';
      await saveJob();
    });

  return { ok: true };
}

async function runJob(p, s) {
  const { records = [] } = await chrome.storage.local.get('records');
  const existing = new Set(records.map((r) => r.key));
  const tabId = await openWorker(p.screen);

  let targets = [];
  if (p.mode === 'keyword') {
    const q = p.keyword.trim();
    job.phase = 'searching';
    job.message = `Searching Facebook pages for "${q}"…`;
    log(job.message);
    await saveJob();
    await navigate(tabId, SEARCH_URL(q));
    const res = await runInTab(
      tabId,
      (limit, skip) => globalThis.FBScraper.collectSearchResults(limit, skip),
      [s.limit, s.skipExisting ? [...existing] : []]
    );
    if (!res) throw new Error('Could not read the search results page.');
    if (res.blocked) return stopForBlock(res.blocked);
    targets = res.urls.map((x) => x.url);
    log(`Found ${targets.length} page(s) in search results.`);
  } else {
    const { urls, invalid } = parseUrlList(p.urls);
    if (invalid) log(`Ignored ${invalid} line(s) that are not Facebook page URLs.`, 'warn');
    targets = urls;
    if (s.skipExisting) {
      const before = targets.length;
      targets = targets.filter((u) => !existing.has(u.toLowerCase()));
      if (before - targets.length) log(`Skipped ${before - targets.length} page(s) already in the Data Report.`);
    }
    targets = targets.slice(0, s.limit);
  }

  if (!targets.length) {
    job.phase = 'done';
    job.message = 'No new pages to scrape.';
    log(job.message);
    return;
  }

  job.total = targets.length;
  job.phase = 'scraping';
  for (let i = 0; i < targets.length; i++) {
    if (stopRequested) return;
    const url = targets[i];
    job.current = url;
    job.message = `Scraping ${i + 1} of ${targets.length}…`;
    await saveJob();

    let result;
    try {
      result = await scrapeOne(tabId, url, s);
    } catch (e) {
      if (stopRequested) return;
      result = { error: e.message };
    }

    if (result.stopped) return;
    if (result.blocked) return stopForBlock(result.blocked);
    if (result.skipped) {
      job.skipped++;
      log(`Skipped ${url} (${result.skipped})`);
    } else if (result.error) {
      job.failed++;
      log(`Failed ${url}: ${result.error}`, 'error');
    } else {
      upsertRecord(records, result.record);
      await chrome.storage.local.set({ records });
      job.saved++;
      log(`Saved: ${result.record.name || url}`);
    }
    job.done = i + 1;
    await saveJob();

    if (i < targets.length - 1) await interruptibleSleep(s.delay * 1000);
  }

  job.phase = 'done';
  job.message = `Done. Saved ${job.saved}, skipped ${job.skipped}, failed ${job.failed}.`;
  log(job.message);
}

function stopForBlock(kind) {
  job.phase = 'blocked';
  job.message = BLOCK_MESSAGES[kind] || 'Facebook blocked the request. Stopped.';
  log(job.message, 'error');
  keepWorkerOpen = true; // leave the window so you can see / resolve it
}
