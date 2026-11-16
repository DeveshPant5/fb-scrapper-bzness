# FB Page Scraper (Chrome extension)

Collects public contact details from Facebook **pages and public profiles**, including companies,
organizations, creators, and people. Collects name, age, gender, relationship status, current
location, category, email, phone, WhatsApp, website, address, audience counts, bio, and social
links, plus Instagram business and creator accounts, and exports them in a consistent CSV format.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `fb-page-scraper` folder.
3. Pin the extension and click its icon to open the dashboard.

Be logged in to facebook.com and/or instagram.com in the same Chrome profile, depending on which
you scrape.

## Use

- **Keyword search**: choose **Facebook pages and profiles** or **Instagram accounts**, then type a keyword.
  - Facebook: runs a general search across pages and profiles such as `dentist in Pune`, scrolls the results, then visits each result.
  - Instagram: runs Instagram's account search. It matches account names and usernames (not bios
    or locations), so `dental clinic pune` works better than `dentist in Pune`. It returns about 50
    accounts at most per keyword. Private accounts are dropped straight away.
- **Profile / page URLs**: paste one per line. Facebook and Instagram can be mixed:
  - Facebook: `facebook.com/name`, `profile.php?id=…`, `/people/Name/…`, or a bare `name`.
  - Instagram: `instagram.com/name` or `@name`.
  Clicking the extension icon while viewing a Facebook Page/profile or an Instagram account adds it
  to the list. Paste direct URLs when a target does not appear in search.
- **Max pages / Delay**: how many accounts per run and how long to wait between them (minimum 3 s).
  Instagram rate-limits sooner than Facebook, so use 10 s or more there.
- **Thorough mode** (Facebook only): also opens each page's home tab to pick up the intro text and
  rating. Without it, the home tab is visited when About has no bio or contact details.
- **Export CSV**: downloads everything in the Data Report (UTF-8, opens in Excel or Google Sheets).
  The **Platform** and **Type** columns tell the records apart.

A separate window opens and does the browsing. Keep it visible (not minimised) while a job runs,
because Facebook doesn't render content in hidden windows.

## How it works

| File | Role |
|---|---|
| `background.js` | Service worker. Opens the scraper window, runs the job queue, and saves results to `chrome.storage`. |
| `content/fb.js` | Injected into Facebook tabs. Reads the visible text and links of a page and turns them into fields. Also holds helpers shared with `ig.js`. |
| `content/ig.js` | Injected into Instagram tabs (after `fb.js`). Reads profiles through instagram.com's own JSON endpoints. |
| `dashboard.*` | The UI. Sends start/stop commands and renders progress and data from storage. |

For each Facebook target the extension reads `/about_contact_and_basic_info` and `/about`. For profiles,
it also reads `/about_family_and_relationships` when relationship status is missing and
`/about_places` when current location is missing. Pages skip these personal-profile tabs.
The home tab fills missing bio or contact details and is always visited in thorough mode.
More profile tabs mean more page loads per target.

Extraction uses visible text, labelled fields, and links. It supports labels before, after,
or inline with values. Post articles and their links are removed before parsing profile details.

**Instagram:** the web page shows little as plain text, so the scraper window opens instagram.com
once and, for each account, calls the endpoints instagram.com itself uses, with your logged-in session:

1. `/api/v1/users/web_profile_info/?username=…` returns the name, bio, links, followers, category,
   and whether it's a business or creator account.
2. `/api/v1/users/<id>/info/` returns the email/phone behind the profile's **Contact** button. It's
   only called for business and creator accounts that didn't already include both.

Emails, phone/WhatsApp numbers (10+ digits) and explicit links (`http…`, `www…`, `wa.me/…`) written
in the bio are picked up too.

## Profile fields and export format

The report and CSV share the same 23 columns, with one row per profile or page:

| Fields | Format and source |
|---|---|
| Name, Platform, Type, Profile Type | Displayed name; `Page` or `Profile` when identifiable, plus platform and professional account type. |
| Age | Whole years, from an explicit age or a complete labelled birth date. Separate birthday and birth-year fields can be combined. Missing years and ambiguous numeric dates remain blank. Birth dates are not saved or exported. |
| Gender | Recognized, explicitly displayed English gender values; preserved as displayed. |
| Relationship Status | Explicit status such as Single or Married; partner names are excluded. |
| Current Location | Explicit current city, current location, or Lives in / Based in text. Hometown is not treated as current location. |
| Category, Bio / Intro, Address | Displayed profile description and address; address stays separate from current city. |
| Email, Phone, WhatsApp, Website, Instagram, Other Links | Multiple values use ` \| ` in the same cell. Country codes are preserved; no country code is guessed for local numbers. |
| Likes, Followers, Rating | Displayed values, including abbreviations such as `4.5K`; not precise audience measurements. |
| Profile URL, Source Search, Scraped At (UTC) | Canonical target URL, keyword used for the latest scrape (blank for pasted URLs), and ISO 8601 UTC timestamp. Age is current as of this scrape. |

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
- Instagram: only business and creator accounts are saved; personal and private accounts are skipped.
- If either site shows a login page, a security checkpoint, or a "you're going too fast" block, the
  job **stops**, leaving the window open so you can deal with it. The extension never tries to bypass these.
- The delay between pages can't be set below 3 seconds.

## Things to know

- Automated collection breaks Facebook's and Instagram's Terms, so the account you scrape with can
  be restricted. Use modest limits and generous delays.
- Before contacting anyone from the data, follow the applicable rules: WhatsApp needs opt-in for
  business messages, India's TRAI/DND rules apply to calls and SMS, and GDPR applies to EU contacts.
- Both sites change regularly. If a Facebook field stops coming through, update the patterns in
  `content/fb.js` (`parseProfile`). If Instagram starts failing with "without JSON" or every account
  is "not found", the endpoints or field names in `content/ig.js` (`extractProfile`, `parseIgUser`)
  need updating. Run `node --test tests/*.test.js` after changes.
