/*
 * FB Page Scraper — shared logic.
 *
 * Loaded in three places:
 *   1. Injected into facebook.com tabs (extension isolated world) to read page data.
 *   2. background.js via importScripts() for URL/record helpers.
 *   3. dashboard.html for URL helpers.
 *
 * Must stay a classic script (no import/export). DOM is only touched inside
 * functions that run in the Facebook tab.
 */
(function () {
  'use strict';
  if (globalThis.FBScraper) return;

  const FB = 'https://www.facebook.com';

  // First path segments that are Facebook features, never profiles or pages.
  const RESERVED = new Set([
    'about', 'ads', 'adsmanager', 'ajax', 'api', 'bookmarks', 'business', 'business_help',
    'campaign', 'careers', 'checkpoint', 'commerce', 'composer', 'cookie', 'cookies',
    'developers', 'dialog', 'events', 'feeds', 'find-friends', 'friends', 'fundraisers',
    'games', 'gaming', 'groups', 'hashtag', 'help', 'home.php', 'instantgames', 'jobs',
    'l.php', 'latest', 'legal', 'lists', 'live', 'login', 'login.php', 'logout.php',
    'marketplace', 'me', 'media', 'memories', 'menu', 'messages', 'messenger_media', 'notes',
    'notifications', 'offers', 'onthisday', 'pay', 'permalink.php', 'photo', 'photo.php',
    'photos', 'places', 'plugins', 'policies', 'policy.php', 'privacy', 'professional_dashboard',
    'r.php', 'recover', 'reel', 'reels', 'reg', 'saved', 'search', 'settings', 'share',
    'share.php', 'sharer', 'sharer.php', 'shops', 'stories', 'story.php', 'terms', 'terms.php',
    'topic', 'trending', 'tv', 'video.php', 'videos', 'watch', 'weather',
  ]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const decodeSafe = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };

  // Facebook wraps phone numbers etc. in bidi control characters; strip them.
  const cleanLine = (s) =>
    String(s || '')
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  // ---------------------------------------------------------------- URLs

  const profileUrl = (id) => `${FB}/profile.php?id=${id}`;

  /** Canonical page URL (www.facebook.com/<slug> or profile.php?id=<id>), or null. */
  function normalizePageUrl(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^((www|m|web|mbasic|business)\.)?(facebook|fb)\.com(\/|$)/i.test(s)) s = 'https://' + s;
      else if (/^@?[A-Za-z0-9.]{3,}$/.test(s)) s = `${FB}/${s.replace(/^@/, '')}`;
      else return null;
    }
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!/(^|\.)(facebook|fb)\.com$/i.test(u.hostname)) return null;

    const parts = u.pathname.split('/').filter(Boolean).map(decodeSafe);
    if (!parts.length) return null;
    const first = parts[0].toLowerCase();

    if (first === 'profile.php') {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? profileUrl(id) : null;
    }
    // /p/Name-1000…/, /people/Name/1000…/, /pages/Name/1234…/
    if (first === 'p' || first === 'people' || first === 'pages') {
      for (let i = parts.length - 1; i >= 1; i--) {
        const m = parts[i].match(/(?:^|-)(\d{6,})$/);
        if (m) return profileUrl(m[1]);
      }
      return null;
    }
    const slug = first === 'pg' ? parts[1] : parts[0];
    if (!slug || RESERVED.has(slug.toLowerCase())) return null;
    if (/^\d{6,}$/.test(slug)) return profileUrl(slug);
    if (!/^[A-Za-z0-9.-]+$/.test(slug)) return null;
    return `${FB}/${slug}`;
  }

  const pageKey = (url) => (normalizePageUrl(url) || String(url || '')).toLowerCase();

  /** Contact tab first; the general About tab supports other profile layouts. */
  function aboutUrl(canon, tab = 'about_contact_and_basic_info') {
    const u = new URL(canon);
    const id = u.searchParams.get('id');
    if (u.pathname === '/profile.php' && id) {
      return `${FB}/profile.php?id=${id}&sk=${tab}`;
    }
    return `${canon.replace(/\/+$/, '')}/${tab}`;
  }

  // ------------------------------------------------------- text patterns

  const EMAIL_G = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
  const EMAIL_ONE = /^[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}$/i;
  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  const COUNT = String.raw`(\d[\d.,]*\s?[KMB]?)`;

  const digitCount = (s) => (s.match(/\d/g) || []).length;

  function isPhoneLike(s) {
    s = cleanLine(s);
    if (!/^\+?[\d(][\d\s\-().]{5,22}\d$/.test(s)) return false;
    const d = digitCount(s);
    if (d < 7 || d > 15) return false;
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(s)) return false; // a date
    return true;
  }

  function isUrlLike(s) {
    return (
      !/\s|@/.test(s) &&
      /^(https?:\/\/)?(www\.)?[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s)
    );
  }

  function isAddressLike(s) {
    if (s.length < 8 || s.length > 250) return false;
    if (s.includes('@') || isUrlLike(s) || isPhoneLike(s)) return false;
    if (/[·•]|\b(likes?|followers?|following|reviews?|rating|recommend|open now|closed now|hours|price range|always open)\b/i.test(s)) return false;
    const comma = s.includes(',');
    const postcode = /\b\d{5,6}\b/.test(s) || /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(s);
    const street = /\b(road|rd|street|st|avenue|ave|lane|ln|nagar|sector|floor|plot|near|opp|opposite|building|bldg|marg|chowk|colony|block|suite|blvd|boulevard|highway|hwy|market|complex|tower|plaza|square|park|mall)\b/i.test(s);
    return (comma && (postcode || street || /\d/.test(s))) || (postcode && street);
  }

  // ----------------------------------------------------------- links

  const FB_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|fb\.watch|fbcdn\.net|messenger\.com|m\.me|meta\.com)$/i;
  const SOCIAL_HOSTS = /(^|\.)(twitter\.com|x\.com|youtube\.com|youtu\.be|linkedin\.com|tiktok\.com|pinterest\.[a-z.]+|t\.me|telegram\.me|snapchat\.com|threads\.net)$/i;

  function cleanUrl(href) {
    try {
      const u = new URL(href);
      ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) =>
        u.searchParams.delete(k)
      );
      return u.href;
    } catch {
      return href;
    }
  }

  /** Undo Facebook's l.facebook.com/l.php?u=… and Instagram's l.instagram.com/?u=… redirect wrappers. */
  function unwrapLink(href) {
    try {
      const u = new URL(href, FB);
      if (
        (/^(l|lm)\.facebook\.com$/i.test(u.hostname) && u.pathname.startsWith('/l.php')) ||
        /^l\.instagram\.com$/i.test(u.hostname)
      ) {
        const target = u.searchParams.get('u');
        return target ? cleanUrl(target) : null;
      }
      return u.protocol.startsWith('http') ? cleanUrl(u.href) : u.href;
    } catch {
      return null;
    }
  }

  function isMapUrl(u) {
    const h = u.hostname.toLowerCase();
    const p = u.pathname;
    return (
      (/(^|\.)bing\.com$/.test(h) && /^\/maps/i.test(p)) ||
      (/(^|\.)google\.[a-z.]+$/.test(h) && /^\/maps/i.test(p)) ||
      /^maps\.google\./.test(h) ||
      h === 'maps.app.goo.gl' ||
      (h === 'goo.gl' && /^\/maps/.test(p)) ||
      h === 'maps.apple.com' ||
      /(^|\.)here\.com$/.test(h) ||
      /(^|\.)openstreetmap\.org$/.test(h)
    );
  }

  function classifyLink(rawHref) {
    const href = unwrapLink(rawHref);
    if (!href) return null;
    if (/^mailto:/i.test(href)) {
      const e = decodeSafe(href.slice(7).split('?')[0]).trim();
      return EMAIL_ONE.test(e) ? { type: 'email', value: e } : null;
    }
    if (/^tel:/i.test(href)) {
      const t = cleanLine(decodeSafe(href.slice(4)));
      return isPhoneLike(t) ? { type: 'phone', value: t } : null;
    }
    let u;
    try { u = new URL(href); } catch { return null; }
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'whatsapp:' || /^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|(www\.)?whatsapp\.com)$/.test(host)) {
      let digits = '';
      if (host === 'wa.me') digits = (u.pathname.match(/^\/(\d{7,15})\b/) || [])[1] || '';
      else digits = (u.searchParams.get('phone') || '').replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 ? { type: 'whatsapp', value: '+' + digits } : null;
    }
    if (!/^https?:$/.test(u.protocol) || FB_HOSTS.test(host)) return null;
    if (/(^|\.)instagram\.com$/.test(host)) return { type: 'instagram', value: cleanUrl(u.href) };
    if (isMapUrl(u)) return { type: 'map', value: cleanUrl(u.href) };
    if (SOCIAL_HOSTS.test(host)) return { type: 'social', value: cleanUrl(u.href) };
    return { type: 'web', value: cleanUrl(u.href) };
  }

  // --------------------------------------------------------- parsing

  const LIST_FIELDS = ['emails', 'phones', 'whatsapp', 'websites', 'instagram', 'otherLinks'];
  const TEXT_FIELDS = ['platform', 'kind', 'name', 'profileType', 'age', 'gender', 'relationshipStatus', 'location', 'category', 'address', 'likes', 'followers', 'rating', 'intro'];

  const REPORT_COLUMNS = [
    ['name', 'Name'], ['platform', 'Platform'], ['kind', 'Type'], ['profileType', 'Profile Type'], ['age', 'Age'], ['gender', 'Gender'],
    ['relationshipStatus', 'Relationship Status'], ['location', 'Current Location'],
    ['category', 'Category'], ['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'],
    ['website', 'Website'], ['address', 'Address'], ['likes', 'Likes (displayed)'],
    ['followers', 'Followers (displayed)'], ['rating', 'Rating'], ['instagram', 'Instagram'],
    ['otherLinks', 'Other Links'], ['intro', 'Bio / Intro'], ['pageUrl', 'Profile URL'],
    ['sourceQuery', 'Source Search'], ['scrapedAt', 'Scraped At (UTC)'],
  ];

  // What kind of account a record came from.
  const KIND_PAGE = 'Page';
  const KIND_PRO = 'Professional profile';

  // "Page · Dentist & dental office" on Pages, "Profile · Digital creator" on profiles in
  // professional mode. The category distinguishes professional profiles.
  const KIND_LINE = /^(Page|Profile)\s*[·•]\s*(.+)$/i;

  function readKindLine(l) {
    const m = l.match(KIND_LINE);
    return m ? { kind: /^profile$/i.test(m[1]) ? KIND_PRO : KIND_PAGE, category: m[2].trim() } : null;
  }

  function valueKey(field, v) {
    const s = String(v).trim().toLowerCase();
    if (field === 'phones' || field === 'whatsapp') return s.replace(/\D/g, '');
    if (field === 'emails') return s;
    return s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }

  function emptyParsed() {
    const r = { isPersonal: false };
    LIST_FIELDS.forEach((f) => (r[f] = []));
    TEXT_FIELDS.forEach((f) => (r[f] = ''));
    return r;
  }

  function addValue(r, field, v) {
    v = cleanLine(v);
    if (!v) return;
    const k = valueKey(field, v);
    if (!k || r[field].some((x) => valueKey(field, x) === k)) return;
    r[field].push(v);
  }

  // Section headings that start / end the parts of the page that hold contact details.
  const SECTION_START = /^(Intro|Bio|Details|Categor(?:y|ies)|Contact(?: and basic)? info(?:rmation)?|Contact details|Websites?(?: and social links)?|Social links)$/i;
  const SECTION_STOP = /^(Basic info|Privacy and legal info|Page transparency|Photos|Featured|Posts|Reviews|Life events|Places lived|Family and relationships|Work and education|See all photos|Videos|Reels|Mentions|Followers|Following|Friends)$/i;
  const DETAIL_START = /^(Intro|Bio|Details|Overview|Basic info|Personal details|Contact and basic info|Places lived|Family and relationships|Relationship(?: status)?)$/i;
  const DETAIL_FIELDS = new Set(['age', 'birthDate', 'birthYear', 'gender', 'relationshipStatus', 'location']);
  const RELATIONSHIP = /^(Single|In a relationship|Engaged|Married|In a civil union|In a domestic partnership|In an open relationship|It['’]s complicated|Separated|Divorced|Widowed)(?=$|\s+(?:with|to|since)\b)/i;

  /** Line indexes inside the contact sections (falls back to the first 80 lines). */
  function scopeIndexes(lines, starts = SECTION_START) {
    const idx = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (!starts.test(lines[i])) continue;
      for (let j = i + 1; j < lines.length; j++) {
        if (starts.test(lines[j]) || SECTION_STOP.test(lines[j])) break;
        idx.add(j);
      }
    }
    if (!idx.size) {
      for (let j = 0; j < Math.min(lines.length, 80); j++) {
        if (/^(Posts|Photos|Reviews|Reels|Videos)$/i.test(lines[j])) break;
        idx.add(j);
      }
    }
    return idx;
  }

  // Labels can appear before or after a value, or inline ("Email: …").
  const LABELS = [
    ['whatsapp', /^whatsapp$/i],
    ['phones', /^(mobile|phone(?: number)?|work|home|main|office|landline|telephone|tel)$/i],
    ['emails', /^e-?mail(?: address)?$/i],
    ['websites', /^websites?$/i],
    ['address', /^address$/i],
    ['instagram', /^instagram$/i],
    ['category', /^categor(?:y|ies)$/i],
    ['age', /^age$/i],
    ['birthDate', /^(birthday|birth date|date of birth)$/i],
    ['birthYear', /^birth year$/i],
    ['gender', /^gender$/i],
    ['relationshipStatus', /^(relationship(?: status)?|marital status)$/i],
    ['location', /^(current city|current location|location)$/i],
  ];

  /** Calculate age only from a full, unambiguous, explicitly labelled birth date. */
  function ageFromBirthDate(value, today = new Date()) {
    const text = cleanLine(value);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const named = text.match(/^(?:([A-Za-z]+)\s+(\d{1,2}),?|(?:(\d{1,2})\s+([A-Za-z]+)))\s+(\d{4})$/);
    if (!iso && !named) return '';
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const year = Number(iso ? iso[1] : named[5]);
    const month = iso ? Number(iso[2]) - 1 : months.indexOf((named[1] || named[4]).toLowerCase());
    const day = Number(iso ? iso[3] : named[2] || named[3]);
    const born = new Date(Date.UTC(year, month, day));
    if (month < 0 || born.getUTCFullYear() !== year || born.getUTCMonth() !== month || born.getUTCDate() !== day) return '';
    let age = today.getUTCFullYear() - year;
    if (today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day)) age--;
    return born <= today && age >= 0 && age <= 120 ? String(age) : '';
  }

  /**
   * Pure function: turns the visible text lines + links of a Facebook page into fields.
   * @param {{lines: string[], links?: {href: string, text: string}[], h1?: string, title?: string}} input
   */
  function parseProfile({ lines, links = [], h1 = '', title = '' }) {
    lines = lines.map(cleanLine).filter(Boolean);
    const r = emptyParsed();
    r.platform = 'Facebook';
    const all = lines.join('\n');
    const scope = scopeIndexes(lines);
    const details = scopeIndexes(lines, DETAIL_START);
    const scopeText = new Set([...scope].map((i) => lines[i]));
    const assigned = new Set();
    let birthDate = '';
    let birthYear = '';

    // Name
    r.name = cleanLine(h1) ||
      cleanLine(title).replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|·-]\s*Facebook\s*$/i, '').replace(/^Facebook$/i, '');

    // Header counts and rating
    let m;
    if ((m = all.match(new RegExp(COUNT + String.raw`\s+(?:likes?\b|people like this)`, 'i')))) r.likes = m[1].replace(/\s/g, '');
    if ((m = all.match(new RegExp(COUNT + String.raw`\s+(?:followers\b|people follow this)`, 'i')))) r.followers = m[1].replace(/\s/g, '');
    if ((m = all.match(/Rating\s*[·•]\s*([\d.]+)\s*\(([\d,.]+\s*K?)\s*Reviews?\)/i))) r.rating = `${m[1]} (${m[2].trim()} reviews)`;
    else if ((m = all.match(/(\d{1,3}%\s*recommend)\s*\(([\d,.]+\s*K?)\s*Reviews?\)/i))) r.rating = `${m[1].replace(/\s+/g, ' ')} (${m[2].trim()} reviews)`;
    else {
      const line = lines.find((l) => /^[0-5](\.\d)?\s*\(([\d,.]+\s*K?)\s*reviews?\)$/i.test(l));
      if (line) r.rating = line.replace(/reviews?/i, 'reviews');
    }

    // Pages and professional profiles expose categories in the header.
    for (const l of lines) {
      const k = readKindLine(l);
      if (k) {
        r.kind = k.kind;
        r.profileType = k.kind === KIND_PAGE ? 'Page' : 'Profile';
        r.category = k.category;
        break;
      }
    }

    // Keep contact links inside profile sections, away from posts and comments.
    for (const { href, text } of links) {
      const c = classifyLink(href);
      if (!c) continue;
      const t = cleanLine(text);
      if (!scopeText.has(t) && !String(text || '').split('\n').some((l) => scopeText.has(cleanLine(l)))) continue;
      if (c.type === 'email') addValue(r, 'emails', c.value);
      else if (c.type === 'phone') addValue(r, 'phones', c.value);
      else if (c.type === 'whatsapp') addValue(r, 'whatsapp', c.value);
      else if (c.type === 'web') addValue(r, 'websites', c.value);
      else if (c.type === 'instagram') addValue(r, 'instagram', c.value);
      else if (c.type === 'social') addValue(r, 'otherLinks', c.value);
      else if (c.type === 'map' && !r.address && t.length > 5 && !isPhoneLike(t)) r.address = t;
    }

    // Try the legacy value-before-label order first, then label-before-value.
    for (let i = 0; i < lines.length; i++) {
      const inline = lines[i].match(/^([^:：]+)[:：]\s*(.+)$/);
      const label = inline ? inline[1].trim() : lines[i];
      for (const [field, re] of LABELS) {
        if (!re.test(label)) continue;
        const indexes = DETAIL_FIELDS.has(field) ? details : scope;
        if (!indexes.has(i) && !SECTION_START.test(label) && !DETAIL_START.test(label)) continue;
        const candidates = inline ? [[i, inline[2]]] : [[i - 1, lines[i - 1]], [i + 1, lines[i + 1]]];
        for (const [index, raw] of candidates) {
          let v = raw;
          if (!indexes.has(index)) continue;
          if (!v || assigned.has(index) || SECTION_START.test(v) || SECTION_STOP.test(v) || /^(About|More)$/i.test(v) || LABELS.some(([, pattern]) => pattern.test(v))) continue;
          let ok = false;
          if (field === 'phones' || field === 'whatsapp') ok = isPhoneLike(v);
          else if (field === 'emails') ok = EMAIL_ONE.test(v);
          else if (field === 'websites') ok = isUrlLike(v);
          else if (field === 'instagram') ok = /^@?[\w.]{2,30}$/.test(v) || /instagram\.com\//i.test(v);
          else if (field === 'address') ok = v.length >= 5 && v.length <= 250 && !isPhoneLike(v) && !EMAIL_ONE.test(v) && !isUrlLike(v);
          else if (field === 'category') ok = v.length <= 120;
          else if (field === 'age') {
            v = v.replace(/\s+years?\s+old$/i, '');
            ok = /^(?:\d|[1-9]\d|1[01]\d|120)$/.test(v);
          }
          else if (field === 'birthDate') ok = !!ageFromBirthDate(v) || /^(?:[A-Za-z]+\s+\d{1,2}|\d{1,2}\s+[A-Za-z]+)$/.test(v);
          else if (field === 'birthYear') ok = /^\d{4}$/.test(v);
          else if (field === 'gender') ok = /^(female|male|woman|man|non[- ]?binary|agender|genderfluid|genderqueer|(?:trans|transgender|cis|cisgender)(?: (?:woman|man|female|male))?|other|custom|prefer not to say)$/i.test(v);
          else if (field === 'relationshipStatus') {
            v = (v.match(RELATIONSHIP) || [])[1] || '';
            ok = !!v;
          }
          else if (field === 'location') ok = v.length >= 2 && v.length <= 250 && !isPhoneLike(v) && !EMAIL_ONE.test(v) && !isUrlLike(v);
          if (!ok) continue;
          assigned.add(index);
          if (field === 'address') { if (!r.address) r.address = v; }
          else if (field === 'category') {
            if (!r.category) {
              const k = readKindLine(v);
              r.category = k ? k.category : v;
              if (k) { r.kind = k.kind; r.profileType = k.kind === KIND_PAGE ? 'Page' : 'Profile'; }
            }
          }
          else if (field === 'birthDate') { if (!birthDate) birthDate = v; }
          else if (field === 'birthYear') { if (!birthYear) birthYear = v; }
          else if (DETAIL_FIELDS.has(field)) { if (!r[field]) r[field] = v; }
          else if (field === 'websites') addValue(r, 'websites', /^https?:\/\//i.test(v) ? v : 'https://' + v);
          else if (field === 'instagram') addValue(r, 'instagram', /instagram\.com\//i.test(v) ? v : `https://www.instagram.com/${v.replace(/^@/, '')}`);
          else addValue(r, field, v);
          break;
        }
        break;
      }
    }

    if (!r.age && birthDate) r.age = ageFromBirthDate(birthDate) || ageFromBirthDate(`${birthDate} ${birthYear}`);

    // Unlabelled values inside the contact sections (main page "Intro" card).
    for (const i of [...scope].sort((a, b) => a - b)) {
      if (assigned.has(i)) continue;
      const l = lines[i];
      if (/^(?:Page|Profile)\s*[·•]/i.test(l) || EMAIL_ONE.test(l)) continue;
      if (isPhoneLike(l)) { addValue(r, 'phones', l); continue; }
      if (isUrlLike(l)) {
        const c = classifyLink(/^https?:\/\//i.test(l) ? l : 'https://' + l);
        if (c && c.type === 'web') addValue(r, 'websites', c.value);
        else if (c && c.type === 'instagram') addValue(r, 'instagram', c.value);
        else if (c && c.type === 'social') addValue(r, 'otherLinks', c.value);
        continue;
      }
      if (!r.address && isAddressLike(l)) r.address = l;
    }

    // Emails from profile contact sections, excluding post and comment text.
    for (const e of [...scope].map((i) => lines[i]).join('\n').match(EMAIL_G) || []) {
      const v = e.replace(/\.+$/, '');
      if (!IMG_EXT.test(v)) addValue(r, 'emails', v);
    }

    for (const i of details) {
      const l = lines[i];
      if (!r.location && (m = l.match(/^(?:Lives in|Based in)\s+(.+)$/i))) r.location = m[1].trim();
      if (!r.age && (m = l.match(/^(\d{1,3})\s+years?\s+old$/i)) && Number(m[1]) <= 120) r.age = String(Number(m[1]));
      if (!r.relationshipStatus && /^Relationship(?: status)?$/i.test(lines[i - 1] || '') && (m = l.match(RELATIONSHIP))) r.relationshipStatus = m[1];
    }

    // Intro / bio: the first line of the "Intro" card when it's free text.
    const introAt = lines.findIndex((l) => /^(Intro|Bio)$/i.test(l));
    if (introAt >= 0 && lines[introAt + 1] && !assigned.has(introAt + 1)) {
      const l = lines[introAt + 1];
      if (l.length >= 15 && !/^(?:Page|Profile)\s*[·•]/i.test(l) && !SECTION_START.test(l) && !SECTION_STOP.test(l) && !isPhoneLike(l) && !isUrlLike(l) && !EMAIL_ONE.test(l) && !isAddressLike(l)) {
        r.intro = l;
      }
    }

    // Retain this classification without excluding public personal profiles.
    r.isPersonal =
      !r.category &&
      lines.some((l) => /^Add friend$/i.test(l) || /^[\d.,]+\s*K?\s+(mutual\s+)?friends$/i.test(l));
    if (r.isPersonal && !r.profileType) r.profileType = 'Profile';
    if (r.category && !r.kind && r.profileType === 'Profile') r.kind = KIND_PRO;

    return r;
  }

  function mergeParsed(a, b) {
    if (!a) return b;
    if (!b) return a;
    const r = emptyParsed();
    LIST_FIELDS.forEach((f) => [...a[f], ...b[f]].forEach((v) => addValue(r, f, v)));
    TEXT_FIELDS.forEach((f) => (r[f] = a[f] || b[f]));
    // Pages never show "Profile ·" or friend controls, so a profile signal from either visit wins.
    if (a.kind === KIND_PRO || b.kind === KIND_PRO) r.kind = KIND_PRO;
    r.isPersonal = !r.category && (a.isPersonal || b.isPersonal);
    return r;
  }

  const hasContact = (d) =>
    !!d && (d.emails.length || d.phones.length || d.whatsapp.length || d.websites.length) > 0;

  /** Whether a Page or professional-mode category has been seen. */
  const isBusiness = (d) => !!d && !!d.category;

  function toRecord(canon, d) {
    const j = (arr) => arr.join(' | ');
    return {
      key: canon.toLowerCase(),
      pageUrl: canon,
      platform: d.platform || 'Facebook',
      name: d.name,
      profileType: d.profileType,
      age: d.age,
      gender: d.gender,
      relationshipStatus: d.relationshipStatus,
      location: d.location,
      kind: d.kind,
      category: d.category,
      email: j(d.emails),
      phone: j(d.phones),
      whatsapp: j(d.whatsapp),
      website: j(d.websites),
      address: d.address,
      likes: d.likes,
      followers: d.followers,
      rating: d.rating,
      instagram: j(d.instagram),
      otherLinks: j(d.otherLinks),
      intro: d.intro,
      sourceQuery: '',
      scrapedAt: new Date().toISOString(),
    };
  }

  function csvCell(value, key) {
    let s = value == null ? '' : String(value);
    const phone = (key === 'phone' || key === 'whatsapp') && s.split(' | ').every(isPhoneLike);
    if (/^[\t\r\n]/.test(s) || (/^\s*[=+\-@]/.test(s) && !phone)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(records) {
    const rows = [REPORT_COLUMNS.map(([, header]) => header).join(',')];
    for (const record of records) rows.push(REPORT_COLUMNS.map(([key]) => csvCell(key === 'platform' ? record.platform || 'Facebook' : record[key], key)).join(','));
    return '\uFEFF' + rows.join('\r\n');
  }

  // ------------------------------------------- DOM (Facebook tab only)

  async function waitFor(fn, timeout = 12000, step = 400) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        const v = fn();
        if (v) return v;
      } catch { /* keep waiting */ }
      await sleep(step);
    }
    return null;
  }

  /** 'login' | 'checkpoint' | 'rate_limited' | null */
  function detectBlock() {
    const href = location.href;
    if (/\/checkpoint\b|\/two_step_verification|\/captcha/i.test(href)) return 'checkpoint';
    if (/facebook\.com\/(login(\.php)?|recover)\b/i.test(href)) return 'login';
    if (!document.querySelector('[role="main"]') && document.querySelector('input[name="pass"]')) return 'login';
    const text = ((document.body && document.body.innerText) || '').slice(0, 5000);
    if (/temporarily blocked|you can[’']t use this feature right now|temporarily restricted|we limit how often|misusing this feature by going too fast/i.test(text)) {
      return 'rate_limited';
    }
    return null;
  }

  function looksNotFound(el) {
    const t = ((el && el.innerText) || '').slice(0, 1500);
    return /this content isn[’']t available|this page isn[’']t available|the link you followed may be broken|page not found/i.test(t);
  }

  /** Reads the currently loaded page/profile tab. */
  async function extractPageData() {
    let blocked = detectBlock();
    if (blocked) return { blocked };

    const root = await waitFor(() => {
      const m = document.querySelector('[role="main"]');
      return m && (m.querySelector('h1') || looksNotFound(m)) ? m : null;
    });
    blocked = detectBlock();
    if (blocked) return { blocked };

    const main = root || document.querySelector('[role="main"]') || document.body;
    if (looksNotFound(main)) return { notFound: true };

    // Nudge lazy-loaded sections, then wait for the text to stop changing.
    window.scrollTo(0, Math.min(900, document.documentElement.scrollHeight));
    await sleep(900);
    window.scrollTo(0, 0);
    let prev = -1;
    for (let i = 0; i < 8; i++) {
      const len = main.innerText.length;
      if (len === prev) break;
      prev = len;
      await sleep(600);
    }

    let profileText = main.innerText;
    for (const article of main.querySelectorAll('[role="article"]')) {
      const text = article.innerText || '';
      const index = text ? profileText.lastIndexOf(text) : -1;
      if (index >= 0) profileText = profileText.slice(0, index) + profileText.slice(index + text.length);
    }
    const lines = profileText.split('\n');
    const links = Array.from(main.querySelectorAll('a[href]')).filter((a) => !a.closest('[role="article"]')).map((a) => ({
      href: a.href,
      text: a.innerText || a.getAttribute('aria-label') || '',
    }));
    const h1 = (main.querySelector('h1') || {}).innerText || '';
    const data = parseProfile({ lines, links, h1, title: document.title });
    return { data, finalUrl: location.href };
  }

  /** On a Facebook search tab: scroll and collect page/profile URLs. */
  async function collectSearchResults(limit, skipKeys = [], maxIdleRounds = 5) {
    const skip = new Set(skipKeys);
    const found = new Map();

    await waitFor(() => document.querySelector('[role="main"] a[href]'), 15000);

    let idle = 0;
    for (let round = 0; round < 300 && found.size < limit && idle < maxIdleRounds; round++) {
      const blocked = detectBlock();
      if (blocked) return { blocked, urls: [...found.values()] };

      const root = document.querySelector('[role="feed"]') || document.querySelector('[role="main"]') || document.body;
      const before = found.size;
      for (const a of root.querySelectorAll('a[href]')) {
        const text = cleanLine(a.innerText);
        if (!text || text.length > 150) continue;
        // Skip "Rahul and 3 friends like this"-style links to people.
        const ctx = cleanLine((a.parentElement && a.parentElement.parentElement && a.parentElement.parentElement.innerText) || '');
        if (ctx.length > text.length + 4 && /\b(like|likes|follow|follows) this\b/i.test(ctx)) continue;
        const url = normalizePageUrl(a.href);
        if (!url) continue;
        const key = url.toLowerCase();
        if (skip.has(key) || found.has(key)) continue;
        found.set(key, { url, name: text });
        if (found.size >= limit) break;
      }
      idle = found.size === before ? idle + 1 : 0;

      const tail = (root.innerText || '').slice(-400);
      if (/End of results|No results found|We didn['’]t find any results/i.test(tail)) break;

      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(2000);
    }
    return { urls: [...found.values()].slice(0, limit) };
  }

  globalThis.FBScraper = {
    // shared with content/ig.js
    cleanLine,
    unwrapLink,
    emptyParsed,
    addValue,
    EMAIL_G,

    normalizePageUrl,
    pageKey,
    aboutUrl,
    ageFromBirthDate,
    isPhoneLike,
    isUrlLike,
    isAddressLike,
    classifyLink,
    parseProfile,
    mergeParsed,
    hasContact,
    isBusiness,
    toRecord,
    REPORT_COLUMNS,
    toCsv,
    KIND_PAGE,
    KIND_PRO,
    detectBlock,
    extractPageData,
    collectSearchResults,
  };
})();
