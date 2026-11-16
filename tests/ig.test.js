// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../content/fb.js');
require('../content/ig.js');

const F = globalThis.FBScraper;
const I = globalThis.IGScraper;
const source = fs.readFileSync(require.resolve('../content/ig.js'), 'utf8');

function instagramTab(responses) {
  const requests = [];
  const context = vm.createContext({
    FBScraper: F,
    URL,
    setTimeout: (fn) => fn(),
    location: { pathname: '/' },
    document: { cookie: 'ds_user_id=123; csrftoken=test', querySelector: () => null },
    sessionStorage: { getItem: () => null },
    fetch: async (path) => {
      requests.push(path);
      assert.ok(responses.length, `Unexpected request to ${path}`);
      const response = responses.shift();
      return { status: response.status || 200, url: path, text: async () => JSON.stringify(response.json) };
    },
  });
  vm.runInContext(source, context);
  return { scraper: context.IGScraper, requests };
}

test('normalizeIgUrl handles Instagram URL shapes and @usernames', () => {
  const cases = [
    ['https://www.instagram.com/SunriseDental/', 'https://www.instagram.com/sunrisedental/'],
    ['https://instagram.com/sunrise.dental?igsh=abc123', 'https://www.instagram.com/sunrise.dental/'],
    ['instagram.com/sunrise_dental/reels/', 'https://www.instagram.com/sunrise_dental/'],
    ['https://m.instagram.com/sunrise_dental', 'https://www.instagram.com/sunrise_dental/'],
    ['https://www.instagram.com/stories/sunrise_dental/3141592653/', 'https://www.instagram.com/sunrise_dental/'],
    ['@sunrise_dental', 'https://www.instagram.com/sunrise_dental/'],
  ];
  for (const [input, want] of cases) assert.equal(I.normalizeIgUrl(input), want, input);

  for (const bad of [
    'https://www.instagram.com/p/C1a2b3c4d5/',
    'https://www.instagram.com/reel/C1a2b3c4d5/',
    'https://www.instagram.com/explore/tags/dentist/',
    'https://www.instagram.com/accounts/login/',
    'https://www.instagram.com/',
    'https://www.facebook.com/sunrisedental',
    'sunrisedental',
    '@bad..name',
    '',
  ]) {
    assert.equal(I.normalizeIgUrl(bad), null, bad);
  }
});

test('normalizeTarget routes mixed lists to the right platform', () => {
  assert.deepEqual(I.normalizeTarget('https://www.instagram.com/sunrise_dental/'), {
    platform: 'instagram', url: 'https://www.instagram.com/sunrise_dental/',
  });
  assert.deepEqual(I.normalizeTarget('@sunrise_dental'), { platform: 'instagram', url: 'https://www.instagram.com/sunrise_dental/' });
  assert.deepEqual(I.normalizeTarget('https://www.facebook.com/SunriseDental/'), {
    platform: 'facebook', url: 'https://www.facebook.com/SunriseDental',
  });
  assert.deepEqual(I.normalizeTarget('sunrisedental'), { platform: 'facebook', url: 'https://www.facebook.com/sunrisedental' });
  assert.equal(I.normalizeTarget('@bad..name'), null);
  assert.equal(I.normalizeTarget('https://www.instagram.com/p/C1a2b3c4d5/'), null);
  assert.equal(I.targetKey('@Sunrise_Dental'), I.targetKey('instagram.com/sunrise_dental'));
});

test('parseIgUser reads a business account (web_profile_info + info)', () => {
  const user = {
    id: '1234567890',
    username: 'sunrise_dental',
    full_name: 'Sunrise Dental Clinic',
    biography: 'Painless dentistry in Kothrud 🦷\n📞 Call/WhatsApp +91 98765 43210\nbookings@sunrisedental.in\nEst. 2015',
    external_url: 'https://sunrisedental.in/?utm_source=ig',
    bio_links: [
      { title: 'Book', url: 'https://wa.me/919876543210' },
      { title: 'Facebook', url: 'https://www.facebook.com/SunriseDental' },
    ],
    edge_followed_by: { count: 4521 },
    is_business_account: true,
    is_professional_account: true,
    category_name: 'Dentist & dental office',
    business_email: null,
    business_phone_number: null,
    business_address_json: '{"city_name": "Pune, Maharashtra", "street_address": "Shop No 4, MG Road, Kothrud", "zip_code": "411038"}',
  };
  const info = {
    public_email: 'info@sunrisedental.in',
    public_phone_country_code: '91',
    public_phone_number: '2025550123',
  };
  const r = I.parseIgUser(user, info);

  assert.equal(r.isPersonal, false);
  assert.equal(r.platform, 'Instagram');
  assert.equal(r.kind, I.KIND_BUSINESS);
  assert.equal(r.name, 'Sunrise Dental Clinic');
  assert.equal(r.category, 'Dentist & dental office');
  assert.equal(r.followers, '4521');
  assert.equal(r.address, 'Shop No 4, MG Road, Kothrud, Pune, Maharashtra, 411038');
  assert.deepEqual(r.emails, ['info@sunrisedental.in', 'bookings@sunrisedental.in']);
  assert.deepEqual(r.phones, ['+91 2025550123', '+91 98765 43210']);
  assert.deepEqual(r.whatsapp, ['+919876543210']);
  assert.deepEqual(r.websites, ['https://sunrisedental.in/']);
  assert.deepEqual(r.otherLinks, ['https://www.facebook.com/SunriseDental']);
  assert.equal(r.intro, 'Painless dentistry in Kothrud 🦷 / 📞 Call/WhatsApp +91 98765 43210 / bookings@sunrisedental.in / Est. 2015');

  const rec = F.toRecord('https://www.instagram.com/sunrise_dental/', r);
  assert.equal(rec.platform, 'Instagram');
  assert.equal(rec.kind, I.KIND_BUSINESS);
  assert.equal(rec.key, 'https://www.instagram.com/sunrise_dental/');
  assert.equal(rec.email, 'info@sunrisedental.in | bookings@sunrisedental.in');
});

test('parseIgUser reads a creator account with contact details only in the bio', () => {
  const r = I.parseIgUser({
    username: 'anita.bakes',
    full_name: 'Anita Desai',
    biography: 'Home bakery • Pune\nOrders: WhatsApp 91234 56789\nwww.anitabakes.in',
    is_business_account: false,
    is_professional_account: true,
    category_name: null,
    business_category_name: 'None',
    edge_followed_by: { count: 12000 },
  });
  assert.equal(r.isPersonal, false);
  assert.equal(r.kind, I.KIND_CREATOR);
  assert.equal(r.category, '');
  assert.deepEqual(r.whatsapp, ['91234 56789']);
  assert.deepEqual(r.phones, []); // WhatsApp-only line
  assert.deepEqual(r.websites, ['https://www.anitabakes.in/']);
});

test('bio parsing ignores years, prices and pin codes', () => {
  const r = I.parseIgUser({
    username: 'x', is_professional_account: true,
    biography: 'Since 2015 · Pune 411038 · Thali ₹250 · Open 10-22 · GST 27AAAPL1234C1ZV · Dr.Patel',
  });
  assert.deepEqual(r.phones, []);
  assert.deepEqual(r.whatsapp, []);
  assert.deepEqual(r.websites, []);
});

test('personal and private profiles retain their available details and account type', () => {
  assert.equal(I.isProfessional({ is_professional_account: false, is_business_account: false }), false);
  for (const is_private of [false, true]) {
    const r = I.parseIgUser({
      username: 'rahul', full_name: 'Rahul', is_private,
      biography: 'Hello!\nrahul@example.com\nCall +91 98765 43210',
      edge_followed_by: { count: 0 }, external_url: 'https://rahul.example/',
    });
    assert.equal(r.isPersonal, true);
    assert.equal(r.kind, is_private ? 'Personal account (private)' : I.KIND_PERSONAL);
    assert.equal(r.profileType, 'Profile');
    assert.equal(r.name, 'Rahul');
    assert.equal(r.followers, '0');
    assert.deepEqual(r.emails, ['rahul@example.com']);
    assert.deepEqual(r.phones, ['+91 98765 43210']);
    assert.deepEqual(r.websites, ['https://rahul.example/']);
  }
});

test('extractProfile accepts every account type and only requests professional contacts where applicable', async () => {
  for (const [flags, kind, contactRequest] of [
    [{ is_business_account: true }, I.KIND_BUSINESS, true],
    [{ is_professional_account: true }, I.KIND_CREATOR, true],
    [{ is_business_account: false, is_professional_account: false }, I.KIND_PERSONAL, false],
    [{ is_private: true }, 'Personal account (private)', false],
  ]) {
    const tab = instagramTab([
      { json: { data: { user: { id: '123', username: 'rahul', ...flags } } } },
      ...(contactRequest ? [{ json: { user: { public_email: 'hello@example.com' } } }] : []),
    ]);
    const result = await tab.scraper.extractProfile('rahul');
    assert.equal(result.data.kind, kind);
    assert.equal(result.data.name, 'rahul');
    assert.equal(result.data.profileType, 'Profile');
    assert.deepEqual(result.data.emails, contactRequest ? ['hello@example.com'] : []);
    assert.equal(result.data.age, '');
    assert.equal(tab.requests.length, contactRequest ? 2 : 1);
    assert.equal(tab.requests[0], '/api/v1/users/web_profile_info/?username=rahul');
    if (contactRequest) assert.equal(tab.requests[1], '/api/v1/users/123/info/');
  }
});

test('searchAccounts includes all account types and still respects deduplication, skips and limits', async () => {
  const response = { json: { users: [
    { user: { username: 'personal', is_private: false } },
    { user: { username: 'private', is_private: true } },
    { user: { username: 'PRIVATE', is_private: true } },
    { user: { username: 'reels' } },
    { user: { username: 'creator', is_professional_account: true } },
    { user: { username: 'business', is_business_account: true } },
  ] } };
  const result = await instagramTab([response]).scraper.searchAccounts('example', 10);
  assert.deepEqual(Array.from(result.urls, (item) => item.url), [
    'https://www.instagram.com/personal/', 'https://www.instagram.com/private/',
    'https://www.instagram.com/creator/', 'https://www.instagram.com/business/',
  ]);
  const limited = await instagramTab([response]).scraper.searchAccounts('example', 1, ['https://www.instagram.com/personal/']);
  assert.deepEqual(Array.from(limited.urls, (item) => item.url), ['https://www.instagram.com/private/']);
});

test('Instagram extraction and search still stop for login, checkpoints and rate limits', async () => {
  for (const [response, blocked] of [
    [{ status: 401, json: {} }, 'login'],
    [{ json: { challenge: {} } }, 'checkpoint'],
    [{ status: 429, json: {} }, 'rate_limited'],
  ]) {
    assert.equal((await instagramTab([response]).scraper.extractProfile('rahul')).blocked, blocked);
    assert.equal((await instagramTab([response]).scraper.searchAccounts('rahul', 10)).blocked, blocked);
    const professional = instagramTab([
      { json: { data: { user: { id: '123', username: 'creator', is_professional_account: true } } } },
      response,
    ]);
    assert.equal((await professional.scraper.extractProfile('creator')).blocked, blocked);
  }
});
