'use strict';
// Editor: the page preview is the editor. Text is edited in place inside the preview iframe (see EDIT_ASSETS in lib/render.js);
// this file owns the data, the side panel (prewritten options, columns/list controls, link and date fields), drafts and publishing.
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v); kids.flat().forEach((c) => e.append(c)); return e; };
const api = async (path, method = 'GET', body) => {
  const r = await fetch('/admin/api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
};
let schema, layouts, atoms, chapter, pages = [], slug, page, dirty = false, sel = -1, selAtom = null, foc = null, clean = false, scrollY = 0, openItems = new Set(), timer;
const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
const frame = () => $('#preview').contentWindow;
const say = (m) => { try { frame().postMessage(m, '*'); } catch (e) { /* frame not ready */ } };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const draftCount = () => pages.filter((x) => x.draft).length;
function status() {
  const s = $('#status');
  if (dirty) { s.textContent = 'Unsaved edits'; s.className = 'pill dirty'; }
  else if (draftCount()) { s.textContent = `Draft: ${draftCount()} page${draftCount() === 1 ? '' : 's'} not published`; s.className = 'pill dirty'; }
  else { s.textContent = 'Everything is published'; s.className = 'pill ok'; }
}
const touch = () => { dirty = true; status(); };
const flash = (t) => { $('#status').textContent = t; $('#status').className = 'pill ok'; setTimeout(status, 2500); };

// ---- data paths: "<block>.<key>", "<block>.<list>.<item>.<key>" or "<block>.cols.<col>.<atom>.<key>"
function getTarget(path) {
  const p = path.split('.'); const b = page.blocks[+p[0]]; if (!b) return null;
  if (p[1] === 'cols') { const a = (b.props.cols[+p[2]] || [])[+p[3]]; return a ? { obj: a.props, key: p[4], type: a.type } : null; }
  if (p.length === 2) return { obj: b.props, key: p[1], type: b.type };
  return { obj: (b.props[p[1]] || [])[+p[2]], key: p[3], type: b.type, list: p[1] };
}
function setPath(path, v) { const t = getTarget(path); if (t && t.obj) t.obj[t.key] = v; }
function fieldDef(path) {
  const t = getTarget(path); if (!t) return null; const def = schema[t.type];
  return t.list ? def.fields.find((f) => f.key === t.list)?.fields.find((f) => f.key === t.key) : def.fields.find((f) => f.key === t.key);
}
const atomAt = (blk, ref) => { const [c, k] = ref.split('.').map(Number); return { col: blk.props.cols[c], c, k, atom: blk.props.cols[c]?.[k] }; };

// ---- preview
async function preview() {
  try {
    try { scrollY = frame().scrollY || scrollY; } catch (e) { /* cross-origin */ }
    $('#preview').srcdoc = await api('preview', 'POST', { chapter, page: slug, edit: !clean, ...page });
  } catch (e) { $('#status').textContent = 'Preview error: ' + e.message; }
}
const later = () => { clearTimeout(timer); timer = setTimeout(preview, 450); };
const structural = () => { touch(); drawPanel(); preview(); };

function act(a, b, atomRef) {
  const blk = page.blocks[b]; if (!blk) return;
  if (atomRef) { const { col, k } = atomAt(blk, atomRef); const [c] = atomRef.split('.').map(Number);
    if (a === 'rm') { if (!confirm('Delete this block?')) return; col.splice(k, 1); selAtom = null; }
    else if (move(col, k, a === 'up' ? -1 : 1)) selAtom = `${c}.${k + (a === 'up' ? -1 : 1)}`; }
  else if (a === 'rm') { if (!confirm('Delete this section?')) return; page.blocks.splice(b, 1); sel = -1; foc = null; }
  else if (move(page.blocks, b, a === 'up' ? -1 : 1)) sel = b + (a === 'up' ? -1 : 1);
  structural();
}
addEventListener('message', (e) => {
  if (e.source !== frame()) return; const m = e.data || {};
  if (m.t === 'ready') { say({ t: 'scroll', y: scrollY }); say({ t: 'select', b: sel }); }
  if (m.t === 'select') {
    sel = m.b; foc = m.f || null; selAtom = m.atom || null;
    const blk = page.blocks[m.b];
    if (blk && m.item != null) openItems.add(`${m.b}.${(schema[blk.type].fields.find((f) => f.kind === 'list') || {}).key}.${m.item}`);
    if (blk && m.atom) openItems.add(`${m.b}.atom.${m.atom}`);
    drawPanel();
  }
  if (m.t === 'focus') { sel = m.b; foc = m.f; drawPanel(); }
  if (m.t === 'edit') { setPath(m.f, m.v); touch(); }
  if (m.t === 'act') {
    if (m.a === 'layout') { const blk = page.blocks[m.b]; if (blk) { sel = m.b; setLayout(blk, m.k); } }
    else if (m.a === 'addatom') { const blk = page.blocks[m.b]; if (blk && schema[m.type]) { sel = m.b; const col = blk.props.cols[m.c]; col.push({ id: uid(), type: m.type, props: clone(schema[m.type].defaults) }); selAtom = `${m.c}.${col.length - 1}`; openItems.add(`${m.b}.atom.${selAtom}`); structural(); } }
    else if (m.a === 'addsec') { const at = sel >= 0 ? sel + 1 : page.blocks.length, n = { full: 1, halves: 2, wideL: 2, wideR: 2, three: 3 }[m.k]; if (!n) return; page.blocks.splice(at, 0, { id: uid(), type: 'columns', props: { layout: m.k, cols: Array.from({ length: n }, () => []) } }); sel = at; selAtom = null; structural(); }
    else act(m.a, m.b, m.atom);
  }
});

// ---- generic inputs
function input(f, obj, onchange) {
  let i;
  if (f.kind === 'textarea') i = el('textarea');
  else if (f.kind === 'select') i = el('select', {}, f.options.map((o) => el('option', {}, o)));
  else if (f.kind === 'date') i = el('input', { type: 'datetime-local' });
  else i = el('input', { type: 'text', placeholder: f.kind === 'url' ? 'https://… or /page' : '' });
  i.value = f.kind === 'date' ? (obj[f.key] || '').slice(0, 16) : obj[f.key] ?? '';
  i.addEventListener('input', () => { obj[f.key] = i.value; onchange?.(); });
  return i;
}
const labeled = (f, obj, onchange) => el('div', {}, el('label', {}, f.label), input(f, obj, onchange));
const isDetail = (f) => f.kind === 'url' || f.kind === 'date' || f.kind === 'select' || f.panel;
const detailFields = (fields, obj) => fields.filter((f) => f.kind !== 'list' && isDetail(f)).map((f) => labeled(f, obj, () => { touch(); later(); }));
const layIcon = (k) => { const e = el('span', { class: 'lay' }); const cols = { full: [1], halves: [1, 1], wideL: [2, 1], wideR: [1, 2], three: [1, 1, 1] }[k]; cols.forEach((n) => e.append(el('b', { style: `flex:${n}` }))); return e; };

// ---- side panel
function drawPanel() {
  const p = $('#panel'); p.replaceChildren();
  if (clean) { p.append(el('h2', {}, 'Clean view'), el('p', { class: 'help' }, 'This is how visitors see the page. Switch back to keep editing.')); return; }
  const fd = foc ? fieldDef(foc) : null;
  if (fd?.options?.length) {
    p.append(el('h2', {}, `Prewritten options: ${fd.label.replace(/ \(.*\)/, '')}`), el('p', { class: 'help' }, 'Tap one to use it. You can still edit it on the page.'));
    fd.options.forEach((o) => p.append(el('button', { class: 'opt', onclick: () => { setPath(foc, o); say({ t: 'set', f: foc, v: o }); touch(); } }, o)));
  } else if (foc) p.append(el('h2', {}, 'Editing'), el('p', { class: 'help' }, `${fd ? fd.label : 'Text'}. Type right on the page.`));
  const b = page.blocks[sel];
  if (b) {
    const def = schema[b.type];
    p.append(el('h2', {}, `Section: ${def.label}`), el('div', { class: 'row' },
      el('button', { class: 'small', onclick: () => act('up', sel) }, '↑ Up'),
      el('button', { class: 'small', onclick: () => act('down', sel) }, '↓ Down'),
      el('button', { class: 'small danger', onclick: () => act('rm', sel) }, 'Delete')),
      el('p', { class: 'help' }, def.help));
    if (def.container) columnsPanel(p, b);
    else {
      const det = detailFields(def.fields, b.props);
      if (det.length) p.append(el('h2', {}, 'Links and settings'), ...det);
      def.fields.filter((f) => f.kind === 'list').forEach((lf) => listPanel(p, b, lf, def));
    }
  }
  addSection(p);
}
function columnsPanel(p, b) {
  p.append(el('h2', {}, 'Layout'), el('div', { class: 'chips layrow' }, ...Object.entries(layouts).map(([k, name]) =>
    el('button', { class: 'small' + (b.props.layout === k ? ' on' : ''), title: name, onclick: () => setLayout(b, k) }, layIcon(k), ' ', name))));
  b.props.cols.forEach((col, c) => {
    p.append(el('h2', {}, `Column ${c + 1}`));
    col.forEach((a, k) => {
      const key = `${sel}.atom.${c}.${k}`, open = openItems.has(key), adef = schema[a.type], det = detailFields(adef.fields, a.props);
      const row = el('div', { class: 'item' + (selAtom === `${c}.${k}` ? ' cur' : '') }, el('div', { class: 'row' },
        el('strong', {}, adef.label + (a.props.heading || a.props.title || a.props.label ? `: ${a.props.heading || a.props.title || a.props.label}` : '')),
        el('button', { class: 'small', title: 'Move up', onclick: () => act('up', sel, `${c}.${k}`) }, '↑'),
        el('button', { class: 'small', title: 'Move down', onclick: () => act('down', sel, `${c}.${k}`) }, '↓'),
        det.length ? el('button', { class: 'small', onclick: () => { open ? openItems.delete(key) : openItems.add(key); drawPanel(); } }, open ? 'Hide' : 'Link') : '',
        el('button', { class: 'small danger', title: 'Remove', onclick: () => act('rm', sel, `${c}.${k}`) }, '✕')));
      if (open) row.append(...det);
      p.append(row);
    });
    const s = el('select', { 'aria-label': `Add a block to column ${c + 1}` }, el('option', { value: '' }, '＋ Add a block'), ...atoms.map((t) => el('option', { value: t }, schema[t].label)));
    s.onchange = () => { if (!s.value) return; col.push({ id: uid(), type: s.value, props: clone(schema[s.value].defaults) }); selAtom = `${c}.${col.length - 1}`; openItems.add(`${sel}.atom.${selAtom}`); structural(); };
    p.append(s);
  });
}
function setLayout(b, k) {
  const n = { full: 1, halves: 2, wideL: 2, wideR: 2, three: 3 }[k], cols = b.props.cols.slice(0, n);
  b.props.cols.slice(n).forEach((c) => cols[n - 1].push(...c)); while (cols.length < n) cols.push([]);
  b.props.layout = k; b.props.cols = cols; structural();
}
function listPanel(p, b, lf, def) {
  const arr = (b.props[lf.key] ||= []);
  p.append(el('h2', {}, lf.label));
  arr.forEach((it, j) => {
    const key = `${sel}.${lf.key}.${j}`, open = openItems.has(key), det = detailFields(lf.fields, it);
    const row = el('div', { class: 'item' }, el('div', { class: 'row' },
      el('strong', {}, it[lf.itemLabel] || `New ${lf.label.toLowerCase().replace(/s$/, '')}`),
      el('button', { class: 'small', title: 'Move up', onclick: () => { if (move(arr, j, -1)) structural(); } }, '↑'),
      el('button', { class: 'small', title: 'Move down', onclick: () => { if (move(arr, j, 1)) structural(); } }, '↓'),
      det.length ? el('button', { class: 'small', onclick: () => { open ? openItems.delete(key) : openItems.add(key); drawPanel(); } }, open ? 'Hide' : 'Link / date') : '',
      el('button', { class: 'small danger', title: 'Remove', onclick: () => { if (confirm('Remove this item?')) { arr.splice(j, 1); structural(); } } }, '✕')));
    if (open) row.append(...det);
    p.append(row);
  });
  const blank = () => Object.fromEntries(lf.fields.map((x) => [x.key, x.kind === 'select' ? x.options[0] : '']));
  const add = (item) => { arr.push(clone(item)); openItems.add(`${sel}.${lf.key}.${arr.length - 1}`); structural(); };
  p.append(el('h2', {}, `Add to ${lf.label.toLowerCase()}`), el('div', { class: 'chips' },
    ...(def.presets || []).map((x) => el('button', { class: 'small', onclick: () => add(x.item) }, '+ ' + x.label)),
    el('button', { class: 'small', onclick: () => add(blank()) }, '+ Blank')));
}
function addSection(p) {
  const secs = Object.entries(schema).filter(([, v]) => !v.atom), simple = Object.entries(schema).filter(([, v]) => v.atom);
  const s = el('select', { 'aria-label': 'Section type' }, el('optgroup', { label: 'Sections' }, secs.map(([k, v]) => el('option', { value: k }, v.label))), el('optgroup', { label: 'Single blocks' }, simple.map(([k, v]) => el('option', { value: k }, v.label))));
  p.append(el('h2', {}, sel >= 0 ? 'Add a section below' : 'Add a section'), el('div', { class: 'row' }, s,
    el('button', { class: 'primary', onclick: () => { const at = sel >= 0 ? sel + 1 : page.blocks.length; page.blocks.splice(at, 0, { id: uid(), type: s.value, props: clone(schema[s.value].defaults) }); sel = at; foc = null; selAtom = null; structural(); setTimeout(() => say({ t: 'goto', b: at }), 600); } }, 'Add')));
  if (sel < 0) p.append(el('p', { class: 'help' }, 'Tip: tap any text on the page to edit it. Tap a section to see its options here. Hover a section for quick move and delete buttons.'));
}

// ---- pages, chapters, drafts
function drawTabs() {
  $('#tabs').replaceChildren(...pages.map((x) => el('button', { class: x.slug === slug ? 'on' : '', onclick: () => loadPage(x.slug) }, (x.title || x.slug) + (x.draft ? ' •' : ''))), el('button', { class: 'small', onclick: newPage }, '+ New page'));
}
async function loadPage(s) {
  if (dirty && !confirm('You have unsaved edits. Discard them?')) return;
  const next = await api(`chapter/${chapter}/page/${s}`);
  slug = s; page = next; page.blocks.forEach((b) => (b.id ||= uid())); sel = -1; selAtom = null; foc = null; scrollY = 0; openItems = new Set();
  dirty = false; status(); drawTabs(); drawPanel(); preview();
}
async function refreshPages(keepSlug) {
  const d = await api(`chapter/${chapter}`);
  const order = (d.site?.nav || []).map((n) => n.path.replace(/^\//, '') || 'home'); const rank = (x) => (order.includes(x) ? order.indexOf(x) : 99);
  pages = d.pages.sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug)); drawTabs(); status();
  return keepSlug ? slug : pages[0].slug;
}
async function loadChapter(c) { chapter = c; dirty = false; await loadPage(await refreshPages(false)); }
async function saveDraft(quiet) {
  try { $('#status').textContent = 'Saving…'; await api(`chapter/${chapter}/page/${slug}`, 'PUT', page); dirty = false; await refreshPages(true); if (!quiet) flash('Draft saved'); return true; }
  catch (e) { $('#status').textContent = 'Save failed: ' + e.message; $('#status').className = 'pill dirty'; return false; }
}
async function publish() {
  if (dirty && !(await saveDraft(true))) return;
  if (!draftCount()) { flash('Nothing new to publish'); return; }
  try { const r = await api(`chapter/${chapter}/publish`, 'POST', {}); await refreshPages(true); flash(`Published ${r.published.length} page${r.published.length === 1 ? '' : 's'}`); }
  catch (e) { $('#status').textContent = 'Publish failed: ' + e.message; }
}
function dialog(title, ...kids) { const d = $('#dlg'); d.replaceChildren(el('h3', {}, title), ...kids, el('p', {}, el('button', { onclick: () => d.close() }, 'Close'))); d.showModal(); }
function newPage() {
  const t = el('input', { type: 'text', placeholder: 'e.g. Volunteer', id: 'newTitle' });
  dialog('New page', el('label', {}, 'Page name'), t, el('p', {}, el('button', { class: 'primary', onclick: async () => {
    if (dirty && !(await saveDraft(true))) return;
    try { const r = await api(`chapter/${chapter}/pages`, 'POST', { title: t.value }); $('#dlg').close(); await refreshPages(true); await loadPage(r.slug); }
    catch (e) { alert(e.message); } } }, 'Create page')));
}
function pageSettings() {
  const f = (key, label) => labeled({ key, label, kind: 'text' }, page, () => { touch(); later(); });
  const cur = pages.find((x) => x.slug === slug);
  dialog('Page settings', f('title', 'Page title (tab and menu name)'), f('seo_title', 'Search/social title (optional)'), f('seo_description', 'Search/social description (optional)'), f('seo_image', 'Social share image URL (optional)'),
    cur?.draft && cur.live ? el('p', {}, el('button', { class: 'danger', onclick: async () => { if (confirm('Throw away the unpublished changes to this page?')) { await api(`chapter/${chapter}/page/${slug}/discard`, 'POST', {}); $('#dlg').close(); dirty = false; await refreshPages(true); loadPage(slug); } } }, 'Discard unpublished changes')) : '');
}
const SWATCHES = ['#C23B4F', '#2C3659', '#00ABBF', '#74C0EB', '#F7986E'];
async function siteSettings() {
  const s = await api(`chapter/${chapter}/site`); s.theme ||= {}; s.nav ||= []; s.social ||= {};
  const f = (k, l, o = s) => labeled({ key: k, label: l, kind: 'text' }, o);
  const hex = f('accent', 'Chapter color (#hex): header, sign, footer', s.theme);
  const sw = el('div', { class: 'sw' }, SWATCHES.map((c) => el('button', { style: `background:${c}`, title: c, class: s.theme.accent?.toLowerCase() === c.toLowerCase() ? 'on' : '', onclick: (e) => { s.theme.accent = c; hex.querySelector('input').value = c; sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } })));
  const nav = el('div'); const drawNav = () => { nav.replaceChildren(el('label', {}, 'Menu links'), ...s.nav.map((n, i) => el('div', { class: 'item' }, el('div', { class: 'row' }, el('strong', {}, n.label || 'New link'), el('button', { class: 'small', onclick: () => { move(s.nav, i, -1); drawNav(); } }, '↑'), el('button', { class: 'small', onclick: () => { move(s.nav, i, 1); drawNav(); } }, '↓'), el('button', { class: 'small danger', onclick: () => { s.nav.splice(i, 1); drawNav(); } }, '✕')), f('label', 'Label', n), f('path', 'Link (e.g. /events)', n))), el('button', { class: 'small', onclick: () => { s.nav.push({ label: '', path: '/' }); drawNav(); } }, '+ Add menu link')); }; drawNav();
  dialog('Site settings', f('name', 'Chapter name'), f('tagline', 'Tagline'), f('footer', 'Footer text'), f('contact_email', 'Contact email'), el('label', {}, 'Chapter color'), sw, hex, f('primary', 'Dark color (#hex): borders, buttons', s.theme), f('logo', 'Logo URL', s.theme),
    f('x', 'X / Twitter handle', s.social), f('ig', 'Instagram handle', s.social), f('bsky', 'Bluesky handle', s.social), nav,
    el('p', {}, el('button', { class: 'primary', onclick: async () => { try { await api(`chapter/${chapter}/site`, 'PUT', s); $('#dlg').close(); preview(); flash('Site settings saved'); } catch (e) { alert(e.message); } } }, 'Save site settings')));
}
async function history() {
  const v = await api(`chapter/${chapter}/page/${slug}/history`);
  dialog('Earlier published versions', v.length ? v.map((x) => el('p', {}, el('button', { onclick: async () => { if (confirm(dirty ? 'Restore this version as a draft? Your unsaved edits will be lost.' : 'Restore this version as a draft? Nothing goes live until you publish.')) { await api(`chapter/${chapter}/page/${slug}/restore`, 'POST', { version: x }); $('#dlg').close(); dirty = false; await refreshPages(true); loadPage(slug); } } }, 'Restore'), ' ' + x.replace('.json', '').replace('T', ' '))) : [el('p', {}, 'No earlier versions yet. One is saved each time you publish.')]);
}
(async () => {
  const sc = await api('schema'); schema = sc.blocks; layouts = sc.layouts; atoms = sc.atoms;
  $('#save').onclick = () => saveDraft(); $('#publish').onclick = publish; $('#siteBtn').onclick = siteSettings; $('#histBtn').onclick = history; $('#pageBtn').onclick = pageSettings;
  $('#viewBtn').onclick = () => { clean = !clean; $('#viewBtn').textContent = clean ? 'Back to editing' : 'Clean view'; sel = -1; foc = null; selAtom = null; drawPanel(); preview(); };
  $('#widthSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#widthSeg button').forEach((x) => x.classList.toggle('on', x === b)); $('#preview').classList.toggle('phone', b.dataset.w === 'phone'); };
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  const cs = await api('chapters'); $('#chapter').append(...cs.map((c) => el('option', {}, c)));
  $('#chapter').onchange = (e) => { if (dirty && !confirm('You have unsaved edits. Discard them?')) { e.target.value = chapter; return; } loadChapter(e.target.value).catch((x) => { $('#status').textContent = 'Error: ' + x.message; }); };
  loadChapter(cs[0]);
})().catch((e) => { $('#status').textContent = 'Error: ' + e.message; });
