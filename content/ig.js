/*
 * FB Page Scraper — Instagram support.
 *
 * Loaded right after content/fb.js (it reuses that file's helpers) in the same three places:
 * Instagram tabs, background.js via importScripts(), and dashboard.html.
 *
 * Instagram's web page shows very little as plain text, so profiles are read from the same JSON
 * endpoints instagram.com itself uses, called from inside a logged-in instagram.com tab.
 * Only business and creator accounts are kept; personal and private accounts are skipped
 * before any of their details leave the tab.
 *
 * Must stay a classic script (no import/export).
 */
(function () {
  'use strict';
  if (globalThis.IGScraper) return;
  const F = globalThis.FBScraper;
  if (!F) throw new Error('content/fb.js must be loaded before content/ig.js');

  const IG = 'https://www.instagram.com';
  const KIND_BUSINESS = 'Business account';
  const KIND_CREATOR = 'Creator account';

  // First path segments that are Instagram features, never usernames.
  const RESERVED = new Set([
    'about', 'accounts', 'ajax', 'api', 'challenge', 'data', 'developer', 'direct', 'directory',
    'download', 'emails', 'explore', 'graphql', 'help', 'legal', 'lite', 'locations', 'login',
    'meta_verified', 'nametag', 'oauth', 'p', 'popular', 'press', 'privacy', 'qr', 'reel', 'reels',
    'session', 'signup', 'static', 'stories', 'tags', 'terms', 'threads', 'tv', 'web', 'your_activity',
  ]);

  // ---------------------------------------------------------------- URLs

  function validUser(name) {
    if (!name || !/^[A-Za-z0-9._]{1,30}$/.test(name)) return null;
    if (RESERVED.has(name.toLowerCase())) return null;
    if (/^\.|\.$|\.\./.test(name)) return null; // not allowed in Instagram usernames
    return `${IG}/${name.toLowerCase()}/`;
  }

  /** Canonical profile URL (https://www.instagram.com/<username>/) from an Instagram URL or "@username", else null. */
  function normalizeIgUrl(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (s.startsWith('@')) return validUser(s.slice(1));
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^((www|m)\.)?(instagram\.com|instagr\.am)(\/|$)/i.test(s)) s = 'https://' + s;
      else return null;
    }
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!/(^|\.)(instagram\.com|instagr\.am)$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    // /stories/<username>/<id>/ also points at a profile.
    return validUser(parts[0] && parts[0].toLowerCase() === 'stories' ? parts[1] : parts[0]);
  }

  /**
   * Routes one pasted line: Instagram URLs and "@username" → Instagram; Facebook URLs and bare
   * names → Facebook (as before). Returns { platform, url } or null.
   */
  function normalizeTarget(raw) {
    const ig = normalizeIgUrl(raw);
    if (ig) return { platform: 'instagram', url: ig };
    if (/^\s*@/.test(String(raw || ''))) return null; // "@name" is never a Facebook page here
    const fb = F.normalizePageUrl(raw);
    return fb ? { platform: 'facebook', url: fb } : null;
  }

  /** Case-insensitive key for any Facebook/Instagram URL (matches saved record keys). */
  const targetKey = (raw) => {
    const t = normalizeTarget(raw);
    return (t ? t.url : String(raw || '')).toLowerCase();
  };

  const usernameOf = (canon) => new URL(canon).pathname.split('/').filter(Boolean)[0];

  // ------------------------------------------------------------- parsing

  const isProfessional = (user) => !!(user && (user.is_professional_account || user.is_business_account));

  const LINK_FIELD = {
    email: 'emails', phone: 'phones', whatsapp: 'whatsapp', web: 'websites',
    instagram: 'instagram', social: 'otherLinks', map: 'otherLinks',
  };
  const FB_LINK = /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i;

  function addLink(r, href) {
    const plain = F.unwrapLink(href);
    if (!plain) return;
    try {
      // fb.js ignores Facebook links (they're the page itself there); here they're useful.
      if (FB_LINK.test(new URL(plain).hostname)) return F.addValue(r, 'otherLinks', plain);
    } catch { /* not a URL; classifyLink decides */ }
    const c = F.classifyLink(plain);
    if (c && LINK_FIELD[c.type]) F.addValue(r, LINK_FIELD[c.type], c.value);
  }

  /** "+91 98765 43210" from a country code and a number, whichever form Instagram returns. */
  function joinPhone(cc, num) {
    num = F.cleanLine(num == null ? '' : String(num));
    if (!num || num.startsWith('+')) return num;
    cc = String(cc == null ? '' : cc).replace(/\D/g, '');
    if (!cc) return num;
    const digits = num.replace(/\D/g, '');
    return digits.length > 10 && digits.startsWith(cc) ? `+${digits}` : `+${cc} ${num}`;
  }

  function igAddress(user, info) {
    let a = user.business_address_json;
    if (typeof a === 'string') {
      try { a = JSON.parse(a); } catch { a = null; }
    }
    let parts = a ? [a.street_address, a.city_name, a.zip_code] : [];
    if (!parts.some(Boolean)) parts = [info.address_street, info.city_name, info.zip];
    return parts.map((p) => F.cleanLine(p == null ? '' : String(p))).filter(Boolean).join(', ');
  }

  const PHONE_IN_TEXT = /\+?\(?\d[\d\s\-().]{7,20}\d/g;

  /** Emails, phone/WhatsApp numbers and links written into the bio text. */
  function contactsFromBio(r, bio) {
    for (const raw of String(bio || '').split('\n')) {
      const line = F.cleanLine(raw);
      if (!line) continue;
      for (const e of line.match(F.EMAIL_G) || []) F.addValue(r, 'emails', e.replace(/\.+$/, ''));

      // Free text: require 10+ digits so years, prices and pin codes aren't taken as numbers.
      const wa = /whats\s?app|\bwa\b/i.test(line);
      const call = !wa || /call|phone|mob|tel|contact|☎|📞/i.test(line);
      for (const m of line.replace(F.EMAIL_G, ' ').match(PHONE_IN_TEXT) || []) {
        const v = F.cleanLine(m);
        const d = (v.match(/\d/g) || []).length;
        if (d < 10 || d > 15 || !F.isPhoneLike(v)) continue;
        if (wa) F.addValue(r, 'whatsapp', v);
        if (call) F.addValue(r, 'phones', v);
      }

      // Only explicit links (http…, www…, wa.me/…), so "Dr.Patel" isn't read as a website.
      for (let tok of line.split(/\s+/)) {
        tok = tok.replace(/^[(\[<]+/, '').replace(/[)\]>.,;:!]+$/, '');
        if (/^(https?:\/\/|www\.|wa\.me\/)/i.test(tok)) addLink(r, /^https?:\/\//i.test(tok) ? tok : 'https://' + tok);
      }
    }
  }

  const bioLinkUrls = (list) => (Array.isArray(list) ? list.map((l) => l && l.url).filter(Boolean) : []);

  /**
   * Pure function: turns Instagram's profile JSON into the same field set fb.js produces.
   * @param user  data.user from /api/v1/users/web_profile_info/
   * @param info  user from /api/v1/users/<id>/info/ (optional; holds the "Contact" button details)
   */
  function parseIgUser(user, info) {
    const i = info || {};
    const r = F.emptyParsed();
    r.platform = 'Instagram';
    r.isPersonal = !isProfessional(user);
    r.kind = r.isPersonal ? '' : user.is_business_account ? KIND_BUSINESS : KIND_CREATOR;
    r.name = F.cleanLine(user.full_name || i.full_name || '') || user.username || '';

    const cat = F.cleanLine(user.category_name || i.category || user.business_category_name || '');
    r.category = /^none$/i.test(cat) ? '' : cat;

    const followers = user.edge_followed_by ? user.edge_followed_by.count : i.follower_count;
    if (followers != null) r.followers = String(followers);

    const bio = user.biography || i.biography || '';
    r.intro = String(bio).split('\n').map(F.cleanLine).filter(Boolean).join(' / ');
    r.address = igAddress(user, i);

    [user.business_email, i.public_email].forEach((e) => e && F.addValue(r, 'emails', String(e)));
    [
      joinPhone(user.business_country_code, user.business_phone_number),
      i.contact_phone_number,
      joinPhone(i.public_phone_country_code, i.public_phone_number),
    ].forEach((p) => p && F.addValue(r, 'phones', String(p)));
    if (i.whatsapp_number) F.addValue(r, 'whatsapp', joinPhone('', i.whatsapp_number));

    [user.external_url, i.external_url, ...bioLinkUrls(user.bio_links), ...bioLinkUrls(i.bio_links)]
      .filter(Boolean)
      .forEach((href) => addLink(r, href));
    contactsFromBio(r, bio);
    return r;
  }

  globalThis.IGScraper = {
    HOME: `${IG}/`,
    KIND_BUSINESS,
    KIND_CREATOR,
    normalizeIgUrl,
    normalizeTarget,
    targetKey,
    usernameOf,
    isProfessional,
    parseIgUser,
  };
})();
