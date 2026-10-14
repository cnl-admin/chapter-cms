'use strict';
// Editor core: the current doc's data, the preview frame, undo/redo, autosave, conflicts and presence.
// The doc is a page, or a collection item (an event, a post, a person...) with its fields and its own sections.
// Text is edited in place inside the frame (admin/frame.js); the side panel lives in panel.js.

const frameWin = () => $('#preview').contentWindow;
const say = (m) => { try { frameWin().postMessage(m, '*'); } catch { /* frame not ready */ } };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
// The doc being edited, named the way the API names it: a page slug or @<collection>-<id>.
const curDoc = () => (S.kind === 'item' ? `@${S.col}-${S.id}` : S.slug);
const docName = () => (S.panel === 'settings' ? '@site' : curDoc());
const docPath = () => (S.kind === 'item' ? `item/${S.col}/${S.id}` : `page/${S.slug}`);
const colDef = () => (S.kind === 'item' ? S.collections[S.col] : null);
const docTitle = () => (S.kind === 'item' ? String(S.page?.[colDef().titleKey] || 'Untitled') : S.page?.title || '');
const docWord = () => (S.kind === 'item' ? colDef().one : 'page');
const versioned = (type) => (S.schema[type].version > 1 ? { v: S.schema[type].version } : {});

// ---------- data paths: "<block>.<key>", "<block>.<list>.<item>.<key>", "<block>.cols.<col>.<atom>.<key>", or
// "f.<key>" for one of an item's own fields
function getTarget(path) {
  const p = String(path).split('.');
  if (p[0] === 'f') { const f = colDef()?.fields.find((x) => x.key === p[1]); return f ? { obj: S.page, key: p[1], type: null, field: f } : null; }
  const b = S.page.blocks[+p[0]];
  if (!b) return null;
  if (p[1] === 'cols') { const a = (b.props.cols[+p[2]] || [])[+p[3]]; return a ? { obj: a.props, key: p[4], type: a.type } : null; }
  if (p.length === 2) return { obj: b.props, key: p[1], type: b.type };
  return { obj: (b.props[p[1]] || [])[+p[2]], key: p[3], type: b.type, list: p[1] };
}
const getPath = (path) => { const t = getTarget(path); return t && t.obj ? t.obj[t.key] ?? '' : ''; };
function setPath(path, v) { const t = getTarget(path); if (t && t.obj) t.obj[t.key] = v; }
function fieldDef(path) {
  const t = getTarget(path); if (!t) return null;
  if (t.field) return t.field;
  const def = S.schema[t.type];
  return t.list ? def.fields.find((f) => f.key === t.list)?.fields.find((f) => f.key === t.key) : def.fields.find((f) => f.key === t.key);
}
const atomAt = (blk, ref) => { const [c, k] = String(ref).split('.').map(Number); return { col: blk.props.cols[c], c, k, atom: blk.props.cols[c]?.[k] }; };

// ---------- undo / redo. Typing in one field is grouped into one step; every structural change is its own step.
const snap = () => JSON.stringify({ page: S.page, sel: S.sel });
function record(kind, key) {
  const t = Date.now(), L = S.last;
  if (kind === 'type' && L.kind === 'type' && L.key === key && t - L.at < 1500) { L.at = t; return; }
  S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift();
  S.redo = []; S.last = { kind, key, at: t };
  undoButtons();
}
function undo() { if (!S.undo.length) return; S.redo.push(snap()); applySnap(S.undo.pop()); toast('Undone'); }
function redo() { if (!S.redo.length) return; S.undo.push(snap()); applySnap(S.redo.pop()); toast('Redone'); }
function applySnap(json) {
  const prev = S.page, s = JSON.parse(json);
  S.page = s.page; S.sel = s.sel; S.last = {};
  const paths = textChanges(prev, S.page);
  changed();
  if (paths && S.mode === 'edit') paths.forEach((p) => say({ t: 'set', f: p, v: getPath(p) })); else preview();
  drawPanel(); undoButtons();
}
function undoButtons() {
  for (const id of ['#undoBtn', '#pbUndo']) { const b = $(id); if (b) b.disabled = !S.undo.length; }
  for (const id of ['#redoBtn', '#pbRedo']) { const b = $(id); if (b) b.disabled = !S.redo.length; }
}
// Paths of text that changed in place between two versions of the page, or null if anything else changed
// (then the preview is redrawn instead of patched, which keeps the caret where it is for small undos).
function textChanges(a, b) {
  const out = [], inPlace = (f) => (f.kind === 'text' || f.kind === 'textarea') && !f.panel;
  const props = (type, pa, pb, pre) => {
    for (const f of S.schema[type].fields) {
      if (f.kind === 'list') {
        const la = pa[f.key] || [], lb = pb[f.key] || [];
        if (la.length !== lb.length) return false;
        for (let j = 0; j < la.length; j++) for (const sf of f.fields) if (la[j][sf.key] !== lb[j][sf.key]) { if (!inPlace(sf)) return false; out.push(`${pre}.${f.key}.${j}.${sf.key}`); }
      } else if (pa[f.key] !== pb[f.key]) { if (!inPlace(f)) return false; out.push(`${pre}.${f.key}`); }
    }
    return true;
  };
  if (a.title !== b.title || a.blocks.length !== b.blocks.length) return null;
  for (const f of colDef()?.fields || []) if (JSON.stringify(a[f.key]) !== JSON.stringify(b[f.key])) { if (!inPlace(f)) return null; out.push('f.' + f.key); }
  for (let i = 0; i < a.blocks.length; i++) {
    const x = a.blocks[i], y = b.blocks[i];
    if (x.id !== y.id || x.type !== y.type || JSON.stringify(x.vis) !== JSON.stringify(y.vis)) return null;
    if (x.type === 'columns') {
      if (x.props.layout !== y.props.layout || x.props.cols.length !== y.props.cols.length) return null;
      for (let c = 0; c < x.props.cols.length; c++) {
        const ca = x.props.cols[c], cb = y.props.cols[c];
        if (ca.length !== cb.length) return null;
        for (let k = 0; k < ca.length; k++) if (ca[k].id !== cb[k].id || ca[k].type !== cb[k].type || !props(ca[k].type, ca[k].props, cb[k].props, `${i}.cols.${c}.${k}`)) return null;
      }
    } else if (!props(x.type, x.props, y.props, String(i))) return null;
  }
  return out;
}

// ---------- preview frame
let previewSeq = 0, previewTimer = 0;
async function preview() {
  clearTimeout(previewTimer);
  const seq = ++previewSeq;
  try { S.scrollY = frameWin().scrollY || S.scrollY; } catch { /* not loaded */ }
  try {
    const edit = S.mode === 'edit', site = S.sitePreview || undefined;
    const html = S.mode === 'gallery' ? await api(`chapter/${S.chapter}/gallery`)
      : S.kind === 'item' ? await api('preview', 'POST', { chapter: S.chapter, col: S.col, id: S.id, item: S.page, edit, site })
        : await api('preview', 'POST', { chapter: S.chapter, page: S.slug, edit, ...S.page, site });
    if (seq === previewSeq) $('#preview').srcdoc = html;
  } catch (e) { toast('Preview problem: ' + e.message); }
  frameBar();
}
const later = () => { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 450); };
function frameBar() {
  const t = docTitle(), w = S.kind === 'item' ? ` ${docWord()}` : '';
  $('#frameLabel').textContent = S.mode === 'gallery' ? 'Block gallery: every block with sample content' : S.mode === 'view' ? `Preview of “${t}” as visitors will see it after publishing` : `Editing${w ? ' the' + w : ''} “${t}”${!S.live ? ' · not published yet' : ''}`;
  $('#frameExit').hidden = S.mode === 'edit';
  const back = $('#frameBack');
  back.hidden = !S.back || S.mode !== 'edit';
  if (S.back) back.textContent = `← Back to ${S.back.title}`;
}

// A change to the page: mark unsaved and autosave shortly (E2).
function changed() {
  S.dirty = true; status();
  clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 800);
}
function structural() { changed(); drawPanel(); preview(); }

// ---------- saving
async function save() {
  clearTimeout(S.saveTimer);
  if (S.saving) { S.saveAgain = true; return; }
  if (!S.dirty || S.conflict || !S.page) return;
  S.saving = true; S.dirty = false; status();
  const doc = curDoc(), item = S.kind === 'item', col = S.col;
  try {
    const r = await api(`chapter/${S.chapter}/${docPath()}`, 'PUT', item ? { item: S.page, baseRev: S.rev } : { page: S.page, baseRev: S.rev });
    if (doc === curDoc()) { S.rev = r.rev; S.draft = r.draft; S.updated = { by: r.updated_by, at: r.updated_at }; }
    S.failures = 0; S.saveError = '';
    refreshOverview(); refreshChecks();
    if (item) loadLists([col]).then(() => S.panel === 'page' && !S.foc && drawPanel());
  } catch (e) {
    if (doc === curDoc()) S.dirty = true;
    if (e.status === 409 && e.data?.current) { S.conflict = true; showConflict(e.data.current); }
    else if (e.status === 400) { S.saveError = e.message; toast("Couldn't save: " + e.message); }
    else { S.failures++; S.saveError = e.message; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, Math.min(30e3, 1500 * 2 ** S.failures)); }
  } finally {
    S.saving = false; status();
    if (S.saveAgain) { S.saveAgain = false; save(); }
  }
}
// Wait for any pending save (before switching pages, publishing, and so on). Returns false if it could not save.
async function flush() {
  for (let i = 0; i < 40 && (S.saving || (S.dirty && !S.conflict)); i++) { if (!S.saving) await save(); else await new Promise((r) => setTimeout(r, 100)); if (S.failures) break; }
  return !S.dirty;
}
function status() {
  const s = $('#status'), n = S.overview?.pending || 0;
  let text, cls;
  if (S.conflict) { text = 'Needs your decision'; cls = 'bad'; }
  else if (S.saveError && S.dirty) { text = S.failures ? "Couldn't save, retrying…" : "Couldn't save"; cls = 'bad'; }
  else if (S.saving || S.dirty) { text = 'Saving…'; cls = ''; }
  else if (n) { text = `Saved · ${n} unpublished`; cls = 'warn'; }
  else { text = 'Saved · all live'; cls = 'ok'; }
  s.textContent = text; s.className = 'pill ' + cls;
  s.title = n ? 'Open the publish list' : '';
}
addEventListener('beforeunload', (e) => {
  if (S.dirty || S.saving) e.preventDefault();
});

// Someone else saved first (W9). Keep mine overwrites; use theirs loads their version and files mine in History.
async function showConflict(cur) {
  const choice = await ask(`${cur.by || 'Someone'} saved this ${docWord()} ${ago(cur.at)}, while you were editing`, [
    el('p', {}, 'Pick which version to keep. The other one is saved in History, so nothing is lost.'),
  ], [{ label: `Use ${cur.by || 'their'}’s version`, value: 'theirs' }, { label: 'Keep my version', value: 'mine', class: 'primary' }]);
  if (choice === 'mine') { S.rev = cur.rev; S.conflict = false; S.dirty = true; await save(); toast('Saved your version. Theirs is in History.'); }
  else if (choice === 'theirs') {
    try { await api(`chapter/${S.chapter}/versions/${curDoc()}/stash`, 'POST', { doc: S.page, name: `${S.me.name || 'My'} edits before loading ${cur.by || 'theirs'}’s` }); } catch { /* best effort */ }
    S.conflict = false; S.dirty = false;
    await reloadDoc();
    toast(`Loaded ${cur.by || 'their'}’s version. Yours is in History.`);
  } else { S.conflict = true; status(); }
}

// ---------- page and chapter loading
async function refreshOverview() {
  S.overview = await api(`chapter/${S.chapter}`);
  pagePicker(); status(); frameBar();
  return S.overview;
}
let checksTimer = 0;
function refreshChecks() {
  clearTimeout(checksTimer);
  checksTimer = setTimeout(async () => {
    try { const c = await api(`chapter/${S.chapter}/checks`, 'POST', { doc: curDoc() }); S.checks = { page: c.page || [], site: c.site || [] }; } catch { return; }
    const errs = [...S.checks.page, ...S.checks.site].filter((x) => x.level === 'error').length, warns = [...S.checks.page, ...S.checks.site].length - errs;
    const b = $('#checksBtn');
    b.textContent = errs ? `${plural(errs, 'problem')}` : warns ? `${plural(warns, 'tip')}` : 'Checks ✓';
    b.className = errs ? 'bad' : warns ? 'warn' : '';
    if (S.panel === 'checks') drawPanel();
  }, 300);
}
// Opening a page or an item. from: the doc to offer "Back to" (when an item is opened from a page's section).
async function leaveDoc() { return (await flush()) || confirmBox("Your last changes couldn't be saved. Leave anyway?", 'Leave', true); }
async function loadPage(slug, opts = {}) {
  if (!(await leaveDoc())) return;
  const g = await api(`chapter/${S.chapter}/page/${slug}`);
  setDoc({ kind: 'page', slug, col: null, id: null }, g.page, g, opts);
}
async function loadItem(col, id, opts = {}) {
  if (!(await leaveDoc())) return;
  const g = await api(`chapter/${S.chapter}/item/${col}/${id}`);
  setDoc({ kind: 'item', slug: null, col, id }, g.item, g, opts);
}
const reloadDoc = () => (S.kind === 'item' ? loadItem(S.col, S.id, { keepPlace: true }) : loadPage(S.slug, { keepPlace: true }));
const docRef = () => ({ kind: S.kind, slug: S.slug, col: S.col, id: S.id, title: docTitle() });
function openRef(ref) {
  const [col, id] = String(ref).split('/');
  if (!S.collections[col] || !id) return;
  loadItem(col, id, { from: docRef() }).catch((e) => toast(e.message));
}
function goBack() { const b = S.back; if (!b) return; (b.kind === 'item' ? loadItem(b.col, b.id, { from: null }) : loadPage(b.slug, { from: null })).catch((e) => toast(e.message)); }
function setDoc(ref, data, g, { keepPlace = false, from } = {}) {
  const same = ref.kind === S.kind && ref.slug === S.slug && ref.col === S.col && ref.id === S.id;
  Object.assign(S, ref);
  S.page = data; S.rev = g.rev; S.draft = g.draft; S.live = g.live; S.path = g.path || ''; S.updated = { by: g.updated_by, at: g.updated_at };
  S.page.blocks.forEach((b) => (b.id ||= uid()));
  if (!(same && keepPlace)) { S.sel = -1; S.selAtom = null; S.foc = null; S.scrollY = 0; S.openItems = new Set(); }
  if (from !== undefined) S.back = from && !(from.kind === ref.kind && from.slug === ref.slug && from.col === ref.col && from.id === ref.id) ? from : null;
  else if (!same) S.back = null;
  S.undo = []; S.redo = []; S.last = {}; S.dirty = false; S.conflict = false; S.saveError = '';
  if (S.mode === 'gallery') S.mode = 'edit';
  if (S.panel === 'settings') { S.panel = 'page'; S.sitePreview = null; }
  local.set('chapter-cms-last', `${S.chapter}/${ref.kind === 'item' ? ref.col + '/' + ref.id : ref.slug}`);
  undoButtons(); pagePicker(); status(); drawPanel(); preview(); refreshChecks(); heartbeat();
}
// Titles of every collection's items, for tag and link pickers and the content screen.
async function loadLists(cols = Object.keys(S.collections)) {
  await Promise.all(cols.map(async (c) => { try { S.lists[c] = await api(`chapter/${S.chapter}/items/${c}`); } catch { S.lists[c] = S.lists[c] || []; } }));
}
async function loadChapter(ch, last) {
  S.chapter = ch; S.lists = {}; S.back = null;
  await refreshOverview();
  await loadLists();
  const pages = S.overview.pages, home = pages.find((p) => p.home), [a, b] = String(last || '').split('/');
  if (b && S.collections[a] && (S.lists[a] || []).some((x) => x.id === b)) return loadItem(a, b);
  await loadPage(pages.some((p) => p.slug === a) ? a : (home || pages[0]).slug);
}
function pagePicker() {
  const item = S.kind === 'item', p = item ? (S.lists[S.col] || []).find((x) => x.id === S.id) : S.overview?.pages.find((x) => x.slug === S.slug);
  const live = p ? p.live : S.live, draft = p ? p.draft : S.draft;
  $('#pageName').textContent = (item ? colDef().one[0].toUpperCase() + colDef().one.slice(1) + ': ' : '') + (p ? p.title : docTitle());
  $('#pageState').textContent = !live ? 'Not published' : draft ? 'Has changes' : 'Live';
  $('#pageState').className = 'tag ' + (!live || draft ? 'warn' : 'ok');
  const links = [...(S.overview?.pages || []).map((x) => [x.home ? '/' : '/' + x.slug, x.title]), ...Object.entries(S.lists || {}).flatMap(([c, l]) => (S.collections[c].path ? l.map((x) => [x.path, x.title]) : []))];
  $('#cms-pages').replaceChildren(...links.map(([v, t]) => el('option', { value: v }, t)));
}

// ---------- presence (W9): who else is editing, and pick up their saves when I have nothing unsaved
let beatTimer = 0;
async function heartbeat() {
  clearTimeout(beatTimer); beatTimer = setTimeout(heartbeat, 15e3);
  if (!S.chapter || document.hidden) return;
  const doc = docName();
  let r;
  try { r = await api(`chapter/${S.chapter}/presence`, 'POST', { id: S.me.id, name: S.me.name, doc }); } catch { return; }
  S.others = r.others || [];
  const here = S.others.filter((o) => o.doc === doc), elsewhere = S.others.filter((o) => o.doc !== doc);
  const pill = $('#presence');
  pill.hidden = !S.others.length;
  pill.className = 'pill ' + (here.length ? 'warn' : '');
  // one entry per person; my own name means I have this page open in another tab or device
  const names = [...new Set(here.map((o) => o.name || 'Someone'))].filter((n) => n !== S.me.name), mine = here.some((o) => o.name === S.me.name);
  pill.textContent = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} here too` : mine ? 'Also open in another tab' : elsewhere.length ? `+${new Set(elsewhere.map((o) => o.name)).size} online` : '';
  const nameOf = (d) => { if (d === '@site') return 'site settings'; const m = /^@([a-z]+)-(.+)$/.exec(d); return m ? (S.lists[m[1]] || []).find((x) => x.id === m[2])?.title || d : S.overview?.pages.find((p) => p.slug === d)?.title || d; };
  pill.title = S.others.map((o) => `${o.name}: ${nameOf(o.doc)}`).join('\n');
  if (doc === curDoc() && r.rev != null && r.rev > S.rev && !S.dirty && !S.saving && !S.conflict && S.mode === 'edit') {
    const by = S.updated?.by;
    await reloadDoc();
    toast(`Updated with ${here[0]?.name || by || 'another editor'}’s latest changes`);
  }
}
addEventListener('pagehide', () => {
  try { fetch(`/admin/api/chapter/${S.chapter}/presence`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: S.me.id, leave: true }) }); } catch { /* ignore */ }
});

// ---------- section actions
function act(a, b, atomRef) {
  const blk = S.page.blocks[b]; if (!blk) return;
  if (atomRef != null) {
    const { col, c, k, atom } = atomAt(blk, atomRef); if (!atom) return;
    if (a === 'rm') return confirmBox(`Delete this ${S.schema[atom.type].label.toLowerCase()} block?`, 'Delete', true).then((ok) => { if (ok) { record('struct'); col.splice(k, 1); S.selAtom = null; structural(); toast('Deleted', { label: 'Undo', run: undo }); } });
    record('struct');
    if (a === 'dup') { const copy = clone(atom); copy.id = uid(); col.splice(k + 1, 0, copy); S.selAtom = `${c}.${k + 1}`; }
    else if (move(col, k, a === 'up' ? -1 : 1)) S.selAtom = `${c}.${k + (a === 'up' ? -1 : 1)}`;
    S.sel = b;
  } else {
    if (a === 'rm') return confirmBox(`Delete the ${S.schema[blk.type].label.toLowerCase()} section?`, 'Delete', true).then((ok) => { if (ok) { record('struct'); S.page.blocks.splice(b, 1); S.sel = -1; S.foc = null; structural(); toast('Section deleted', { label: 'Undo', run: undo }); } });
    record('struct');
    if (a === 'dup') { const copy = clone(blk); copy.id = uid(); (copy.props.cols || []).forEach((col) => col.forEach((x) => (x.id = uid()))); S.page.blocks.splice(b + 1, 0, copy); S.sel = b + 1; }
    else if (move(S.page.blocks, b, a === 'up' ? -1 : 1)) S.sel = b + (a === 'up' ? -1 : 1);
  }
  structural();
}
// Drag and drop (E4). from/to: { kind: 'blk', b } / { kind: 'atom', b, c, k } and { kind: 'blk', at } / { kind: 'col', b, c, at }.
function moveNode(from, to) {
  const blocks = S.page.blocks;
  const node = from.kind === 'blk' ? blocks[from.b] : blocks[from.b]?.props.cols[from.c]?.[from.k];
  if (!node || (to.kind === 'col' && !S.atoms.includes(node.type))) return;
  record('struct');
  if (from.kind === 'blk') {
    blocks.splice(from.b, 1);
    if (to.kind === 'blk' && to.at > from.b) to.at--;
    if (to.kind === 'col' && to.b > from.b) to.b--;
  } else {
    blocks[from.b].props.cols[from.c].splice(from.k, 1);
    if (to.kind === 'col' && to.b === from.b && to.c === from.c && to.at > from.k) to.at--;
  }
  if (to.kind === 'blk') { blocks.splice(to.at, 0, node); S.sel = to.at; S.selAtom = null; }
  else { blocks[to.b].props.cols[to.c].splice(to.at, 0, node); S.sel = to.b; S.selAtom = `${to.c}.${to.at}`; }
  structural();
}
const LAYOUT_COLS = { full: 1, halves: 2, wideL: 2, wideR: 2, three: 3 };
function setLayout(b, k) {
  const n = LAYOUT_COLS[k]; if (!n) return;
  record('struct');
  const cols = b.props.cols.slice(0, n);
  b.props.cols.slice(n).forEach((c) => cols[n - 1].push(...c));
  while (cols.length < n) cols.push([]);
  b.props.layout = k; b.props.cols = cols; structural();
}
function addBlock(type, at) {
  record('struct');
  const i = at ?? (S.sel >= 0 ? S.sel + 1 : S.page.blocks.length);
  S.page.blocks.splice(i, 0, { id: uid(), type, ...versioned(type), props: clone(S.schema[type].defaults) });
  S.sel = i; S.selAtom = null; S.foc = null; S.insertAt = null;
  structural();
  setTimeout(() => say({ t: 'goto', b: i }), 500);
}
function addColumns(k, at) {
  const n = LAYOUT_COLS[k]; if (!n) return;
  record('struct');
  const i = at ?? (S.sel >= 0 ? S.sel + 1 : S.page.blocks.length);
  S.page.blocks.splice(i, 0, { id: uid(), type: 'columns', props: { layout: k, cols: Array.from({ length: n }, () => []) } });
  S.sel = i; S.selAtom = null; structural();
  setTimeout(() => say({ t: 'goto', b: i }), 500);
}
function addAtom(b, c, type) {
  const blk = S.page.blocks[b]; if (!blk || !S.schema[type]) return;
  record('struct');
  const col = blk.props.cols[c]; col.push({ id: uid(), type, ...versioned(type), props: clone(S.schema[type].defaults) });
  S.sel = b; S.selAtom = `${c}.${col.length - 1}`; S.openItems.add(`${b}.atom.${S.selAtom}`); structural();
}
// Saved sections (B3): put one on the page, turn one back into a separate copy, or save a section for reuse.
function addSaved(ref, at) {
  record('struct');
  const i = at ?? (S.sel >= 0 ? S.sel + 1 : S.page.blocks.length);
  S.page.blocks.splice(i, 0, { id: uid(), type: 'saved', props: { ref } });
  S.sel = i; S.selAtom = null; S.foc = null; structural();
  setTimeout(() => say({ t: 'goto', b: i }), 500);
}
async function detach(b) {
  const blk = S.page.blocks[b]; if (!blk || blk.type !== 'saved') return;
  let g; try { g = await api(`chapter/${S.chapter}/item/sections/${blk.props.ref}`); } catch (e) { return toast(e.message); }
  const copies = clone(g.item.blocks).map((x) => { x.id = uid(); (x.props.cols || []).forEach((col) => col.forEach((a) => (a.id = uid()))); return x; });
  record('struct');
  S.page.blocks.splice(b, 1, ...copies); S.sel = copies.length ? b : -1; structural();
  toast('Now a separate copy. Edits here stay on this page.', { label: 'Undo', run: undo });
}
async function saveForReuse(b) {
  const blk = S.page.blocks[b]; if (!blk || blk.type === 'saved') return;
  if (S.kind === 'item' && S.col === 'sections') return toast('This is already a saved section.');
  const head = String(blk.props.heading || blk.props.title || '').replace(/\s+/g, ' ').trim();
  const name = await askText('Save this section for reuse', 'Name (only editors see it)', (head || S.schema[blk.type].label).slice(0, 60), 'Save');
  if (!name) return;
  try {
    const r = await api(`chapter/${S.chapter}/items/sections`, 'POST', { title: name, blocks: [blk] });
    record('struct');
    S.page.blocks.splice(b, 1, { id: uid(), type: 'saved', props: { ref: r.id } });
    await loadLists(['sections']); structural();
    toast('Saved. Add it to other pages from “Add a section”, and edit it once to change it everywhere.');
  } catch (e) { toast(e.message); }
}
function selectBlock(b, { scroll = true } = {}) {
  S.sel = b; S.selAtom = null; S.foc = null;
  say({ t: 'select', b }); if (scroll) say({ t: 'goto', b });
  drawPanel();
}

// ---------- messages from the frame
addEventListener('message', (e) => {
  if (e.source !== frameWin()) return;
  const m = e.data || {};
  if (m.t === 'ready') { say({ t: 'scroll', y: S.scrollY }); say({ t: 'select', b: S.sel, atom: S.selAtom }); say({ t: 'mode', phone: S.phone }); if (S.pendingFocus) { say(S.pendingFocus); S.pendingFocus = null; } }
  if (m.t === 'select') {
    S.sel = m.b; S.foc = m.f || null; S.selAtom = m.atom || null;
    const blk = S.page.blocks[m.b];
    if (blk && m.item != null) { const lf = S.schema[blk.type].fields.find((f) => f.kind === 'list'); if (lf) S.openItems.add(`${m.b}.${lf.key}.${m.item}`); }
    if (blk && m.atom) S.openItems.add(`${m.b}.atom.${m.atom}`);
    if (S.panel !== 'page' && m.b >= 0) S.panel = 'page';
    drawPanel();
  }
  if (m.t === 'focus') { const changedField = S.foc !== m.f; S.sel = m.b; S.foc = m.f; S.selAtom = m.atom || S.selAtom; if (S.panel !== 'page') S.panel = 'page'; if (changedField) drawPanel(); }
  if (m.t === 'edit') { record(m.fmt ? 'struct' : 'type', m.f); setPath(m.f, m.v); changed(); fieldCounter(m.f); }
  if (m.t === 'undo') undo();
  if (m.t === 'redo') redo();
  if (m.t === 'save') save();
  if (m.t === 'site') openSettings(m.section);
  if (m.t === 'open') openRef(m.ref);
  if (m.t === 'act') {
    if (m.a === 'layout') { const blk = S.page.blocks[m.b]; if (blk) { S.sel = m.b; setLayout(blk, m.k); } }
    else if (m.a === 'addatom') addAtom(m.b, m.c, m.type);
    else if (m.a === 'addsec') addColumns(m.k, S.page.blocks.length);
    else if (m.a === 'insert') chooseBlock(m.at);
    else if (m.a === 'move') moveNode(m.from, m.to);
    else if (m.a === 'detach') detach(m.b);
    else if (m.a === 'reuse') saveForReuse(m.b);
    else act(m.a, m.b, m.atom);
  }
});
