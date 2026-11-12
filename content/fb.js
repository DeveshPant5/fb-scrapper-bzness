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

  // First path segments that are Facebook features, never business pages.
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

  /** The page's "About → Contact and basic info" tab. */
  function aboutUrl(canon) {
    const u = new URL(canon);
    const id = u.searchParams.get('id');
    if (u.pathname === '/profile.php' && id) {
      return `${FB}/profile.php?id=${id}&sk=about_contact_and_basic_info`;
    }
    return `${canon.replace(/\/+$/, '')}/about_contact_and_basic_info`;
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

  /** Undo Facebook's l.facebook.com/l.php?u=… redirect wrapper. */
  function unwrapLink(href) {
    try {
      const u = new URL(href, FB);
      if (/^(l|lm)\.facebook\.com$/i.test(u.hostname) && u.pathname.startsWith('/l.php')) {
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
      return digitCount(t) >= 7 ? { type: 'phone', value: t } : null;
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
  const TEXT_FIELDS = ['name', 'category', 'address', 'likes', 'followers', 'rating', 'intro'];

  function valueKey(field, v) {
    const s = String(v).trim().toLowerCase();
    if (field === 'phones' || field === 'whatsapp') return s.replace(/\D/g, '').slice(-10);
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
  const SECTION_START = /^(Intro|Categor(?:y|ies)|Contact info|Websites and social links)$/i;
  const SECTION_STOP = /^(Basic info|Privacy and legal info|Page transparency|Photos|Featured|Posts|Reviews|Life events|Details|Places lived|Family and relationships|Work and education|See all photos|Videos|Reels|Mentions|Followers|Following)$/i;

  /** Line indexes inside the contact sections (falls back to the first 80 lines). */
  function scopeIndexes(lines) {
    const idx = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (!SECTION_START.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 31); j++) {
        if (SECTION_START.test(lines[j]) || SECTION_STOP.test(lines[j])) break;
        idx.add(j);
      }
    }
    if (!idx.size) for (let j = 0; j < Math.min(lines.length, 80); j++) idx.add(j);
    return idx;
  }

  // On "Contact and basic info" each value is followed by a small label.
  const LABELS = [
    ['whatsapp', /^whatsapp$/i],
    ['phones', /^(mobile|phone|work|home|main|office|landline|telephone|tel)$/i],
    ['emails', /^e-?mail$/i],
    ['websites', /^websites?$/i],
    ['address', /^address$/i],
    ['instagram', /^instagram$/i],
    ['category', /^categor(?:y|ies)$/i],
  ];

  /**
   * Pure function: turns the visible text lines + links of a Facebook page into fields.
   * @param {{lines: string[], links?: {href: string, text: string}[], h1?: string, title?: string}} input
   */
  function parseProfile({ lines, links = [], h1 = '', title = '' }) {
    lines = lines.map(cleanLine).filter(Boolean);
    const r = emptyParsed();
    const all = lines.join('\n');
    const scope = scopeIndexes(lines);
    const scopeText = new Set([...scope].map((i) => lines[i]));
    const assigned = new Set();

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

    // Category ("Page · Dentist & dental office")
    for (const l of lines) {
      if ((m = l.match(/^Page\s*[·•]\s*(.+)$/i))) { r.category = m[1].trim(); break; }
    }

    // Links: mail/tel/WhatsApp anywhere; websites, socials and maps only from the contact sections.
    for (const { href, text } of links) {
      const c = classifyLink(href);
      if (!c) continue;
      const t = cleanLine(text);
      if (c.type === 'email') addValue(r, 'emails', c.value);
      else if (c.type === 'phone') addValue(r, 'phones', c.value);
      else if (c.type === 'whatsapp') addValue(r, 'whatsapp', c.value);
      else if (!scopeText.has(t)) continue;
      else if (c.type === 'web') addValue(r, 'websites', c.value);
      else if (c.type === 'instagram') addValue(r, 'instagram', c.value);
      else if (c.type === 'social') addValue(r, 'otherLinks', c.value);
      else if (c.type === 'map' && !r.address && t.length > 5 && !isPhoneLike(t)) r.address = t;
    }

    // Labelled values ("+91 98765 43210" followed by "WhatsApp").
    for (let i = 0; i < lines.length - 1; i++) {
      const v = lines[i];
      const label = lines[i + 1];
      for (const [field, re] of LABELS) {
        if (!re.test(label)) continue;
        let ok = false;
        if (field === 'phones' || field === 'whatsapp') ok = isPhoneLike(v);
        else if (field === 'emails') ok = EMAIL_ONE.test(v);
        else if (field === 'websites') ok = isUrlLike(v);
        else if (field === 'instagram') ok = /^@?[\w.]{2,30}$/.test(v) || /instagram\.com\//i.test(v);
        else if (field === 'address') ok = v.length >= 5 && v.length <= 250 && !isPhoneLike(v) && !EMAIL_ONE.test(v) && !isUrlLike(v);
        else if (field === 'category') ok = v.length <= 120;
        if (!ok) continue;
        assigned.add(i);
        if (field === 'address') { if (!r.address) r.address = v; }
        else if (field === 'category') { if (!r.category) r.category = v.replace(/^Page\s*[·•]\s*/i, ''); }
        else if (field === 'websites') addValue(r, 'websites', /^https?:\/\//i.test(v) ? v : 'https://' + v);
        else if (field === 'instagram') addValue(r, 'instagram', /instagram\.com\//i.test(v) ? v : `https://www.instagram.com/${v.replace(/^@/, '')}`);
        else addValue(r, field, v);
        break;
      }
    }

    // Unlabelled values inside the contact sections (main page "Intro" card).
    for (const i of [...scope].sort((a, b) => a - b)) {
      if (assigned.has(i)) continue;
      const l = lines[i];
      if (/^Page\s*[·•]/i.test(l) || EMAIL_ONE.test(l)) continue;
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

    // Emails anywhere in the visible text.
    for (const e of all.match(EMAIL_G) || []) {
      const v = e.replace(/\.+$/, '');
      if (!IMG_EXT.test(v)) addValue(r, 'emails', v);
    }

    // Intro / bio: the first line of the "Intro" card when it's free text.
    const introAt = lines.findIndex((l) => /^Intro$/i.test(l));
    if (introAt >= 0 && lines[introAt + 1]) {
      const l = lines[introAt + 1];
      if (l.length >= 15 && !/^Page\s*[·•]/i.test(l) && !isPhoneLike(l) && !isUrlLike(l) && !EMAIL_ONE.test(l) && !isAddressLike(l)) {
        r.intro = l;
      }
    }

    // A personal profile, not a business page: never stored.
    r.isPersonal =
      !r.category &&
      lines.some((l) => /^Add friend$/i.test(l) || /^[\d.,]+\s*K?\s+(mutual\s+)?friends$/i.test(l));

    return r;
  }

  function mergeParsed(a, b) {
    if (!a) return b;
    if (!b) return a;
    const r = emptyParsed();
    LIST_FIELDS.forEach((f) => [...a[f], ...b[f]].forEach((v) => addValue(r, f, v)));
    TEXT_FIELDS.forEach((f) => (r[f] = a[f] || b[f]));
    r.isPersonal = a.isPersonal || b.isPersonal;
    return r;
  }

  const hasContact = (d) =>
    !!d && (d.emails.length || d.phones.length || d.whatsapp.length || d.websites.length) > 0;

  function toRecord(canon, d) {
    const j = (arr) => arr.join(' | ');
    return {
      key: canon.toLowerCase(),
      pageUrl: canon,
      name: d.name,
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
      scrapedAt: new Date().toISOString(),
    };
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

    const lines = main.innerText.split('\n');
    const links = Array.from(main.querySelectorAll('a[href]'), (a) => ({
      href: a.href,
      text: cleanLine(a.innerText || a.getAttribute('aria-label') || ''),
    }));
    const h1 = (main.querySelector('h1') || {}).innerText || '';
    const data = parseProfile({ lines, links, h1, title: document.title });
    if (data.isPersonal) return { isPersonal: true };
    return { data, finalUrl: location.href };
  }

  /** On a facebook.com/search/pages/?q=… tab: scroll and collect page URLs. */
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
        if (ctx.length > text.length + 4 && /\b(like|likes|follow|follows) this\b|mutual friends?/i.test(ctx)) continue;
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
    normalizePageUrl,
    pageKey,
    aboutUrl,
    isPhoneLike,
    isUrlLike,
    isAddressLike,
    classifyLink,
    parseProfile,
    mergeParsed,
    hasContact,
    toRecord,
    detectBlock,
    extractPageData,
    collectSearchResults,
  };
})();
