const test = require('node:test');
const assert = require('node:assert/strict');
require('../content/fb.js');
const F = globalThis.FBScraper;

test('CSV includes every collected parameter in the shared report column order', () => {
  const d = F.parseProfile({ h1: 'Example', lines: [
    'Details', 'Age: 29', 'Gender: Female', 'Relationship status: Single', 'Lives in Pune',
  ] });
  const record = F.toRecord('https://www.facebook.com/example', d);
  assert.deepEqual(Object.keys(record).filter((key) => key !== 'key').sort(), F.REPORT_COLUMNS.map(([key]) => key).sort());
  const csv = F.toCsv([record]);
  assert.ok(csv.startsWith('\uFEFFName,Platform,Type,Profile Type,Age,Gender,Relationship Status,Current Location,'));
  const values = csv.split('\r\n')[1].split(',');
  assert.equal(values[F.REPORT_COLUMNS.findIndex(([key]) => key === 'age')], '29');
  assert.equal(values[F.REPORT_COLUMNS.findIndex(([key]) => key === 'location')], 'Pune');
});

test('CSV keeps older records exportable with empty cells for newly added fields', () => {
  const csv = F.toCsv([{ name: 'Legacy', email: 'legacy@example.com' }]);
  const values = csv.split('\r\n')[1].split(',');
  assert.equal(values.length, F.REPORT_COLUMNS.length);
  assert.equal(values[0], 'Legacy');
  assert.equal(values[F.REPORT_COLUMNS.findIndex(([key]) => key === 'age')], '');
  assert.equal(values[F.REPORT_COLUMNS.findIndex(([key]) => key === 'platform')], 'Facebook');
  assert.ok(csv.includes('legacy@example.com'));
  assert.ok(!csv.includes('undefined'));
});

test('CSV escapes quotes and newlines and preserves Unicode and multiple contacts', () => {
  const csv = F.toCsv([{
    name: 'Zoë "Example", Ltd', intro: 'First line\nSecond line',
    email: 'one@example.com | two@example.com', phone: '+1 415-555-0132',
  }]);
  assert.ok(csv.includes('"Zoë ""Example"", Ltd"'));
  assert.ok(csv.includes('"First line\nSecond line"'));
  assert.ok(csv.includes('one@example.com | two@example.com'));
  assert.ok(csv.includes(',+1 415-555-0132,'));
});

test('CSV neutralizes spreadsheet formulas including malicious legacy phone fields', () => {
  for (const key of ['name', 'gender', 'location', 'phone', 'whatsapp', 'sourceQuery']) {
    for (const value of ['=1+1', '  =1+1', '+HYPERLINK("https://bad.example")', '-1+1', '@SUM(A1)', '\t=1+1', '\n=1+1']) {
      const csv = F.toCsv([{ [key]: value }]);
      assert.ok(csv.split('\r\n')[1].includes("'"), `${key}: ${value}`);
    }
  }
});
