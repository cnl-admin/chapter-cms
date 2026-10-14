'use strict';
// Page renderer: site chrome (announcement bar, header and menu, footer) around the page's blocks.
// Used for the public site, share-link previews, the editor preview (edit: true) and the block gallery.
const { esc, safeUrl, renderBlock, socialLinks, blocks: BLOCKS, ATOMS, LAYOUT_NAMES } = require('./blocks');

// Yard Sign design: the chapter picks one color; everything else derives from it.
const hexOk = (c, d) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : d);
const rgb = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x > 0.03928 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const readable = (c, bg, ink) => { for (let i = 0; i < 14 && contrast(c, bg) < 4.6; i++) c = mix(c, ink, 0.16); return c; };
const PAPER = '#FDFBE9', INK = '#22293f';

function themeVars(theme = {}) {
  const ch = hexOk(theme.accent, '#C23B4F');
  const navy = hexOk(theme.primary, '#2C3659');
  return `--ch:${ch};--navy:${navy};--paper:${PAPER};--ink:${INK};--on-ch:${contrast(ch, '#ffffff') >= contrast(ch, INK) ? '#ffffff' : INK};--ch-text:${readable(ch, PAPER, INK)};--ch-tint:${mix(ch, PAPER, 0.84)}`;
}

// Today's date (YYYY-MM-DD) in the chapter's timezone, for announcement end dates.
function todayIn(tz, now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Chicago' }).format(now); } catch { return now.toISOString().slice(0, 10); }
}
const homeOf = (site) => (site && site.home) || 'home';
const href = (path, base) => safeUrl(String(path || '').startsWith('/') ? base + path : path);

function navHtml(site, cur, base) {
  const link = (n, cls) => `<a href="${href(n.path, base)}"${cls ? ` class="${cls}"` : ''}${n.path === cur ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`;
  return (site.nav || []).map((n) => (n.children && n.children.length
    ? `<details class="dd"><summary>${esc(n.label)}</summary><div class="ddm">${n.path ? link(n) : ''}${n.children.map((c) => link(c)).join('')}</div></details>`
    : link(n, n.style === 'button' ? 'navbtn' : ''))).join('');
}
function announceHtml(site, edit, now) {
  const a = site.announcement || {};
  if (!a.on || !String(a.text || '').trim()) return '';
  if (a.until && todayIn(site.timezone, now) > a.until) return '';
  return `<div class="announce"${edit ? ' data-site="announcement"' : ''}><div class="wrap"><span>${esc(a.text)}</span>${a.link_label && a.url ? ` <a href="${safeUrl(a.url)}">${esc(a.link_label)}</a>` : ''}</div></div>`;
}
function footerHtml(site, edit, base) {
  const links = (site.footer_links || []).filter((l) => l.label && l.url);
  return `<footer${edit ? ' data-site="footer"' : ''}><div class="wrap"><p class="sign foot-name">${esc(site.name)}</p>${site.footer ? `<p>${esc(site.footer)}</p>` : ''}${links.length ? `<p class="footlinks">${links.map((l) => `<a href="${href(l.url, base)}">${esc(l.label)}</a>`).join('')}</p>` : ''}${socialLinks(site)}${site.contact_email ? `<p><a href="mailto:${esc(site.contact_email)}">${esc(site.contact_email)}</a></p>` : ''}${site.disclaimer ? `<p class="disclaimer">${esc(site.disclaimer)}</p>` : ''}</div></footer>`;
}
const GALLERY_CSS = '<style>.glabel{background:#fff;border-top:2px dashed #2C3659;border-bottom:2px dashed #2C3659;padding:10px 0;font:14px/1.4 system-ui,sans-serif;color:#22293f}.glabel code{background:#eef0f6;padding:1px 6px;border-radius:4px;margin:0 6px}.glabel span{color:#5b6178}</style>';
const BANNER_CSS = 'position:sticky;top:0;z-index:60;background:#d9a521;color:#111;font:600 14px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center';

// opts: pageSlug, base (prefix for site links), preview (links inert), edit (editor preview), editAssets (HTML the
// editor injects), banner (text across the top, for share links), noindex, labels (block gallery), now.
function renderPage(site, page, { pageSlug, base = '', preview = false, edit = false, editAssets = '', banner = '', noindex = false, labels = false, now = new Date() } = {}) {
  const t = site.theme || {};
  const title = page.seo_title || `${page.title} · ${site.name}`;
  const cur = pageSlug === homeOf(site) ? '/' : '/' + pageSlug;
  const desc = page.seo_description || site.tagline || '';
  const main = (page.blocks || []).map((b, i) => {
    if (edit) return `<div class="blk" data-b="${i}" data-type="${esc(b.type)}" data-label="${esc(BLOCKS[b.type]?.label || '')}">${renderBlock(b, { edit, i, site })}</div>`;
    const html = renderBlock(b, { site });
    return labels ? `<div class="glabel"><div class="wrap"><b>${esc(BLOCKS[b.type]?.label || b.type)}</b><code>${esc(b.type)}</code><span>${esc(BLOCKS[b.type]?.help || '')}</span></div></div>${html}` : html;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${noindex || preview || banner ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${page.seo_image ? `<meta property="og:image" content="${safeUrl(page.seo_image)}">` : ''}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Domine:wght@400..700&display=swap">
<link rel="stylesheet" href="/static/site.css"><style>:root{${themeVars(t)}}</style>${labels ? GALLERY_CSS : ''}</head>
<body>${banner ? `<div class="pvbar" style="${BANNER_CSS}">${esc(banner)}</div>` : ''}${announceHtml(site, edit, now)}<header class="top"${edit ? ' data-site="menu"' : ''}><div class="wrap bar"><a class="brand" href="${safeUrl(base || '/')}">${t.logo ? `<img src="${safeUrl(t.logo)}" alt="">` : ''}<span class="sign">${esc(site.name)}</span></a><nav>${navHtml(site, cur, base)}</nav></div></header>
<main>${(page.blocks || []).some((b) => b.type === 'hero') || labels ? '' : `<h1 class="vh">${esc(page.title)}</h1>`}${main}</main>
${footerHtml(site, edit, base)}
${edit ? `<script>window.__CMS=${JSON.stringify({ atoms: ATOMS.map((a) => [a, BLOCKS[a].label]), layouts: LAYOUT_NAMES }).replace(/</g, '\\u003c')}</script>${editAssets}` : preview ? '<script>document.addEventListener("click",e=>{if(e.target.closest("a"))e.preventDefault()})</script>' : ''}
</body></html>`;
}
module.exports = { renderPage, themeVars, contrast, hexOk, todayIn, homeOf, PAPER };
