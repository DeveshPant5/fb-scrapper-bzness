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

  // --------------------------------------------------------------- init

  async function init() {
    const data = await chrome.storage.local.get(['settings', 'prefillUrl']);
    applySettings(data.settings || {});
    if (data.prefillUrl) consumePrefill(data.prefillUrl);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.prefillUrl && changes.prefillUrl.newValue) consumePrefill(changes.prefillUrl.newValue);
    });

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => {
        setMode(t.dataset.mode);
        saveSettings();
      })
    );
    ['keyword', 'limit', 'delay', 'skipExisting', 'thorough'].forEach((id) => $(id).addEventListener('change', saveSettings));
  }

  init();
})();
