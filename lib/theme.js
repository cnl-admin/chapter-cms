'use strict';
// Theme engine (T1, T2). Pages store content and option names only; how they look comes from here and static/site.css:
//   style     the design: "yard" (Yard Sign) or "plain"; switching it restyles every page without touching content
//   palette   an approved national colour set (or custom colours, when national allows them for the chapter)
//   fonts     an approved font pairing
// Every colour that text sits on is checked for contrast, and derived text colours are darkened until they pass.
const { esc } = require('./text');

const PAPER = '#FDFBE9', INK = '#22293f';
const PALETTES = [
  { id: 'rose', name: 'Rose', primary: '#2C3659', accent: '#C23B4F' },
  { id: 'cnl', name: 'CNL red', primary: '#2C3659', accent: '#9F3C39' },
  { id: 'teal', name: 'Teal', primary: '#2C3659', accent: '#00ABBF' },
  { id: 'sky', name: 'Sky', primary: '#2C3659', accent: '#74C0EB' },
  { id: 'coral', name: 'Coral', primary: '#2C3659', accent: '#F7986E' },
  { id: 'green', name: 'Green', primary: '#2C3659', accent: '#3E7B4F' },
];
const FONTS = [
  { id: 'yard', name: 'Archivo and Domine', sign: '"Archivo",sans-serif', stretch: '125%', body: '"Domine",Georgia,serif', css: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Domine:wght@400..700&display=swap' },
  { id: 'civic', name: 'Archivo and Source Serif', sign: '"Archivo",sans-serif', stretch: '100%', body: '"Source Serif 4",Georgia,serif', css: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap' },
  { id: 'system', name: 'System fonts (fastest to load)', sign: 'system-ui,-apple-system,"Segoe UI",sans-serif', stretch: '100%', body: 'system-ui,-apple-system,"Segoe UI",sans-serif', css: '' },
];
const STYLES = { yard: 'Yard sign', plain: 'Plain' };

const hexOk = (c, d) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : d);
const rgb = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x > 0.03928 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const readable = (c, bg, ink) => { for (let i = 0; i < 14 && contrast(c, bg) < 4.6; i++) c = mix(c, ink, 0.16); return c; };
const onColor = (c) => (contrast(c, '#ffffff') >= contrast(c, INK) ? '#ffffff' : INK);

// Contrast problems with a colour set: [{ level, msg }]. National can't approve a set with errors.
function paletteIssues(p) {
  const out = [], primary = hexOk(p.primary), accent = hexOk(p.accent);
  if (!primary || !accent) return [{ level: 'error', msg: 'Colours must be codes like #2C3659.' }];
  if (contrast(primary, PAPER) < 4.5) out.push({ level: 'error', msg: `The dark colour is too light to read on the page background (${contrast(primary, PAPER).toFixed(1)}:1, needs 4.5:1).` });
  const on = contrast(accent, onColor(accent));
  if (on < 4.5) out.push({ level: 'warn', msg: `Text on the chapter colour is hard to read (${on.toFixed(1)}:1). Headers and buttons use it.` });
  return out;
}
// The approved lists for a chapter, from the national settings (lib/national.js).
const palettesFor = (nat) => (nat?.palettes?.length ? nat.palettes : PALETTES);
const fontsFor = (nat) => { const ids = nat?.fonts; return ids?.length ? FONTS.filter((f) => ids.includes(f.id)) : FONTS; };
// A site's theme settings resolved to concrete colours and fonts. custom: whether this chapter may use its own colours.
function resolveTheme(theme = {}, nat = {}, { custom = false } = {}) {
  const pals = palettesFor(nat), fonts = fontsFor(nat);
  const pal = theme.palette === 'custom' && custom ? { id: 'custom', primary: hexOk(theme.primary, '#2C3659'), accent: hexOk(theme.accent, '#C23B4F') } : pals.find((p) => p.id === theme.palette) || pals[0];
  return { palette: pal.id, primary: hexOk(pal.primary, '#2C3659'), accent: hexOk(pal.accent, '#C23B4F'), font: fonts.find((f) => f.id === theme.fonts) || fonts[0], style: STYLES[theme.style] ? theme.style : 'yard' };
}
function themeVars(t) {
  const ch = t.accent, navy = t.primary;
  return `--ch:${ch};--navy:${navy};--paper:${PAPER};--ink:${INK};--on-ch:${onColor(ch)};--ch-text:${readable(ch, PAPER, INK)};--ch-tint:${mix(ch, PAPER, 0.84)};--font-sign:${t.font.sign};--font-body:${t.font.body};--sign-stretch:${t.font.stretch}`;
}
// For old settings that stored colours directly: the matching approved set, or custom.
const paletteFor = (primary, accent) => (PALETTES.find((p) => p.primary.toLowerCase() === String(primary || '#2C3659').toLowerCase() && p.accent.toLowerCase() === String(accent || '#C23B4F').toLowerCase()) || { id: 'custom' }).id;

// Generated identity defaults (T5): two-letter initials and a favicon in the chapter colour.
const initials = (name) => (String(name || '').replace(/\b(chapter|the|of|for|and|cnl|citizens|new|liberalism)\b/gi, ' ').match(/[A-Za-z0-9]+/g) || ['N', 'L']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function faviconSvg(name, t) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${t.accent}"/><text x="32" y="42" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="${initials(name).length > 1 ? 26 : 34}" text-anchor="middle" fill="${onColor(t.accent)}">${esc(initials(name))}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { PAPER, INK, PALETTES, FONTS, STYLES, hexOk, mix, contrast, onColor, readable, paletteIssues, palettesFor, fontsFor, resolveTheme, themeVars, paletteFor, initials, faviconSvg };
