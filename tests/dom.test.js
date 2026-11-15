const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function tab(main) {
  const context = vm.createContext({
    URL,
    setTimeout: (fn) => { fn(); },
    location: { href: 'https://www.facebook.com/rahul' },
    window: { scrollTo() {} },
    document: {
      title: 'Rahul | Facebook', body: main, documentElement: { scrollHeight: 1000 },
      querySelector: (selector) => selector.startsWith('[role="main"]') ? main : null,
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../content/fb.js'), 'utf8'), context);
  return context.FBScraper;
}

test('DOM extraction returns personal profile data instead of skipping it', async () => {
  const main = {
    innerText: 'Rahul\nAdd friend\nDetails\nrahul@example.com',
    querySelector: () => ({ innerText: 'Rahul' }),
    querySelectorAll: () => [],
  };
  const result = await tab(main).extractPageData();
  assert.equal(result.data.isPersonal, true);
  assert.equal(result.data.emails[0], 'rahul@example.com');
  assert.equal(result.isPersonal, undefined);
});

test('DOM extraction preserves multiline company contact links', async () => {
  const main = {
    innerText: 'Acme\nContact details\nVisit our site\nacme.example\nPosts\nNews story',
    querySelector: () => ({ innerText: 'Acme' }),
    querySelectorAll: (selector) => selector === '[role="article"]' ? [] : [
      { href: 'https://acme.example/contact', innerText: 'Visit our site\nacme.example', closest: () => null },
      { href: 'https://unrelated.example/', innerText: 'News story', closest: () => null },
    ],
  };
  const { data } = await tab(main).extractPageData();
  assert.deepEqual(Array.from(data.websites), ['https://acme.example/contact', 'https://acme.example/']);
});

test('post articles with fake profile headings cannot supply demographics or contacts', async () => {
  const article = { innerText: 'Basic info\nAge: 29\nGender: Female\nRelationship status: Single\nPlaces lived\nLives in London\nContact info\npost@example.com' };
  const main = {
    innerText: 'Rahul\nIntro\nA public profile bio.\nPosts\n' + article.innerText,
    querySelector: () => ({ innerText: 'Rahul' }),
    querySelectorAll: (selector) => selector === '[role="article"]' ? [article] : [
      { href: 'mailto:post@example.com', innerText: 'post@example.com', closest: () => article },
    ],
  };
  const { data } = await tab(main).extractPageData();
  for (const field of ['age', 'gender', 'relationshipStatus', 'location']) assert.equal(data[field], '');
  assert.equal(data.emails.length, 0);
});

test('search keeps people with mutual friends and filters Facebook feature URLs', async () => {
  const anchor = (href, innerText, context) => ({
    href, innerText, parentElement: { parentElement: { innerText: context || innerText } },
  });
  const main = {
    innerText: 'End of results',
    querySelectorAll: () => [
      anchor('https://www.facebook.com/rahul', 'Rahul', 'Rahul\n3 mutual friends'),
      anchor('https://www.facebook.com/acme/about', 'Acme'),
      anchor('https://www.facebook.com/acme', 'Acme duplicate'),
      anchor('https://www.facebook.com/groups/123456', 'Group'),
      anchor('https://www.facebook.com/another', 'Another', 'Another and 3 friends like this'),
    ],
  };
  const result = await tab(main).collectSearchResults(10);
  assert.deepEqual(Array.from(result.urls, (item) => item.url), [
    'https://www.facebook.com/rahul', 'https://www.facebook.com/acme',
  ]);
  const skipped = await tab(main).collectSearchResults(1, ['https://www.facebook.com/rahul']);
  assert.equal(skipped.urls[0].url, 'https://www.facebook.com/acme');
});
