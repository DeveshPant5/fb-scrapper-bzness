# FB Page Scraper (Chrome extension)

Collects public contact details from **Facebook business Pages**, **Facebook profiles in
professional mode**, and **Instagram business and creator accounts**, and exports them to CSV.
It collects name, platform, type, category, email, phone, WhatsApp, website, address, likes,
followers, rating, intro/bio and links.

Professional mode is the Facebook setting that turns a personal account into a public creator or
business presence with a category, shown as `Profile · <category>` (for example
`Profile · Digital creator`). Many small businesses run on one of these instead of a Page.
Ordinary personal accounts are never saved, on either platform.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `fb-page-scraper` folder.
3. Pin the extension and click its icon to open the dashboard.

Be logged in to facebook.com and/or instagram.com in the same Chrome profile, depending on which
you scrape.

## Use

- **Keyword search**: choose **Facebook Pages** or **Instagram accounts**, then type a keyword.
  - Facebook: runs a Pages search such as `dentist in Pune`, scrolls the results, then visits each page.
  - Instagram: runs Instagram's account search. It matches account names and usernames (not bios
    or locations), so `dental clinic pune` works better than `dentist in Pune`. It returns about 50
    accounts at most per keyword. Private accounts are dropped straight away.
- **Page URLs**: paste one per line. Facebook and Instagram can be mixed:
  - Facebook: `facebook.com/name`, `profile.php?id=…`, `/people/Name/…`, or a bare `name`.
  - Instagram: `instagram.com/name` or `@name`.
  Clicking the extension icon while viewing a Facebook Page/profile or an Instagram account adds it
  to the list. Facebook keyword search only finds Pages, so Facebook professional profiles have to
  be added here.
- **Max pages / Delay**: how many accounts per run and how long to wait between them (minimum 3 s).
  Instagram rate-limits sooner than Facebook, so use 10 s or more there.
- **Thorough mode** (Facebook only): also opens each page's home tab to pick up the intro text and
  rating. This doubles the page loads.
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

**Facebook:** for each page the extension opens `/about_contact_and_basic_info`, where Facebook
shows labelled contact details. It also opens the home tab when the About tab has no contact details
or no category. Professional profiles sometimes show their `Profile · <category>` line only on the
home tab. Extraction relies on visible text and link patterns, not Facebook's CSS class names, which
change frequently.

**Instagram:** the web page shows little as plain text, so the scraper window opens instagram.com
once and, for each account, calls the endpoints instagram.com itself uses, with your logged-in session:

1. `/api/v1/users/web_profile_info/?username=…` returns the name, bio, links, followers, category,
   and whether it's a business or creator account.
2. `/api/v1/users/<id>/info/` returns the email/phone behind the profile's **Contact** button. It's
   only called for business and creator accounts that didn't already include both.

Emails, phone/WhatsApp numbers (10+ digits) and explicit links (`http…`, `www…`, `wa.me/…`) written
in the bio are picked up too.

## Built-in safeguards

- **Facebook**: a record is saved only when the extension sees a `Page · <category>` or
  `Profile · <category>` line, or a labelled Category. Anything else is skipped, including personal
  profiles that hide their friend controls (for example when you're already friends or their friend
  list is hidden).
- **Instagram**: only accounts Instagram marks as business or creator (professional) accounts are
  saved. For personal and private accounts nothing beyond that check is requested, and nothing is kept.
- If either site shows a login page, a security checkpoint, or a "you're going too fast" / "please
  wait a few minutes" block, the job **stops**, leaving the window open so you can deal with it. The
  extension never tries to bypass these.
- The delay between accounts can't be set below 3 seconds.

## Things to know

- Automated collection breaks Facebook's and Instagram's Terms, so the account you scrape with can
  be restricted. Use modest limits and generous delays.
- Before contacting anyone from the data, follow the applicable rules: WhatsApp needs opt-in for
  business messages, India's TRAI/DND rules apply to calls and SMS, and GDPR applies to EU contacts.
- Both sites change regularly. If a Facebook field stops coming through, update the patterns in
  `content/fb.js` (`parseProfile`). If Instagram starts failing with "without JSON" or every account
  is "not found", the endpoints or field names in `content/ig.js` (`extractProfile`, `parseIgUser`)
  need updating. Run `node --test tests/*.test.js` after changes.
