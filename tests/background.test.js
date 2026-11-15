const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../content/fb.js');

const F = globalThis.FBScraper;
const source = fs.readFileSync(require.resolve('../background.js'), 'utf8');

function worker(responses) {
  const visits = [];
  const event = { addListener() {} };
  const context = vm.createContext({
    FBScraper: F,
    importScripts() {},
    chrome: {
      runtime: { getURL: (path) => path, onMessage: event },
      storage: { local: { get: async () => ({}) } },
      action: { onClicked: event },
      windows: { onRemoved: event },
    },
  });
  vm.runInContext(source, context);
  context.interruptibleSleep = async () => {};
  context.visitAndExtract = async (_, url) => {
    visits.push(url);
    assert.ok(responses.length, `Unexpected navigation to ${url}`);
    return responses.shift();
  };
  return { context, visits, scrape: (thorough = false) => {
    context.settings = { thorough };
    return vm.runInContext('scrapeOne(1, "https://www.facebook.com/acme", settings)', context);
  } };
}

test('scrapeOne tries general About for company layouts before falling back home', async () => {
  const data = F.parseProfile({ h1: 'Acme', lines: ['Contact info', 'hello@acme.example'] });
  const w = worker([{ notFound: true }, { data }]);
  const result = await w.scrape();
  assert.equal(result.record.email, 'hello@acme.example');
  assert.deepEqual(w.visits, [
    'https://www.facebook.com/acme/about_contact_and_basic_info',
    'https://www.facebook.com/acme/about',
  ]);
});

test('scrapeOne saves a personal profile found on the home fallback', async () => {
  const data = F.parseProfile({ h1: 'Rahul', lines: ['Add friend', 'Details', 'rahul@example.com'] });
  const w = worker([{ notFound: true }, { notFound: true }, { data }]);
  const result = await w.scrape();
  assert.equal(data.isPersonal, true);
  assert.equal(result.record.email, 'rahul@example.com');
  assert.equal(w.visits.at(-1), 'https://www.facebook.com/acme');
});

test('scrapeOne keeps the fast path and thorough-mode home visit', async () => {
  const data = F.parseProfile({ h1: 'Acme', lines: ['Contact info', 'hello@acme.example'] });
  for (const thorough of [false, true]) {
    const w = worker([{ data }, { data }]);
    assert.equal((await w.scrape(thorough)).record.name, 'Acme');
    assert.equal(w.visits.length, thorough ? 2 : 1);
  }
});

test('scrapeOne stops at blocks on every fallback and rejects unavailable pages', async () => {
  for (const blocked of ['login', 'checkpoint', 'rate_limited']) {
    for (let step = 0; step < 3; step++) {
      const w = worker([...Array.from({ length: step }, () => ({ notFound: true })), { blocked }]);
      assert.equal((await w.scrape()).blocked, blocked);
      assert.equal(w.visits.length, step + 1);
    }
  }
  const w = worker([{ notFound: true }, { notFound: true }, { notFound: true }]);
  assert.equal((await w.scrape()).error, 'page not found or not available');
});

test('keyword search uses general Facebook results', () => {
  const w = worker([]);
  assert.equal(vm.runInContext('SEARCH_URL("Acme & Co")', w.context), 'https://www.facebook.com/search/top/?q=Acme%20%26%20Co');
});
