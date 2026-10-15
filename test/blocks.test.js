'use strict';
// The block registry is a contract (see README, "Adding a block"). These tests hold every block to it, so a new
// block that forgets a label, renders unescaped text or breaks in edit mode fails here.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../lib/blocks');
const T = require('../lib/text');

const EVIL = '<x onerror=1>"\'';
// Fill every text-like field with hostile text, keeping list items and column atoms.
function poison(fields, props) {
  const out = { ...props };
  for (const f of fields) {
    if (f.kind === 'list') out[f.key] = (props[f.key] || []).map((it) => poison(f.fields, it));
    else if (f.kind === 'text' || f.kind === 'textarea') out[f.key] = EVIL;
  }
  return out;
}

for (const [type, def] of Object.entries(B.blocks)) {
  test(`block "${type}" follows the registry contract`, () => {
    assert.ok(def.label && def.help, 'needs a label and help text');
    assert.strictEqual(typeof def.render, 'function');
    for (const f of def.fields) {
      assert.ok(f.key && f.label && f.kind, `field ${f.key} needs key, label and kind`);
      if (f.kind === 'select') assert.ok(f.options?.length, `select ${f.key} needs options`);
      if (f.kind === 'list') { assert.ok(f.fields?.length && f.itemLabel, `list ${f.key} needs fields and itemLabel`); for (const s of f.fields) assert.ok(s.key && s.label && s.kind); }
    }
    // defaults and samples survive validation unchanged in shape and render in both modes
    for (const props of [B.defaultsFor(type), B.sampleFor(type)]) {
      const [b] = B.validateBlocks([{ type, props }]);
      for (const edit of [false, true]) assert.ok(typeof B.renderBlock(b, { edit, site: {} }) === 'string');
    }
    for (const p of def.presets || []) assert.ok(p.label && p.item, 'presets need a label and an item');
  });
  test(`block "${type}" escapes every text field`, () => {
    const [b] = B.validateBlocks([{ type, props: poison(def.fields, B.sampleFor(type)) }]);
    for (const edit of [false, true]) {
      const h = B.renderBlock(b, { edit, site: {} });
      assert.ok(!h.includes('<x '), `${type} rendered raw HTML (edit: ${edit})`);
    }
  });
}
test('edit mode marks editable text with its path and guidance', () => {
  const h = B.renderBlock({ type: 'hero', props: B.defaultsFor('hero') }, { edit: true, i: 3 });
  assert.match(h, /data-f="3\.heading" data-fl="Headline" data-ph="Headline \(required\)" data-max="60" data-maxlines="3" data-ml="1"/);
  const t = B.renderBlock({ type: 'text', props: B.defaultsFor('text') }, { edit: true, i: 0 });
  assert.match(t, /class="rich" data-f="0\.body"[^>]*data-rich="1"/);
  assert.strictEqual(B.renderBlock({ type: 'hero', props: B.defaultsFor('hero') }).includes('data-f'), false);
});
test('text is HTML-escaped', () => {
  const h = B.renderBlock({ type: 'text', props: { heading: '<script>x</script>', body: '<img onerror=1>' } });
  assert.ok(!h.includes('<script>') && !h.includes('<img'));
});
test('markdown subset: bold, italic, links, lists, subheadings, escapes', () => {
  const h = T.paras('**b** *i* _j_ [ok](https://a.com) [bad](javascript:alert(1)) [bad2](data:text/html,x)\n\n- one\n- two\n### Sub\n\\*not italic\\* \\- dash');
  assert.match(h, /<strong>b<\/strong>/); assert.match(h, /<em>i<\/em>/); assert.match(h, /<em>j<\/em>/); assert.match(h, /href="https:\/\/a.com"/);
  assert.ok(!/javascript:|data:/.test(h));
  assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul><h3 class="sub">Sub<\/h3>/);
  assert.match(h, /\*not italic\* - dash/);
  assert.strictEqual(T.plain('**Hi** [there](/x)\n- item'), 'Hi there\nitem');
});
test('safeUrl rejects bad schemes and protocol-relative links', () => {
  for (const u of ['javascript:1', ' JaVaScript:1', 'data:x', '//evil.com', 'vbscript:1']) assert.strictEqual(T.safeUrl(u), '#');
  for (const u of ['https://a.com', '/events', 'mailto:a@b.c', '#top']) assert.notStrictEqual(T.safeUrl(u), '#');
});
test('validateBlocks strips unknown keys, de-duplicates ids, rejects unknown types', () => {
  const [b, c] = B.validateBlocks([{ id: 'x', type: 'hero', props: { heading: 'Hi', evil: 'x' } }, { id: 'x', type: 'text', props: {} }]);
  assert.strictEqual(b.props.heading, 'Hi'); assert.ok(!('evil' in b.props));
  assert.notStrictEqual(b.id, c.id);
  assert.throws(() => B.validateBlocks([{ type: 'nope' }]), { status: 400 });
  assert.throws(() => B.validateBlocks('x'));
});
test('columns: atoms only, column count follows the layout', () => {
  const [b] = B.validateBlocks([{ type: 'columns', props: { layout: 'full', cols: [[{ type: 'text', props: { heading: 'a' } }], [{ type: 'button', props: { label: 'b' } }]] } }]);
  assert.strictEqual(b.props.cols.length, 1); assert.strictEqual(b.props.cols[0].length, 2);
  assert.throws(() => B.validateBlocks([{ type: 'columns', props: { layout: 'halves', cols: [[{ type: 'hero', props: {} }], []] } }]));
});
test('past events are hidden by default; times are wall-clock', () => {
  const data = { now: '2026-10-14T12:00', items: { events: [{ id: 'old', title: 'Old', start: '2020-01-01T10:00' }, { id: 'new', title: 'New', start: '2999-01-01T10:00' }] }, features: {} };
  const h = B.renderBlock({ type: 'events_list', v: 2, props: B.defaultsFor('events_list') }, { data });
  assert.ok(!h.includes('Old') && h.includes('New'));
  const t = B.renderBlock({ type: 'events_list', v: 2, props: { ...B.defaultsFor('events_list'), show: 'All' } }, { data: { ...data, items: { events: [{ id: 't', title: 'T', start: '2026-11-05T18:30' }] } } });
  assert.match(t, /6:30 PM/);
});
test('empty sign-up and calendar links fall back to Settings > Connections', () => {
  const site = { connections: { action_network_url: 'https://an.example/join', luma_calendar_url: 'https://lu.ma/demo' } };
  assert.match(B.renderBlock({ type: 'signup', props: { ...B.defaultsFor('signup'), button_url: '' } }, { site }), /href="https:\/\/an.example\/join"/);
  assert.match(B.renderBlock({ type: 'events_list', props: B.defaultsFor('events_list') }, { site }), /href="https:\/\/lu.ma\/demo"/);
});
