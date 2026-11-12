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

  globalThis.FBScraper = {
    normalizePageUrl,
    pageKey,
    aboutUrl,
  };
})();
