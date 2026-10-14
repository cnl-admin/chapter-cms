'use strict';
// Field schemas, shared by blocks (lib/blocks.js) and collection items (lib/collections.js).
// Kinds:
//   text, textarea   plain text, or the markdown subset in text.js when the field is `rich`
//   url              a link: https://…, mailto:, or a page on the site like /events
//   image            an image link, picked from the media library or uploaded (M1, M2)
//   date             local date and time ("2026-11-05T18:30"), or a date only with `dateOnly`
//   select           one of `options` (stored as the option name, never as styling: T1)
//   tags             several items of another collection, by id (`col`), e.g. issues (C3)
//   ref              one item of another collection, by id (`col`), or empty
//   list             a list of sub-`fields`, with `itemLabel` naming the field shown as the item's title
// Field options: label, hint, options, rich, max, maxLines, required, panel (edit in the side panel, not on the
// page), fallback (a Settings > Connections key used when empty), private (never shown on the site or in the
// content API, e.g. a personal email).
const { SLUG } = require('./text');

const MAX_TEXT = 20000;
function clean(fields, input) {
  const out = {};
  for (const f of fields) {
    const v = input?.[f.key];
    if (f.kind === 'list') out[f.key] = (Array.isArray(v) ? v : []).slice(0, 200).map((it) => clean(f.fields, it));
    else if (f.kind === 'tags') out[f.key] = [...new Set((Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map((x) => String(x).trim()).filter((x) => SLUG.test(x)))].slice(0, 30);
    else if (f.kind === 'ref') out[f.key] = SLUG.test(String(v ?? '')) ? String(v) : '';
    else {
      let s = typeof v === 'string' ? v : v == null ? '' : String(v);
      if (f.kind === 'select' && !f.options.includes(s)) s = f.options[0];
      if (f.kind === 'date' && s) s = f.dateOnly ? s.slice(0, 10) : s.slice(0, 16);
      out[f.key] = s.slice(0, MAX_TEXT);
    }
  }
  return out;
}
// Blank values for a set of fields (what "+ Blank" adds to a list).
const blank = (fields) => Object.fromEntries(fields.map((f) => [f.key, f.kind === 'select' ? f.options[0] : f.kind === 'tags' ? [] : f.kind === 'list' ? [] : '']));
// Drop private fields, for anything visitors or other sites can read.
const publicOnly = (fields, obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !fields.some((f) => f.key === k && f.private)));

module.exports = { clean, blank, publicOnly };
