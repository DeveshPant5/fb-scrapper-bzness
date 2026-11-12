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

  // -------------------------------------------------------- data report

  function cell(text, href) {
    const td = document.createElement('td');
    const value = text || '';
    td.title = value;
    if (href && /^https?:\/\//i.test(href)) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = value || href;
      td.append(a);
    } else {
      td.textContent = value;
    }
    return td;
  }

  function renderRecords() {
    $('recordCount').textContent = records.length;
    const q = $('filter').value.trim().toLowerCase();
    const rows = records
      .slice()
      .reverse()
      .filter((r) => !q || CSV_COLUMNS.some(([k]) => String(r[k] || '').toLowerCase().includes(q)));

    const body = $('rows');
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty';
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = records.length ? 'No rows match the filter.' : 'No data yet. Start a job to collect pages.';
      tr.append(td);
      body.replaceChildren(tr);
    } else {
      body.replaceChildren(
        ...rows.slice(0, MAX_ROWS).map((r) => {
          const tr = document.createElement('tr');
          const site = (r.website || '').split(' | ')[0];
          tr.append(
            cell(r.name || r.pageUrl, r.pageUrl),
            cell(r.category),
            cell(r.email),
            cell(r.phone),
            cell(r.whatsapp),
            cell(r.website, site),
            cell(r.address),
            cell(r.followers),
            cell(r.likes)
          );
          return tr;
        })
      );
    }
    $('tableNote').textContent =
      rows.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${rows.length} rows. Export CSV to get everything.` : '';
  }

  // ---------------------------------------------------------------- CSV

  function csvCell(value, key) {
    let s = value == null ? '' : String(value);
    // Stop spreadsheet apps from running scraped text as a formula.
    if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && key !== 'phone' && key !== 'whatsapp')) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    if (!records.length) return flash('Nothing to export yet.');
    const lines = [CSV_COLUMNS.map(([, h]) => h).join(',')];
    for (const r of records) lines.push(CSV_COLUMNS.map(([k]) => csvCell(r[k], k)).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `facebook-pages-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // Two-click confirm instead of a blocking confirm() dialog.
  async function clearData() {
    const btn = $('clearBtn');
    if (!clearArmed) {
      btn.textContent = 'Click again to delete all';
      btn.classList.add('confirm');
      clearArmed = setTimeout(() => {
        clearArmed = null;
        btn.textContent = 'Clear data';
        btn.classList.remove('confirm');
      }, 4000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    btn.textContent = 'Clear data';
    btn.classList.remove('confirm');
    await chrome.storage.local.set({ records: [] });
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
    const data = await chrome.storage.local.get(['settings', 'records', 'job', 'prefillUrl']);
    applySettings(data.settings || {});
    records = data.records || [];
    job = data.job || null;
    renderRecords();
    renderJob();
    if (data.prefillUrl) consumePrefill(data.prefillUrl);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.records) {
        records = changes.records.newValue || [];
        renderRecords();
      }
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
    $('exportBtn').addEventListener('click', exportCsv);
    $('clearBtn').addEventListener('click', clearData);
    $('filter').addEventListener('input', renderRecords);
  }

  init();
})();
