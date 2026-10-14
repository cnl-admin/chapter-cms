'use strict';
// The editor's JSON API, independent of any web server: server.js passes /admin/api/* requests to handle(), and the
// single-file demo calls handle() from a fetch shim, so both run the same code.
//   handle({ method, path, body, user }) -> { status, type: 'json' | 'html', body }
const { schema } = require('./blocks');
const { collections, COLS } = require('./collections');
const { templateList } = require('./templates');
const { FEATURES } = require('./national');
const { SLUG } = require('./text');

const PRESENCE_MS = 45e3; // an editor counts as present for this long after their last heartbeat

// What the editor needs to know about each collection (the render functions stay on the server).
const collectionSchema = () => Object.fromEntries(COLS.map((c) => {
  const d = collections[c];
  return [c, { label: d.label, one: d.one, path: d.path, feature: d.feature || null, help: d.help, titleKey: d.titleKey, dateKey: d.dateKey || null, fields: d.fields, defaults: d.defaults, body: d.body !== false, archive: d.archive || null }];
}));

function createApi({ cms, editAssets = '', now = () => Date.now() }) {
  const rooms = new Map(); // chapter -> Map(editor id -> { name, doc, at })
  const json = (body, status = 200) => ({ status, type: 'json', body });
  const html = (body) => ({ status: 200, type: 'html', body });
  const fail = (status, msg) => Object.assign(new Error(msg), { status });

  async function presence(ch, b, user) {
    const room = rooms.get(ch) || new Map(), t = now(), id = String(b.id || '').slice(0, 40), doc = String(b.doc || '').slice(0, 64);
    rooms.set(ch, room);
    if (id && b.leave) room.delete(id); else if (id) room.set(id, { name: String(b.name || user).slice(0, 40), doc, at: t });
    for (const [k, v] of room) if (t - v.at > PRESENCE_MS) room.delete(k);
    let rev = null;
    try { rev = await cms.rev(ch, doc); } catch { /* gone */ }
    return { others: [...room].filter(([k]) => k !== id).map(([, v]) => ({ name: v.name, doc: v.doc })), rev };
  }
  // The media library of a chapter or of national (M2): list, upload, edit, delete.
  async function media(ch, M, x, y, b, user) {
    if (M === 'GET' && !x) return json(await cms.mediaList(ch));
    if (M === 'POST' && !x) return json(await cms.upload(ch, b, user));
    if (M === 'POST' && x && !y) return json(await cms.mediaUpdate(ch, x, b));
    if (M === 'POST' && y === 'delete') return json(await cms.mediaDelete(ch, x));
    throw fail(404, 'Not found');
  }

  async function handle({ method = 'GET', path = '', body, user = 'Someone' }) {
    const M = method.toUpperCase(), b = body || {};
    const [a, ch, kind, x, y, z] = path.split('/').filter(Boolean).map(decodeURIComponent);
    const is = (m, ...want) => M === m && want.every((w, i) => [kind, x, y, z][i] === w || (w === '*' && [kind, x, y, z][i] !== undefined)) && [kind, x, y, z][want.length] === undefined;
    if (a === 'schema' && M === 'GET') return json({ ...schema(), collections: collectionSchema(), templates: templateList(), features: FEATURES });
    if (a === 'chapters' && M === 'GET') return json(await cms.chapters());
    if (a === 'preview' && M === 'POST') return html(await cms.renderPreview(String(b.chapter || ''), b, editAssets));
    // national settings: approved looks, feature switches, logo approvals, the national media library
    if (a === 'national') {
      if (M === 'GET' && !ch) return json(await cms.getNational());
      if (M === 'PUT' && !ch) return json(await cms.saveNational(b));
      if (M === 'POST' && ch === 'logo' && SLUG.test(kind || '') && !x) return json(await cms.decideLogo(kind, !!b.approve));
      if (ch === 'media') return media('national', M, kind, x, b, user);
      throw fail(404, 'Not found');
    }
    if (a !== 'chapter' || !SLUG.test(ch || '')) throw fail(404, 'Not found');

    if (is('GET')) return json(await cms.overview(ch));
    if (is('GET', 'gallery')) return html(await cms.gallery(ch));
    if (is('POST', 'checks')) return json(await cms.checks(ch, b.doc ?? b.page));
    if (is('POST', 'presence')) return json(await presence(ch, b, user));
    // site settings
    if (is('GET', 'site')) return json(await cms.getSite(ch));
    if (is('PUT', 'site')) return json(await cms.saveSite(ch, b, user));
    if (is('POST', 'site', 'discard')) return json(await cms.discardSite(ch));
    // pages
    if (is('POST', 'pages')) return json(await cms.newPage(ch, b, user));
    if (kind === 'page') {
      const slug = x;
      if (is('GET', 'page', '*')) return json(await cms.getPage(ch, slug));
      if (is('PUT', 'page', '*')) return json(await cms.savePage(ch, slug, b, user));
      const act = M === 'POST' && z === undefined ? y : null;
      if (act === 'discard') return json(await cms.discardPage(ch, slug));
      if (act === 'duplicate') return json(await cms.duplicatePage(ch, slug, user));
      if (act === 'rename') return json(await cms.renamePage(ch, slug, b, user));
      if (act === 'unpublish') return json(await cms.unpublishPage(ch, slug, user));
      if (act === 'delete') return json(await cms.deletePage(ch, slug, user));
      if (act === 'home') return json(await cms.setHome(ch, slug, user));
      if (act === 'share') return json(await cms.share(ch, slug, user));
    }
    // collection items: events, posts, people, endorsements, issues, saved sections
    if (is('GET', 'items', '*')) return json(await cms.listItems(ch, x));
    if (is('POST', 'items', '*')) return json(await cms.newItem(ch, x, b, user));
    if (kind === 'item' && x && y) {
      if (is('GET', 'item', '*', '*')) return json(await cms.getItem(ch, x, y));
      if (is('PUT', 'item', '*', '*')) return json(await cms.saveItem(ch, x, y, b, user));
      const act = M === 'POST' && z !== undefined ? z : null;
      if (act === 'discard') return json(await cms.discardItem(ch, x, y));
      if (act === 'duplicate') return json(await cms.duplicateItem(ch, x, y, user));
      if (act === 'rename') return json(await cms.renameItem(ch, x, y, b, user));
      if (act === 'unpublish') return json(await cms.unpublishItem(ch, x, y, user));
      if (act === 'delete') return json(await cms.deleteItem(ch, x, y, user));
      if (act === 'share') return json(await cms.share(ch, y, user, x));
    }
    // publishing and scheduling
    if (is('GET', 'pending')) return json(await cms.pending(ch));
    if (is('POST', 'pending')) return json(await cms.pending(ch, b));
    if (is('POST', 'publish')) return json(await cms.publish(ch, b, user));
    if (is('GET', 'schedule')) return json(await cms.scheduleList(ch));
    if (is('POST', 'schedule')) return json(await cms.addSchedule(ch, b, user));
    if (is('POST', 'schedule', '*', 'cancel')) return json(await cms.cancelSchedule(ch, x));
    // history
    if (is('GET', 'timeline')) return json(await cms.timeline(ch));
    if (is('POST', 'restore-site')) return json(await cms.restoreSite(ch, b.at, user));
    if (is('GET', 'versions', '*')) return json(await cms.versions(ch, x));
    if (is('POST', 'versions', '*', 'stash')) return json(await cms.stash(ch, x, b.doc, user, b.name));
    if (is('GET', 'versions', '*', '*')) return json(await cms.version(ch, x, y));
    if (is('POST', 'versions', '*', '*', 'name')) return json(await cms.nameVersion(ch, x, y, b.name));
    if (is('POST', 'versions', '*', '*', 'restore')) return json(await cms.restoreVersion(ch, x, y, user));
    // share links and trash
    if (is('GET', 'shares')) return json(await cms.shares(ch));
    if (is('POST', 'shares', '*', 'revoke')) return json(await cms.revokeShare(ch, x));
    if (is('POST', 'trash', '*', 'restore')) return json(await cms.restoreTrash(ch, x, user));
    // media and messages
    if (kind === 'media' && z === undefined) return media(ch, M, x, y, b, user);
    if (is('GET', 'inbox')) return json(await cms.inbox(ch));
    if (is('POST', 'inbox', '*')) return json(await cms.inboxUpdate(ch, x, b));
    throw fail(404, 'Not found');
  }
  return { handle };
}

// Turns a thrown error into an API response (errors from cms.js may carry a JSON body, like a 409 conflict).
const errorResponse = (e) => ({ status: e.status || 500, type: 'json', body: e.body ? { ...e.body, message: e.message } : { error: e.status ? e.message : 'Something went wrong' } });

module.exports = { createApi, errorResponse };
