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
  assert.equal(F.aboutUrl('https://www.facebook.com/acme', 'about'), 'https://www.facebook.com/acme/about');
  assert.equal(F.aboutUrl('https://www.facebook.com/profile.php?id=123456', 'about'), 'https://www.facebook.com/profile.php?id=123456&sk=about');
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

test('parseProfile identifies personal profiles while keeping their public contacts', () => {
  const r = F.parseProfile({
    lines: ['Rahul Sharma', '1.2K friends', 'Add friend', 'Message', 'Posts', 'About', 'Friends', 'Photos', 'Details', 'rahul@example.com', '+91 98765 43210'],
    h1: 'Rahul Sharma',
  });
  assert.equal(r.isPersonal, true);
  const record = F.toRecord('https://www.facebook.com/rahul', r);
  assert.equal(record.email, 'rahul@example.com');
  assert.equal(record.phone, '+91 98765 43210');
});

test('company About layouts support labels before values and inline labels', () => {
  const r = F.parseProfile({ h1: 'Acme Ltd', lines: [
    'About', 'Categories', 'Company', 'Contact information',
    'Phone number', '+1 415-555-0132', 'Email address: hello@acme.example',
    'Website', 'acme.example', 'Address', '10 Baker Street, London, NW1 6XE',
    'WhatsApp: +44 20 7946 0958', 'Instagram: acme_official',
  ] });
  assert.equal(r.name, 'Acme Ltd');
  assert.equal(r.category, 'Company');
  assert.deepEqual(r.phones, ['+1 415-555-0132']);
  assert.deepEqual(r.emails, ['hello@acme.example']);
  assert.deepEqual(r.websites, ['https://acme.example']);
  assert.equal(r.address, '10 Baker Street, London, NW1 6XE');
  assert.deepEqual(r.whatsapp, ['+44 20 7946 0958']);
  assert.deepEqual(r.instagram, ['https://www.instagram.com/acme_official']);
});

test('adjacent labels before values keep phone and WhatsApp numbers separate', () => {
  const r = F.parseProfile({ lines: [
    'Contact details', 'Phone', '+1 415-555-0132', 'WhatsApp', '+44 20 7946 0958',
  ] });
  assert.deepEqual(r.phones, ['+1 415-555-0132']);
  assert.deepEqual(r.whatsapp, ['+44 20 7946 0958']);
});

test('creator and organization details use contact sections without reading post websites', () => {
  for (const category of ['Digital creator', 'Nonprofit organization', 'Company']) {
    const r = F.parseProfile({ h1: 'Public Profile', lines: [
      'Bio', 'Helping people learn something new every day.', `Profile · ${category}`,
      'Details', ...Array(35).fill('Additional public detail'), 'creator.example',
      'Visit our site', 'Posts', 'unrelated.example', 'News story',
    ], links: [
      { href: 'https://creator.example/contact', text: 'Visit our site\ncreator.example' },
      { href: 'https://unrelated.example/', text: 'News story' },
    ] });
    assert.equal(r.category, category);
    assert.equal(r.isPersonal, false);
    assert.equal(r.intro, 'Helping people learn something new every day.');
    assert.deepEqual(r.websites, ['https://creator.example/contact', 'https://creator.example/']);
  }
});

test('a personal profile with no friend controls is still not treated as a business', () => {
  // Already a friend + friend list hidden: no "Add friend", no "N friends".
  const r = F.parseProfile({
    lines: ['Priya Mehta', 'Friends', 'Message', 'Posts', 'About', 'Photos',
      'Contact info', '98765 43210', 'Mobile', 'priya.m@example.com', 'Email'],
    h1: 'Priya Mehta',
  });
  assert.equal(r.isPersonal, false);
  assert.equal(F.isBusiness(r), false);
});

test('parseProfile reads a profile in professional mode', () => {
  const lines = [
    'Anita Desai', '12K followers', '•', '310 following', 'Add friend', 'Follow', 'Message',
    'Posts', 'About', 'Reels', 'Photos',
    'Intro',
    'Home bakery in Pune. Custom cakes made to order.',
    'Profile · Bakery',
    'Baner Road, Pune, India, 411045',
    '+91 91234 56789',
    'orders@anitabakes.in',
    'anitabakes.in',
    'Photos', 'See all photos',
  ];
  const r = F.parseProfile({ lines, h1: 'Anita Desai' });
  assert.equal(r.isPersonal, false);
  assert.ok(F.isBusiness(r));
  assert.equal(r.kind, F.KIND_PRO);
  assert.equal(r.category, 'Bakery');
  assert.equal(r.followers, '12K');
  assert.equal(r.intro, 'Home bakery in Pune. Custom cakes made to order.');
  assert.deepEqual(r.phones, ['+91 91234 56789']);
  assert.deepEqual(r.emails, ['orders@anitabakes.in']);
  assert.deepEqual(r.websites, ['https://anitabakes.in/']);
  assert.equal(r.address, 'Baner Road, Pune, India, 411045');
});

test('Pages are tagged as Pages', () => {
  const r = F.parseProfile({ lines: ['Intro', 'Page · Cafe', 'hello@cafe.in'], h1: 'Cafe' });
  assert.equal(r.kind, F.KIND_PAGE);
  assert.ok(F.isBusiness(r));
});

test('a professional profile whose About tab lacks the category is confirmed by the home tab', () => {
  // About tab: labelled contacts plus friend controls, but no "Profile ·" line.
  const about = F.parseProfile({
    lines: ['Anita Desai', '2.1K friends', 'Add friend', 'Contact info', '+91 91234 56789', 'Mobile', 'orders@anitabakes.in', 'Email'],
    h1: 'Anita Desai',
  });
  assert.equal(about.isPersonal, true);
  assert.equal(F.isBusiness(about), false);

  const home = F.parseProfile({ lines: ['Anita Desai', 'Add friend', 'Intro', 'Profile · Bakery', 'anitabakes.in'], h1: 'Anita Desai' });
  const m = F.mergeParsed(about, home);
  assert.equal(m.isPersonal, false);
  assert.ok(F.isBusiness(m));
  assert.equal(m.kind, F.KIND_PRO);
  assert.deepEqual(m.emails, ['orders@anitabakes.in']);
  assert.deepEqual(m.phones, ['+91 91234 56789']);
  assert.equal(F.toRecord('https://www.facebook.com/anita.desai', m).kind, F.KIND_PRO);
});

test('mergeParsed + toRecord combine two visits without duplicates', () => {
  const a = F.parseProfile({ lines: ['Contact info', '098765 43210', 'Mobile'], h1: 'Biz' });
  const b = F.parseProfile({ lines: ['Intro', 'Page · Shop', '+91 98765 43210', 'shop@biz.in'], h1: 'Biz' });
  const m = F.mergeParsed(a, b);
  assert.deepEqual(m.phones, ['098765 43210', '+91 98765 43210']); // Keep ambiguous local/international variants.
  assert.equal(m.category, 'Shop');
  const rec = F.toRecord('https://www.facebook.com/Biz', m);
  assert.equal(rec.key, 'https://www.facebook.com/biz');
  assert.equal(rec.email, 'shop@biz.in');
  assert.ok(F.hasContact(m));
});

test('profile details read explicit age, gender, relationship status, and current location', () => {
  for (const lines of [
    ['Details', 'Age: 29', 'Gender: Female', 'Relationship status: Single', 'Lives in Pune, India'],
    ['Basic info', '29', 'Age', 'Female', 'Gender', 'Family and relationships', 'Single', 'Relationship', 'Places lived', 'Pune, India', 'Current city'],
    ['Basic info', 'Age', '29 years old', 'Gender', 'Female', 'Family and relationships', 'Relationship', 'Single', 'Places lived', 'Current city', 'Pune, India'],
  ]) {
    const d = F.parseProfile({ h1: 'Public Profile', lines });
    assert.equal(d.age, '29', lines.join(' / '));
    assert.equal(d.gender, 'Female');
    assert.equal(d.relationshipStatus, 'Single');
    assert.equal(d.location, 'Pune, India');
  }
});

test('age calculation checks the birthday boundary and rejects incomplete or invalid dates', () => {
  const today = new Date('2026-11-15T12:00:00Z');
  for (const value of ['November 15, 1997', '15 November 1997', '1997-11-15']) {
    assert.equal(F.ageFromBirthDate(value, today), '29');
  }
  assert.equal(F.ageFromBirthDate('November 16, 1997', today), '28');
  assert.equal(F.ageFromBirthDate('February 29, 2000', new Date('2026-02-28T12:00:00Z')), '25');
  for (const bad of ['1997', 'November 15', '11/15/1997', 'February 30, 1997', 'February 29, 1997', 'November 16, 2026', 'January 1, 1800', 'Wrongmonth 15, 1997']) {
    assert.equal(F.ageFromBirthDate(bad, today), '', bad);
  }
  const d = F.parseProfile({ h1: 'Profile', lines: ['Basic info', 'November 15, 1997', 'Birth date'] });
  assert.equal(d.age, F.ageFromBirthDate('November 15, 1997'));
  assert.ok(!('birthDate' in F.toRecord('https://www.facebook.com/profile', d)));
  const intro = F.parseProfile({ lines: ['Intro', 'November 15, 1997', 'Birth date'] });
  assert.equal(intro.intro, '');
});

test('undisclosed demographics remain blank and post/comment contacts are excluded', () => {
  const d = F.parseProfile({ h1: 'Jane', lines: [
    'Intro', 'A public profile with no personal details.', 'Profile · Digital creator',
    'Posts', 'Age: 29', 'Gender: Female', 'Relationship status: Single', 'Lives in London',
    'post@example.com', 'Email: comment@example.com', 'Phone: +1 415-555-0132', 'comment.example',
  ], links: [
    { href: 'mailto:post@example.com', text: 'post@example.com' },
    { href: 'tel:+14155550132', text: '+1 415-555-0132' },
    { href: 'https://wa.me/14155550132', text: 'Chat on WhatsApp' },
  ] });
  for (const field of ['age', 'gender', 'relationshipStatus', 'location']) assert.equal(d[field], '');
  assert.deepEqual(d.emails, []);
  assert.deepEqual(d.phones, []);
  assert.deepEqual(d.whatsapp, []);
});

test('birth dates without years and hometowns do not become ages or current cities', () => {
  const d = F.parseProfile({ h1: 'Profile', lines: [
    'Basic info', 'Birth date: November 15',
    'Places lived', 'Mumbai, India', 'Hometown',
  ] });
  assert.equal(d.age, '');
  assert.equal(d.location, '');
});

test('separately labelled birthday and birth year combine into an exact age', () => {
  for (const lines of [
    ['Basic info', 'November 15', 'Birth date', '1997', 'Birth year'],
    ['Basic info', 'Birthday: 15 November', 'Birth year: 1997'],
    ['Basic info', 'Birth date', 'November 15', 'Birth year', '1997'],
  ]) {
    const d = F.parseProfile({ h1: 'Profile', lines });
    assert.equal(d.age, F.ageFromBirthDate('November 15, 1997'));
    assert.ok(!('birthDate' in d));
    assert.ok(!('birthYear' in d));
  }
  assert.equal(F.parseProfile({ lines: ['Basic info', 'Birth year: 1997'] }).age, '');
});

test('relationship state excludes the name of a partner', () => {
  const d = F.parseProfile({ h1: 'Profile', lines: [
    'Details', 'Relationship status: Married to Another Person',
  ] });
  assert.equal(d.relationshipStatus, 'Married');
});

test('telephone links reject malformed, oversized, and formula-like values', () => {
  for (const value of ['tel:+1234567890123456', 'tel:+1234567+HYPERLINK("https://bad.example")', 'tel:2020-05-01']) {
    assert.equal(F.classifyLink(value), null);
  }
});

test('phone deduplication preserves country codes while merging spacing differences', () => {
  const d = F.parseProfile({ lines: [
    'Contact info', '+1 415 555 0132', '+1 (415) 555-0132', '+44 415 555 0132',
  ] });
  assert.deepEqual(d.phones, ['+1 415 555 0132', '+44 415 555 0132']);
});
