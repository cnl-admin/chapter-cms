'use strict';
// The editor's JSON API, independent of any web server: server.js passes /admin/api/* requests to handle(), and the
// single-file demo calls handle() from a fetch shim, so both run the same code.
//   handle({ method, path, body, user }) -> { status, type: 'json' | 'html', body }
const { schema, blocks, sampleFor } = require('./blocks');
const { renderPage } = require('./render');
const { SLUG } = require('./text');
const { SITE } = require('./cms');

const PRESENCE_MS = 45e3; // an editor counts as present for this long after their last heartbeat

function createApi({ cms, editAssets = '', now = () => Date.now() }) {
  const rooms = new Map(); // chapter -> Map(editor id -> { name, doc, at })
  const json = (body, status = 200) => ({ status, type: 'json', body });
  const html = (body) => ({ status: 200, type: 'html', body });
  const fail = (status, msg) => Object.assign(new Error(msg), { status });

  async function gallery(ch) {
    const { site } = await cms.getSite(ch);
    const page = { title: 'Block gallery', blocks: Object.keys(blocks).map((type, i) => ({ id: 'g' + i, type, props: sampleFor(type) })) };
    return renderPage(site, page, { pageSlug: '', preview: true, labels: true });
  }
  async function presence(ch, b, user) {
    const room = rooms.get(ch) || new Map(), t = now(), id = String(b.id || '').slice(0, 40), doc = String(b.doc || '').slice(0, 41);
    rooms.set(ch, room);
    if (id && b.leave) room.delete(id); else if (id) room.set(id, { name: String(b.name || user).slice(0, 40), doc, at: t });
    for (const [k, v] of room) if (t - v.at > PRESENCE_MS) room.delete(k);
    let rev = null;
    try { rev = doc === SITE ? (await cms.getSite(ch)).rev : SLUG.test(doc) ? (await cms.getPage(ch, doc)).rev : null; } catch { /* page gone */ }
    return { others: [...room].filter(([k]) => k !== id).map(([, v]) => ({ name: v.name, doc: v.doc })), rev };
  }

  async function handle({ method = 'GET', path = '', body, user = 'Someone' }) {
    const M = method.toUpperCase(), b = body || {};
    const [a, ch, kind, x, y, z] = path.split('/').filter(Boolean).map(decodeURIComponent);
    const is = (m, ...want) => M === m && want.every((w, i) => [kind, x, y, z][i] === w || (w === '*' && [kind, x, y, z][i] !== undefined)) && [kind, x, y, z][want.length] === undefined;
    if (a === 'schema' && M === 'GET') return json(schema());
    if (a === 'chapters' && M === 'GET') return json(await cms.chapters());
    if (a === 'preview' && M === 'POST') return html(await cms.renderPreview(String(b.chapter || ''), b, editAssets));
    if (a !== 'chapter' || !SLUG.test(ch || '')) throw fail(404, 'Not found');

    if (is('GET')) return json(await cms.overview(ch));
    if (is('GET', 'gallery')) return html(await gallery(ch));
    if (is('GET', 'checks')) return json(await cms.checks(ch, b.page));
    if (is('POST', 'checks')) return json(await cms.checks(ch, b.page));
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
      if (is('GET', 'page', '*', 'checks')) return json((await cms.checks(ch, slug)).page || []);
      const act = M === 'POST' && z === undefined ? y : null;
      if (act === 'discard') return json(await cms.discardPage(ch, slug));
      if (act === 'duplicate') return json(await cms.duplicatePage(ch, slug, user));
      if (act === 'rename') return json(await cms.renamePage(ch, slug, b, user));
      if (act === 'unpublish') return json(await cms.unpublishPage(ch, slug, user));
      if (act === 'delete') return json(await cms.deletePage(ch, slug, user));
      if (act === 'home') return json(await cms.setHome(ch, slug, user));
      if (act === 'share') return json(await cms.share(ch, slug, user));
    }
    // publishing
    if (is('GET', 'pending')) return json(await cms.pending(ch));
    if (is('POST', 'pending')) return json(await cms.pending(ch, b));
    if (is('POST', 'publish')) return json(await cms.publish(ch, b, user));
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
    throw fail(404, 'Not found');
  }
  return { handle };
}

// Turns a thrown error into an API response (errors from cms.js may carry a JSON body, like a 409 conflict).
const errorResponse = (e) => ({ status: e.status || 500, type: 'json', body: e.body ? { ...e.body, message: e.message } : { error: e.status ? e.message : 'Something went wrong' } });

module.exports = { createApi, errorResponse };
