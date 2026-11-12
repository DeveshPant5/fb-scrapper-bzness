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

  globalThis.FBScraper = {
    normalizePageUrl,
    pageKey,
    aboutUrl,
    isPhoneLike,
    isUrlLike,
    isAddressLike,
    classifyLink,
  };
})();
