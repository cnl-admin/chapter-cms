'use strict';
// Page renderer: site chrome (announcement bar, header and menu, footer) around a page's blocks, or around a
// collection item's page (C2). Used for the public site, share-link previews, the editor preview (edit: true) and
// the block gallery. How things look comes from the theme (lib/theme.js) and static/site.css, never from content (T1).
const { esc, safeUrl, plain, localNow } = require('./text');
const { renderBlock, socialLinks, blocks: BLOCKS, ATOMS, LAYOUT_NAMES, visibility, deviceClass } = require('./blocks');
const { collections, titleOf } = require('./collections');
const { resolveTheme, themeVars, fontCss, contrast, hexOk, PAPER, faviconSvg } = require('./theme');
const { featuresFor } = require('./national');

// Today's date (YYYY-MM-DD) in the chapter's timezone, for announcement dates.
const todayIn = (tz, now = new Date()) => localNow(tz, now).slice(0, 10);
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
  const today = todayIn(site.timezone, now);
  if ((a.until && today > a.until) || (a.from && today < a.from)) return ''; // expired or not started yet (W5, R2)
  return `<div class="announce"${edit ? ' data-site="announcement"' : ''}><div class="wrap"><span>${esc(a.text)}</span>${a.link_label && a.url ? ` <a href="${safeUrl(a.url)}">${esc(a.link_label)}</a>` : ''}</div></div>`;
}
// The footer is a set of labelled cells; each design lays them out its own way (a ruled grid, or a zine back page).
function footerHtml(site, edit, base) {
  const links = (site.footer_links || []).filter((l) => l.label && l.url), social = socialLinks(site);
  const cell = (label, html, cls = '') => `<div class="cell${cls}"><p class="cap flabel">${label}</p>${html}</div>`;
  const cells = [
    cell('Chapter', `<p class="sign foot-name">${esc(site.name)}</p>`, ' fname'),
    site.footer ? cell('About', `<p>${esc(site.footer)}</p>`) : '',
    links.length ? cell('Links', `<p class="footlinks">${links.map((l) => `<a href="${href(l.url, base)}">${esc(l.label)}</a>`).join('')}</p>`) : '',
    social ? cell('Follow', social) : '',
    site.contact_email ? cell('Contact', `<p><a href="mailto:${esc(site.contact_email)}">${esc(site.contact_email)}</a></p>`) : '',
    site.disclaimer ? cell('Disclaimer', `<p class="disclaimer">${esc(site.disclaimer)}</p>`) : '',
  ];
  return `<footer${edit ? ' data-site="footer"' : ''}><div class="wrap"><div class="fgrid">${cells.join('')}</div></div></footer>`;
}
const GALLERY_CSS = '<style>.glabel{background:#fff;border-top:2px dashed #2C3659;border-bottom:2px dashed #2C3659;padding:10px 0;font:14px/1.4 system-ui,sans-serif;color:#22293f}.glabel code{background:#eef0f6;padding:1px 6px;border-radius:4px;margin:0 6px}.glabel span{color:#5b6178}</style>';
const BANNER_CSS = 'position:sticky;top:0;z-index:60;background:#d9a521;color:#111;font:600 14px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center';

// Field attributes for an item's own fields on its page, so they edit in place like block text (path "f.<key>").
function itemCtx(col, edit, site, data) {
  const fields = collections[col].fields;
  const f = (key) => {
    if (!edit) return '';
    const d = fields.find((x) => x.key === key) || {}, label = d.label || key;
    let a = ` data-f="f.${esc(key)}" data-fl="${esc(label)}" data-ph="${esc(d.required ? label + ' (required)' : label)}"`;
    if (d.max) a += ` data-max="${d.max}"`;
    if (d.kind === 'textarea') a += d.rich ? ' data-ml="1" data-rich="1"' : ' data-ml="1"';
    return a;
  };
  return { edit, site, data, f };
}

// opts: pageSlug, base (prefix for site links), preview (links inert), edit (editor preview), editAssets (HTML the
// editor injects), banner (text across the top, for share links), noindex, labels (block gallery), now, data (the
// chapter's collections, see cms.js), national (national settings, for approved colours and fonts), chapter,
// col (render `page` as an item of that collection, with its page header).
function renderPage(site, page, { pageSlug, base = '', preview = false, edit = false, editAssets = '', banner = '', noindex = false, labels = false, now = new Date(), data, national = {}, chapter = '', col = null } = {}) {
  const features = data?.features || featuresFor(national, chapter);
  const t = resolveTheme(site.theme, national, { custom: features.custom_colors });
  const d = { items: {}, national: { posts: [] }, ...(data || {}), features, now: data?.now || localNow(site.timezone, now) };
  const def = col && collections[col];
  const title = def ? `${titleOf(col, page)} · ${site.name}` : page.seo_title || `${page.title} · ${site.name}`;
  const cur = pageSlug === homeOf(site) ? '/' : '/' + pageSlug;
  const desc = (def ? plain(page[def.summaryKey] || '').slice(0, 200) : page.seo_description) || site.tagline || '';
  const id = site.identity || {};
  const image = (def ? page[def.imageKey] : page.seo_image) || id.share_image || id.share_auto || '';
  const one = (b, i) => {
    const v = visibility(b, d), dev = deviceClass(b);
    if (edit) {
      const note = [!v.show ? v.why : '', dev ? b.vis.device : ''].filter(Boolean).join(' · ');
      return `<div class="blk${v.show ? '' : ' hiddenblk'}" data-b="${i}" data-type="${esc(b.type)}" data-label="${esc(BLOCKS[b.type]?.label || '')}">${note ? `<p class="cms-hidden">${esc(note)}</p>` : ''}${renderBlock(b, { edit, i, site, data: d })}</div>`;
    }
    if (!v.show) return '';
    const html = renderBlock(b, { site, data: d, sample: labels });
    const out = dev && html ? `<div class="${dev}">${html}</div>` : html;
    return labels ? `<div class="glabel"><div class="wrap"><b>${esc(BLOCKS[b.type]?.label || b.type)}</b><code>${esc(b.type)}</code><span>${esc(BLOCKS[b.type]?.help || '')}</span></div></div>${out}` : out;
  };
  let main = (page.blocks || []).map(one).join('\n');
  if (def) {
    const c = itemCtx(col, edit, site, d), item = { ...page, id: page.id || pageSlug };
    const related = (def.related?.(item) || []).map((b) => renderBlock(b, { site, data: d })).join('');
    main = `<article class="itempage">${def.detail(item, c)}${edit ? `<div class="cms-bodyhint">Sections below appear on this ${esc(def.one)}’s page only.</div>` : ''}${main}${related}${def.after?.(item, c) || ''}</article>`;
  }
  const h1 = def || (page.blocks || []).some((b) => b.type === 'hero') || labels ? '' : `<h1 class="vh">${esc(page.title)}</h1>`;
  const favicon = id.favicon ? safeUrl(id.favicon) : faviconSvg(site.name, t);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${noindex || preview || banner ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${image ? `<meta property="og:image" content="${safeUrl(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="${favicon}">${fontCss(t).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join('')}
<link rel="stylesheet" href="/static/site.css"><style>:root{${themeVars(t)}}</style>${labels ? GALLERY_CSS : ''}</head>
<body class="style-${t.style}">${banner ? `<div class="pvbar" style="${BANNER_CSS}">${esc(banner)}</div>` : ''}${announceHtml(site, edit, now)}<header class="top"${edit ? ' data-site="menu"' : ''}><div class="wrap bar"><a class="brand" href="${safeUrl(base || '/')}">${site.theme?.logo ? `<img src="${safeUrl(site.theme.logo)}" alt="">` : ''}<span class="bname"><span class="sign">${esc(site.name)}</span>${site.tagline ? `<span class="tagline">${esc(site.tagline)}</span>` : ''}</span></a><nav>${navHtml(site, cur, base)}</nav></div></header>
<main>${h1}${main}</main>
${footerHtml(site, edit, base)}
${edit ? `<script>window.__CMS=${JSON.stringify({ atoms: ATOMS.map((a) => [a, BLOCKS[a].label]), layouts: LAYOUT_NAMES }).replace(/</g, '\\u003c')}</script>${editAssets}` : preview ? '<script>document.addEventListener("click",e=>{if(e.target.closest("a"))e.preventDefault()});document.addEventListener("submit",e=>e.preventDefault())</script>' : ''}
</body></html>`;
}
module.exports = { renderPage, themeVars, contrast, hexOk, todayIn, homeOf, PAPER };
