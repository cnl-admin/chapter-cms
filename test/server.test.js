'use strict';
// The HTTP layer: auth, CSRF, admin assets, public pages and share links.
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
  } finally { server.close(); }
});
