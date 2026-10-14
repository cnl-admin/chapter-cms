'use strict';
// The HTTP layer: auth, CSRF, admin assets, public pages, share links, media files, contact forms and the content API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

test('server: auth, CSRF, assets, public pages, share links', async () => {
  process.env.ADMIN_PASSWORD = 'pw';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-data-'));
  fs.cpSync(path.join(__dirname, '..', 'data'), tmp, { recursive: true });
  process.env.DATA_DIR = tmp;
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: 'Basic ' + Buffer.from('Sam:pw').toString('base64') };
  const jh = { ...auth, 'content-type': 'application/json' };
  try {
    assert.strictEqual((await fetch(base + '/admin/api/chapters')).status, 401);
    assert.strictEqual((await fetch(base + '/admin/api/chapters', { headers: auth })).status, 200);
    assert.strictEqual((await fetch(base + '/admin/api/chapter/demo/page/home', { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.strictEqual((await fetch(base + '/admin/api/chapter/demo/page/home', { method: 'PUT', headers: { ...jh, origin: 'https://evil.com' }, body: '{}' })).status, 403);
    assert.strictEqual((await fetch(base + '/admin/editor.js', { headers: auth })).status, 200);
    assert.strictEqual((await fetch(base + '/admin/..%2fserver.js', { headers: auth })).status, 404);
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/..%2f..%2fetc')).status, 404);
    assert.strictEqual((await fetch(base + '/nope')).status, 404);
    // edits are attributed to the editor name header (or the login name)
    const g = await (await fetch(base + '/admin/api/chapter/demo/page/about', { headers: auth })).json();
    g.page.title = 'About us';
    const put = await fetch(base + '/admin/api/chapter/demo/page/about', { method: 'PUT', headers: { ...jh, 'x-editor': encodeURIComponent('Ana B') }, body: JSON.stringify({ page: g.page, baseRev: g.rev }) });
    assert.strictEqual((await put.json()).updated_by, 'Ana B');
    const sh = await (await fetch(base + '/admin/api/chapter/demo/page/about/share', { method: 'POST', headers: jh, body: '{}' })).json();
    const pv = await fetch(base + '/preview/' + sh.token);
    assert.strictEqual(pv.status, 200); assert.match(pv.headers.get('x-robots-tag'), /noindex/);
    assert.match(await pv.text(), /About us/);
    assert.strictEqual((await fetch(base + '/preview/' + 'a'.repeat(20))).status, 404);
    const pub = await (await fetch(base + '/admin/api/chapter/demo/publish', { method: 'POST', headers: jh, body: '{}' })).json();
    assert.deepStrictEqual(pub.published, ['page:about']);
    assert.match(await (await fetch(base + '/about')).text(), /About us/);

    // item pages live two levels down
    assert.match(await (await fetch(base + '/events/voter-registration-drive')).text(), /Voter Registration Drive/);
    assert.strictEqual((await fetch(base + '/events/nope')).status, 404);

    // media: uploads are checked by their contents and served from /media with long caching and no scripts
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const up = await fetch(base + '/admin/api/chapter/demo/media', { method: 'POST', headers: jh, body: JSON.stringify({ data: png, name: 'dot.png', alt: 'A dot' }) });
    const m = await up.json();
    assert.strictEqual(up.status, 200); assert.match(m.url, /^\/media\/[a-z0-9]+\.png$/);
    const img = await fetch(base + m.url);
    assert.strictEqual(img.status, 200); assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/); assert.strictEqual(img.headers.get('content-security-policy'), "default-src 'none'");
    assert.strictEqual(Buffer.from(await img.arrayBuffer()).toString('base64'), png);
    const html = Buffer.from('<script>alert(1)</script>').toString('base64');
    assert.strictEqual((await fetch(base + '/admin/api/chapter/demo/media', { method: 'POST', headers: jh, body: JSON.stringify({ data: html, name: 'x.png' }) })).status, 415);
    assert.strictEqual((await fetch(base + '/media/zzzz.png')).status, 404);
    assert.strictEqual((await fetch(base + '/media/national/zzzz.png')).status, 404);

    // contact form: a plain HTML form post, a thank-you page, and the message waits in the chapter's inbox
    const form = (f) => fetch(base + '/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() });
    const ok = await form({ name: 'Pat', email: 'pat@example.com', message: 'Hello there', to: 'person:alex-rivera' });
    assert.strictEqual(ok.status, 200); assert.match(await ok.text(), /Message sent[\s\S]*Alex Rivera/);
    const bad = await form({ name: 'Pat', email: 'not-an-email', message: 'Hi' });
    assert.strictEqual(bad.status, 400); assert.match(await bad.text(), /not sent/);
    assert.strictEqual((await form({ name: 'Bot', email: 'b@x.co', message: 'spam', website: 'http://spam' })).status, 200);
    const inbox = await (await fetch(base + '/admin/api/chapter/demo/inbox', { headers: auth })).json();
    assert.deepStrictEqual(inbox.map((x) => x.name), ['Pat'], 'the honeypot message is dropped quietly');
    assert.ok(!(await (await fetch(base + '/people/alex-rivera')).text()).includes('alex@example.org'), 'a person\'s email never reaches the page');

    // the read-only content API: published content as JSON, readable from other sites
    const apiRes = await fetch(base + '/api/v1/events');
    assert.strictEqual(apiRes.status, 200); assert.strictEqual(apiRes.headers.get('access-control-allow-origin'), '*');
    assert.ok((await apiRes.json()).items.some((e) => e.page_url === '/events/voter-registration-drive'));
    assert.strictEqual((await fetch(base + '/api/v1/nope')).status, 404);
  } finally { server.close(); }
});
