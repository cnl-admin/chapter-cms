'use strict';
// Zero-dependency server: public chapter sites + /admin editor + JSON API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileStore, SLUG } = require('./lib/store');
const { schema, validateBlocks, defaultsFor, blocks } = require('./lib/blocks');
const { renderPage } = require('./lib/render');

const PORT = +process.env.PORT || 3000;
const DEV = process.env.NODE_ENV !== 'production';
const BASE_DOMAIN = process.env.BASE_DOMAIN || '';          // e.g. cnliberalism.org -> austin.cnliberalism.org
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';    // required in production
const DEFAULT_CHAPTER = process.env.DEFAULT_CHAPTER || 'demo';
const store = new FileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff' }); res.end(body); };
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');
const fail = (code, msg) => Object.assign(new Error(msg), { status: code });

function chapterFor(req, url) {
  const host = (req.headers.host || '').split(':')[0];
  if (BASE_DOMAIN && host.endsWith('.' + BASE_DOMAIN)) return host.slice(0, -BASE_DOMAIN.length - 1);
  if (DEV && url.searchParams.get('chapter')) return url.searchParams.get('chapter');
  return DEFAULT_CHAPTER;
}

function authed(req) {
  if (!ADMIN_PASSWORD) return DEV; // no password set: open in dev only
  const [scheme, val] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !val) return false;
  const given = Buffer.from(Buffer.from(val, 'base64').toString().split(':').slice(1).join(':'));
  const want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 2e6) { reject(fail(413, 'too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(fail(400, 'invalid JSON')); } });
  });
}

function sitePage(chapter, slug) {
  const site = store.get(chapter, '_site');
  if (!site) throw fail(404, 'Unknown chapter');
  const page = store.get(chapter, slug);
  if (!page) throw fail(404, 'Page not found');
  return { site, page };
}

async function admin(req, res, url) {
  if (!authed(req)) { res.setHeader('www-authenticate', 'Basic realm="Chapter admin"'); return send(res, 401, 'Login required'); }
  const p = url.pathname;
  if (p === '/admin' || p === '/admin/') return send(res, 200, fs.readFileSync(path.join(__dirname, 'admin', 'index.html')));
  if (p === '/admin/admin.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'admin', 'admin.js')), MIME['.js']);
  if (!p.startsWith('/admin/api/')) return send(res, 404, 'Not found');
  const parts = p.slice('/admin/api/'.length).split('/').filter(Boolean).map(decodeURIComponent);

  if (req.method !== 'GET') { // CSRF: JSON content-type + same-origin
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON only');
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) throw fail(403, 'bad origin');
  }
  if (parts[0] === 'schema') return json(res, 200, schema());
  if (parts[0] === 'chapters') return json(res, 200, store.chapters());
  if (parts[0] === 'preview' && req.method === 'POST') {
    const b = await readBody(req);
    const site = store.get(b.chapter, '_site'); if (!site) throw fail(404, 'Unknown chapter');
    const page = { title: String(b.title || ''), seo_title: String(b.seo_title || ''), seo_description: String(b.seo_description || ''), seo_image: String(b.seo_image || ''), blocks: validateBlocks(b.blocks) };
    return send(res, 200, renderPage(site, page, { pageSlug: b.page, preview: true, edit: !!b.edit }));
  }
  if (parts[0] !== 'chapter') throw fail(404, 'Not found');
  const [, chapter, kind, slug, extra] = parts;
  if (!SLUG.test(chapter || '')) throw fail(400, 'bad chapter');
  if (!kind) {
    const drafts = new Set(store.drafts(chapter));
    return json(res, 200, { site: store.get(chapter, '_site'), pages: store.allPages(chapter).map((s) => ({ slug: s, title: (store.getDraft(chapter, s) || store.get(chapter, s))?.title, draft: drafts.has(s), live: store.pages(chapter).includes(s) })) });
  }
  if (kind === 'publish' && req.method === 'POST') return json(res, 200, { published: store.publish(chapter) });
  if (kind === 'pages' && req.method === 'POST') { // create a new page (as a draft) and add it to the menu
    const b = await readBody(req);
    const title = String(b.title || '').trim().slice(0, 60) || 'New page';
    let base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'page', slug = base, n = 2;
    while (store.allPages(chapter).includes(slug) || ['admin', 'static'].includes(slug)) slug = `${base}-${n++}`;
    store.putDraft(chapter, slug, { title, seo_title: '', seo_description: '', seo_image: '', blocks: validateBlocks([{ type: 'hero', props: { ...defaultsFor('hero'), heading: title } }, { type: 'text', props: defaultsFor('text') }]) });
    const site = store.get(chapter, '_site'); site.nav = [...(site.nav || []), { label: title, path: '/' + slug }].slice(0, 12); store.put(chapter, '_site', site);
    return json(res, 200, { slug });
  }
  if (kind === 'site') {
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const s = (v, n = 300) => String(v ?? '').slice(0, n);
      const social = { x: s(b.social?.x, 80), ig: s(b.social?.ig, 80), bsky: s(b.social?.bsky, 120) };
      const nav = (Array.isArray(b.nav) ? b.nav : []).slice(0, 12).map((n) => ({ label: s(n.label, 40), path: s(n.path, 80) }));
      store.put(chapter, '_site', { name: s(b.name, 80), tagline: s(b.tagline), footer: s(b.footer), contact_email: s(b.contact_email, 120), timezone: s(b.timezone, 60) || 'America/Chicago', theme: { primary: s(b.theme?.primary, 9), accent: s(b.theme?.accent, 9), logo: s(b.theme?.logo, 500) }, social, nav });
    }
    return json(res, 200, store.get(chapter, '_site'));
  }
  if (kind === 'page' && SLUG.test(slug || '')) {
    if (extra === 'history') return json(res, 200, store.history(chapter, slug));
    if (extra === 'restore' && req.method === 'POST') { const b = await readBody(req); const data = store.restore(chapter, slug, String(b.version)); store.putDraft(chapter, slug, data); return json(res, 200, data); }
    if (extra === 'discard' && req.method === 'POST') { store.discardDraft(chapter, slug); return json(res, 200, store.get(chapter, slug) || {}); }
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const s = (v, n = 300) => String(v ?? '').slice(0, n);
      store.putDraft(chapter, slug, { title: s(b.title, 120) || slug, seo_title: s(b.seo_title), seo_description: s(b.seo_description, 400), seo_image: s(b.seo_image, 500), blocks: validateBlocks(b.blocks) });
    }
    if (req.method === 'DELETE') throw fail(405, 'deleting pages is not supported yet');
    const page = store.getDraft(chapter, slug) || store.get(chapter, slug);
    return page ? json(res, 200, page) : json(res, 404, { error: 'not found' });
  }
  throw fail(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/static/')) {
      const f = path.join(__dirname, 'static', path.basename(url.pathname));
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream') : send(res, 404, 'Not found');
    }
    if (url.pathname.startsWith('/admin')) return await admin(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const chapter = chapterFor(req, url);
    if (!SLUG.test(chapter)) return send(res, 404, 'Not found');
    const slug = url.pathname.replace(/^\/|\/$/g, '') || 'home';
    if (!SLUG.test(slug)) return send(res, 404, 'Not found');
    const { site, page } = sitePage(chapter, slug);
    send(res, 200, renderPage(site, page, { pageSlug: slug }));
  } catch (e) {
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if ((req.url || '').startsWith('/admin/api')) return json(res, code, { error: e.message });
    send(res, code, `<!doctype html><meta charset=utf-8><link rel=stylesheet href=/static/site.css><div class=wrap style="padding:4rem 0"><h1>${code === 404 ? 'Page not found' : 'Something went wrong'}</h1><p><a href="/">Back home</a></p></div>`);
  }
});

if (require.main === module) {
  if (!DEV && !ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD when NODE_ENV=production'); process.exit(1); }
  server.listen(PORT, ADMIN_PASSWORD ? undefined : '127.0.0.1', () => console.log(`Chapter CMS on http://localhost:${PORT}  (admin: /admin${ADMIN_PASSWORD ? ', password required' : ', open in dev'})`));
}
module.exports = { server };
