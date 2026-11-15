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

test('scrapeOne reads company About details without visiting personal profile tabs', async () => {
  const data = F.parseProfile({ h1: 'Acme', lines: ['Intro', 'Building useful things for everyone.', 'Page · Company', 'hello@acme.example'] });
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
  const w = worker([{ notFound: true }, { notFound: true }, { notFound: true }, { notFound: true }, { data }]);
  const result = await w.scrape();
  assert.equal(data.isPersonal, true);
  assert.equal(result.record.email, 'rahul@example.com');
  assert.equal(w.visits.at(-1), 'https://www.facebook.com/acme');
});

test('scrapeOne always reads About and preserves the thorough-mode home visit', async () => {
  const data = F.parseProfile({ h1: 'Acme', lines: ['Intro', 'Building useful things for everyone.', 'Page · Company', 'hello@acme.example'] });
  for (const thorough of [false, true]) {
    const w = worker([{ data }, { data }, { data }]);
    assert.equal((await w.scrape(thorough)).record.name, 'Acme');
    assert.equal(w.visits.length, thorough ? 3 : 2);
  }
});

test('scrapeOne stops at blocks on every fallback and rejects unavailable pages', async () => {
  for (const blocked of ['login', 'checkpoint', 'rate_limited']) {
    for (let step = 0; step < 5; step++) {
      const w = worker([...Array.from({ length: step }, () => ({ notFound: true })), { blocked }]);
      assert.equal((await w.scrape()).blocked, blocked);
      assert.equal(w.visits.length, step + 1);
    }
  }
  const w = worker(Array.from({ length: 5 }, () => ({ notFound: true })));
  assert.equal((await w.scrape()).error, 'page not found or not available');
});

test('scrapeOne collects profile parameters across the dedicated About tabs', async () => {
  const parse = (lines) => ({ data: F.parseProfile({ h1: 'Rahul', lines }) });
  const w = worker([
    parse(['Basic info', 'Age: 28', 'Gender: Male', 'Contact info', 'rahul@example.com']),
    parse(['Intro', 'A public profile bio for the campaign.', 'Add friend']),
    parse(['Family and relationships', 'Relationship', 'Single']),
    parse(['Places lived', 'Pune, Maharashtra', 'Current city']),
  ]);
  const { record } = await w.scrape();
  assert.equal(record.age, '28');
  assert.equal(record.gender, 'Male');
  assert.equal(record.relationshipStatus, 'Single');
  assert.equal(record.location, 'Pune, Maharashtra');
  assert.equal(record.profileType, 'Profile');
  assert.equal(w.visits.length, 4);
  assert.equal(w.visits[2], 'https://www.facebook.com/acme/about_family_and_relationships');
  assert.equal(w.visits[3], 'https://www.facebook.com/acme/about_places');
});

test('scrapeOne skips detail tabs already covered by Overview', async () => {
  const data = F.parseProfile({ h1: 'Rahul', lines: [
    'Intro', 'A public profile bio for the campaign.', 'rahul@example.com',
    'Details', 'Relationship status: Single', 'Lives in Pune',
  ] });
  const w = worker([{ data }, { data }]);
  const { record } = await w.scrape();
  assert.equal(record.relationshipStatus, 'Single');
  assert.equal(record.location, 'Pune');
  assert.equal(w.visits.length, 2);
});

test('rescraping clears previously visible details instead of retaining stale campaign data', () => {
  const w = worker([]);
  w.context.records = [{ key: 'same', gender: 'Female', relationshipStatus: 'Single', email: 'old@example.com', note: 'Keep this note' }];
  w.context.record = { key: 'same', gender: '', relationshipStatus: '', email: '', scrapedAt: '2026-11-15T00:00:00Z' };
  vm.runInContext('upsertRecord(records, record)', w.context);
  assert.equal(w.context.records[0].gender, '');
  assert.equal(w.context.records[0].relationshipStatus, '');
  assert.equal(w.context.records[0].email, '');
  assert.equal(w.context.records[0].note, 'Keep this note');
});

test('stop during a pause prevents the next profile navigation', async () => {
  const w = worker([{ notFound: true }]);
  w.context.interruptibleSleep = async () => vm.runInContext('stopRequested = true', w.context);
  assert.equal((await w.scrape()).stopped, true);
  assert.equal(w.visits.length, 1);
});

test('keyword search uses general Facebook results', () => {
  const w = worker([]);
  assert.equal(vm.runInContext('SEARCH_URL("Acme & Co")', w.context), 'https://www.facebook.com/search/top/?q=Acme%20%26%20Co');
});
