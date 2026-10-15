'use strict';
// Pre-publish checks. Errors block publishing; warnings are advice. Every issue says where it is (block index and
// field path for pages and items, settings section for the site) so the editor can take the lead straight to it, and
// a few carry a one-tap fix. The same rules run on the server and in the demo.
// ctx for pages and items:
//   live      page slugs that will be live after publishing
//   items     "col/id" of collection items that will be live (events/zoning-hearing, sections/join-band)
//   all       "col/id" of every item, live or not (to tell a deleted item from an unpublished one)
//   site, features, titles ({ "col/id": title } for messages)
const { blocks } = require('./blocks');
const { collections, colByPath } = require('./collections');
const { plain, mdLinks, safeUrl } = require('./text');
const { contrast, hexOk, PAPER, resolveTheme, paletteIssues } = require('./theme');
const { videoSrc } = require('./parts');
const { homeOf } = require('./render');

const VAGUE = /^(click here|click|here|read more|more|this|link|this link|go|details|tap here)$/i;
const STARTER = /^(write something here\.|write something short here\.)$/i;
const PLACEHOLDER = /\[[A-Z0-9][^\]\n]{0,40}\](?!\()/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ARCHIVES = { events: 'archive', endorsements: 'results' };

// A link problem, or null.
function linkIssue(url, { live = new Set(), items = new Set(), home = 'home' }) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (safeUrl(u) === '#' && u !== '#') {
    const guess = /^(www\.|[\w-]+\.[a-z]{2,})/i.test(u) && !/\s/.test(u) ? 'https://' + u : '';
    return { level: 'error', msg: `“${u}” isn't a working link. ${guess ? `Did you mean ${guess}?` : 'Links start with https://, a / for a page on your site, or mailto:'}`, fix: guess || undefined };
  }
  if (u.startsWith('/') && !/^\/(static|media|contact)\//.test(u)) {
    const segs = u.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/'), col = colByPath(segs[0]);
    if (segs.length > 1 && col) {
      if (segs[1] === ARCHIVES[col] || items.has(`${col}/${segs[1]}`)) return null;
      return { level: 'error', msg: `Links to ${u}, but that ${collections[col].one} isn't published.` };
    }
    const slug = segs[0] || home;
    if (!live.has(slug) && !col) return { level: 'error', msg: `Links to ${u}, but that page isn't published.` };
  }
  return null;
}

// Checks one set of fields (a block's or an item's). at(path, label, extra) says where an issue is.
function checkFields(fields, props, pre, at, add, ctx, site) {
  const one = (f, obj, path, item) => {
    const raw = obj?.[f.key], v = Array.isArray(raw) ? raw.join(',') : String(raw ?? ''), text = f.rich ? plain(v) : v, where = at(path, f.label, item);
    const fallback = f.fallback && site.connections?.[f.fallback];
    if (f.required && !v.trim() && !fallback) add('error', `${f.label} is empty. Fill it in or remove it.`, where);
    if (f.kind === 'ref' || f.kind === 'tags') {
      for (const id of Array.isArray(raw) ? raw : raw ? [raw] : []) if (ctx.all && !ctx.all.has(`${f.col}/${id}`)) add('warn', `${f.label}: “${id}” was deleted. Pick another or clear it.`, where);
      return;
    }
    if (f.kind === 'url' || f.kind === 'image' || f.kind === 'date' || f.kind === 'select') {
      if (f.kind === 'url' || f.kind === 'image') { const li = linkIssue(v, ctx); if (li) add(li.level, `${f.label}: ${li.msg}`, { ...where, fix: li.fix }); }
      if (f.kind === 'date' && v && isNaN(Date.parse(v))) add('error', `${f.label} isn't a valid date.`, where);
      return;
    }
    if (f.private && v && f.key === 'email' && !EMAIL.test(v)) add('error', `“${v}” doesn't look like an email address.`, where);
    if (STARTER.test(text.trim())) add('error', `${f.label} still has the starter text. Write your own.`, where);
    const ph = text.match(PLACEHOLDER); if (ph) add('error', `${f.label}: replace the placeholder “${ph[0]}”.`, where);
    if (f.max && text.length > f.max) add('warn', `${f.label} is ${text.length} characters. Aim for ${f.max} or fewer so it fits.`, where);
    if (f.maxLines && text.split('\n').length > f.maxLines) add('warn', `${f.label} has ${text.split('\n').length} lines. Keep it to ${f.maxLines}.`, where);
    if (f.rich) for (const l of mdLinks(v)) {
      const li = linkIssue(l.url, ctx); if (li) add(li.level, `${f.label}, link “${l.text}”: ${li.msg}`, { ...where, fix: li.fix ? v.replace(`](${l.url})`, `](${li.fix})`) : undefined });
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
  for (const f of fields) {
    if (f.kind !== 'list') { one(f, props, `${pre}.${f.key}`); continue; }
    (props[f.key] || []).forEach((it, j) => {
      const item = { item: j, itemName: it[f.itemLabel] || `${f.label} item ${j + 1}` };
      f.fields.forEach((sf) => one(sf, it, `${pre}.${f.key}.${j}.${sf.key}`, item));
      buttons(f.fields, it, `${pre}.${f.key}.${j}`, item);
    });
  }
  buttons(fields, props, pre);
}

// Checks a list of blocks (a page's, or an item's sections).
function checkBlocks(list, add, ctx, site) {
  const fields = (type, props, pre, b, vis) => {
    const def = blocks[type]; if (!def) return;
    const at = (path, label, extra) => ({ block: b, path, label, section: def.label, ...extra });
    if (def.feature && ctx.features?.[def.feature] === false) add('warn', `${def.label}: this feature is turned off for your chapter, so the section is hidden.`, at(pre, def.label));
    checkFields(def.fields, props, pre, at, add, ctx, site);
    if (type === 'image' && props.src && !String(props.alt || '').trim()) {
      if (String(props.caption || '').trim()) add('warn', 'Describe this image for people using screen readers. The caption is used until you do.', at(`${pre}.alt`, 'Describe the image'));
      else add('error', 'Describe this image for people using screen readers.', at(`${pre}.alt`, 'Describe the image'));
    }
    if (type === 'video' && props.url && !videoSrc(props.url)) add('warn', "That video link isn't from YouTube, Vimeo or Loom, so it shows as a link instead of playing on the page.", at(`${pre}.url`, 'Video link'));
    if (type === 'saved' && props.ref && ctx.all) {
      const key = `sections/${props.ref}`, name = ctx.titles?.[key] || props.ref;
      if (!ctx.all.has(key)) add('error', 'This saved section was deleted. Remove it from the page or turn it into a separate copy.', at(pre, 'Saved section'));
      else if (!ctx.items.has(key)) add('error', `The saved section “${name}” isn't published. Publish it together with this page.`, at(pre, 'Saved section'));
    }
    if (vis?.after && ctx.all && !ctx.all.has(`events/${vis.after}`)) add('warn', 'This section hides after an event that was deleted, so it always shows.', at(pre, 'Visibility'));
    if (vis?.from && vis?.until && vis.until <= vis.from) add('warn', 'This section is set to hide before it starts showing, so it never shows.', at(pre, 'Visibility'));
  };
  list.forEach((b, i) => {
    fields(b.type, b.props || {}, String(i), i, b.vis);
    if (b.type === 'columns') (b.props.cols || []).forEach((col, c) => col.forEach((a, k) => fields(a.type, a.props || {}, `${i}.cols.${c}.${k}`, i)));
  });
}

function checkPage(page, { site = {}, live = new Set(), slug, ...rest } = {}) {
  const out = [], ctx = { live, home: homeOf(site), items: new Set(), ...rest };
  const add = (level, msg, where = {}) => out.push({ level, msg, ...where });
  const list = page.blocks || [];
  if (!String(page.title || '').trim()) add('error', 'The page needs a title.', { field: 'title' });
  if (!list.length) add('error', 'The page is empty. Add at least one section.');
  const heroes = list.filter((b) => b.type === 'hero').length;
  if (heroes > 1) add('warn', `There are ${heroes} heroes. Use one per page so the page has a single main headline.`);
  if (String(page.seo_description || '').length > 160) add('warn', 'The search description is over 160 characters, so search engines will cut it off.', { field: 'seo_description' });
  const si = linkIssue(page.seo_image, ctx); if (si) add(si.level, `Social share image: ${si.msg}`, { field: 'seo_image' });
  checkBlocks(list, add, ctx, site);
  return out;
}

// A collection item: its fields (paths "f.<key>") and its sections.
function checkItem(col, item, { site = {}, live = new Set(), ...rest } = {}) {
  const def = collections[col], out = [], ctx = { live, home: homeOf(site), items: new Set(), ...rest };
  const add = (level, msg, where = {}) => out.push({ level, msg, ...where });
  if (def.feature && ctx.features?.[def.feature] === false) add('warn', `${def.label} are turned off for your chapter by national, so this ${def.one} won't show on the site.`);
  checkFields(def.fields, item, 'f', (path, label, extra) => ({ block: -1, path, label, section: `${def.one[0].toUpperCase()}${def.one.slice(1)} details`, ...extra }), add, ctx, site);
  if (col === 'events' && item.start && item.end && item.end < item.start) add('error', 'The event ends before it starts.', { block: -1, path: 'f.end', label: 'Ends' });
  if (col === 'people' && item.term_start && item.term_end && item.term_end < item.term_start) add('error', 'Stepped down is before Started.', { block: -1, path: 'f.term_end', label: 'Stepped down' });
  if (col === 'sections' && !(item.blocks || []).length) add('error', 'This saved section is empty. Add a section to it.');
  checkBlocks(item.blocks || [], add, ctx, site);
  return out;
}

function checkSite(site, { live = new Set(), national = {}, features = {} } = {}) {
  const out = [];
  const ctx = { live, home: homeOf(site) };
  const add = (level, msg, section, extra) => out.push({ level, msg, section, ...extra });
  const link = (u, label, section) => { const li = linkIssue(u, ctx); if (li) add(li.level, `${label}: ${li.msg}`, section, { fix: li.fix }); };
  if (!String(site.name || '').trim()) add('error', 'The chapter needs a name.', 'basics');
  if (site.contact_email && !EMAIL.test(site.contact_email)) add('error', `“${site.contact_email}” doesn't look like an email address.`, 'basics');
  if (!live.has(homeOf(site))) add('error', `The homepage (“${homeOf(site)}”) isn't published.`, 'menu');
  const th = site.theme || {}, t = resolveTheme(th, national, { custom: features.custom_colors });
  if (th.palette === 'custom' && !features.custom_colors) add('warn', 'National hasn’t turned on custom colours for your chapter, so an approved colour set is used. Pick one.', 'look');
  if (th.palette && th.palette !== 'custom' && t.palette !== th.palette) add('warn', 'That colour set is no longer approved, so the first approved set is used. Pick another.', 'look');
  if (t.palette === 'custom') {
    for (const i of paletteIssues(t)) add(i.level, i.msg, 'look');
    for (const [k, label] of [['primary', 'Dark color'], ['accent', 'Chapter color']]) if (th[k] && !hexOk(th[k])) add('warn', `${label} “${th[k]}” isn't a color code like #2C3659, so the default is used.`, 'look');
  } else if (contrast(t.primary, PAPER) < 4.5) add('error', 'The dark color is too light to read against the page background. Pick a darker color.', 'look');
  if (th.logo_request) add('warn', 'Your new logo is waiting for national approval. The current logo shows until then.', 'identity');
  for (const [k, label] of [['favicon', 'Browser tab icon'], ['share_image', 'Share image'], ['team_photo', 'Team photo']]) link(site.identity?.[k], label, 'identity');
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
  if (a.on && a.from && a.until && a.until < a.from) add('warn', 'The announcement is set to hide before it starts, so it never shows.', 'announcement');
  (site.footer_links || []).forEach((l) => { if (!String(l.label || '').trim()) add('error', 'A footer link has no label.', 'footer'); link(l.url, `Footer link “${l.label}”`, 'footer'); });
  for (const [k, label] of [['luma_calendar_url', 'Luma calendar'], ['action_network_url', 'Sign-up link'], ['donate_url', 'Donate link']]) link(site.connections?.[k], label, 'connections');
  for (const [k, v] of Object.entries(site.social || {})) if (/\s/.test(String(v || '').trim())) add('warn', `The ${k} handle “${v}” has a space in it.`, 'social');
  return out;
}

module.exports = { checkPage, checkItem, checkSite, linkIssue };
