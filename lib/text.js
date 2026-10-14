'use strict';
// Text helpers shared by the renderer, the checks, the server, the editor and the in-browser demo. No Node-only APIs here.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only http(s), mailto, site-relative and in-page links survive; everything else becomes '#'.
const safeUrl = (u) => (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');

// Markdown subset used by rich text fields. The editor's formatting toolbar writes exactly this, so leads never type it:
//   **bold**, *italic* or _italic_, [text](url), "- " bullet lines, "### " subheading lines,
//   blank line = new paragraph, single newline = line break, backslash escapes for \ * _ [ ] ( ) # -
const inline = (t) => {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  const s = String(t ?? '')
    .replace(/\u0000/g, '')
    .replace(/\\([\\*_[\]()#-])/g, (m, ch) => hold(esc(ch)))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, txt, url) => hold(`<a href="${safeUrl(url)}">`) + txt + hold('</a>'));
  return esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
};
function paras(t) {
  const out = [];
  let para = [], list = [];
  const flushP = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushL = () => { if (list.length) out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = []; };
  for (const line of String(t ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.trim()) { flushP(); flushL(); continue; }
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li) { flushP(); list.push(li[1]); continue; }
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { flushP(); flushL(); out.push(`<h3 class="sub">${inline(h[1])}</h3>`); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return out.join('');
}
// Plain text of a markdown string (for checks, counters and share text).
const plain = (t) => String(t ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\\(.)/g, '$1').replace(/^(#{1,3}|-)\s+/gm, '').replace(/\*\*|[*_]/g, '');
// Links inside a markdown string: [{text, url}]
const mdLinks = (t) => [...String(t ?? '').matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)].map((m) => ({ text: m[1], url: m[2] }));

// Dates are stored as local wall-clock times ("2026-11-05T18:30") unless an offset is given.
const parseDate = (iso) => new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(iso || '') ? iso : (iso || '') + 'Z');
const fmtDate = (iso) => {
  const d = parseDate(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};
const shortDate = (iso) => fmtDate(iso).replace(/^\w+, /, '').replace(/, \d+:\d+ [AP]M$/, '');

// Chapter-local wall-clock time ("2026-11-05T18:30"), the same form dates are stored in, so they compare as strings.
function localNow(tz, now = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  } catch { return now.toISOString().slice(0, 16); }
}
const addHours = (local, h) => { const d = parseDate(local); return isNaN(d) ? '' : new Date(d.getTime() + h * 36e5).toISOString().slice(0, 16); };

// Page and chapter identifiers: lowercase letters, digits and hyphens.
const SLUG = /^[a-z0-9-]{1,40}$/;
// A web address from a title: lowercase words joined by dashes, cut at a whole word (at most 32 characters).
const slugify = (t, fallback = 'page') => {
  const s = String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (s.length <= 32) return s || fallback;
  const cut = s.slice(0, 33), i = cut.lastIndexOf('-');
  return (i > 8 ? cut.slice(0, i) : s.slice(0, 32)).replace(/(-(a|an|and|at|for|in|of|on|or|the|to|with))+$/, '').replace(/-$/, '') || fallback;
};

const CMSText = { SLUG, slugify, esc, safeUrl, inline, paras, plain, mdLinks, parseDate, fmtDate, shortDate, localNow, addHours };
// Also loaded as a plain script by the editor and its preview frame (served as /admin/text.js).
if (typeof module === 'object' && module.exports) module.exports = CMSText; else globalThis.CMSText = CMSText;
