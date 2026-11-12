# FB Page Scraper (Chrome extension)

Collects public contact details from Facebook **business pages** (name, category, email, phone,
WhatsApp, website, address, likes, followers, rating, Instagram) and exports them to CSV.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `fb-page-scraper` folder.
3. Pin the extension and click its icon to open the dashboard.

You must be logged in to facebook.com in the same Chrome profile.

## Use

- **Keyword search**: type something like `dentist in Pune`. The extension runs a Facebook Pages
  search, scrolls the results, then visits each page.
- **Page URLs**: paste one URL per line. Clicking the extension icon while viewing a Facebook page
  adds that page to the list.
- **Max pages / Delay**: how many pages per run and how long to wait between them (minimum 3 s).
- **Thorough mode**: also opens each page's home tab to pick up the intro text and rating. This
  doubles the page loads.
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
contact details. It falls back to the page's home tab when that tab has nothing. Extraction relies
on visible text and link patterns, not Facebook's CSS class names, which change frequently.

## Built-in safeguards

- Personal profiles are detected and skipped. Only business pages are saved.
- If Facebook shows a login page, a security checkpoint, or a "you're going too fast" block, the
  job **stops**, leaving the window open so you can deal with it. The extension never tries to bypass these.
- The delay between pages can't be set below 3 seconds.

## Things to know

- Automated collection breaks Facebook's Terms, so the account you scrape with can be restricted.
  Use modest limits and generous delays.
- Before contacting anyone from the data, follow the applicable rules: WhatsApp needs opt-in for
  business messages, India's TRAI/DND rules apply to calls and SMS, and GDPR applies to EU contacts.
- Facebook changes its layout regularly. If a field stops coming through, the patterns in
  `content/fb.js` (`parseProfile`) are what need updating. Run `node --test tests/fb.test.js` after changes.
