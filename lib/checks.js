'use strict';
// Pre-publish checks. Errors block publishing; warnings are advice. Every issue says where it is (block index and
// field path for pages, settings section for the site) so the editor can take the lead straight to it, and a few
// carry a one-tap fix. The same rules run on the server and in the demo.
const { blocks } = require('./blocks');
const { plain, mdLinks, safeUrl } = require('./text');
const { contrast, hexOk, PAPER, homeOf } = require('./render');

const VAGUE = /^(click here|click|here|read more|more|this|link|this link|go|details|tap here)$/i;
const STARTER = /^(write something here\.|write something short here\.)$/i;
const PLACEHOLDER = /\[[A-Z][^\]\n]{0,40}\](?!\()/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A link problem, or null. live: slugs that will be live after publishing; home: the homepage slug.
function linkIssue(url, { live, home }) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (safeUrl(u) === '#' && u !== '#') {
    const guess = /^(www\.|[\w-]+\.[a-z]{2,})/i.test(u) && !/\s/.test(u) ? 'https://' + u : '';
    return { level: 'error', msg: `“${u}” isn't a working link. ${guess ? `Did you mean ${guess}?` : 'Links start with https://, a / for a page on your site, or mailto:'}`, fix: guess || undefined };
  }
  if (u.startsWith('/') && !u.startsWith('/static/')) {
    const slug = u.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/')[0] || home;
    if (!live.has(slug)) return { level: 'error', msg: `Links to ${u}, but that page isn't published.` };
  }
  return null;
}

function checkPage(page, { site = {}, live = new Set(), slug } = {}) {
  const out = [];
  const ctx = { live, home: homeOf(site) };
  const add = (level, msg, where = {}) => out.push({ level, msg, ...where });
  const list = page.blocks || [];
  if (!String(page.title || '').trim()) add('error', 'The page needs a title.', { field: 'title' });
  if (!list.length) add('error', 'The page is empty. Add at least one section.');
  const heroes = list.filter((b) => b.type === 'hero').length;
  if (heroes > 1) add('warn', `There are ${heroes} yard sign heroes. Use one per page so the page has a single main headline.`);
  if (String(page.seo_description || '').length > 160) add('warn', 'The search description is over 160 characters, so search engines will cut it off.', { field: 'seo_description' });
  const si = linkIssue(page.seo_image, ctx); if (si) add(si.level, `Social share image: ${si.msg}`, { field: 'seo_image' });

  const fields = (type, props, pre, b) => {
    const def = blocks[type]; if (!def) return;
    const at = (path, label, extra) => ({ block: b, path, label, section: def.label, ...extra });
    const one = (f, obj, path, item) => {
      const v = String(obj?.[f.key] ?? ''), text = f.rich ? plain(v) : v, where = at(path, f.label, item);
      const fallback = f.fallback && site.connections?.[f.fallback];
      if (f.required && !v.trim() && !fallback) add('error', `${f.label} is empty. Fill it in or remove it.`, where);
      if (f.kind === 'url' || f.kind === 'date' || f.kind === 'select') {
        if (f.kind === 'url') { const li = linkIssue(v, ctx); if (li) add(li.level, `${f.label}: ${li.msg}`, { ...where, fix: li.fix }); }
        if (f.kind === 'date' && v && isNaN(Date.parse(v))) add('error', `${f.label} isn't a valid date.`, where);
        return;
      }
      if (STARTER.test(text.trim())) add('error', `${f.label} still has the starter text. Write your own.`, where);
      const ph = text.match(PLACEHOLDER); if (ph) add('error', `${f.label}: replace the placeholder “${ph[0]}”.`, where);
      if (f.max && text.length > f.max) add('warn', `${f.label} is ${text.length} characters. Aim for ${f.max} or fewer so it fits.`, where);
      if (f.maxLines && text.split('\n').length > f.maxLines) add('warn', `${f.label} has ${text.split('\n').length} lines. Keep it to ${f.maxLines}.`, where);
      if (f.rich) for (const l of mdLinks(v)) {
        const li = linkIssue(l.url, ctx); if (li) add(li.level, `${f.label}, link “${l.text}”: ${li.msg}`, where);
        if (VAGUE.test(l.text.trim())) add('warn', `The link “${l.text}” doesn't say where it goes. Name the destination, like “our events page”.`, where);
      }
    };
    // a button whose text is set but has no link disappears on the live site
    const buttons = (fs, obj, pre2, item) => fs.filter((f) => /(^|_)label$/.test(f.key)).forEach((f) => {
      const u = fs.find((x) => x.key === f.key.replace(/label$/, 'url'));
      if (u && String(obj?.[f.key] || '').trim() && !String(obj?.[u.key] || '').trim() && !(u.fallback && site.connections?.[u.fallback]) && !u.required)
        add('warn', `The button “${obj[f.key]}” has no link, so it won't show on the live site.`, at(`${pre2}.${u.key}`, u.label, item));
      if (VAGUE.test(String(obj?.[f.key] || '').trim())) add('warn', `The button “${obj[f.key]}” doesn't say what it does. Start with a verb, like “RSVP” or “Join”.`, at(`${pre2}.${f.key}`, f.label, item));
    });
    for (const f of def.fields) {
      if (f.kind !== 'list') { one(f, props, `${pre}.${f.key}`); continue; }
      (props[f.key] || []).forEach((it, j) => {
        const item = { item: j, itemName: it[f.itemLabel] || `${f.label} item ${j + 1}` };
        f.fields.forEach((sf) => one(sf, it, `${pre}.${f.key}.${j}.${sf.key}`, item));
        buttons(f.fields, it, `${pre}.${f.key}.${j}`, item);
      });
    }
    buttons(def.fields, props, pre);
    if (type === 'image' && props.src && !String(props.alt || '').trim()) {
      if (String(props.caption || '').trim()) add('warn', 'Describe this image for people using screen readers. The caption is used until you do.', at(`${pre}.alt`, 'Describe the image'));
      else add('error', 'Describe this image for people using screen readers.', at(`${pre}.alt`, 'Describe the image'));
    }
  };
  list.forEach((b, i) => {
    fields(b.type, b.props || {}, String(i), i);
    if (b.type === 'columns') (b.props.cols || []).forEach((col, c) => col.forEach((a, k) => fields(a.type, a.props || {}, `${i}.cols.${c}.${k}`, i)));
  });
  return out;
}

function checkSite(site, { live = new Set() } = {}) {
  const out = [];
  const ctx = { live, home: homeOf(site) };
  const add = (level, msg, section, extra) => out.push({ level, msg, section, ...extra });
  const link = (u, label, section) => { const li = linkIssue(u, ctx); if (li) add(li.level, `${label}: ${li.msg}`, section, { fix: li.fix }); };
  if (!String(site.name || '').trim()) add('error', 'The chapter needs a name.', 'basics');
  if (site.contact_email && !EMAIL.test(site.contact_email)) add('error', `“${site.contact_email}” doesn't look like an email address.`, 'basics');
  if (!live.has(homeOf(site))) add('error', `The homepage (“${homeOf(site)}”) isn't published.`, 'menu');
  const navy = hexOk(site.theme?.primary, '#2C3659');
  if (contrast(navy, PAPER) < 4.5) add('error', 'The dark color is too light to read against the page background. Pick a darker color.', 'look');
  for (const [k, label] of [['primary', 'Dark color'], ['accent', 'Chapter color']]) if (site.theme?.[k] && !hexOk(site.theme[k])) add('warn', `${label} “${site.theme[k]}” isn't a color code like #2C3659, so the default is used.`, 'look');
  (site.nav || []).forEach((n, i) => {
    if (!String(n.label || '').trim()) add('error', `Menu item ${i + 1} has no label.`, 'menu');
    if (!n.path && !(n.children || []).length) add('warn', `Menu item “${n.label}” has no link.`, 'menu');
    link(n.path, `Menu item “${n.label}”`, 'menu');
    (n.children || []).forEach((c) => { if (!String(c.label || '').trim()) add('error', `A link under “${n.label}” has no label.`, 'menu'); link(c.path, `Menu item “${c.label}”`, 'menu'); });
  });
  const a = site.announcement || {};
  if (a.on && !String(a.text || '').trim()) add('warn', 'The announcement bar is on but has no text, so it is hidden.', 'announcement');
  if (a.on) link(a.url, 'Announcement link', 'announcement');
  if (a.on && a.link_label && !a.url) add('warn', `The announcement link “${a.link_label}” has no address, so it won't show.`, 'announcement');
  (site.footer_links || []).forEach((l) => { if (!String(l.label || '').trim()) add('error', 'A footer link has no label.', 'footer'); link(l.url, `Footer link “${l.label}”`, 'footer'); });
  for (const [k, label] of [['luma_calendar_url', 'Luma calendar'], ['action_network_url', 'Sign-up link'], ['donate_url', 'Donate link']]) link(site.connections?.[k], label, 'connections');
  for (const [k, v] of Object.entries(site.social || {})) if (/\s/.test(String(v || '').trim())) add('warn', `The ${k} handle “${v}” has a space in it.`, 'social');
  return out;
}

module.exports = { checkPage, checkSite, linkIssue };
