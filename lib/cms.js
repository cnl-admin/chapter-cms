'use strict';
// The CMS core: drafts, publishing, version history, trash, share links, checks, shared collections, media,
// schedules and national settings, on top of a key-value store (lib/store.js on a server, lib/memstore.js in the
// tests and the single-file demo). No Node-only APIs, so the demo runs this exact code in the browser.
//
// Keys, per chapter:
//   site, site-draft                 published site settings and their unpublished draft
//   page/<slug>, draft/<slug>        published page and its unpublished draft
//   item/<col>/<id>, idraft/<col>/<id>  published collection item (C1) and its unpublished draft
//   ver/<doc>/<id>, verindex/<doc>   version snapshots and their index (<doc>: a page slug, @site, or @<col>-<id>)
//   trash/<id>                       deleted pages and items, restorable
//   shares                           preview links
//   schedule                         scheduled publishes and unpublishes (W5)
//   media/<id>, blob/<id>            media library entries and their files (M1, M2)
//   inbox/<id>                       contact form messages (C5)
//   meta                             content schema version, for automatic migrations (F2)
// The reserved chapter "national" holds config (lib/national.js), the national media library and national news.
// Every editable doc carries rev (bumped on each save), updated_at and updated_by. Saves send the rev they started
// from; a mismatch means someone else saved first and the save is refused with the current doc (409).
const { validateBlocks, defaultsFor, sampleFor, blocks: BLOCKS } = require('./blocks');
const { SLUG, slugify, localNow } = require('./text');
const { checkPage, checkItem, checkSite } = require('./checks');
const { renderPage, homeOf } = require('./render');
const { clean, publicOnly } = require('./fields');
const { collections, COLS, titleOf, itemPath, colByPath, isPast } = require('./collections');
const { templates } = require('./templates');
const { NATIONAL, cleanNational, featuresFor, FEATURES } = require('./national');
const { paletteFor, STYLES, FONTS, palettesFor, fontsFor, paletteIssues } = require('./theme');

const SITE = '@site';
const SCHEMA = 2;                // content schema; chapters below it are migrated on first use
const EDIT_SESSION = 10 * 60e3; // one "edited" version per person per 10 minutes of editing
const KEEP_EDITS = 100;          // publishes, restores and named versions are always kept
const SHARE_DAYS = 7, TRASH_DAYS = 30;
const RESERVED = ['admin', 'static', 'preview', 'api', 'media', 'contact', 'national'];
const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MEDIA_MAX = 6e6;

const fail = (status, msg, body) => Object.assign(new Error(msg), { status, body });
const str = (v, n = 300) => String(v ?? '').slice(0, n);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function rid(n = 10) {
  const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
}
const fromB64 = (s) => {
  const t = String(s || '').replace(/^data:[^,]*,/, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(t, 'base64'));
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const ascii = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));
// The real type of an uploaded file, from its first bytes (never trust the name). SVG is refused: it can carry scripts.
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : ascii(b, 1, 3) === 'PNG' ? 'image/png' : ascii(b, 0, 4) === 'GIF8' ? 'image/gif' : ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' ? 'image/webp' : null);

// Page and site content as stored, minus bookkeeping. Anything else a client sends is dropped.
const content = (d) => ({ title: d.title || '', seo_title: d.seo_title || '', seo_description: d.seo_description || '', seo_image: d.seo_image || '', blocks: d.blocks || [] });
// Stored content normalized the way a save would normalize it, so comparisons ignore harmless differences.
const normal = (d) => { try { return cleanPage(content(d)); } catch { return content(d); } };
function cleanPage(b, opts) {
  return { title: str(b?.title, 120).trim(), seo_title: str(b?.seo_title, 120), seo_description: str(b?.seo_description, 400), seo_image: str(b?.seo_image, 500), blocks: validateBlocks(b?.blocks ?? [], opts) };
}
// Collection items: their fields plus, for most collections, sections of their own.
function itemContent(col, d = {}) {
  const def = collections[col];
  return { ...Object.fromEntries(def.fields.map((f) => [f.key, d[f.key] ?? (f.kind === 'tags' ? [] : '')])), blocks: d.blocks || [] };
}
function cleanItem(col, input, opts = {}) {
  const def = collections[col], out = clean(def.fields, input);
  out[def.titleKey] = String(out[def.titleKey]).trim();
  out.blocks = def.body === false ? [] : validateBlocks(input?.blocks ?? [], { ...opts, noSaved: col === 'sections' });
  return out;
}
const normalItem = (col) => (d) => { try { return cleanItem(col, itemContent(col, d)); } catch { return itemContent(col, d); } };
function cleanNav(list, depth = 0) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((n) => {
    const item = { label: str(n?.label, 40), path: str(n?.path, 300).trim() };
    if (depth) return item;
    item.style = n?.style === 'button' ? 'button' : 'link';
    if (Array.isArray(n?.children) && n.children.length) item.children = cleanNav(n.children, 1);
    return item;
  });
}
const dateOnly = (s) => (/^\d{4}-\d\d-\d\d$/.test(s || '') ? s : '');
function cleanSite(o = {}) {
  const a = o.announcement || {}, th = o.theme || {}, id = o.identity || {};
  const palette = SLUG.test(th.palette || '') || th.palette === 'custom' ? th.palette : paletteFor(th.primary, th.accent);
  return {
    name: str(o.name, 80), tagline: str(o.tagline), footer: str(o.footer, 500), contact_email: str(o.contact_email, 120).trim(),
    timezone: str(o.timezone, 60) || 'America/Chicago', home: SLUG.test(o.home || '') ? o.home : 'home',
    theme: { style: STYLES[th.style] ? th.style : 'yard', palette, fonts: FONTS.some((f) => f.id === th.fonts) ? th.fonts : 'yard', primary: str(th.primary, 9), accent: str(th.accent, 9), logo: str(th.logo, 500), logo_request: str(th.logo_request, 500) },
    identity: { favicon: str(id.favicon, 500), share_image: str(id.share_image, 500), team_photo: str(id.team_photo, 500), share_auto: str(id.share_auto, 500) },
    social: { x: str(o.social?.x, 80), ig: str(o.social?.ig, 80), bsky: str(o.social?.bsky, 120), fb: str(o.social?.fb, 200) },
    nav: cleanNav(o.nav),
    announcement: { on: !!a.on, text: str(a.text, 160), link_label: str(a.link_label, 30), url: str(a.url, 300).trim(), from: dateOnly(a.from), until: dateOnly(a.until) },
    footer_links: (Array.isArray(o.footer_links) ? o.footer_links : []).slice(0, 12).map((l) => ({ label: str(l?.label, 40), url: str(l?.url, 300).trim() })),
    disclaimer: str(o.disclaimer, 300),
    connections: { luma_calendar_url: str(o.connections?.luma_calendar_url, 300).trim(), action_network_url: str(o.connections?.action_network_url, 300).trim(), donate_url: str(o.connections?.donate_url, 300).trim() },
  };
}
const SITE_PARTS = { name: 'Name', tagline: 'Tagline', footer: 'Footer', contact_email: 'Contact email', timezone: 'Timezone', home: 'Homepage', theme: 'Look', identity: 'Identity kit', social: 'Social accounts', nav: 'Menu', announcement: 'Announcement bar', footer_links: 'Footer links', disclaimer: 'Disclaimer', connections: 'Connections' };
const navPaths = (nav) => (nav || []).flatMap((n) => [n.path, ...(n.children || []).map((c) => c.path)]);
const stripNav = (nav, path) => (nav || []).filter((n) => n.path !== path).map((n) => (n.children ? { ...n, children: n.children.filter((c) => c.path !== path) } : n));
const findNav = (nav, path) => (nav || []).flatMap((n) => [n, ...(n.children || [])]).find((n) => n.path === path);

function changeSummary(live, draft) {
  if (!live) return `New, ${draft.blocks.length} section${draft.blocks.length === 1 ? '' : 's'}`;
  const parts = [];
  const before = new Map(live.blocks.map((b) => [b.id, b])), after = new Map(draft.blocks.map((b) => [b.id, b]));
  const added = draft.blocks.filter((b) => !before.has(b.id)).length, removed = live.blocks.filter((b) => !after.has(b.id)).length;
  const changed = draft.blocks.filter((b) => before.has(b.id) && !same(before.get(b.id), b)).length;
  const kept = draft.blocks.filter((b) => before.has(b.id)).map((b) => b.id), order = live.blocks.filter((b) => after.has(b.id)).map((b) => b.id);
  const n = (x, w) => `${x} section${x === 1 ? '' : 's'} ${w}`;
  if (changed) parts.push(n(changed, 'edited')); if (added) parts.push(n(added, 'added')); if (removed) parts.push(n(removed, 'removed'));
  if (!same(kept, order)) parts.push('sections reordered');
  const fields = Object.keys(draft).filter((k) => k !== 'blocks' && !same(live[k] ?? '', draft[k] ?? ''));
  if (fields.includes('title')) parts.push('title changed');
  if (fields.some((k) => /^seo_/.test(k))) parts.push('search and sharing details changed');
  const other = fields.filter((k) => k !== 'title' && !/^seo_/.test(k));
  if (other.length) parts.push(`${other.length} detail${other.length === 1 ? '' : 's'} changed`);
  return parts.join(', ') || 'No visible changes';
}

// Doc names used by versions, presence and checks: a page slug, @site, or @<col>-<id> for a collection item.
const itemDoc = (col, id) => `@${col}-${id}`;
function parseDoc(d) {
  if (d === SITE) return { kind: 'site' };
  if (SLUG.test(d || '')) return { kind: 'page', slug: d };
  const m = /^@([a-z]+)-([a-z0-9-]{1,40})$/.exec(d || '');
  return m && collections[m[1]] ? { kind: 'item', col: m[1], id: m[2] } : null;
}

function createCms({ store, now = () => new Date() }) {
  const iso = () => now().toISOString();
  const okSlug = (s) => { if (!SLUG.test(s || '')) throw fail(400, 'Page names use lowercase letters, numbers and dashes.'); return s; };
  const okCol = (c) => { if (!collections[c]) throw fail(404, 'Unknown collection'); return c; };
  const okDoc = (d) => { const p = parseDoc(d); if (!p) throw fail(400, 'bad document name'); return p; };
  const okChapter = (ch) => { if (ch === NATIONAL) throw fail(404, 'Unknown chapter'); return ch; };
  async function liveSite(ch) {
    okChapter(ch);
    const s = await store.get(ch, 'site'); if (!s) throw fail(404, 'Unknown chapter');
    await ensureSchema(ch);
    return s;
  }
  async function siteState(ch) {
    const live = await liveSite(ch), draft = await store.get(ch, 'site-draft');
    return { doc: draft || live, draft: !!draft, live };
  }
  async function pageState(ch, slug) {
    okSlug(slug);
    const [draft, live] = await Promise.all([store.get(ch, `draft/${slug}`), store.get(ch, `page/${slug}`)]);
    return { doc: draft || live, draft, live };
  }
  async function itemState(ch, col, id) {
    okCol(col); okSlug(id);
    const [draft, live] = await Promise.all([store.get(ch, `idraft/${col}/${id}`), store.get(ch, `item/${col}/${id}`)]);
    return { doc: draft || live, draft, live };
  }
  const idsIn = async (ch, prefix) => (await store.list(ch, prefix)).map((k) => k.split('/').pop());
  async function slugSets(ch) {
    const [l, d] = await Promise.all([store.list(ch, 'page/'), store.list(ch, 'draft/')]);
    return { live: new Set(l.map((k) => k.slice(5))), drafts: new Set(d.map((k) => k.slice(6))) };
  }
  async function itemSets(ch, col) { return { live: new Set(await idsIn(ch, `item/${col}/`)), drafts: new Set(await idsIn(ch, `idraft/${col}/`)) }; }
  async function freeSlug(ch, base) {
    const { live, drafts } = await slugSets(ch);
    let slug = base, n = 2;
    while (live.has(slug) || drafts.has(slug) || RESERVED.includes(slug)) slug = `${base}-${n++}`.slice(0, 40);
    return slug;
  }
  async function freeItemId(ch, col, base) {
    const { live, drafts } = await itemSets(ch, col), archive = { events: 'archive', endorsements: 'results' }[col];
    let id = base, n = 2;
    while (live.has(id) || drafts.has(id) || id === archive) id = `${base}-${n++}`.slice(0, 40);
    return id;
  }
  const national = async () => cleanNational((await store.get(NATIONAL, 'config')) || {});
  const features = async (ch) => featuresFor(await national(), ch);
  const needFeature = async (ch, col) => { const f = collections[col].feature; if (f && (await features(ch))[f] === false) throw fail(403, `${collections[col].label} are turned off for this chapter by national.`); };

  // ---- automatic migrations (F2). Blocks upgrade themselves through their migrations whenever they are saved; on
  // first use a chapter's stored pages are upgraded once, and inline lists move into the shared collections.
  const migrated = new Set();
  async function ensureSchema(ch) {
    if (migrated.has(ch)) return;
    const meta = await store.get(ch, 'meta');
    if ((meta?.schema || 1) < SCHEMA) await migrateChapter(ch);
    migrated.add(ch);
  }
  // Collects items that migrations pull out of blocks, matching ones that already exist by Luma ID or title.
  async function collector(ch) {
    const known = {}, found = [], next = {};
    for (const col of COLS) {
      known[col] = [];
      for (const pre of ['item/', 'idraft/']) for (const k of await store.list(ch, `${pre}${col}/`)) known[col].push({ id: k.split('/').pop(), ...(await store.get(ch, k)) });
    }
    const self = {
      live: false,
      extract(col, raw) {
        if (!collections[col]) return '';
        let item; try { item = cleanItem(col, { ...collections[col].defaults, ...raw, blocks: [] }); } catch { return ''; }
        const title = titleOf(col, item).toLowerCase();
        const match = known[col].find((x) => (item.luma_id && x.luma_id === item.luma_id) || (titleOf(col, x).toLowerCase() === title && (col !== 'events' || x.start === item.start)));
        if (match) { if (self.live && match.pending) match.live = true; return match.id; }
        const taken = new Set(known[col].map((x) => x.id)), base = slugify(titleOf(col, item), collections[col].one.replace(/\s/g, '-'));
        let id = base, n = 2;
        while (taken.has(id) || id === 'archive' || id === 'results') id = `${base}-${n++}`.slice(0, 40);
        // lists that had an order on the page keep it
        if (collections[col].fields.some((f) => f.key === 'order') && !item.order) item.order = String((next[col] = (next[col] || 0) + 1));
        const entry = { id, ...item, pending: true, live: self.live };
        known[col].push(entry); found.push({ col, entry });
        return id;
      },
      async save(user) {
        const at = iso();
        for (const { col, entry } of found) {
          const { id, pending, live, ...item } = entry;
          if (live) await store.put(ch, `item/${col}/${id}`, { ...item, rev: 1, updated_at: at, updated_by: user, published_at: at, published_by: user });
          else await store.put(ch, `idraft/${col}/${id}`, { ...item, rev: 1, updated_at: at, updated_by: user });
          await addVersion(ch, itemDoc(col, id), item, user, live ? 'publish' : 'create', live ? { batch: 'migrate' } : {});
        }
        return found.map(({ col, entry }) => `${col}/${entry.id}`);
      },
    };
    return self;
  }
  async function migrateChapter(ch) {
    const col = await collector(ch);
    for (const [prefix, live] of [['page/', true], ['draft/', false]]) {
      for (const k of await store.list(ch, prefix)) {
        const d = await store.get(ch, k);
        col.live = live;
        let blocks; try { blocks = validateBlocks(d.blocks || [], { extract: col.extract }); } catch { continue; }
        if (!same(blocks, d.blocks)) await store.put(ch, k, { ...d, blocks });
      }
    }
    const moved = await col.save('Automatic update');
    await store.put(ch, 'meta', { schema: SCHEMA, migrated_at: iso(), moved });
  }

  // ---- versions
  const docTitle = (doc, data) => { const p = parseDoc(doc); return p?.kind === 'site' ? 'Site settings' : p?.kind === 'item' ? titleOf(p.col, data) : data.title; };
  async function addVersion(ch, doc, data, user, kind, extra = {}) {
    const idx = (await store.get(ch, `verindex/${doc}`)) || { items: [] };
    const at = iso(), title = docTitle(doc, data), last = idx.items[idx.items.length - 1];
    if (kind === 'edit' && last && last.kind === 'edit' && !last.name && last.by === user && now() - new Date(last.started || last.at) < EDIT_SESSION) {
      Object.assign(last, { at, title });
      await store.put(ch, `ver/${doc}/${last.id}`, { ...last, doc: data });
      await store.put(ch, `verindex/${doc}`, idx);
      return last;
    }
    const item = { id: at.replace(/[:.]/g, '-') + '-' + rid(4), at, started: at, by: user, kind, name: '', title, ...extra };
    idx.items.push(item);
    const plain = idx.items.filter((x) => x.kind === 'edit' && !x.name);
    const drop = new Set(plain.slice(0, Math.max(0, plain.length - KEEP_EDITS)).map((x) => x.id));
    if (drop.size) { idx.items = idx.items.filter((x) => !drop.has(x.id)); for (const id of drop) await store.del(ch, `ver/${doc}/${id}`); }
    await store.put(ch, `ver/${doc}/${item.id}`, { ...item, doc: data });
    await store.put(ch, `verindex/${doc}`, idx);
    return item;
  }
  async function versions(ch, doc) {
    okDoc(doc); await liveSite(ch);
    return ((await store.get(ch, `verindex/${doc}`)) || { items: [] }).items.slice().reverse();
  }
  async function version(ch, doc, id) {
    okDoc(doc);
    const v = await store.get(ch, `ver/${doc}/${id}`);
    if (!v) throw fail(404, 'That version no longer exists.');
    return v;
  }
  async function nameVersion(ch, doc, id, name) {
    const v = await version(ch, doc, id);
    const idx = await store.get(ch, `verindex/${doc}`), item = idx.items.find((x) => x.id === id);
    v.name = item.name = str(name, 80).trim();
    await store.put(ch, `ver/${doc}/${id}`, v); await store.put(ch, `verindex/${doc}`, idx);
    return item;
  }
  // Keep a copy of someone's edits that are about to be replaced (for example "use theirs" in a conflict).
  async function stash(ch, doc, data, user, name) {
    const p = okDoc(doc);
    const c = p.kind === 'site' ? cleanSite(data) : p.kind === 'item' ? cleanItem(p.col, data) : cleanPage(data);
    return addVersion(ch, doc, c, user, 'edit', { name: str(name, 80) || `${user}'s unsaved edits` });
  }

  // ---- writing drafts. A draft identical to the live doc is dropped, so undoing every change clears "unpublished".
  async function writeDraft(ch, keys, data, prevRev, live, user, norm) {
    const rev = prevRev + 1, meta = { rev, updated_at: iso(), updated_by: user };
    const isLive = !!live && same(norm(live), data);
    if (isLive) { await store.del(ch, keys.draft); await store.put(ch, keys.live, { ...live, rev }); }
    else await store.put(ch, keys.draft, { ...data, ...meta });
    return { rev, draft: !isLive, ...meta };
  }
  const pageKeys = (slug) => ({ live: `page/${slug}`, draft: `draft/${slug}` });
  const itemKeys = (col, id) => ({ live: `item/${col}/${id}`, draft: `idraft/${col}/${id}` });
  const writePageDraft = (ch, slug, page, prevRev, live, user) => writeDraft(ch, pageKeys(slug), page, prevRev, live, user, normal);
  async function writeSiteDraft(ch, site, prevRev, live, user) {
    const r = await writeDraft(ch, { live: 'site', draft: 'site-draft' }, site, prevRev, live, user, cleanSite);
    await addVersion(ch, SITE, site, user, 'edit');
    return r;
  }
  async function editSiteDraft(ch, user, fn) {
    const { doc, live } = await siteState(ch);
    const s = cleanSite(doc); fn(s);
    return writeSiteDraft(ch, cleanSite(s), doc.rev || 0, live, user);
  }
  // Removes a page from the live and draft menus at once, so the live menu never links to a missing page.
  async function dropFromNav(ch, slug) {
    for (const key of ['site', 'site-draft']) {
      const s = await store.get(ch, key);
      if (!s || !navPaths(s.nav).includes('/' + slug)) continue;
      await store.put(ch, key, { ...s, nav: stripNav(s.nav, '/' + slug), rev: (s.rev || 0) + 1 });
    }
  }
  const conflict = (doc, what, current) => fail(409, `${doc.updated_by || 'Someone'} saved ${what} while you were editing.`, { error: 'conflict', current: { ...current, rev: doc.rev || 0, by: doc.updated_by, at: doc.updated_at } });

  // ---- pages
  async function getPage(ch, slug) {
    await liveSite(ch);
    const { doc, draft, live } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    return { slug, page: content(doc), rev: doc.rev || 0, draft: !!draft, live: !!live, updated_at: doc.updated_at, updated_by: doc.updated_by };
  }
  async function savePage(ch, slug, { page, baseRev, force } = {}, user) {
    await liveSite(ch);
    const { doc, live } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    if (!force && baseRev != null && +baseRev !== (doc.rev || 0)) throw conflict(doc, 'this page', { page: content(doc) });
    const clean = cleanPage(page);
    if (!clean.title) clean.title = doc.title || slug;
    const r = await writePageDraft(ch, slug, clean, doc.rev || 0, live, user);
    await addVersion(ch, slug, clean, user, 'edit');
    return { slug, page: clean, live: !!live, ...r };
  }
  async function newPage(ch, { title, addToMenu = true, template } = {}, user) {
    const site = (await siteState(ch)).doc, tpl = template ? templates[template] : null;
    if (template && tpl?.kind !== 'page') throw fail(400, 'Unknown page template');
    const t = str(title, 60).trim() || 'New page', slug = await freeSlug(ch, slugify(t));
    const blocks = tpl ? tpl.blocks() : [{ type: 'hero', props: { ...defaultsFor('hero'), heading: t, subheading: site.name || '' } }, { type: 'text', props: defaultsFor('text') }];
    const page = cleanPage({ title: t, blocks });
    await store.put(ch, `draft/${slug}`, { ...page, rev: 1, updated_at: iso(), updated_by: user });
    await addVersion(ch, slug, page, user, 'create');
    if (addToMenu) await editSiteDraft(ch, user, (s) => { s.nav = [...s.nav, { label: t.slice(0, 40), path: '/' + slug, style: 'link' }]; });
    return { slug };
  }
  async function duplicatePage(ch, slug, user) {
    const { doc } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    const page = { ...content(doc), title: `${doc.title} (copy)`.slice(0, 120) }, to = await freeSlug(ch, slugify(doc.title + ' copy'));
    await store.put(ch, `draft/${to}`, { ...page, rev: 1, updated_at: iso(), updated_by: user });
    await addVersion(ch, to, page, user, 'create');
    return { slug: to };
  }
  async function moveVersions(ch, from, to) {
    for (const k of await store.list(ch, `ver/${from}/`)) { await store.put(ch, `ver/${to}/${k.split('/').pop()}`, await store.get(ch, k)); await store.del(ch, k); }
    const idx = await store.get(ch, `verindex/${from}`); if (idx) { await store.put(ch, `verindex/${to}`, idx); await store.del(ch, `verindex/${from}`); }
  }
  // Titles can always change. The web address can change only before the page is first published (no redirects yet).
  async function renamePage(ch, slug, { title, slug: newSlug } = {}, user) {
    const { doc, live } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    let target = slug;
    if (newSlug && newSlug !== slug) {
      if (live) throw fail(400, "This page is already published, so its web address can't change yet.");
      okSlug(newSlug);
      if (RESERVED.includes(newSlug) || (await freeSlug(ch, newSlug)) !== newSlug) throw fail(409, 'That web address is already taken.');
      await store.put(ch, `draft/${newSlug}`, doc); await store.del(ch, `draft/${slug}`);
      await moveVersions(ch, slug, newSlug);
      const { doc: s } = await siteState(ch);
      if (navPaths(s.nav).includes('/' + slug)) await editSiteDraft(ch, user, (x) => { const fix = (n) => (n.path === '/' + slug ? { ...n, path: '/' + newSlug } : n); x.nav = x.nav.map((n) => ({ ...fix(n), ...(n.children ? { children: n.children.map(fix) } : {}) })); });
      target = newSlug;
    }
    const t = title == null ? null : str(title, 120).trim();
    if (t === '') throw fail(400, 'The page needs a title.');
    if (t && t !== doc.title) {
      const cur = (await store.get(ch, `draft/${target}`)) || doc;
      const page = { ...content(cur), title: t };
      await writePageDraft(ch, target, page, cur.rev || 0, live, user);
      await addVersion(ch, target, page, user, 'edit');
      const item = findNav((await siteState(ch)).doc.nav, target === homeOf((await siteState(ch)).doc) ? '/' : '/' + target);
      if (item && item.label.toLowerCase() === String(doc.title).toLowerCase().slice(0, 40)) {
        await editSiteDraft(ch, user, (x) => { const fix = (n) => (n.path === item.path && n.label === item.label ? { ...n, label: t.slice(0, 40) } : n); x.nav = x.nav.map((n) => ({ ...fix(n), ...(n.children ? { children: n.children.map(fix) } : {}) })); });
      }
    }
    return { slug: target };
  }
  async function guardHome(ch, slug) {
    const { doc, live } = await siteState(ch);
    if (homeOf(doc) === slug || homeOf(live) === slug) throw fail(400, 'This is your homepage. Choose a different homepage first.');
  }
  async function unpublishPage(ch, slug, user) {
    const { draft, live } = await pageState(ch, slug);
    if (!live) throw fail(400, 'This page is not published.');
    await guardHome(ch, slug);
    if (!draft) await store.put(ch, `draft/${slug}`, { ...live, rev: (live.rev || 0) + 1, updated_at: iso(), updated_by: user });
    await store.del(ch, `page/${slug}`);
    await dropFromNav(ch, slug);
    await addVersion(ch, slug, content(live), user, 'unpublish');
    return { slug };
  }
  async function deletePage(ch, slug, user) {
    const { doc, draft, live } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    await guardHome(ch, slug);
    const s = (await siteState(ch)).doc, id = iso().replace(/[:.]/g, '-') + '-' + rid(4);
    await store.put(ch, `trash/${id}`, { id, slug, title: doc.title, at: iso(), by: user, live, draft, navItem: findNav(s.nav, '/' + slug) || null });
    await store.del(ch, `page/${slug}`); await store.del(ch, `draft/${slug}`);
    await dropFromNav(ch, slug);
    await cancelFor(ch, 'page:' + slug);
    return { trashed: id };
  }
  async function trash(ch) {
    const out = [];
    for (const k of await store.list(ch, 'trash/')) {
      const t = await store.get(ch, k);
      if (now() - new Date(t.at) > TRASH_DAYS * 864e5) { await store.del(ch, k); continue; }
      out.push({ id: t.id, slug: t.slug, col: t.col || null, title: t.title, at: t.at, by: t.by });
    }
    return out.reverse();
  }
  // Restores as a draft (back in the menu if it was there); it goes live with the next publish.
  async function restoreTrash(ch, id, user) {
    if (!/^[\w-]{1,64}$/.test(id || '')) throw fail(400, 'bad id');
    const t = await store.get(ch, `trash/${id}`);
    if (!t) throw fail(404, 'That is no longer in the trash.');
    const doc = t.draft || t.live;
    if (t.col) {
      const to = await freeItemId(ch, t.col, t.slug);
      await store.put(ch, `idraft/${t.col}/${to}`, { ...itemContent(t.col, doc), rev: (doc.rev || 0) + 1, updated_at: iso(), updated_by: user });
      await store.del(ch, `trash/${id}`);
      return { col: t.col, id: to };
    }
    const slug = await freeSlug(ch, t.slug);
    await store.put(ch, `draft/${slug}`, { ...content(doc), rev: (doc.rev || 0) + 1, updated_at: iso(), updated_by: user });
    if (t.navItem) await editSiteDraft(ch, user, (s) => { s.nav = [...s.nav, { ...t.navItem, path: '/' + slug }]; });
    await store.del(ch, `trash/${id}`);
    return { slug };
  }
  async function setHome(ch, slug, user) {
    const { doc } = await pageState(ch, slug);
    if (!doc) throw fail(404, 'Page not found');
    const old = homeOf((await siteState(ch)).doc);
    if (old !== slug) await editSiteDraft(ch, user, (s) => {
      s.home = slug;
      const swap = (n) => (n.path === '/' + slug ? { ...n, path: '/' } : n.path === '/' ? { ...n, path: '/' + old } : n);
      s.nav = s.nav.map((n) => ({ ...swap(n), ...(n.children ? { children: n.children.map(swap) } : {}) }));
    });
    return { home: slug };
  }
  async function discardPage(ch, slug) {
    const { draft, live } = await pageState(ch, slug);
    if (!draft) return getPage(ch, slug);
    if (!live) throw fail(400, "This page has never been published, so there's nothing to go back to. Delete it instead.");
    await store.del(ch, `draft/${slug}`);
    await store.put(ch, `page/${slug}`, { ...live, rev: Math.max(live.rev || 0, draft.rev || 0) + 1 });
    return getPage(ch, slug);
  }

  // ---- collection items (C1): the same drafts, versions, conflicts, trash and publishing as pages
  async function listItems(ch, col) {
    const site = await liveSite(ch); okCol(col);
    const { live, drafts } = await itemSets(ch, col), out = [], nowL = localNow(site.timezone, now());
    const sched = ((await store.get(ch, 'schedule')) || { items: [] }).items;
    for (const id of new Set([...live, ...drafts])) {
      const d = drafts.has(id) ? await store.get(ch, `idraft/${col}/${id}`) : null, l = live.has(id) ? await store.get(ch, `item/${col}/${id}`) : null, doc = d || l;
      const { blocks, ...fields } = itemContent(col, doc);
      out.push({ ...fields, id, title: titleOf(col, doc), path: itemPath(col, id), live: !!l, draft: !!d, past: isPast(col, doc, nowL), sections: blocks.length, updated_at: doc.updated_at, updated_by: doc.updated_by, published_at: l?.published_at, scheduled: sched.filter((x) => x.doc === `item:${col}/${id}`).map((x) => ({ action: x.action, at: x.at })) });
    }
    out.sort(collections[col].sort);
    if (col === 'sections') {
      const uses = await sectionUses(ch);
      out.forEach((x) => { x.usedOn = uses[x.id] || []; });
    }
    return out;
  }
  // Pages and items that use each saved section: { id: [title, ...] }
  async function sectionUses(ch) {
    const out = {};
    const scan = (blocks, title) => (blocks || []).forEach((b) => { if (b.type === 'saved' && b.props?.ref) (out[b.props.ref] ||= new Set()).add(title); });
    for (const pre of ['page/', 'draft/']) for (const k of await store.list(ch, pre)) { const d = await store.get(ch, k); scan(d.blocks, d.title); }
    for (const col of COLS) for (const pre of ['item/', 'idraft/']) for (const k of await store.list(ch, `${pre}${col}/`)) { const d = await store.get(ch, k); scan(d.blocks, titleOf(col, d)); }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
  }
  async function getItem(ch, col, id) {
    await liveSite(ch);
    const { doc, draft, live } = await itemState(ch, col, id);
    if (!doc) throw fail(404, `That ${collections[col].one} doesn't exist.`);
    return { col, id, item: itemContent(col, doc), rev: doc.rev || 0, draft: !!draft, live: !!live, path: itemPath(col, id), updated_at: doc.updated_at, updated_by: doc.updated_by };
  }
  async function saveItem(ch, col, id, { item, baseRev, force } = {}, user) {
    await liveSite(ch);
    const { doc, live } = await itemState(ch, col, id);
    if (!doc) throw fail(404, `That ${collections[col].one} doesn't exist.`);
    if (!force && baseRev != null && +baseRev !== (doc.rev || 0)) throw conflict(doc, `this ${collections[col].one}`, { item: itemContent(col, doc) });
    const c = cleanItem(col, item);
    if (!c[collections[col].titleKey]) c[collections[col].titleKey] = titleOf(col, doc);
    const r = await writeDraft(ch, itemKeys(col, id), c, doc.rev || 0, live, user, normalItem(col));
    await addVersion(ch, itemDoc(col, id), c, user, 'edit');
    return { col, id, item: c, live: !!live, ...r };
  }
  async function newItem(ch, col, { title, template, fields = {}, blocks } = {}, user) {
    await liveSite(ch); okCol(col); await needFeature(ch, col);
    const def = collections[col], tpl = template ? templates[template] : null;
    if (template && tpl?.kind !== col) throw fail(400, `Unknown ${def.one} template`);
    const site = await liveSite(ch), today = localNow(site.timezone, now());
    const start = { ...def.defaults, ...(col === 'posts' ? { date: today.slice(0, 11) + '12:00', author: '' } : {}), ...(tpl?.fields || {}) };
    for (const f of def.fields) if (fields[f.key] != null) start[f.key] = fields[f.key];
    const t = str(title, 100).trim();
    if (t) start[def.titleKey] = t;
    const item = cleanItem(col, { ...start, blocks: tpl ? tpl.blocks() : Array.isArray(blocks) ? blocks : [] });
    const id = await freeItemId(ch, col, slugify(titleOf(col, item), def.one.replace(/\s/g, '-')));
    await store.put(ch, `idraft/${col}/${id}`, { ...item, rev: 1, updated_at: iso(), updated_by: user });
    await addVersion(ch, itemDoc(col, id), item, user, 'create');
    return { col, id };
  }
  async function duplicateItem(ch, col, id, user) {
    const { doc } = await itemState(ch, col, id);
    if (!doc) throw fail(404, 'Not found');
    const def = collections[col], item = { ...itemContent(col, doc), [def.titleKey]: `${titleOf(col, doc)} (copy)`.slice(0, 100) };
    const to = await freeItemId(ch, col, slugify(titleOf(col, doc) + ' copy'));
    await store.put(ch, `idraft/${col}/${to}`, { ...item, rev: 1, updated_at: iso(), updated_by: user });
    await addVersion(ch, itemDoc(col, to), item, user, 'create');
    return { col, id: to };
  }
  // The web address can change until the item is first published, like a page's.
  async function renameItem(ch, col, id, { id: to } = {}, user) {
    const { doc, live } = await itemState(ch, col, id);
    if (!doc) throw fail(404, 'Not found');
    if (!to || to === id) return { col, id };
    if (live) throw fail(400, "This is already published, so its web address can't change yet.");
    okSlug(to);
    if ((await freeItemId(ch, col, to)) !== to) throw fail(409, 'That web address is already taken.');
    await store.put(ch, `idraft/${col}/${to}`, { ...doc, updated_at: iso(), updated_by: user }); await store.del(ch, `idraft/${col}/${id}`);
    await moveVersions(ch, itemDoc(col, id), itemDoc(col, to));
    await cancelFor(ch, `item:${col}/${id}`);
    return { col, id: to };
  }
  async function unpublishItem(ch, col, id, user) {
    const { draft, live } = await itemState(ch, col, id);
    if (!live) throw fail(400, 'This is not published.');
    if (!draft) await store.put(ch, `idraft/${col}/${id}`, { ...live, rev: (live.rev || 0) + 1, updated_at: iso(), updated_by: user });
    await store.del(ch, `item/${col}/${id}`);
    await addVersion(ch, itemDoc(col, id), itemContent(col, live), user, 'unpublish');
    return { col, id };
  }
  async function deleteItem(ch, col, id, user) {
    const { doc, draft, live } = await itemState(ch, col, id);
    if (!doc) throw fail(404, 'Not found');
    if (col === 'sections') { const uses = (await sectionUses(ch))[id]; if (uses?.length) throw fail(400, `This saved section is used on ${uses.join(', ')}. Remove it there first, or turn those into separate copies.`); }
    const tid = iso().replace(/[:.]/g, '-') + '-' + rid(4);
    await store.put(ch, `trash/${tid}`, { id: tid, col, slug: id, title: titleOf(col, doc), at: iso(), by: user, live, draft });
    await store.del(ch, `item/${col}/${id}`); await store.del(ch, `idraft/${col}/${id}`);
    await cancelFor(ch, `item:${col}/${id}`);
    return { trashed: tid };
  }
  async function discardItem(ch, col, id) {
    const { draft, live } = await itemState(ch, col, id);
    if (!draft) return getItem(ch, col, id);
    if (!live) throw fail(400, "This has never been published, so there's nothing to go back to. Delete it instead.");
    await store.del(ch, `idraft/${col}/${id}`);
    await store.put(ch, `item/${col}/${id}`, { ...live, rev: Math.max(live.rev || 0, draft.rev || 0) + 1 });
    return getItem(ch, col, id);
  }

  // ---- site settings
  async function getSite(ch) {
    const { doc, draft } = await siteState(ch);
    return { site: cleanSite(doc), rev: doc.rev || 0, draft, updated_at: doc.updated_at, updated_by: doc.updated_by };
  }
  async function saveSite(ch, { site, baseRev, force } = {}, user) {
    const { doc, live } = await siteState(ch);
    if (!force && baseRev != null && +baseRev !== (doc.rev || 0)) throw conflict(doc, 'the settings', { site: cleanSite(doc) });
    const c = cleanSite(site), cur = cleanSite(doc);
    // A new logo waits for national approval (T5); removing the logo doesn't.
    if (c.theme.logo && c.theme.logo !== cur.theme.logo) { c.theme.logo_request = c.theme.logo; c.theme.logo = cur.theme.logo; }
    return { site: c, ...(await writeSiteDraft(ch, c, doc.rev || 0, live, user)) };
  }
  async function discardSite(ch) {
    const { draft, live } = await siteState(ch);
    if (draft) { const d = await store.get(ch, 'site-draft'); await store.del(ch, 'site-draft'); await store.put(ch, 'site', { ...live, rev: Math.max(live.rev || 0, d?.rev || 0) + 1 }); }
    return getSite(ch);
  }

  // ---- what the renderer needs: the chapter's collections (with drafts, for previews), national news, switches
  async function itemsIn(ch, col, drafts) {
    const out = new Map();
    for (const k of await store.list(ch, `item/${col}/`)) out.set(k.split('/').pop(), await store.get(ch, k));
    if (drafts) for (const k of await store.list(ch, `idraft/${col}/`)) out.set(k.split('/').pop(), await store.get(ch, k));
    return [...out].map(([id, d]) => ({ id, ...itemContent(col, d) }));
  }
  async function loadData(ch, { drafts = false, site } = {}) {
    const nat = await national(), s = site || (await liveSite(ch)), items = {};
    for (const col of COLS) items[col] = await itemsIn(ch, col, drafts);
    return { now: localNow(s.timezone, now()), items, national: { posts: await itemsIn(NATIONAL, 'posts', false) }, features: featuresFor(nat, ch), nat };
  }
  const renderOpts = (ch, data) => ({ data, national: data.nat, chapter: ch, now: now() });

  // ---- overview, checks, publishing
  async function overview(ch) {
    await tick(ch);
    const { doc: site, draft: siteDraft } = await siteState(ch);
    const { live, drafts } = await slugSets(ch);
    const sched = ((await store.get(ch, 'schedule')) || { items: [] }).items;
    const paths = navPaths(site.nav), home = homeOf(site), order = (s) => { const i = paths.indexOf(s === home ? '/' : '/' + s); return i < 0 ? 999 : i; };
    const pages = [];
    for (const slug of new Set([...live, ...drafts])) {
      const d = drafts.has(slug) ? await store.get(ch, `draft/${slug}`) : null, l = live.has(slug) ? await store.get(ch, `page/${slug}`) : null, doc = d || l;
      pages.push({ slug, title: doc.title, live: !!l, draft: !!d, home: slug === home, inMenu: paths.includes(slug === home ? '/' : '/' + slug), updated_at: doc.updated_at, updated_by: doc.updated_by, published_at: l?.published_at, published_by: l?.published_by, scheduled: sched.filter((x) => x.doc === 'page:' + slug).map((x) => ({ action: x.action, at: x.at })) });
    }
    pages.sort((a, b) => order(a.slug) - order(b.slug) || a.title.localeCompare(b.title));
    const counts = {};
    let itemDrafts = 0;
    for (const col of COLS) { const s = await itemSets(ch, col); counts[col] = { total: new Set([...s.live, ...s.drafts]).size, drafts: s.drafts.size }; itemDrafts += s.drafts.size; }
    const nat = await national(), feats = featuresFor(nat, ch);
    // the looks this chapter may choose from (T2)
    const look = { styles: STYLES, palettes: palettesFor(nat).map((p) => ({ ...p, issues: paletteIssues(p) })), fonts: fontsFor(nat).map((f) => ({ id: f.id, name: f.name })), custom: !!feats.custom_colors };
    const inboxNew = (await Promise.all((await store.list(ch, 'inbox/')).slice(-200).map((k) => store.get(ch, k)))).filter((m) => m && !m.done).length;
    return { chapter: ch, site: cleanSite(site), siteDraft, pages, counts, features: feats, look, inbox: inboxNew, trash: await trash(ch), scheduled: sched.length, pending: drafts.size + itemDrafts + (siteDraft ? 1 : 0) };
  }
  // What will be live once the chosen pending items are published (all of them when chosen is undefined).
  async function liveCtx(ch, chosen) {
    const { live, drafts } = await slugSets(ch);
    const pages = new Set([...live, ...[...drafts].filter((s) => !chosen || chosen.has('page:' + s))]);
    const items = new Set(), all = new Set(), titles = {};
    for (const col of COLS) {
      const s = await itemSets(ch, col);
      for (const id of s.live) { items.add(`${col}/${id}`); all.add(`${col}/${id}`); }
      for (const id of s.drafts) { all.add(`${col}/${id}`); if (!chosen || chosen.has(`item:${col}/${id}`)) items.add(`${col}/${id}`); }
      if (col === 'sections') for (const id of new Set([...s.live, ...s.drafts])) titles[`sections/${id}`] = titleOf(col, (await store.get(ch, `idraft/${col}/${id}`)) || (await store.get(ch, `item/${col}/${id}`)));
    }
    const nat = await national();
    return { live: pages, items, all, titles, features: featuresFor(nat, ch), national: nat };
  }
  // Checks for the editor (assumes everything waiting is published together). doc: a page slug or @<col>-<id>.
  async function checks(ch, doc) {
    const { doc: site } = await siteState(ch);
    const ctx = await liveCtx(ch);
    const out = { site: checkSite(cleanSite(site), { live: ctx.live, national: ctx.national, features: ctx.features }) };
    const p = doc ? parseDoc(doc) : null;
    if (p?.kind === 'page') { const { doc: d } = await pageState(ch, p.slug); if (d) out.page = checkPage(content(d), { site, ...ctx, slug: p.slug }); }
    if (p?.kind === 'item') { const { doc: d } = await itemState(ch, p.col, p.id); if (d) out.page = checkItem(p.col, itemContent(p.col, d), { site, ...ctx }); }
    return out;
  }
  // Every pending id: "page:<slug>", "item:<col>/<id>", "site".
  async function pendingIds(ch) {
    const { drafts } = await slugSets(ch), ids = [...drafts].sort().map((s) => 'page:' + s);
    for (const col of COLS) for (const id of [...(await itemSets(ch, col)).drafts].sort()) ids.push(`item:${col}/${id}`);
    if (await store.get(ch, 'site-draft')) ids.push('site');
    return ids;
  }
  // What a publish would put live. items: ids like "page:about", "item:events/meetup" and "site"; omitted means all.
  async function pending(ch, { items } = {}) {
    const all = await pendingIds(ch);
    const chosen = new Set(Array.isArray(items) ? items.filter((x) => all.includes(x)) : all);
    const ctx = await liveCtx(ch, chosen);
    const [siteDraft, site] = await Promise.all([store.get(ch, 'site-draft'), liveSite(ch)]);
    const nextSite = chosen.has('site') ? siteDraft : site;
    const sched = ((await store.get(ch, 'schedule')) || { items: [] }).items;
    const scheduled = (id) => sched.filter((x) => x.doc === id).map((x) => ({ id: x.id, action: x.action, at: x.at, by: x.by }));
    const out = [];
    for (const id of all) {
      if (id.startsWith('page:')) {
        const s = id.slice(5), d = await store.get(ch, `draft/${s}`), l = await store.get(ch, `page/${s}`);
        out.push({ id, kind: 'page', slug: s, title: d.title, isNew: !l, by: d.updated_by, at: d.updated_at, summary: changeSummary(l && normal(l), normal(d)), checks: checkPage(content(d), { site: nextSite, ...ctx, slug: s }), selected: chosen.has(id), scheduled: scheduled(id) });
      } else if (id.startsWith('item:')) {
        const [col, iid] = id.slice(5).split('/'), d = await store.get(ch, `idraft/${col}/${iid}`), l = await store.get(ch, `item/${col}/${iid}`);
        out.push({ id, kind: 'item', col, slug: iid, label: collections[col].one, title: titleOf(col, d), isNew: !l, by: d.updated_by, at: d.updated_at, summary: changeSummary(l && normalItem(col)(l), normalItem(col)(d)), checks: checkItem(col, itemContent(col, d), { site: nextSite, ...ctx }), selected: chosen.has(id), scheduled: scheduled(id) });
      } else {
        const changed = Object.keys(SITE_PARTS).filter((k) => !same(cleanSite(site)[k], cleanSite(siteDraft)[k])).map((k) => SITE_PARTS[k]);
        out.push({ id: 'site', kind: 'site', title: 'Site settings', by: siteDraft.updated_by, at: siteDraft.updated_at, summary: changed.join(', ') || 'No visible changes', checks: checkSite(cleanSite(siteDraft), { live: ctx.live, national: ctx.national, features: ctx.features }), selected: chosen.has('site'), scheduled: scheduled('site') });
      }
    }
    return { items: out };
  }
  // Puts one pending doc live. snapshot: publish this content instead of the current draft (scheduled publishes).
  async function publishOne(ch, id, user, batch, at, snapshot) {
    const stamp = { published_at: at, published_by: user };
    const go = async (keys, doc, data, norm) => {
      const d = await store.get(ch, keys.draft), l = await store.get(ch, keys.live);
      const body = snapshot || d;
      if (!body) return false;
      const rev = Math.max(d?.rev || 0, l?.rev || 0) + (snapshot ? 1 : 0);
      await store.put(ch, keys.live, { ...data(body), rev, updated_at: body.updated_at || at, updated_by: body.updated_by || user, ...stamp });
      if (!snapshot || (d && same(norm(d), norm(snapshot)))) await store.del(ch, keys.draft);
      await addVersion(ch, doc, data(body), user, 'publish', { batch });
      return true;
    };
    if (id === 'site') return go({ live: 'site', draft: 'site-draft' }, SITE, cleanSite, cleanSite);
    if (id.startsWith('page:')) { const s = id.slice(5); return go(pageKeys(s), s, content, normal); }
    const [col, iid] = id.slice(5).split('/');
    return go(itemKeys(col, iid), itemDoc(col, iid), (x) => itemContent(col, x), normalItem(col));
  }
  async function publish(ch, { items, at: when } = {}, user) {
    const p = await pending(ch, { items });
    const sel = p.items.filter((x) => x.selected);
    if (!sel.length) throw fail(400, 'Nothing to publish.');
    if (sel.some((x) => x.checks.some((c) => c.level === 'error'))) throw fail(422, 'Fix the problems marked in red before publishing.', { error: 'checks', items: p.items });
    if (when) return { scheduled: await Promise.all(sel.map((x) => addSchedule(ch, { doc: x.id, action: 'publish', at: when }, user, true))) };
    const batch = rid(6), at = iso();
    for (const x of sel) { await publishOne(ch, x.id, user, batch, at); await cancelFor(ch, x.id, 'publish'); }
    return { published: sel.map((x) => x.id), batch, at };
  }

  // ---- scheduled publish and unpublish (W5). Times are chapter-local wall-clock times, like event times. Publishing
  // takes a snapshot when it is scheduled, so later edits to the draft wait for the next publish.
  async function scheduleList(ch) { await liveSite(ch); const s = (await store.get(ch, 'schedule')) || { items: [], done: [] }; return { items: s.items || [], done: s.done || [] }; }
  async function addSchedule(ch, { doc, action, at } = {}, user, checked = false) {
    const site = await liveSite(ch), nowL = localNow(site.timezone, now());
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at || '')) throw fail(400, 'Pick a date and time.');
    if (at <= nowL) throw fail(400, 'Pick a time in the future.');
    if (!['publish', 'unpublish'].includes(action)) throw fail(400, 'bad action');
    let snapshot = null, title = '';
    if (doc === 'site') { if (action !== 'publish') throw fail(400, 'Settings can only be scheduled to publish.'); snapshot = await store.get(ch, 'site-draft'); title = 'Site settings'; }
    else if (/^page:/.test(doc || '')) {
      const st = await pageState(ch, doc.slice(5)); title = st.doc?.title;
      if (!st.doc) throw fail(404, 'Page not found');
      if (action === 'publish') snapshot = st.draft;
      else { if (!st.live && !st.draft) throw fail(400, 'Nothing to unpublish.'); await guardHome(ch, doc.slice(5)); }
    } else if (/^item:[a-z]+\/[a-z0-9-]+$/.test(doc || '')) {
      const [col, id] = doc.slice(5).split('/'), st = await itemState(ch, col, id);
      if (!st.doc) throw fail(404, 'Not found');
      title = titleOf(col, st.doc);
      if (action === 'publish') snapshot = st.draft;
    } else throw fail(400, 'bad document');
    if (action === 'publish' && !snapshot) throw fail(400, 'There are no unpublished changes to schedule.');
    if (action === 'publish' && !checked) {
      const p = await pending(ch, { items: [doc] }), x = p.items.find((i) => i.id === doc);
      if (x?.checks.some((c) => c.level === 'error')) throw fail(422, 'Fix the problems marked in red before scheduling.', { error: 'checks', items: p.items });
    }
    const s = (await store.get(ch, 'schedule')) || { items: [], done: [] };
    s.items = (s.items || []).filter((x) => !(x.doc === doc && x.action === action));
    const entry = { id: rid(8), doc, title, action, at, by: user, created: iso(), snapshot };
    s.items.push(entry); s.items.sort((a, b) => a.at.localeCompare(b.at));
    await store.put(ch, 'schedule', s);
    const { snapshot: _, ...pub } = entry;
    return pub;
  }
  async function cancelSchedule(ch, id) {
    const s = (await store.get(ch, 'schedule')) || { items: [] };
    await store.put(ch, 'schedule', { ...s, items: (s.items || []).filter((x) => x.id !== id) });
    return { cancelled: id };
  }
  async function cancelFor(ch, doc, action) {
    const s = await store.get(ch, 'schedule');
    if (!s?.items?.some((x) => x.doc === doc && (!action || x.action === action))) return;
    await store.put(ch, 'schedule', { ...s, items: s.items.filter((x) => !(x.doc === doc && (!action || x.action === action))) });
  }
  // Runs whatever is due. Called on every visit and editor overview, and by the server once a minute.
  const ticking = new Map();
  function tick(ch) {
    const prev = ticking.get(ch) || Promise.resolve();
    const run = prev.then(async () => {
      const s = await store.get(ch, 'schedule');
      if (!s?.items?.length) return [];
      const site = await store.get(ch, 'site'); if (!site) return [];
      const nowL = localNow(site.timezone, now()), due = s.items.filter((x) => x.at <= nowL);
      if (!due.length) return [];
      const batch = rid(6), at = iso();
      for (const x of due) {
        try {
          if (x.action === 'publish') await publishOne(ch, x.doc, `${x.by} (scheduled)`, batch, at, x.snapshot);
          else if (x.doc.startsWith('page:')) await unpublishPage(ch, x.doc.slice(5), `${x.by} (scheduled)`);
          else { const [col, id] = x.doc.slice(5).split('/'); await unpublishItem(ch, col, id, `${x.by} (scheduled)`); }
          x.result = 'Done';
        } catch (e) { x.result = e.message; }
        x.ran = at; delete x.snapshot;
      }
      const ids = new Set(due.map((x) => x.id));
      await store.put(ch, 'schedule', { items: s.items.filter((x) => !ids.has(x.id)), done: [...due, ...(s.done || [])].slice(0, 30) });
      return due;
    }).catch(() => []);
    ticking.set(ch, run);
    return run;
  }
  async function tickAll() { for (const ch of await store.chapters()) await tick(ch); }

  // ---- restoring
  async function stageVersion(ch, doc, data, user, from) {
    const p = okDoc(doc);
    if (p.kind === 'site') { const { doc: cur, live } = await siteState(ch); await writeSiteDraft(ch, cleanSite(data), cur.rev || 0, live, user); return; }
    // old versions may hold content from before a block changed shape: their inline items come back as drafts
    const col = await collector(ch);
    if (p.kind === 'item') {
      const { doc: cur, live } = await itemState(ch, p.col, p.id);
      const item = cleanItem(p.col, data, { extract: col.extract });
      await writeDraft(ch, itemKeys(p.col, p.id), item, cur?.rev || 0, live, user, normalItem(p.col));
      await addVersion(ch, doc, item, user, 'restore', { from });
    } else {
      const { doc: cur, live } = await pageState(ch, doc);
      const page = cleanPage(data, { extract: col.extract });
      await writePageDraft(ch, doc, page, cur?.rev || 0, live, user);
      await addVersion(ch, doc, page, user, 'restore', { from });
    }
    await col.save(user);
  }
  async function restoreVersion(ch, doc, id, user) {
    const v = await version(ch, doc, id);
    await stageVersion(ch, doc, v.doc, user, v.at);
    return { doc, restored: v.at };
  }
  // Every publish across the site, newest first, for "restore the whole site to this point".
  async function timeline(ch) {
    const batches = new Map();
    for (const k of await store.list(ch, 'verindex/')) {
      const doc = k.slice(9);
      for (const v of (await store.get(ch, k)).items.filter((x) => x.kind === 'publish' && x.batch !== 'migrate')) {
        const b = batches.get(v.batch) || { batch: v.batch, at: v.at, by: v.by, items: [] };
        b.items.push(v.title || doc); batches.set(v.batch, b);
      }
    }
    return [...batches.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  }
  // Stages, as drafts, what was live at `at`: each doc's latest publish at or before then.
  async function restoreSite(ch, at, user) {
    const T = Date.parse(at);
    if (isNaN(T)) throw fail(400, 'bad time');
    const restored = [], unchanged = [];
    for (const k of await store.list(ch, 'verindex/')) {
      const doc = k.slice(9), items = (await store.get(ch, k)).items;
      const v = items.filter((x) => x.kind === 'publish' && Date.parse(x.at) <= T).pop();
      if (!v) { if (doc !== SITE) unchanged.push(doc); continue; }
      await stageVersion(ch, doc, (await version(ch, doc, v.id)).doc, user, v.at);
      restored.push(doc);
    }
    return { restored, unchanged };
  }

  // ---- share links: a secret URL that shows a page's or an item's unpublished draft for SHARE_DAYS days
  async function shareList(ch) {
    const s = (await store.get(ch, 'shares')) || { items: [] };
    const keep = s.items.filter((x) => new Date(x.expires) > now());
    if (keep.length !== s.items.length) await store.put(ch, 'shares', { items: keep });
    return keep;
  }
  async function share(ch, slug, user, col) {
    if (col) await getItem(ch, col, slug); else await getPage(ch, slug);
    const items = await shareList(ch);
    const item = { token: rid(20), slug, ...(col ? { col } : {}), at: iso(), by: user, expires: new Date(now().getTime() + SHARE_DAYS * 864e5).toISOString() };
    await store.put(ch, 'shares', { items: [...items, item] });
    return item;
  }
  async function revokeShare(ch, token) {
    const items = await shareList(ch);
    await store.put(ch, 'shares', { items: items.filter((x) => x.token !== token) });
    return { revoked: token };
  }

  // ---- media library (M1, M2). Files arrive already resized and compressed by the editor; the server checks what
  // they really are, and keeps them under ids so links never break when a file is renamed.
  const mediaUrl = (ch, file) => (ch === NATIONAL ? `/media/national/${file}` : `/media/${file}`);
  async function mediaList(ch) {
    if (ch !== NATIONAL) await liveSite(ch);
    const out = [];
    for (const k of await store.list(ch, 'media/')) out.push(await store.get(ch, k));
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  async function upload(ch, { data, name, alt, w, h } = {}, user) {
    if (ch !== NATIONAL) await liveSite(ch);
    const bytes = fromB64(data);
    if (!bytes.length) throw fail(400, 'The file was empty.');
    if (bytes.length > MEDIA_MAX) throw fail(413, 'That image is too big, even after shrinking. Try a smaller one.');
    const type = sniff(bytes);
    if (!type) throw fail(415, 'Only photos and graphics (JPEG, PNG, WebP or GIF) can be uploaded.');
    const id = rid(12), file = `${id}.${MEDIA_TYPES[type]}`;
    await store.putBlob(ch, `blob/${id}`, bytes);
    const meta = { id, file, url: mediaUrl(ch, file), type, size: bytes.length, w: Math.round(+w || 0), h: Math.round(+h || 0), name: str(name, 120), alt: str(alt, 200), at: iso(), by: user };
    await store.put(ch, `media/${id}`, meta);
    return meta;
  }
  async function mediaUpdate(ch, id, { alt, name } = {}) {
    if (!SLUG.test(id || '')) throw fail(400, 'bad id');
    const m = await store.get(ch, `media/${id}`); if (!m) throw fail(404, 'Not found');
    if (alt != null) m.alt = str(alt, 200);
    if (name != null) m.name = str(name, 120);
    await store.put(ch, `media/${id}`, m);
    return m;
  }
  // Where a file is used: titles of pages, items and settings that mention its address.
  async function mediaUsage(ch, url) {
    const out = new Set(), has = (d) => JSON.stringify(d || '').includes(url);
    const chapters = ch === NATIONAL ? await store.chapters() : [ch];
    for (const c of chapters) {
      for (const k of ['site', 'site-draft']) if (has(await store.get(c, k))) out.add(ch === NATIONAL ? `${c}: settings` : 'Site settings');
      for (const pre of ['page/', 'draft/']) for (const k of await store.list(c, pre)) { const d = await store.get(c, k); if (has(d)) out.add((ch === NATIONAL ? c + ': ' : '') + d.title); }
      for (const col of COLS) for (const pre of ['item/', 'idraft/']) for (const k of await store.list(c, `${pre}${col}/`)) { const d = await store.get(c, k); if (has(d)) out.add((ch === NATIONAL ? c + ': ' : '') + titleOf(col, d)); }
    }
    return [...out];
  }
  async function mediaDelete(ch, id) {
    if (!SLUG.test(id || '')) throw fail(400, 'bad id');
    const m = await store.get(ch, `media/${id}`); if (!m) throw fail(404, 'Not found');
    const used = await mediaUsage(ch, m.url);
    if (used.length) throw fail(409, `This image is used on ${used.slice(0, 5).join(', ')}${used.length > 5 ? ' and more' : ''}. Replace it there first.`, { error: 'in use', usedOn: used });
    await store.delBlob(ch, `blob/${id}`); await store.del(ch, `media/${id}`);
    return { deleted: id };
  }
  // For the server: the bytes and type of /media/<file>.
  async function mediaFile(ch, file) {
    const m = /^([a-z0-9]{12})\.(jpg|png|webp|gif)$/.exec(file || '');
    if (!m || !SLUG.test(ch)) return null;
    const meta = await store.get(ch, `media/${m[1]}`);
    if (!meta || meta.file !== file) return null;
    const bytes = await store.getBlob(ch, `blob/${m[1]}`);
    return bytes ? { type: meta.type, bytes } : null;
  }

  // ---- national settings (T2, T5, T7)
  async function getNational() {
    const config = await national(), chapters = [];
    for (const ch of await store.chapters()) {
      if (ch === NATIONAL) continue;
      const s = cleanSite((await store.get(ch, 'site-draft')) || (await store.get(ch, 'site')));
      chapters.push({ chapter: ch, name: s.name, features: featuresFor(config, ch), logo: s.theme.logo, logo_request: s.theme.logo_request });
    }
    return { config, palettes: palettesFor(config), fonts: FONTS.map((f) => ({ id: f.id, name: f.name, approved: !config.fonts.length || config.fonts.includes(f.id) })), features: FEATURES, chapters, media: await mediaList(NATIONAL) };
  }
  async function saveNational(body = {}) {
    const c = cleanNational(body);
    await store.put(NATIONAL, 'config', c);
    return c;
  }
  // Approve or turn down a chapter's new logo. Approval puts it on the live site straight away.
  async function decideLogo(ch, approve) {
    await liveSite(ch);
    for (const key of ['site', 'site-draft']) {
      const s = await store.get(ch, key);
      if (!s?.theme?.logo_request) continue;
      const theme = { ...s.theme, ...(approve ? { logo: s.theme.logo_request } : {}), logo_request: '' };
      await store.put(ch, key, { ...s, theme, rev: (s.rev || 0) + 1 });
    }
    return { chapter: ch, approved: !!approve };
  }

  // ---- contact forms (C5): messages are filed for the chapter; a person's private email is looked up only when
  // the message is delivered, so it never reaches the page.
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  async function contact(ch, b = {}) {
    await liveSite(ch);
    if (b.website) return { ok: true }; // honeypot: bots fill in every field
    const name = str(b.name, 80).trim(), email = str(b.email, 120).trim(), message = str(b.message, 3000).trim(), to = str(b.to, 60);
    if (!name || !EMAIL.test(email) || !message) throw fail(400, 'Please fill in your name, a valid email and a message.');
    const feats = await features(ch);
    if (feats.contact === false) throw fail(403, 'This form is turned off.');
    let toName = 'the chapter';
    if (to.startsWith('person:')) {
      const p = SLUG.test(to.slice(7)) ? await store.get(ch, `item/people/${to.slice(7)}`) : null;
      if (!p || !p.email || feats.people === false) throw fail(400, 'That person can’t be messaged here.');
      toName = p.name;
    }
    const recent = (await store.list(ch, 'inbox/')).slice(-60), hourAgo = new Date(now().getTime() - 36e5).toISOString().replace(/[:.]/g, '-');
    if (recent.filter((k) => k.slice(6) > hourAgo).length >= 50) throw fail(429, 'Too many messages right now. Please try again later.');
    const id = iso().replace(/[:.]/g, '-') + '-' + rid(4);
    await store.put(ch, `inbox/${id}`, { id, at: iso(), to: to.startsWith('person:') ? to : 'chapter', toName, name, email, message, done: false });
    return { ok: true, toName };
  }
  async function inbox(ch) {
    await liveSite(ch);
    const out = [];
    for (const k of (await store.list(ch, 'inbox/')).slice(-200)) out.push(await store.get(ch, k));
    return out.reverse();
  }
  async function inboxUpdate(ch, id, { done, remove } = {}) {
    if (!/^[\w-]{1,64}$/.test(id || '')) throw fail(400, 'bad id');
    const m = await store.get(ch, `inbox/${id}`); if (!m) throw fail(404, 'Not found');
    if (remove) { await store.del(ch, `inbox/${id}`); return { deleted: id }; }
    m.done = !!done; await store.put(ch, `inbox/${id}`, m);
    return m;
  }

  // ---- rendering
  const notFound = (site, data, ch) => ({ status: 404, html: renderPage(site, { title: 'Page not found', blocks: [{ type: 'text', props: { heading: 'Page not found', body: "We couldn't find that page. [Go to the homepage](/)." } }] }, { pageSlug: '', noindex: true, ...renderOpts(ch, data) }) });
  // A short message page in the chapter's own look (after a contact form is sent, for example).
  async function renderNotice(ch, heading, text, status = 200) {
    const site = await store.get(ch, 'site'); if (!site) return { status: 404, html: null };
    const data = await loadData(ch, { site });
    return { status, html: renderPage(site, { title: heading, blocks: [{ type: 'text', props: { heading, body: text } }] }, { pageSlug: '', noindex: true, ...renderOpts(ch, data) }) };
  }
  // A list page for a collection when the chapter has no page at that address: /events, /events/archive (R2).
  function autoPage(col, archive) {
    const type = Object.keys(BLOCKS).find((k) => BLOCKS[k].view === col), def = collections[col];
    const props = { ...defaultsFor(type), heading: archive ? def.archive.title : def.label, if_empty: 'Show a message', empty_text: archive ? 'Nothing here yet.' : `No ${def.label.toLowerCase()} yet.` };
    if (archive) props.show = col === 'events' ? 'Past' : 'Results';
    return { title: archive ? def.archive.title : def.label, blocks: [{ id: 'auto', type, v: BLOCKS[type].version, props }] };
  }
  async function renderLive(ch, path = '') {
    const site = ch === NATIONAL ? null : await store.get(ch, 'site');
    if (!site) return { status: 404, html: null };
    await ensureSchema(ch); await tick(ch);
    const data = await loadData(ch, { site }), opts = renderOpts(ch, data);
    const segs = String(path).split('/').filter(Boolean), home = homeOf(site);
    if (segs.length > 2 || !segs.every((s) => SLUG.test(s))) return notFound(site, data, ch);
    if (segs.length === 1 && segs[0] === home) return { status: 301, location: '/' };
    const col = colByPath(segs[0] || ''), on = col && data.features[collections[col].feature] !== false;
    if (segs.length === 2) {
      if (!on) return notFound(site, data, ch);
      if (collections[col].archive?.slug === segs[1]) return { status: 200, html: renderPage(site, autoPage(col, true), { pageSlug: path, ...opts }) };
      const d = await store.get(ch, `item/${col}/${segs[1]}`);
      if (!d) return notFound(site, data, ch);
      return { status: 200, html: renderPage(site, { ...itemContent(col, d), id: segs[1] }, { pageSlug: path, col, ...opts }) };
    }
    const slug = segs[0] || home, page = await store.get(ch, `page/${slug}`);
    if (page) return { status: 200, html: renderPage(site, page, { pageSlug: slug, ...opts }) };
    if (on) return { status: 200, html: renderPage(site, autoPage(col, false), { pageSlug: slug, ...opts }) };
    return notFound(site, data, ch);
  }
  async function renderShare(ch, token) {
    if (!/^[a-z0-9]{20}$/.test(token || '')) return null;
    const item = (await shareList(ch)).find((x) => x.token === token);
    if (!item) return null;
    const { doc } = item.col ? await itemState(ch, item.col, item.slug) : await pageState(ch, item.slug);
    if (!doc) return null;
    const { doc: site } = await siteState(ch), data = await loadData(ch, { drafts: true, site });
    const until = new Date(item.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const banner = `Preview of unpublished changes. This link stops working ${until}.`;
    if (item.col) return renderPage(cleanSite(site), { ...itemContent(item.col, doc), id: item.slug }, { pageSlug: `${collections[item.col].path}/${item.slug}`, col: item.col, preview: true, banner, ...renderOpts(ch, data) });
    return renderPage(cleanSite(site), content(doc), { pageSlug: item.slug, preview: true, banner, ...renderOpts(ch, data) });
  }
  // The editor's preview: the page or item as sent (unsaved edits included) inside the draft site settings, with
  // every collection's drafts.
  async function renderPreview(ch, body, editAssets) {
    const site = body.site ? cleanSite(body.site) : cleanSite((await siteState(ch)).doc);
    const data = await loadData(ch, { drafts: true, site }), opts = { preview: true, edit: !!body.edit, editAssets, ...renderOpts(ch, data) };
    if (body.col && collections[body.col]) {
      const col = body.col, id = SLUG.test(body.id || '') ? body.id : 'new', item = cleanItem(col, body.item || {});
      data.items[col] = [...data.items[col].filter((x) => x.id !== id), { id, ...item }];
      if (col === 'sections') return renderPage(site, { title: titleOf(col, item), blocks: item.blocks }, { pageSlug: '', ...opts });
      return renderPage(site, { ...item, id }, { pageSlug: `${collections[col].path}/${id}`, col, ...opts });
    }
    return renderPage(site, cleanPage(body), { pageSlug: str(body.page, 40), ...opts });
  }
  async function gallery(ch) {
    const { site } = await getSite(ch), data = await loadData(ch, { drafts: true });
    const page = { title: 'Block gallery', blocks: Object.keys(BLOCKS).filter((t) => !BLOCKS[t].hidden).map((type, i) => ({ id: 'g' + i, type, v: BLOCKS[type].version, props: sampleFor(type) })) };
    return renderPage(site, page, { pageSlug: '', preview: true, labels: true, ...renderOpts(ch, data) });
  }

  // ---- content API (F3): published pages and items as read-only JSON, for other sites, apps and syndication.
  // Private fields (like a person's email) and drafts never appear.
  async function contentApi(ch, path = '') {
    const site = ch === NATIONAL ? null : await store.get(ch, 'site');
    if (!site) return { status: 404, body: { error: 'Unknown chapter' } };
    await ensureSchema(ch); await tick(ch);
    const feats = await features(ch), nowL = localNow(site.timezone, now());
    const [kind, id, extra] = String(path).split('/').filter(Boolean);
    const cols = COLS.filter((c) => collections[c].path && feats[collections[c].feature] !== false);
    const pub = (col, iid, d) => ({ id: iid, page_url: itemPath(col, iid), ...publicOnly(collections[col].fields, itemContent(col, d)), ...(collections[col].past ? { past: isPast(col, d, nowL) } : {}), published_at: d.published_at || '', updated_at: d.updated_at || '' });
    if (extra !== undefined) return { status: 404, body: { error: 'Not found' } };
    if (!kind) return { status: 200, body: { chapter: ch, name: site.name, tagline: site.tagline || '', endpoints: ['pages', ...cols].map((c) => `/api/v1/${c}`) } };
    if (kind === 'pages') {
      if (id) { const d = SLUG.test(id) ? await store.get(ch, `page/${id}`) : null; return d ? { status: 200, body: { slug: id, page_url: id === homeOf(site) ? '/' : '/' + id, ...content(d), published_at: d.published_at || '' } } : { status: 404, body: { error: 'Not found' } }; }
      const out = [];
      for (const k of await store.list(ch, 'page/')) { const d = await store.get(ch, k), s = k.slice(5); out.push({ slug: s, page_url: s === homeOf(site) ? '/' : '/' + s, title: d.title, published_at: d.published_at || '' }); }
      return { status: 200, body: { items: out } };
    }
    const col = cols.find((c) => c === kind || collections[c].path === kind);
    if (!col) return { status: 404, body: { error: 'Not found' } };
    if (id) { const d = SLUG.test(id) ? await store.get(ch, `item/${col}/${id}`) : null; return d ? { status: 200, body: pub(col, id, d) } : { status: 404, body: { error: 'Not found' } }; }
    const out = [];
    for (const k of await store.list(ch, `item/${col}/`)) out.push(pub(col, k.split('/').pop(), await store.get(ch, k)));
    out.sort(collections[col].sort);
    return { status: 200, body: { items: out } };
  }

  // Overall "what changed" for the presence check: the current rev of any doc.
  async function rev(ch, doc) {
    const p = parseDoc(doc);
    if (p?.kind === 'site') return (await getSite(ch)).rev;
    if (p?.kind === 'page') return (await getPage(ch, p.slug)).rev;
    if (p?.kind === 'item') return (await getItem(ch, p.col, p.id)).rev;
    return null;
  }

  return {
    overview, getPage, savePage, newPage, duplicatePage, renamePage, unpublishPage, deletePage, restoreTrash, setHome, discardPage,
    listItems, getItem, saveItem, newItem, duplicateItem, renameItem, unpublishItem, deleteItem, discardItem,
    getSite, saveSite, discardSite, checks, pending, publish, versions, version, nameVersion, stash, restoreVersion, timeline, restoreSite,
    scheduleList, addSchedule, cancelSchedule, tick, tickAll,
    mediaList, upload, mediaUpdate, mediaDelete, mediaFile, mediaUsage,
    getNational, saveNational, decideLogo, contact, inbox, inboxUpdate,
    share, shares: shareList, revokeShare, renderLive, renderShare, renderPreview, renderNotice, gallery, contentApi, rev,
    chapters: async () => (await store.chapters()).filter((c) => c !== NATIONAL),
  };
}

module.exports = { createCms, cleanPage, cleanSite, cleanItem, itemContent, changeSummary, parseDoc, itemDoc, SITE, SCHEMA, rid };
