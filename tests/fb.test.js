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

test('classifyLink unwraps l.facebook.com and recognises WhatsApp/Instagram/maps', () => {
  assert.deepEqual(
    F.classifyLink('https://l.facebook.com/l.php?u=https%3A%2F%2Fsunrisedental.in%2F%3Ffbclid%3Dabc&h=AT0'),
    { type: 'web', value: 'https://sunrisedental.in/' }
  );
  assert.deepEqual(F.classifyLink('https://wa.me/919876543210'), { type: 'whatsapp', value: '+919876543210' });
  assert.deepEqual(F.classifyLink('https://api.whatsapp.com/send?phone=919876543210'), { type: 'whatsapp', value: '+919876543210' });
  assert.equal(F.classifyLink('https://wa.me/message/ABC123XYZ'), null);
  assert.equal(F.classifyLink('https://www.instagram.com/sunrise_dental').type, 'instagram');
  assert.equal(F.classifyLink('https://www.bing.com/maps/default.aspx?v=2&where1=Pune').type, 'map');
  assert.deepEqual(F.classifyLink('mailto:info@sunrisedental.in'), { type: 'email', value: 'info@sunrisedental.in' });
  assert.equal(F.classifyLink('https://www.facebook.com/sunrisedental/photos'), null);
});

test('parseProfile reads an About → Contact and basic info page', () => {
  const lines = [
    'Sunrise Dental Clinic', '4.2K likes', '•', '4.5K followers',
    'Posts', 'About', 'Mentions', 'Reviews', 'Followers', 'Photos', 'More',
    'About', 'Intro', 'Contact and basic info', 'Privacy and legal info', 'Page transparency',
    'Categories', 'Page · Dentist & dental office',
    'Contact info',
    'Shop No 4, MG Road, Kothrud, Pune, India, 411038',
    '‪098765 43210‬', 'Mobile',
    'info@sunrisedental.in', 'Email',
    'Websites and social links',
    'sunrisedental.in', 'Website',
    'sunrise_dental', 'Instagram',
    '+91 98765 43210', 'WhatsApp',
    'Basic info', 'Price range', '$$', 'Rating · 4.8 (56 Reviews)',
  ];
  const links = [
    { href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fsunrisedental.in%2F&h=x', text: 'sunrisedental.in' },
    { href: 'https://www.instagram.com/sunrise_dental', text: 'sunrise_dental' },
    { href: 'https://www.facebook.com/sunrisedental/followers', text: '4.5K followers' },
    { href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample-news.com%2Fstory', text: 'Some news story' },
  ];
  const r = F.parseProfile({ lines, links, h1: 'Sunrise Dental Clinic', title: '(3) Sunrise Dental Clinic | Facebook' });

  assert.equal(r.isPersonal, false);
  assert.equal(r.name, 'Sunrise Dental Clinic');
  assert.equal(r.category, 'Dentist & dental office');
  assert.equal(r.likes, '4.2K');
  assert.equal(r.followers, '4.5K');
  assert.equal(r.rating, '4.8 (56 reviews)');
  assert.deepEqual(r.emails, ['info@sunrisedental.in']);
  assert.deepEqual(r.phones, ['098765 43210']);
  assert.deepEqual(r.whatsapp, ['+91 98765 43210']);
  assert.deepEqual(r.websites, ['https://sunrisedental.in/']);
  assert.deepEqual(r.instagram, ['https://www.instagram.com/sunrise_dental']);
  assert.equal(r.address, 'Shop No 4, MG Road, Kothrud, Pune, India, 411038');
});

test('parseProfile reads the unlabelled Intro card on a page home tab', () => {
  const lines = [
    'Green Leaf Cafe', '1.1K likes • 1.3K followers',
    'Posts', 'About', 'Reviews', 'Photos',
    'Intro',
    'Cosy vegetarian cafe serving breakfast all day.',
    'Page · Cafe',
    '12 Baker Street, London, NW1 6XE',
    '+44 20 7946 0958',
    'hello@greenleaf.co.uk',
    'greenleaf.co.uk',
    'Rating · 4.6 (210 Reviews)',
    'Photos', 'See all photos',
    'Posts', 'Call us at 020 1234 5678 for bookings, 12-05-2024',
  ];
  const r = F.parseProfile({ lines, h1: 'Green Leaf Cafe' });
  assert.equal(r.category, 'Cafe');
  assert.equal(r.intro, 'Cosy vegetarian cafe serving breakfast all day.');
  assert.equal(r.address, '12 Baker Street, London, NW1 6XE');
  assert.deepEqual(r.phones, ['+44 20 7946 0958']);
  assert.deepEqual(r.emails, ['hello@greenleaf.co.uk']);
  assert.deepEqual(r.websites, ['https://greenleaf.co.uk/']);
  assert.equal(r.rating, '4.6 (210 reviews)');
  assert.equal(r.likes, '1.1K');
  assert.equal(r.followers, '1.3K');
});

test('parseProfile flags personal profiles so they are never stored', () => {
  const r = F.parseProfile({
    lines: ['Rahul Sharma', '1.2K friends', 'Add friend', 'Message', 'Posts', 'About', 'Friends', 'Photos'],
    h1: 'Rahul Sharma',
  });
  assert.equal(r.isPersonal, true);
});

