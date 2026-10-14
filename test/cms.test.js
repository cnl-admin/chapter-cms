'use strict';
// The CMS core through its API, on the in-memory store (the same code the demo runs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { FileStore } = require('../lib/store');
const { checkPage, checkSite, checkItem } = require('../lib/checks');
const { setup } = require('./helpers');

const edit = async (call, slug, fn, user = 'Sam', baseRev) => {
  const g = (await call('GET', `chapter/demo/page/${slug}`)).body;
  fn(g.page);
  return call('PUT', `chapter/demo/page/${slug}`, { page: g.page, baseRev: baseRev ?? g.rev }, user);
};

test('demo seed passes the pre-publish checks', async () => {
  const { cms } = setup();
  for (const p of (await cms.overview('demo')).pages) assert.deepStrictEqual((await cms.checks('demo', p.slug)).page.filter((c) => c.level === 'error'), [], p.slug);
  assert.deepStrictEqual((await cms.checks('demo')).site, []);
});
test('drafts stay private until published; undoing every change clears the draft', async () => {
  const { cms, call } = setup();
  let r = await edit(call, 'about', (p) => { p.blocks[0].props.cols[0][0].props.heading = 'DRAFT-MARKER'; });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.draft, true);
  assert.ok(!(await cms.renderLive('demo', 'about')).html.includes('DRAFT-MARKER'));
  assert.deepStrictEqual((await call('POST', 'chapter/demo/publish', {})).body.published, ['page:about']);
  assert.ok((await cms.renderLive('demo', 'about')).html.includes('DRAFT-MARKER'));
  r = await edit(call, 'about', (p) => { p.blocks[0].props.cols[0][0].props.heading = 'Changed'; });
  assert.strictEqual(r.body.draft, true);
  r = await edit(call, 'about', (p) => { p.blocks[0].props.cols[0][0].props.heading = 'DRAFT-MARKER'; });
  assert.strictEqual(r.body.draft, false, 'back to the live content, so no draft');
  assert.strictEqual((await call('GET', 'chapter/demo')).body.pending, 0);
});
test('a save based on an old rev is refused with the current version', async () => {
  const { call } = setup();
  const g = (await call('GET', 'chapter/demo/page/home')).body;
  assert.strictEqual((await edit(call, 'home', (p) => { p.title = 'Mine'; }, 'Sam', g.rev)).status, 200);
  const r = await edit(call, 'home', (p) => { p.title = 'Theirs'; }, 'Ana', g.rev);
  assert.strictEqual(r.status, 409); assert.strictEqual(r.body.error, 'conflict');
  assert.strictEqual(r.body.current.by, 'Sam'); assert.strictEqual(r.body.current.page.title, 'Mine');
  const forced = await call('PUT', 'chapter/demo/page/home', { page: { ...r.body.current.page, title: 'Theirs' }, baseRev: g.rev, force: true }, 'Ana');
  assert.strictEqual(forced.status, 200);
});
test('new pages are drafts that offer to join the menu, and go live together with it', async () => {
  const { cms, call } = setup();
  const { slug } = (await call('POST', 'chapter/demo/pages', { title: 'Volunteer!', addToMenu: true })).body;
  assert.strictEqual(slug, 'volunteer');
  assert.ok(!(await cms.renderLive('demo', '')).html.includes('/volunteer'), 'menu link waits for publish');
  let p = (await call('GET', 'chapter/demo/pending')).body.items;
  assert.deepStrictEqual(p.map((x) => x.id), ['page:volunteer', 'site']);
  assert.ok(p[0].checks.some((c) => c.level === 'error' && /starter text/.test(c.msg)));
  assert.strictEqual((await call('POST', 'chapter/demo/publish', {})).status, 422);
  await edit(call, 'volunteer', (pg) => { pg.blocks[1].props.body = 'Help out at our next canvass.'; });
  // publishing the menu without the page would break a link
  p = (await call('POST', 'chapter/demo/pending', { items: ['site'] })).body.items;
  assert.ok(p.find((x) => x.id === 'site').checks.some((c) => /isn't published/.test(c.msg)));
  assert.strictEqual((await call('POST', 'chapter/demo/publish', { items: ['site'] })).status, 422);
  assert.strictEqual((await call('POST', 'chapter/demo/publish', {})).status, 200);
  assert.strictEqual((await cms.renderLive('demo', 'volunteer')).status, 200);
  assert.ok((await cms.renderLive('demo', '')).html.includes('href="/volunteer"'));
  const noMenu = (await call('POST', 'chapter/demo/pages', { title: 'Hidden', addToMenu: false })).body;
  assert.ok(!(await call('GET', 'chapter/demo/site')).body.site.nav.some((n) => n.path === '/' + noMenu.slug));
});
test('pages screen actions: duplicate, rename, unpublish, delete and restore, set homepage', async () => {
  const { cms, call } = setup();
  const dup = (await call('POST', 'chapter/demo/page/about/duplicate', {})).body.slug;
  assert.strictEqual((await call('GET', `chapter/demo/page/${dup}`)).body.page.title, 'About (copy)');
  assert.strictEqual((await call('POST', `chapter/demo/page/${dup}/rename`, { title: 'Team', slug: 'team' })).body.slug, 'team');
  assert.strictEqual((await call('POST', 'chapter/demo/page/about/rename', { slug: 'about-us' })).status, 400, 'published pages keep their address');
  assert.strictEqual((await call('POST', 'chapter/demo/page/home/delete', {})).status, 400, 'homepage is protected');
  await call('POST', 'chapter/demo/page/news/unpublish', {});
  assert.match((await cms.renderLive('demo', 'news')).html, /<title>News and posts ·/, 'the address falls back to the automatic list of posts');
  assert.ok(!(await cms.renderLive('demo', '')).html.includes('href="/news"'), 'removed from the live menu at once');
  const t = (await call('POST', 'chapter/demo/page/news/delete', {})).body.trashed;
  assert.strictEqual((await call('GET', 'chapter/demo')).body.trash[0].slug, 'news');
  assert.strictEqual((await call('POST', `chapter/demo/trash/${t}/restore`, {})).body.slug, 'news');
  assert.strictEqual((await call('GET', 'chapter/demo/page/news')).body.draft, true);
  await call('POST', 'chapter/demo/page/events/home', {});
  const s = (await call('GET', 'chapter/demo/site')).body.site;
  assert.strictEqual(s.home, 'events');
  assert.ok(s.nav.some((n) => n.label === 'Events' && n.path === '/') && s.nav.some((n) => n.label === 'Home' && n.path === '/home'));
  await call('POST', 'chapter/demo/publish', { items: ['site'] });
  assert.match((await cms.renderLive('demo', '')).html, /Show up/);
  assert.deepStrictEqual(await cms.renderLive('demo', 'events'), { status: 301, location: '/' });
});
test('version history: coalesced edits, names, compare data, restore a page or the whole site', async () => {
  const { call, clock } = setup();
  await edit(call, 'home', (p) => { p.title = 'A'; });
  clock.tick(60e3); await edit(call, 'home', (p) => { p.title = 'B'; });
  let v = (await call('GET', 'chapter/demo/versions/home')).body;
  assert.strictEqual(v.length, 1, 'one edit version per person per session');
  clock.tick(11 * 60e3); await edit(call, 'home', (p) => { p.title = 'C'; });
  await edit(call, 'home', (p) => { p.title = 'D'; }, 'Ana');
  v = (await call('GET', 'chapter/demo/versions/home')).body;
  assert.deepStrictEqual(v.map((x) => `${x.by}:${x.title}`), ['Ana:D', 'Sam:C', 'Sam:B']);
  await call('POST', `chapter/demo/versions/home/${v[2].id}/name`, { name: 'Before the redesign' });
  assert.strictEqual((await call('GET', `chapter/demo/versions/home/${v[2].id}`)).body.doc.title, 'B');
  await call('POST', `chapter/demo/versions/home/${v[2].id}/restore`, {});
  assert.strictEqual((await call('GET', 'chapter/demo/page/home')).body.page.title, 'B');
  // whole-site restore goes back to what was live at a publish
  await call('POST', 'chapter/demo/publish', {});
  const first = (await call('GET', 'chapter/demo/timeline')).body[0];
  clock.tick(60e3); await edit(call, 'home', (p) => { p.title = 'Later'; }); await edit(call, 'about', (p) => { p.title = 'Later'; });
  await call('POST', 'chapter/demo/publish', {});
  assert.strictEqual((await call('GET', 'chapter/demo/timeline')).body.length, 2);
  const r = (await call('POST', 'chapter/demo/restore-site', { at: first.at })).body;
  assert.deepStrictEqual(r.restored, ['home']); assert.ok(r.unchanged.includes('about'));
  assert.strictEqual((await call('GET', 'chapter/demo/page/home')).body.page.title, 'B');
});
test('share links show the draft for 7 days and can be revoked', async () => {
  const { cms, call, clock } = setup();
  await edit(call, 'about', (p) => { p.blocks[0].props.cols[0][0].props.heading = 'SECRET-DRAFT'; });
  const { token } = (await call('POST', 'chapter/demo/page/about/share', {})).body;
  const html = await cms.renderShare('demo', token);
  assert.match(html, /SECRET-DRAFT/); assert.match(html, /noindex/); assert.match(html, /Preview of unpublished changes/);
  assert.strictEqual(await cms.renderShare('demo', 'x'.repeat(20)), null);
  clock.tick(8 * 864e5);
  assert.strictEqual(await cms.renderShare('demo', token), null, 'expired');
  const t2 = (await call('POST', 'chapter/demo/page/about/share', {})).body.token;
  await call('POST', `chapter/demo/shares/${t2}/revoke`, {});
  assert.strictEqual(await cms.renderShare('demo', t2), null, 'revoked');
});
test('presence lists other editors and the current rev', async () => {
  const { call, clock } = setup();
  await call('POST', 'chapter/demo/presence', { id: 'a', name: 'Sam', doc: 'home' });
  let r = (await call('POST', 'chapter/demo/presence', { id: 'b', name: 'Ana', doc: 'home' })).body;
  assert.deepStrictEqual(r.others, [{ name: 'Sam', doc: 'home' }]); assert.strictEqual(r.rev, (await call('GET', 'chapter/demo/page/home')).body.rev);
  r = (await call('POST', 'chapter/demo/presence', { id: 'b', name: 'Ana', doc: '@events-summer-picnic' })).body;
  assert.strictEqual(r.rev, (await call('GET', 'chapter/demo/item/events/summer-picnic')).body.rev, 'items have revs too');
  clock.tick(60e3);
  r = (await call('POST', 'chapter/demo/presence', { id: 'b', name: 'Ana', doc: 'home' })).body;
  assert.deepStrictEqual(r.others, [], 'stale editors drop off');
});
test('checks: placeholders, starter text, broken and vague links, alt text, contrast', () => {
  const live = new Set(['home', 'events']);
  const page = { title: 'T', blocks: [
    { type: 'hero', props: { heading: 'Hi', subheading: '', badge_text: '', image: '', intro: '', button_label: 'Join', button_url: '/missing', button2_label: 'More', button2_url: '' } },
    { type: 'text', props: { heading: 'H', body: 'Write something here.' } },
    { type: 'text', props: { heading: 'H', body: 'See [click here](/events) or [this](www.example.com)' } },
    { type: 'image', props: { src: 'https://x/y.jpg', alt: '', caption: '' } },
  ] };
  const msgs = checkPage(page, { live, site: {} }).map((c) => `${c.level}:${c.msg}`).join('\n');
  for (const re of [/error:Main button link: Links to \/missing/, /warn:The button “More” has no link/, /error:Text still has the starter text/, /warn:The link “click here”/, /error:.*isn't a working link. Did you mean https:\/\/www.example.com/, /error:Describe this image/]) assert.match(msgs, re);
  const item = checkItem('events', { title: 'Meetup', start: '2030-01-01T10:00', end: '2030-01-01T09:00', location: '[Venue]', issues: ['gone'] }, { live, site: {}, all: new Set() }).map((c) => `${c.level}:${c.path}:${c.msg}`).join('\n');
  for (const re of [/error:f.location:Location: replace the placeholder “\[Venue\]”/, /error:f.end:The event ends before it starts/, /f.issues:.*deleted/i]) assert.match(item, re);
  const fix = checkPage(page, { live, site: {} }).find((c) => c.fix);
  assert.strictEqual(fix.fix, 'See [click here](/events) or [this](https://www.example.com)', 'one-tap fix rewrites the link in place');
  const site = checkSite({ name: 'X', theme: { palette: 'custom', primary: '#eeeeee', accent: '#C23B4F' }, nav: [{ label: '', path: '/gone' }] }, { live, features: { custom_colors: true } });
  assert.ok(site.some((c) => c.section === 'look' && c.level === 'error'), 'custom colours are contrast-checked');
  assert.ok(checkSite({ name: 'X', theme: { palette: 'custom', primary: '#eeeeee' } }, { live }).some((c) => c.section === 'look' && /custom colours/.test(c.msg)), 'custom colours need national to allow them');
  assert.ok(site.some((c) => /Menu item 1 has no label/.test(c.msg)) && site.some((c) => /\/gone/.test(c.msg)));
});
test('FileStore keeps keys inside the chapter folder', async () => {
  const s = new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cms-')));
  for (const bad of ['../x', 'A', 'a/b', '']) await assert.rejects(() => s.get(bad, 'site'));
  for (const key of ['../x', 'page/../../x', 'page/a b', '']) await assert.rejects(() => s.get('demo', key));
  await s.put('demo', 'page/home', { a: 1 }); await s.put('demo', 'site', { b: 1 });
  assert.deepStrictEqual(await s.list('demo', 'page/'), ['page/home']);
  assert.deepStrictEqual(await s.chapters(), ['demo']);
  await s.del('demo', 'page/home'); assert.strictEqual(await s.get('demo', 'page/home'), null);
});
