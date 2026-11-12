// Run with: node --test tests/fb.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../content/fb.js');

const F = globalThis.FBScraper;

test('normalizePageUrl handles the URL shapes Facebook uses', () => {
  const cases = [
    ['https://www.facebook.com/SunriseDental/', 'https://www.facebook.com/SunriseDental'],
    ['https://m.facebook.com/sunrisedental?ref=xyz', 'https://www.facebook.com/sunrisedental'],
    ['facebook.com/sunrise.dental/about', 'https://www.facebook.com/sunrise.dental'],
    ['https://www.facebook.com/profile.php?id=100063539480153&sk=about', 'https://www.facebook.com/profile.php?id=100063539480153'],
    ['https://www.facebook.com/p/Sunrise-Dental-100063539480153/', 'https://www.facebook.com/profile.php?id=100063539480153'],
    ['https://www.facebook.com/people/Sunrise-Dental/100083000000001/', 'https://www.facebook.com/profile.php?id=100083000000001'],
    ['https://www.facebook.com/pages/Sunrise-Dental/123456789012', 'https://www.facebook.com/profile.php?id=123456789012'],
    ['https://www.facebook.com/pg/sunrisedental/about/', 'https://www.facebook.com/sunrisedental'],
    ['https://www.facebook.com/123456789012', 'https://www.facebook.com/profile.php?id=123456789012'],
    ['sunrisedental', 'https://www.facebook.com/sunrisedental'],
    ['https://www.facebook.com/sunrisedental?__cft__[0]=AZX&__tn__=%3C', 'https://www.facebook.com/sunrisedental'],
  ];
  for (const [input, want] of cases) assert.equal(F.normalizePageUrl(input), want, input);

  for (const bad of [
    'https://www.facebook.com/search/pages/?q=dentist',
    'https://www.facebook.com/groups/12345',
    'https://www.facebook.com/',
    'https://example.com/sunrisedental',
    'https://www.facebook.com/profile.php',
    'https://www.facebook.com/watch/?v=1',
    '',
  ]) {
    assert.equal(F.normalizePageUrl(bad), null, bad);
  }
});

test('aboutUrl points at the Contact and basic info tab', () => {
  assert.equal(
    F.aboutUrl('https://www.facebook.com/sunrisedental'),
    'https://www.facebook.com/sunrisedental/about_contact_and_basic_info'
  );
  assert.equal(
    F.aboutUrl('https://www.facebook.com/profile.php?id=1000635394'),
    'https://www.facebook.com/profile.php?id=1000635394&sk=about_contact_and_basic_info'
  );
});

test('phone detection rejects counts and dates', () => {
  for (const ok of ['+91 98765 43210', '098765 43210', '(022) 2345 6789', '‪+1 415-555-0132‬', '919876543210']) {
    assert.ok(F.isPhoneLike(ok), ok);
  }
  for (const bad of ['4.2K', '12,345', '2015', '12-05-2020', '1234', 'Call now']) {
    assert.ok(!F.isPhoneLike(bad), bad);
  }
});

