/* FB Page Scraper — dashboard UI. The job itself runs in background.js. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const FBS = globalThis.FBScraper;
  const MAX_ROWS = 500;

  const CSV_COLUMNS = [
    ['name', 'Page Name'], ['category', 'Category'], ['email', 'Email'], ['phone', 'Phone'],
    ['whatsapp', 'WhatsApp'], ['website', 'Website'], ['address', 'Address'], ['likes', 'Likes'],
    ['followers', 'Followers'], ['rating', 'Rating'], ['instagram', 'Instagram'],
    ['otherLinks', 'Other Links'], ['intro', 'Intro'], ['pageUrl', 'Facebook URL'], ['scrapedAt', 'Scraped At'],
  ];

  let mode = 'keyword';
  let records = [];
  let job = null;
  let clearArmed = null;

  // ------------------------------------------------------------ settings

  function readSettings() {
    return {
      mode,
      keyword: $('keyword').value,
      limit: Number($('limit').value),
      delay: Number($('delay').value),
      skipExisting: $('skipExisting').checked,
      thorough: $('thorough').checked,
    };
  }

  function applySettings(s) {
    if (s.keyword) $('keyword').value = s.keyword;
    if (s.limit) $('limit').value = s.limit;
    if (s.delay) $('delay').value = s.delay;
    if (typeof s.skipExisting === 'boolean') $('skipExisting').checked = s.skipExisting;
    if (typeof s.thorough === 'boolean') $('thorough').checked = s.thorough;
    setMode(s.mode === 'urls' ? 'urls' : 'keyword');
  }

  const saveSettings = () => chrome.storage.local.set({ settings: readSettings() });

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.mode === m;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.mode-panel').forEach((p) => (p.hidden = p.dataset.panel !== m));
  }

  function flash(msg) {
    $('flash').textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => ($('flash').textContent = ''), 5000);
  }

  async function consumePrefill(url) {
    const box = $('urls');
    const lines = box.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.some((l) => FBS.pageKey(l) === FBS.pageKey(url))) lines.push(url);
    box.value = lines.join('\n') + '\n';
    setMode('urls');
    saveSettings();
    await chrome.storage.local.remove('prefillUrl');
  }

  // ----------------------------------------------------------- job view

  function renderJob() {
    const j = job || {};
    const isRunning = !!j.running;

    $('startBtn').disabled = isRunning;
    $('stopBtn').disabled = !isRunning;
    $('clearBtn').disabled = isRunning;
    ['keyword', 'urls', 'limit', 'delay', 'skipExisting', 'thorough'].forEach((id) => ($(id).disabled = isRunning));
    document.querySelectorAll('.tab').forEach((t) => (t.disabled = isRunning));

    const status = $('statusText');
    status.textContent = j.message || 'Idle.';
    status.className = `status ${j.phase || ''}`;

    const pct = j.total ? Math.round((j.done / j.total) * 100) : isRunning && j.phase === 'searching' ? 5 : 0;
    $('progressBar').style.width = `${pct}%`;
    $('cDone').textContent = j.done || 0;
    $('cTotal').textContent = j.total || 0;
    $('cSaved').textContent = j.saved || 0;
    $('cSkipped').textContent = j.skipped || 0;
    $('cFailed').textContent = j.failed || 0;
    $('currentUrl').textContent = j.current ? `Now: ${j.current}` : '';

    const log = $('log');
    log.replaceChildren(
      ...(j.log || []).slice().reverse().map((e) => {
        const li = document.createElement('li');
        li.className = e.level || 'info';
        const time = document.createElement('time');
        time.textContent = new Date(e.t).toLocaleTimeString();
        li.append(time, document.createTextNode(e.msg));
        return li;
      })
    );
  }

  // ------------------------------------------------------------ actions

  async function start() {
    const s = readSettings();
    saveSettings();
    const msg = {
      cmd: 'start',
      mode,
      settings: s,
      screen: {
        left: screen.availLeft || 0,
        top: screen.availTop || 0,
        width: screen.availWidth,
        height: screen.availHeight,
      },
    };
    if (mode === 'keyword') {
      msg.keyword = s.keyword.trim();
      if (!msg.keyword) return flash('Enter a keyword.');
    } else {
      msg.urls = $('urls').value.split(/[\s,]+/).filter(Boolean);
      if (!msg.urls.length) return flash('Paste at least one page URL.');
    }
    const res = await chrome.runtime.sendMessage(msg);
    if (!res || !res.ok) flash((res && res.error) || 'Could not start.');
  }

  async function stop() {
    await chrome.runtime.sendMessage({ cmd: 'stop' });
  }

  // --------------------------------------------------------------- init

  async function init() {
    const data = await chrome.storage.local.get(['settings', 'job', 'prefillUrl']);
    applySettings(data.settings || {});
    job = data.job || null;
    renderJob();
    if (data.prefillUrl) consumePrefill(data.prefillUrl);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.job) {
        job = changes.job.newValue || null;
        renderJob();
      }
      if (changes.prefillUrl && changes.prefillUrl.newValue) consumePrefill(changes.prefillUrl.newValue);
    });

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => {
        setMode(t.dataset.mode);
        saveSettings();
      })
    );
    ['keyword', 'limit', 'delay', 'skipExisting', 'thorough'].forEach((id) => $(id).addEventListener('change', saveSettings));
    $('keyword').addEventListener('keydown', (e) => e.key === 'Enter' && !$('startBtn').disabled && start());
    $('startBtn').addEventListener('click', start);
    $('stopBtn').addEventListener('click', stop);
  }

  init();
})();
