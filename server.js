'use strict';
// Zero-dependency server: public chapter sites and their item pages, uploaded media, contact forms, the read-only
// content API (/api/v1), share-link previews, the /admin editor and its JSON API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileStore } = require('./lib/store');
const { createCms } = require('./lib/cms');
const { createApi, errorResponse } = require('./lib/api');
const { SLUG } = require('./lib/text');

const PORT = +process.env.PORT || 3000;
const DEV = process.env.NODE_ENV !== 'production';
const BASE_DOMAIN = process.env.BASE_DOMAIN || '';          // e.g. cnliberalism.org -> austin.cnliberalism.org
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';    // required in production
const DEFAULT_CHAPTER = process.env.DEFAULT_CHAPTER || 'demo';
const cms = createCms({ store: new FileStore(process.env.DATA_DIR || path.join(__dirname, 'data')) });
// The editor preview is a srcdoc iframe, which resolves these against the admin page's address.
const api = createApi({ cms, editAssets: '<link rel="stylesheet" href="/admin/frame.css"><script src="/admin/text.js"></script><script src="/admin/frame.js"></script>' });

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const send = (res, code, body, type = MIME['.html'], extra = {}) => { res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra }); res.end(body); };
const fail = (code, msg) => Object.assign(new Error(msg), { status: code });

function chapterFor(req, url) {
  const host = (req.headers.host || '').split(':')[0];
  if (BASE_DOMAIN && host.endsWith('.' + BASE_DOMAIN)) return host.slice(0, -BASE_DOMAIN.length - 1);
  if (DEV && url.searchParams.get('chapter')) return url.searchParams.get('chapter');
  return DEFAULT_CHAPTER;
}

function credentials(req) {
  const [scheme, val] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !val) return null;
  const s = Buffer.from(val, 'base64').toString(), i = s.indexOf(':');
  return i < 0 ? null : { user: s.slice(0, i), pass: s.slice(i + 1) };
}
function authed(req) {
  if (!ADMIN_PASSWORD) return DEV; // no password set: open in dev only
  const c = credentials(req);
  if (!c) return false;
  const given = Buffer.from(c.pass), want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
// Who is editing, for history and presence. Until logins land this is the name the editor asks for once.
function editorName(req) {
  let n = '';
  try { n = decodeURIComponent(req.headers['x-editor'] || ''); } catch { /* ignore */ }
  return n.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || credentials(req)?.user?.slice(0, 40) || 'Someone';
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(fail(413, 'too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
async function readBody(req, max = 2e6) {
  const raw = await readRaw(req, max);
  try { return JSON.parse(raw || '{}'); } catch { throw fail(400, 'invalid JSON'); }
}

// Contact forms (C5): a few messages per visitor per ten minutes, on top of the chapter-wide cap in cms.js.
const sent = new Map();
function tooMany(ip) {
  const t = Date.now(), list = (sent.get(ip) || []).filter((x) => t - x < 10 * 60e3);
  if (sent.size > 5000) sent.clear();
  sent.set(ip, [...list, t]);
  return list.length >= 5;
}
async function contactForm(req, res, chapter) {
  const raw = await readRaw(req, 2e4), f = Object.fromEntries(new URLSearchParams(raw));
  const back = '\n\n[Back to the site](/)';
  if (tooMany(req.socket.remoteAddress || '')) {
    const r = await cms.renderNotice(chapter, 'Please wait a little', 'You have sent several messages already. Please try again in a few minutes.' + back, 429);
    return send(res, r.status, r.html || 'Too many messages');
  }
  try {
    const out = await cms.contact(chapter, f);
    const r = await cms.renderNotice(chapter, 'Message sent', `Thanks. Your message is on its way to ${out.toName || 'the chapter'}, and they will reply by email.` + back);
    return send(res, r.status, r.html || 'Sent', MIME['.html'], { 'cache-control': 'no-store' });
  } catch (e) {
    if (!e.status || e.status >= 500) throw e;
    const r = await cms.renderNotice(chapter, 'Your message was not sent', e.message + '\n\nGo back to fix it and try again.', e.status);
    return send(res, r.status, r.html || e.message, MIME['.html'], { 'cache-control': 'no-store' });
  }
}

async function admin(req, res, url) {
  if (!authed(req)) return send(res, 401, 'Login required', MIME['.html'], { 'www-authenticate': 'Basic realm="Chapter admin"' });
  const p = url.pathname, safe = { 'x-frame-options': 'DENY', 'cache-control': 'no-store' };
  if (p === '/admin' || p === '/admin/') return send(res, 200, fs.readFileSync(path.join(__dirname, 'admin', 'index.html')), MIME['.html'], safe);
  const asset = p.match(/^\/admin\/([a-z]+\.(js|css))$/);
  if (asset) {
    const f = asset[1] === 'text.js' ? path.join(__dirname, 'lib', 'text.js') : path.join(__dirname, 'admin', asset[1]);
    return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), MIME['.' + asset[2]], { 'cache-control': 'no-cache' }) : send(res, 404, 'Not found');
  }
  if (!p.startsWith('/admin/api/')) return send(res, 404, 'Not found');
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') { // CSRF: JSON content-type + same-origin
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON only');
    const o = req.headers.origin;
    if (o && o !== 'null' && new URL(o).host !== req.headers.host) throw fail(403, 'bad origin');
    body = await readBody(req, /\/media$/.test(p) ? 9e6 : 2e6); // uploads arrive as base64
  }
  const r = await api.handle({ method: req.method, path: p.slice('/admin/api/'.length), body, user: editorName(req) }).catch(errorResponse);
  if (r.status >= 500) console.error(r.body);
  return r.type === 'html' ? send(res, r.status, r.body, MIME['.html'], { 'cache-control': 'no-store' }) : send(res, r.status, JSON.stringify(r.body), 'application/json', { 'cache-control': 'no-store' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/static/')) {
      const f = path.join(__dirname, 'static', path.basename(url.pathname));
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream') : send(res, 404, 'Not found');
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await admin(req, res, url);
    const chapter = chapterFor(req, url);
    if (!SLUG.test(chapter)) return send(res, 404, 'Not found');
    if (url.pathname === '/contact' && req.method === 'POST') return await contactForm(req, res, chapter);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    // uploaded images: /media/<file> for the chapter's, /media/national/<file> for the national library's
    const media = url.pathname.match(/^\/media\/(?:(national)\/)?([a-z0-9]+\.[a-z]+)$/);
    if (media) {
      const f = await cms.mediaFile(media[1] || chapter, media[2]);
      return f ? send(res, 200, Buffer.from(f.bytes), f.type, { 'cache-control': 'public, max-age=31536000, immutable', 'content-security-policy': "default-src 'none'" }) : send(res, 404, 'Not found');
    }
    // the read-only content API (F3): published content only, readable from any site
    if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
      const r = await cms.contentApi(chapter, url.pathname.slice('/api/v1'.length));
      return send(res, r.status, JSON.stringify(r.body, null, 2), MIME['.json'], { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' });
    }
    const share = url.pathname.match(/^\/preview\/([a-z0-9]+)\/?$/);
    if (share) {
      const html = await cms.renderShare(chapter, share[1]);
      const head = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
      return html ? send(res, 200, html, MIME['.html'], head) : send(res, 404, '<!doctype html><meta charset=utf-8><title>Link expired</title><p style="font:18px system-ui;padding:3rem">This preview link has expired or was turned off. Ask whoever sent it for a new one.</p>', MIME['.html'], head);
    }
    const p = url.pathname.replace(/^\/|\/$/g, '');
    if (p && !p.split('/').every((s) => SLUG.test(s))) return send(res, 404, 'Not found');
    const r = await cms.renderLive(chapter, p);
    if (r.status === 301) { res.writeHead(301, { location: r.location }); return res.end(); }
    if (!r.html) return send(res, 404, 'Not found');
    send(res, r.status, r.html);
  } catch (e) {
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if ((req.url || '').startsWith('/admin/api')) return send(res, code, JSON.stringify({ error: e.message }), 'application/json');
    send(res, code, `<!doctype html><meta charset=utf-8><link rel=stylesheet href=/static/site.css><div class=wrap style="padding:4rem 0"><h1>${code === 404 ? 'Page not found' : 'Something went wrong'}</h1><p><a href="/">Back home</a></p></div>`);
  }
});

if (require.main === module) {
  if (!DEV && !ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD when NODE_ENV=production'); process.exit(1); }
  setInterval(() => cms.tickAll().catch((e) => console.error(e)), 60e3).unref(); // scheduled publishes (W5)
  server.listen(PORT, ADMIN_PASSWORD ? undefined : '127.0.0.1', () => console.log(`Chapter CMS on http://localhost:${PORT}  (admin: /admin${ADMIN_PASSWORD ? ', password required' : ', open in dev'})`));
}
module.exports = { server, cms };
