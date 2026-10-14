'use strict';
// The CMS core: drafts, publishing, version history, trash, share links and checks, on top of a key-value store
// (lib/store.js on a server, lib/memstore.js in the tests and the single-file demo). No Node-only APIs, so the demo
// runs this exact code in the browser.
//
// Keys, per chapter:
//   site, site-draft                 published site settings and their unpublished draft
//   page/<slug>, draft/<slug>        published page and its unpublished draft
//   ver/<doc>/<id>, verindex/<doc>   version snapshots and their index (<doc> is a page slug or @site)
//   trash/<id>                       deleted pages, restorable
//   shares                           preview links
// Every editable doc carries rev (bumped on each save), updated_at and updated_by. Saves send the rev they started
// from; a mismatch means someone else saved first and the save is refused with the current doc (409).
const { validateBlocks, defaultsFor } = require('./blocks');
const { SLUG } = require('./text');
const { checkPage, checkSite } = require('./checks');
const { renderPage, homeOf } = require('./render');

const SITE = '@site';
const EDIT_SESSION = 10 * 60e3; // one "edited" version per person per 10 minutes of editing
const KEEP_EDITS = 100;          // publishes, restores and named versions are always kept
const SHARE_DAYS = 7, TRASH_DAYS = 30;
const RESERVED = ['admin', 'static', 'preview', 'api'];

const fail = (status, msg, body) => Object.assign(new Error(msg), { status, body });
const str = (v, n = 300) => String(v ?? '').slice(0, n);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '') || 'page';
function rid(n = 10) {
  const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
}

// Page and site content as stored, minus bookkeeping. Anything else a client sends is dropped.
const content = (d) => ({ title: d.title || '', seo_title: d.seo_title || '', seo_description: d.seo_description || '', seo_image: d.seo_image || '', blocks: d.blocks || [] });
function cleanPage(b) {
  return { title: str(b?.title, 120).trim(), seo_title: str(b?.seo_title, 120), seo_description: str(b?.seo_description, 400), seo_image: str(b?.seo_image, 500), blocks: validateBlocks(b?.blocks ?? []) };
}
function cleanNav(list, depth = 0) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((n) => {
    const item = { label: str(n?.label, 40), path: str(n?.path, 300).trim() };
    if (depth) return item;
    item.style = n?.style === 'button' ? 'button' : 'link';
    if (Array.isArray(n?.children) && n.children.length) item.children = cleanNav(n.children, 1);
    return item;
  });
}
function cleanSite(o = {}) {
  const a = o.announcement || {};
  return {
    name: str(o.name, 80), tagline: str(o.tagline), footer: str(o.footer, 500), contact_email: str(o.contact_email, 120).trim(),
    timezone: str(o.timezone, 60) || 'America/Chicago', home: SLUG.test(o.home || '') ? o.home : 'home',
    theme: { primary: str(o.theme?.primary, 9), accent: str(o.theme?.accent, 9), logo: str(o.theme?.logo, 500) },
    social: { x: str(o.social?.x, 80), ig: str(o.social?.ig, 80), bsky: str(o.social?.bsky, 120), fb: str(o.social?.fb, 200) },
    nav: cleanNav(o.nav),
    announcement: { on: !!a.on, text: str(a.text, 160), link_label: str(a.link_label, 30), url: str(a.url, 300).trim(), until: /^\d{4}-\d\d-\d\d$/.test(a.until || '') ? a.until : '' },
    footer_links: (Array.isArray(o.footer_links) ? o.footer_links : []).slice(0, 12).map((l) => ({ label: str(l?.label, 40), url: str(l?.url, 300).trim() })),
    disclaimer: str(o.disclaimer, 300),
    connections: { luma_calendar_url: str(o.connections?.luma_calendar_url, 300).trim(), action_network_url: str(o.connections?.action_network_url, 300).trim(), donate_url: str(o.connections?.donate_url, 300).trim() },
  };
}
const SITE_PARTS = { name: 'Name', tagline: 'Tagline', footer: 'Footer', contact_email: 'Contact email', timezone: 'Timezone', home: 'Homepage', theme: 'Colors and logo', social: 'Social accounts', nav: 'Menu', announcement: 'Announcement bar', footer_links: 'Footer links', disclaimer: 'Disclaimer', connections: 'Connections' };
const navPaths = (nav) => (nav || []).flatMap((n) => [n.path, ...(n.children || []).map((c) => c.path)]);
const stripNav = (nav, path) => (nav || []).filter((n) => n.path !== path).map((n) => (n.children ? { ...n, children: n.children.filter((c) => c.path !== path) } : n));
const findNav = (nav, path) => (nav || []).flatMap((n) => [n, ...(n.children || [])]).find((n) => n.path === path);

function changeSummary(live, draft) {
  if (!live) return `New page, ${draft.blocks.length} section${draft.blocks.length === 1 ? '' : 's'}`;
  const parts = [];
  const before = new Map(live.blocks.map((b) => [b.id, b])), after = new Map(draft.blocks.map((b) => [b.id, b]));
  const added = draft.blocks.filter((b) => !before.has(b.id)).length, removed = live.blocks.filter((b) => !after.has(b.id)).length;
  const changed = draft.blocks.filter((b) => before.has(b.id) && !same(before.get(b.id), b)).length;
  const kept = draft.blocks.filter((b) => before.has(b.id)).map((b) => b.id), order = live.blocks.filter((b) => after.has(b.id)).map((b) => b.id);
  const n = (x, w) => `${x} section${x === 1 ? '' : 's'} ${w}`;
  if (changed) parts.push(n(changed, 'edited')); if (added) parts.push(n(added, 'added')); if (removed) parts.push(n(removed, 'removed'));
  if (!same(kept, order)) parts.push('sections reordered');
  if (live.title !== draft.title) parts.push('title changed');
  if (['seo_title', 'seo_description', 'seo_image'].some((k) => (live[k] || '') !== (draft[k] || ''))) parts.push('search and sharing details changed');
  return parts.join(', ') || 'No visible changes';
}

function createCms({ store, now = () => new Date() }) {
  const iso = () => now().toISOString();
  const okSlug = (s) => { if (!SLUG.test(s || '')) throw fail(400, 'Page names use lowercase letters, numbers and dashes.'); return s; };
  const okDoc = (d) => (d === SITE ? d : okSlug(d));
  async function liveSite(ch) { const s = await store.get(ch, 'site'); if (!s) throw fail(404, 'Unknown chapter'); return s; }
  async function siteState(ch) {
    const [draft, live] = await Promise.all([store.get(ch, 'site-draft'), liveSite(ch)]);
    return { doc: draft || live, draft: !!draft, live };
  }
  async function pageState(ch, slug) {
    okSlug(slug);
    const [draft, live] = await Promise.all([store.get(ch, `draft/${slug}`), store.get(ch, `page/${slug}`)]);
    return { doc: draft || live, draft, live };
  }
  async function slugSets(ch) {
    const [l, d] = await Promise.all([store.list(ch, 'page/'), store.list(ch, 'draft/')]);
    return { live: new Set(l.map((k) => k.slice(5))), drafts: new Set(d.map((k) => k.slice(6))) };
  }
  async function freeSlug(ch, base) {
    const { live, drafts } = await slugSets(ch);
    let slug = base, n = 2;
    while (live.has(slug) || drafts.has(slug) || RESERVED.includes(slug)) slug = `${base}-${n++}`.slice(0, 40);
    return slug;
  }

  // ---- versions
  async function addVersion(ch, doc, data, user, kind, extra = {}) {
    const idx = (await store.get(ch, `verindex/${doc}`)) || { items: [] };
    const at = iso(), title = doc === SITE ? 'Site settings' : data.title, last = idx.items[idx.items.length - 1];
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
    okDoc(doc);
    const clean = doc === SITE ? cleanSite(data) : cleanPage(data);
    return addVersion(ch, doc, clean, user, 'edit', { name: str(name, 80) || `${user}'s unsaved edits` });
  }

  // ---- writing drafts. A draft identical to the live doc is dropped, so undoing every change clears "unpublished".
  async function writePageDraft(ch, slug, page, prevRev, live, user) {
    const rev = prevRev + 1, meta = { rev, updated_at: iso(), updated_by: user };
    if (live && same(content(live), page)) { await store.del(ch, `draft/${slug}`); await store.put(ch, `page/${slug}`, { ...live, rev }); }
    else await store.put(ch, `draft/${slug}`, { ...page, ...meta });
    return { rev, draft: !(live && same(content(live), page)), ...meta };
  }
  async function writeSiteDraft(ch, site, prevRev, live, user) {
    const rev = prevRev + 1, meta = { rev, updated_at: iso(), updated_by: user };
    const isLive = same(cleanSite(live), site);
    if (isLive) { await store.del(ch, 'site-draft'); await store.put(ch, 'site', { ...live, rev }); }
    else await store.put(ch, 'site-draft', { ...site, ...meta });
    await addVersion(ch, SITE, site, user, 'edit');
    return { rev, draft: !isLive, ...meta };
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
    if (!force && baseRev != null && +baseRev !== (doc.rev || 0)) {
      throw fail(409, `${doc.updated_by || 'Someone'} saved this page while you were editing.`, { error: 'conflict', current: { page: content(doc), rev: doc.rev || 0, by: doc.updated_by, at: doc.updated_at } });
    }
    const clean = cleanPage(page);
    if (!clean.title) clean.title = doc.title || slug;
    const r = await writePageDraft(ch, slug, clean, doc.rev || 0, live, user);
    await addVersion(ch, slug, clean, user, 'edit');
    return { slug, page: clean, live: !!live, ...r };
  }
  async function newPage(ch, { title, addToMenu = true } = {}, user) {
    const site = (await siteState(ch)).doc;
    const t = str(title, 60).trim() || 'New page', slug = await freeSlug(ch, slugify(t));
    const page = cleanPage({ title: t, blocks: [{ type: 'hero', props: { ...defaultsFor('hero'), heading: t, subheading: site.name || '' } }, { type: 'text', props: defaultsFor('text') }] });
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
      for (const k of await store.list(ch, `ver/${slug}/`)) { await store.put(ch, `ver/${newSlug}/${k.split('/').pop()}`, await store.get(ch, k)); await store.del(ch, k); }
      const idx = await store.get(ch, `verindex/${slug}`); if (idx) { await store.put(ch, `verindex/${newSlug}`, idx); await store.del(ch, `verindex/${slug}`); }
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
    return { trashed: id };
  }
  async function trash(ch) {
    const out = [];
    for (const k of await store.list(ch, 'trash/')) {
      const t = await store.get(ch, k);
      if (now() - new Date(t.at) > TRASH_DAYS * 864e5) { await store.del(ch, k); continue; }
      out.push({ id: t.id, slug: t.slug, title: t.title, at: t.at, by: t.by });
    }
    return out.reverse();
  }
  // Restores as a draft (back in the menu if it was there); it goes live with the next publish.
  async function restoreTrash(ch, id, user) {
    if (!/^[\w-]{1,64}$/.test(id || '')) throw fail(400, 'bad id');
    const t = await store.get(ch, `trash/${id}`);
    if (!t) throw fail(404, 'That page is no longer in the trash.');
    const slug = await freeSlug(ch, t.slug), doc = t.draft || t.live;
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

  // ---- site settings
  async function getSite(ch) {
    const { doc, draft } = await siteState(ch);
    return { site: cleanSite(doc), rev: doc.rev || 0, draft, updated_at: doc.updated_at, updated_by: doc.updated_by };
  }
  async function saveSite(ch, { site, baseRev, force } = {}, user) {
    const { doc, live } = await siteState(ch);
    if (!force && baseRev != null && +baseRev !== (doc.rev || 0)) {
      throw fail(409, `${doc.updated_by || 'Someone'} changed the settings while you were editing.`, { error: 'conflict', current: { site: cleanSite(doc), rev: doc.rev || 0, by: doc.updated_by, at: doc.updated_at } });
    }
    const clean = cleanSite(site);
    return { site: clean, ...(await writeSiteDraft(ch, clean, doc.rev || 0, live, user)) };
  }
  async function discardSite(ch) {
    const { draft, live } = await siteState(ch);
    if (draft) { await store.del(ch, 'site-draft'); await store.put(ch, 'site', { ...live, rev: Math.max(live.rev || 0, draft.rev || 0) + 1 }); }
    return getSite(ch);
  }

  // ---- overview, checks, publishing
  async function overview(ch) {
    const { doc: site, draft: siteDraft } = await siteState(ch);
    const { live, drafts } = await slugSets(ch);
    const paths = navPaths(site.nav), home = homeOf(site), order = (s) => { const i = paths.indexOf(s === home ? '/' : '/' + s); return i < 0 ? 999 : i; };
    const pages = [];
    for (const slug of new Set([...live, ...drafts])) {
      const d = drafts.has(slug) ? await store.get(ch, `draft/${slug}`) : null, l = live.has(slug) ? await store.get(ch, `page/${slug}`) : null, doc = d || l;
      pages.push({ slug, title: doc.title, live: !!l, draft: !!d, home: slug === home, inMenu: paths.includes(slug === home ? '/' : '/' + slug), updated_at: doc.updated_at, updated_by: doc.updated_by, published_at: l?.published_at, published_by: l?.published_by });
    }
    pages.sort((a, b) => order(a.slug) - order(b.slug) || a.title.localeCompare(b.title));
    return { chapter: ch, site: cleanSite(site), siteDraft, pages, trash: await trash(ch), pending: drafts.size + (siteDraft ? 1 : 0) };
  }
  // Checks for the editor: assumes everything waiting is published together.
  async function checks(ch, slug) {
    const { doc: site } = await siteState(ch);
    const { live, drafts } = await slugSets(ch), all = new Set([...live, ...drafts]);
    const out = { site: checkSite(cleanSite(site), { live: all }) };
    if (slug) { const { doc } = await pageState(ch, slug); if (doc) out.page = checkPage(content(doc), { site, live: all, slug }); }
    return out;
  }
  // What a publish would put live. items: ids like "page:about" and "site"; omitted means everything.
  async function pending(ch, { items } = {}) {
    const [siteDraft, site] = await Promise.all([store.get(ch, 'site-draft'), liveSite(ch)]);
    const { live, drafts } = await slugSets(ch);
    const all = [...[...drafts].sort().map((s) => 'page:' + s), ...(siteDraft ? ['site'] : [])];
    const chosen = new Set(Array.isArray(items) ? items.filter((x) => all.includes(x)) : all);
    const willLive = new Set([...live, ...[...drafts].filter((s) => chosen.has('page:' + s))]);
    const nextSite = chosen.has('site') ? siteDraft : site;
    const out = [];
    for (const s of [...drafts].sort()) {
      const d = await store.get(ch, `draft/${s}`), l = await store.get(ch, `page/${s}`);
      out.push({ id: 'page:' + s, kind: 'page', slug: s, title: d.title, isNew: !l, by: d.updated_by, at: d.updated_at, summary: changeSummary(l && content(l), content(d)), checks: checkPage(content(d), { site: nextSite, live: willLive, slug: s }), selected: chosen.has('page:' + s) });
    }
    if (siteDraft) {
      const changed = Object.keys(SITE_PARTS).filter((k) => !same(cleanSite(site)[k], cleanSite(siteDraft)[k])).map((k) => SITE_PARTS[k]);
      out.push({ id: 'site', kind: 'site', title: 'Site settings', by: siteDraft.updated_by, at: siteDraft.updated_at, summary: changed.join(', ') || 'No visible changes', checks: checkSite(cleanSite(siteDraft), { live: willLive }), selected: chosen.has('site') });
    }
    // live pages that would be left linking to something unpublished are reported but don't block
    return { items: out };
  }
  async function publish(ch, { items } = {}, user) {
    const p = await pending(ch, { items });
    const sel = p.items.filter((x) => x.selected);
    if (!sel.length) throw fail(400, 'Nothing to publish.');
    if (sel.some((x) => x.checks.some((c) => c.level === 'error'))) throw fail(422, 'Fix the problems marked in red before publishing.', { error: 'checks', items: p.items });
    const batch = rid(6), at = iso();
    for (const x of sel) {
      if (x.kind === 'page') {
        const d = await store.get(ch, `draft/${x.slug}`);
        await store.put(ch, `page/${x.slug}`, { ...d, published_at: at, published_by: user });
        await store.del(ch, `draft/${x.slug}`);
        await addVersion(ch, x.slug, content(d), user, 'publish', { batch });
      } else {
        const d = await store.get(ch, 'site-draft');
        await store.put(ch, 'site', { ...d, published_at: at, published_by: user });
        await store.del(ch, 'site-draft');
        await addVersion(ch, SITE, cleanSite(d), user, 'publish', { batch });
      }
    }
    return { published: sel.map((x) => x.id), batch, at };
  }

  // ---- restoring
  async function stageVersion(ch, doc, data, user, from) {
    if (doc === SITE) { const { doc: cur, live } = await siteState(ch); await writeSiteDraft(ch, cleanSite(data), cur.rev || 0, live, user); }
    else {
      const { doc: cur, live } = await pageState(ch, doc);
      const page = cleanPage(data);
      await writePageDraft(ch, doc, page, cur?.rev || 0, live, user);
      await addVersion(ch, doc, page, user, 'restore', { from });
    }
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
      for (const v of (await store.get(ch, k)).items.filter((x) => x.kind === 'publish')) {
        const b = batches.get(v.batch) || { batch: v.batch, at: v.at, by: v.by, items: [] };
        b.items.push(v.title || doc); batches.set(v.batch, b);
      }
    }
    return [...batches.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  }
  // Stages, as drafts, what was live at `at`: each page's and the settings' latest publish at or before then.
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

  // ---- share links: a secret URL that shows a page's unpublished draft for SHARE_DAYS days
  async function shareList(ch) {
    const s = (await store.get(ch, 'shares')) || { items: [] };
    const keep = s.items.filter((x) => new Date(x.expires) > now());
    if (keep.length !== s.items.length) await store.put(ch, 'shares', { items: keep });
    return keep;
  }
  async function share(ch, slug, user) {
    await getPage(ch, slug);
    const items = await shareList(ch);
    const item = { token: rid(20), slug, at: iso(), by: user, expires: new Date(now().getTime() + SHARE_DAYS * 864e5).toISOString() };
    await store.put(ch, 'shares', { items: [...items, item] });
    return item;
  }
  async function revokeShare(ch, token) {
    const items = await shareList(ch);
    await store.put(ch, 'shares', { items: items.filter((x) => x.token !== token) });
    return { revoked: token };
  }

  // ---- rendering
  async function renderLive(ch, path) {
    const site = await store.get(ch, 'site');
    if (!site) return { status: 404, html: null };
    const home = homeOf(site), slug = path || home;
    if (path && path === home) return { status: 301, location: '/' };
    const page = SLUG.test(slug) ? await store.get(ch, `page/${slug}`) : null;
    if (!page) return { status: 404, html: renderPage(site, { title: 'Page not found', blocks: [{ type: 'text', props: { heading: 'Page not found', body: "We couldn't find that page. [Go to the homepage](/)." } }] }, { pageSlug: '', noindex: true }) };
    return { status: 200, html: renderPage(site, page, { pageSlug: slug }) };
  }
  async function renderShare(ch, token) {
    if (!/^[a-z0-9]{20}$/.test(token || '')) return null;
    const item = (await shareList(ch)).find((x) => x.token === token);
    if (!item) return null;
    const { doc } = await pageState(ch, item.slug);
    if (!doc) return null;
    const { doc: site } = await siteState(ch);
    const until = new Date(item.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return renderPage(site, content(doc), { pageSlug: item.slug, preview: true, banner: `Preview of unpublished changes. This link stops working ${until}.` });
  }
  // The editor's preview: the page as sent (unsaved edits included) inside the draft site settings.
  async function renderPreview(ch, body, editAssets) {
    const site = body.site ? cleanSite(body.site) : cleanSite((await siteState(ch)).doc);
    return renderPage(site, cleanPage(body), { pageSlug: str(body.page, 40), preview: true, edit: !!body.edit, editAssets });
  }

  return {
    overview, getPage, savePage, newPage, duplicatePage, renamePage, unpublishPage, deletePage, restoreTrash, setHome, discardPage,
    getSite, saveSite, discardSite, checks, pending, publish, versions, version, nameVersion, stash, restoreVersion, timeline, restoreSite,
    share, shares: shareList, revokeShare, renderLive, renderShare, renderPreview, chapters: () => store.chapters(),
  };
}

module.exports = { createCms, cleanPage, cleanSite, changeSummary, SITE, rid };
