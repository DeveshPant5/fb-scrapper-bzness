// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
require('../content/fb.js');
require('../content/ig.js');

const F = globalThis.FBScraper;
const I = globalThis.IGScraper;

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

test('personal accounts are flagged so they are never stored', () => {
  assert.equal(I.isProfessional({ is_professional_account: false, is_business_account: false }), false);
  const r = I.parseIgUser({ username: 'rahul', full_name: 'Rahul', is_private: true });
  assert.equal(r.isPersonal, true);
  assert.equal(r.kind, '');
});
