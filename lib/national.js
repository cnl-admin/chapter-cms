'use strict';
// National settings, stored under the reserved chapter name "national" (key "config"), with the national media
// library (M2) and national news (the "national news" fallback, R3) beside it:
//   palettes   approved colour sets (T2); empty means the built-in sets in lib/theme.js
//   fonts      ids of approved font pairings (T2); empty means all of them
//   defaults   feature switches for every chapter (T7), and features: { <chapter>: { <feature>: true|false } }
const { SLUG } = require('./text');
const { hexOk, paletteIssues, FONTS, fontId } = require('./theme');

const NATIONAL = 'national';
const FEATURES = {
  events: ['Events', 'Event lists and event pages.'],
  posts: ['News and posts', 'Blog posts, press releases, clippings, videos and podcasts.'],
  people: ['People', 'Team lists and personal pages.'],
  issues: ['Issues', 'Issue pages and issue tags.'],
  endorsements: ['Endorsements', 'Only for chapters cleared to endorse candidates.'],
  contact: ['Contact forms', 'Forms that message the chapter or a lead without showing their email.'],
  custom_colors: ['Custom colours', 'Lets the chapter pick colours outside the approved sets.'],
};
const DEFAULT_ON = { events: true, posts: true, people: true, issues: true, endorsements: false, contact: true, custom_colors: false };
const str = (v, n) => String(v ?? '').slice(0, n);
const switches = (f) => Object.fromEntries(Object.keys(FEATURES).filter((k) => typeof f?.[k] === 'boolean').map((k) => [k, f[k]]));

function cleanNational(o = {}) {
  const palettes = (Array.isArray(o.palettes) ? o.palettes : []).slice(0, 24).map((p, i) => ({
    id: SLUG.test(p?.id || '') ? p.id : `set-${i + 1}`, name: str(p?.name, 40).trim() || `Colour set ${i + 1}`, primary: hexOk(p?.primary, ''), accent: hexOk(p?.accent, ''),
  })).filter((p) => p.primary && p.accent && !paletteIssues(p).some((x) => x.level === 'error'));
  const seen = new Set();
  return {
    palettes: palettes.filter((p) => !seen.has(p.id) && seen.add(p.id)),
    fonts: (Array.isArray(o.fonts) ? o.fonts : []).map(fontId).filter((id) => FONTS.some((f) => f.id === id)),
    defaults: switches(o.defaults),
    features: Object.fromEntries(Object.entries(o.features || {}).filter(([ch]) => SLUG.test(ch) && ch !== NATIONAL).map(([ch, f]) => [ch, switches(f)])),
  };
}
const featuresFor = (nat, ch) => ({ ...DEFAULT_ON, ...(nat?.defaults || {}), ...(nat?.features?.[ch] || {}) });

module.exports = { NATIONAL, FEATURES, DEFAULT_ON, cleanNational, featuresFor };
