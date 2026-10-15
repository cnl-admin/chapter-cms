#!/usr/bin/env node
// Builds a single-file, server-less demo of the editor, for trying it on any device without running the server.
// Usage: node tools/build-preview.js out.html
// The demo runs the real code: the lib/ modules (API, drafts, publishing, history, checks) run in the browser against
// an in-memory store saved to localStorage, and a fetch shim routes the editor's /admin/api calls to api.handle().
// Edits stay in the viewer's browser. Nothing is published anywhere.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
// Inside an inline <script>, "</script" would end the script early.
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

// Seed: the demo chapter's and national's tracked files (not local drafts, history or uploads), in the store's key
// layout ("data/demo/item/events/x.json" -> demo: "item/events/x").
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const seed = {};
for (const ch of ['demo', 'national']) {
  let files;
  try { files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', `data/${ch}`], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f && fs.existsSync(path.join(root, f))); } catch { files = []; }
  if (!files.length) files = walk(`data/${ch}`);
  seed[ch] = {};
  for (const f of files.filter((x) => x.endsWith('.json'))) seed[ch][f.slice(`data/${ch}/`.length, -5)] = JSON.parse(rd(f));
}

// lib modules (all but the file store), wrapped CommonJS-style. Order doesn't matter: require() loads on first use.
const MODS = fs.readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.js') && f !== 'store.js').map((f) => f.slice(0, -3));
const mod = (name) => `__m['./${name}']=function(module,exports,require){${rd(`lib/${name}.js`)}\n};`;

const html = rd('admin/index.html');
const body = html.match(/<body>([\s\S]*?)<script src/)[1];
const sitecss = rd('static/site.css');
// What the preview frame loads in edit mode (server.js serves these as files).
const editAssets = `<style>${rd('admin/frame.css')}</style><script>${rd('lib/text.js')}</script><script>${rd('admin/frame.js')}</script>`;

const out = `<title>Chapter Editor Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${rd('admin/admin.css')}
header#top{top:env(safe-area-inset-top,0px)}
#demoNote{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;background:var(--card);border-bottom:1px solid var(--line);font-size:.85rem;color:var(--mut);padding-block:.4rem;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
#demoNote span{flex:1;min-width:12rem}
</style>
${body.replace('<main', '<div id="demoNote"><span>Demo: this runs the real editor in your browser. Edits are saved only on this device, and publishing only updates the demo.</span><button id="resetDemo" class="small">Reset demo</button></div>\n<main')}
<script>
window.__DEMO = true;
var __m = {}, __cache = {};
function __require(n) { if (__cache[n]) return __cache[n].exports; var m = __cache[n] = { exports: {} }; __m[n](m, m.exports, __require); return m.exports; }
${safe(MODS.map(mod).join('\n'))}
(function () {
  var KEY = 'chapter-cms-demo-v6', SEED = ${safe(JSON.stringify(seed))};
  var SITE_CSS = ${safe(JSON.stringify('<style>' + sitecss + '</style>'))};
  var data = null;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
  if (!data || !data.demo) data = JSON.parse(JSON.stringify(SEED));
  var timer = 0, warned = false;
  var persist = function (d) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {
        if (warned) return; warned = true; // full (photos fill it fast) or blocked
        document.querySelector('#demoNote span').textContent = 'Demo: this browser has no room left to save the demo, so changes from now on last until you reload. Reset the demo or delete some photos to make room.';
      }
    }, 300);
  };
  var store = new (__require('./memstore').MemoryStore)(data, persist);
  var cms = __require('./cms').createCms({ store: store });
  setInterval(function () { cms.tickAll().catch(function () {}); }, 30000); // scheduled publishes, as the server does
  // Uploaded photos: the site and the editor link to /media/<file>; with no server, show them from the store instead.
  var mediaData = function (u) {
    var m = /^\\/media\\/(?:(national)\\/)?([a-z0-9]+)\\.[a-z]+$/.exec(u); if (!m) return null;
    var chs = m[1] ? ['national'] : Object.keys(data).filter(function (c) { return c !== 'national'; });
    for (var i = 0; i < chs.length; i++) { var meta = data[chs[i]] && data[chs[i]]['media/' + m[2]]; if (meta) return store.dataUrl(chs[i], 'blob/' + m[2], meta.type); }
    return null;
  };
  window.__mediaSrc = function (u) { return mediaData(u) || u; };
  var withMedia = function (h) { return h.replace(/\\/media\\/(?:national\\/)?[a-z0-9]+\\.[a-z]+/g, function (u) { return mediaData(u) || u; }); };
  var A = __require('./api');
  var api = A.createApi({ cms: cms, editAssets: ${safe(JSON.stringify(editAssets))} });
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, o) {
    url = String(url); o = o || {};
    if (url.indexOf('/admin/api/') !== 0) return realFetch ? realFetch(url, o) : Promise.reject(new Error('offline'));
    var h = o.headers || {}, user = '';
    try { user = decodeURIComponent(h['x-editor'] || ''); } catch (e) { /* ignore */ }
    var req = { method: o.method || 'GET', path: url.slice('/admin/api/'.length), body: o.body ? JSON.parse(o.body) : undefined, user: user.trim().slice(0, 40) || 'Someone' };
    return api.handle(req).catch(A.errorResponse).then(function (r) {
      var isHtml = r.type === 'html';
      var text = isHtml ? withMedia(String(r.body).replace('<link rel="stylesheet" href="/static/site.css">', SITE_CSS)) : JSON.stringify(r.body);
      return new Response(text, { status: r.status, headers: { 'content-type': isHtml ? 'text/html' : 'application/json' } });
    });
  };
  document.getElementById('resetDemo').onclick = function () {
    clearTimeout(timer); store.onChange = null;
    try { localStorage.removeItem(KEY); localStorage.removeItem('chapter-cms-last'); } catch (e) { /* ignore */ }
    location.reload();
  };
})();
</script>
${['lib/text.js', 'admin/util.js', 'admin/editor.js', 'admin/panel.js', 'admin/screens.js', 'admin/boot.js'].map((f) => `<script>\n${safe(rd(f))}\n</script>`).join('\n')}
`;
const dest = process.argv[2] || 'preview.html';
fs.writeFileSync(dest, out);
console.log('wrote', dest, out.length, 'bytes');
