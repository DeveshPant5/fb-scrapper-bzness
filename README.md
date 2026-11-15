# FB Page Scraper (Chrome extension)

Collects public contact details from Facebook **pages and public profiles**, including companies,
organizations, creators, and people. Exports name, category, email, phone, WhatsApp, website,
address, likes, followers, rating, and Instagram to CSV.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `fb-page-scraper` folder.
3. Pin the extension and click its icon to open the dashboard.

You must be logged in to facebook.com in the same Chrome profile.

## Use

- **Keyword search**: type something like `dentist in Pune`. The extension runs a general Facebook
  search across pages and profiles, scrolls the results, then visits each result.
- **Profile / page URLs**: paste one URL per line. Clicking the extension icon while viewing a
  Facebook page or profile adds it to the list. Paste direct URLs when a target does not appear in search.
- **Max profiles / pages / Delay**: how many entries per run and how long to wait between them (minimum 3 s).
- **Thorough mode**: also opens each page's home tab to pick up the intro text and rating. This
  adds a page load even when an About tab already has contact details.
- **Export CSV**: downloads everything in the Data Report (UTF-8, opens in Excel or Google Sheets).

A separate window opens and does the browsing. Keep it visible (not minimised) while a job runs,
because Facebook doesn't render content in hidden windows.

## How it works

| File | Role |
|---|---|
| `background.js` | Service worker. Opens the scraper window, runs the job queue, and saves results to `chrome.storage`. |
| `content/fb.js` | Injected into Facebook tabs. Reads the visible text and links of a page and turns them into fields. |
| `dashboard.*` | The UI. Sends start/stop commands and renders progress and data from storage. |

For each page the extension opens `/about_contact_and_basic_info`, where Facebook shows labelled
contact details. If that tab has no contact details, it tries the general `/about` tab, then the home
tab. Extraction relies on visible text and link patterns, not Facebook's CSS class names, which
change frequently. Labels before, after, or inline with values are supported, along with Intro,
Bio, Details, and contact sections.

## Built-in safeguards

- Public personal profiles and all Page categories are accepted; no business category is required.
- Only information visible to your logged-in account can be collected. Missing or hidden fields stay blank.
- Keyword discovery depends on Facebook’s search ranking; it does not enumerate every matching profile.
- If Facebook shows a login page, a security checkpoint, or a "you're going too fast" block, the
  job **stops**, leaving the window open so you can deal with it. The extension never tries to bypass these.
- The delay between pages can't be set below 3 seconds.

## Things to know

- Automated collection breaks Facebook's Terms, so the account you scrape with can be restricted.
  Use modest limits and generous delays.
- Before contacting anyone from the data, follow the applicable rules: WhatsApp needs opt-in for
  business messages, India's TRAI/DND rules apply to calls and SMS, and GDPR applies to EU contacts.
- Facebook changes its layout regularly. If a field stops coming through, the patterns in
  `content/fb.js` (`parseProfile`) are what need updating. Run `node --test tests/*.test.js` after changes.
