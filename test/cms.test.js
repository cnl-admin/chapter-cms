'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const B = require('../lib/blocks');
const { FileStore } = require('../lib/store');

test('text is HTML-escaped', () => {
  const h = B.renderBlock({ type: 'text', props: { heading: '<script>x</script>', body: '<img onerror=1>' } });
  assert.ok(!h.includes('<script>') && !h.includes('<img'));
});
test('markdown subset and unsafe links', () => {
  const h = B.paras('**b** *i* [ok](https://a.com) [bad](javascript:alert(1)) [bad2](data:text/html,x)');
  assert.match(h, /<strong>b<\/strong>/); assert.match(h, /<em>i<\/em>/); assert.match(h, /href="https:\/\/a.com"/);
  assert.ok(!/javascript:|data:/.test(h));
});
test('safeUrl rejects bad schemes and protocol-relative', () => {
  for (const u of ['javascript:1', ' JaVaScript:1', 'data:x', '//evil.com', 'vbscript:1']) assert.strictEqual(B.safeUrl(u), '#');
  for (const u of ['https://a.com', '/events', 'mailto:a@b.c', '#top']) assert.notStrictEqual(B.safeUrl(u), '#');
});
test('validateBlocks strips unknown keys, rejects unknown types', () => {
  const [b] = B.validateBlocks([{ type: 'hero', props: { heading: 'Hi', evil: 'x' } }]);
  assert.strictEqual(b.props.heading, 'Hi'); assert.ok(!('evil' in b.props));
  assert.throws(() => B.validateBlocks([{ type: 'nope' }]));
  assert.throws(() => B.validateBlocks('x'));
});
test('store rejects bad slugs, keeps history', () => {
  const s = new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cms-')));
  for (const bad of ['../x', 'A', 'a/b', '']) assert.throws(() => s.get(bad, 'home'));
  assert.throws(() => s.get('demo', '../x'));
  s.put('demo', 'home', { title: 'v1', blocks: [] }); s.put('demo', 'home', { title: 'v2', blocks: [] });
  assert.strictEqual(s.get('demo', 'home').title, 'v2');
  const h = s.history('demo', 'home'); assert.strictEqual(h.length, 1);
  assert.strictEqual(s.restore('demo', 'home', h[0]).title, 'v1');
  assert.throws(() => s.restore('demo', 'home', '../../etc/passwd'));
});
test('past events hidden by default', () => {
  const h = B.renderBlock({ type: 'events_list', props: { heading: 'E', events: [{ title: 'Old', start: '2020-01-01T10:00' }, { title: 'New', start: '2999-01-01T10:00' }] } });
  assert.ok(!h.includes('Old') && h.includes('New'));
});
test('server: auth + csrf + render', async () => {
  process.env.ADMIN_PASSWORD = 'pw';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-data-')); fs.cpSync(path.join(__dirname, '..', 'data'), tmp, { recursive: true }); process.env.DATA_DIR = tmp;
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: 'Basic ' + Buffer.from('x:pw').toString('base64') };
  assert.strictEqual((await fetch(base + '/admin/api/chapters')).status, 401);
  assert.strictEqual((await fetch(base + '/admin/api/chapters', { headers: auth })).status, 200);
  assert.strictEqual((await fetch(base + '/admin/api/chapter/demo/page/home', { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.strictEqual((await fetch(base + '/admin/api/chapter/demo/page/home', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json', origin: 'https://evil.com' }, body: '{}' })).status, 403);
  assert.strictEqual((await fetch(base + '/')).status, 200);
  assert.strictEqual((await fetch(base + '/..%2f..%2fetc')).status, 404);
  assert.strictEqual((await fetch(base + '/nope')).status, 404);
  // drafts stay private until published
  const jh = { ...auth, 'content-type': 'application/json' };
  const put = (blocks) => fetch(base + '/admin/api/chapter/demo/page/about', { method: 'PUT', headers: jh, body: JSON.stringify({ title: 'About', blocks }) });
  assert.strictEqual((await put([{ type: 'text', props: { heading: 'DRAFT-MARKER' } }])).status, 200);
  assert.ok(!(await (await fetch(base + '/about')).text()).includes('DRAFT-MARKER'));
  assert.ok((await (await fetch(base + '/admin/api/chapter/demo/page/about', { headers: auth })).json()).blocks[0].props.heading === 'DRAFT-MARKER');
  assert.deepStrictEqual((await (await fetch(base + '/admin/api/chapter/demo/publish', { method: 'POST', headers: jh, body: '{}' })).json()).published, ['about']);
  assert.ok((await (await fetch(base + '/about')).text()).includes('DRAFT-MARKER'));
  // new page: draft, added to menu, 404 until published
  const np = await (await fetch(base + '/admin/api/chapter/demo/pages', { method: 'POST', headers: jh, body: JSON.stringify({ title: 'Volunteer!' }) })).json();
  assert.strictEqual(np.slug, 'volunteer');
  assert.strictEqual((await fetch(base + '/volunteer')).status, 404);
  await fetch(base + '/admin/api/chapter/demo/publish', { method: 'POST', headers: jh, body: '{}' });
  assert.strictEqual((await fetch(base + '/volunteer')).status, 200);
  server.close();
});
test('columns validation: atoms only, column count follows layout', () => {
  const [b] = B.validateBlocks([{ type: 'columns', props: { layout: 'full', cols: [[{ type: 'text', props: { heading: 'a' } }], [{ type: 'button', props: { label: 'b' } }]] } }]);
  assert.strictEqual(b.props.cols.length, 1); assert.strictEqual(b.props.cols[0].length, 2);
  assert.throws(() => B.validateBlocks([{ type: 'columns', props: { layout: 'halves', cols: [[{ type: 'hero', props: {} }], []] } }]));
  const h = B.renderBlock({ type: 'columns', props: { layout: 'halves', cols: [[{ type: 'text', props: { heading: '<b>x</b>' } }], []] } }, { site: {} });
  assert.ok(!h.includes('<b>x'));
});
test('event times render as entered wall-clock time regardless of server TZ', () => {
  const h = B.renderBlock({ type: 'events_list', props: { heading: 'E', show_past: 'Yes', events: [{ title: 'T', start: '2026-11-05T18:30' }] } });
  assert.match(h, /6:30 PM/);
});
