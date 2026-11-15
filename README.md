# FB Page Scraper (Chrome extension)

Collects public contact details from Facebook **pages and public profiles**, including companies,
organizations, creators, and people. Collects name, age, gender, relationship status, current
location, category, email, phone, WhatsApp, website, address, audience counts, bio, and social
links, and exports them in a consistent CSV format.

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
- **Thorough mode**: always opens the home tab for additional bio and rating details. Without it,
  the home tab is visited when About has no bio or contact details.
- **Export CSV**: downloads everything in the Data Report (UTF-8, opens in Excel or Google Sheets).

A separate window opens and does the browsing. Keep it visible (not minimised) while a job runs,
because Facebook doesn't render content in hidden windows.

## How it works

| File | Role |
|---|---|
| `background.js` | Service worker. Opens the scraper window, runs the job queue, and saves results to `chrome.storage`. |
| `content/fb.js` | Injected into Facebook tabs. Reads the visible text and links of a page and turns them into fields. |
| `dashboard.*` | The UI. Sends start/stop commands and renders progress and data from storage. |

For each target the extension reads `/about_contact_and_basic_info` and `/about`. For profiles,
it also reads `/about_family_and_relationships` when relationship status is missing and
`/about_places` when current location is missing. Pages skip these personal-profile tabs.
The home tab fills missing bio or contact details and is always visited in thorough mode.
More profile tabs mean more page loads per target.

Extraction uses visible text, labelled fields, and links. It supports labels before, after,
or inline with values. Post articles and their links are removed before parsing profile details.

## Profile fields and export format

The report and CSV share the same 21 columns, with one row per profile or page:

| Fields | Format and source |
|---|---|
| Name, Profile Type | Displayed name; `Page` or `Profile` when identifiable. |
| Age | Whole years, from an explicit age or a complete labelled birth date. Separate birthday and birth-year fields can be combined. Missing years and ambiguous numeric dates remain blank. Birth dates are not saved or exported. |
| Gender | Recognized, explicitly displayed English gender values; preserved as displayed. |
| Relationship Status | Explicit status such as Single or Married; partner names are excluded. |
| Current Location | Explicit current city, current location, or Lives in / Based in text. Hometown is not treated as current location. |
| Category, Bio / Intro, Address | Displayed profile description and address; address stays separate from current city. |
| Email, Phone, WhatsApp, Website, Instagram, Other Links | Multiple values use ` \| ` in the same cell. Country codes are preserved; no country code is guessed for local numbers. |
| Likes, Followers, Rating | Displayed values, including abbreviations such as `4.5K`; not precise audience measurements. |
| Facebook URL, Source Search, Scraped At (UTC) | Canonical target URL, keyword used for the latest scrape (blank for pasted URLs), and ISO 8601 UTC timestamp. Age is current as of this scrape. |

Unknown, hidden, or unsupported fields show `—` in the report and empty cells in CSV. CSV uses
UTF-8 with a BOM, quoted fields where needed, and protection against spreadsheet formulas.
Import phone columns as text in spreadsheet software to preserve leading `+` and zeros.

Existing saved rows remain readable. To populate new fields, reload the extension, turn off
**Skip entries already in the Data Report**, and scrape those targets again. A successful
rescrape replaces collected fields, including clearing values no longer visible, so old
relationship or contact details do not masquerade as the latest information.

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
