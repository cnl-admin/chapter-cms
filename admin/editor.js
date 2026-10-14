'use strict';
// Editor core: the current page's data, the preview frame, undo/redo, autosave, conflicts and presence.
// Text is edited in place inside the frame (admin/frame.js); the side panel lives in panel.js.

const frameWin = () => $('#preview').contentWindow;
const say = (m) => { try { frameWin().postMessage(m, '*'); } catch { /* frame not ready */ } };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
const docName = () => (S.panel === 'settings' ? '@site' : S.slug);

// ---------- data paths: "<block>.<key>", "<block>.<list>.<item>.<key>" or "<block>.cols.<col>.<atom>.<key>"
function getTarget(path) {
  const p = String(path).split('.'), b = S.page.blocks[+p[0]];
  if (!b) return null;
  if (p[1] === 'cols') { const a = (b.props.cols[+p[2]] || [])[+p[3]]; return a ? { obj: a.props, key: p[4], type: a.type } : null; }
  if (p.length === 2) return { obj: b.props, key: p[1], type: b.type };
  return { obj: (b.props[p[1]] || [])[+p[2]], key: p[3], type: b.type, list: p[1] };
}
const getPath = (path) => { const t = getTarget(path); return t && t.obj ? t.obj[t.key] ?? '' : ''; };
function setPath(path, v) { const t = getTarget(path); if (t && t.obj) t.obj[t.key] = v; }
function fieldDef(path) {
  const t = getTarget(path); if (!t) return null;
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
  for (let i = 0; i < a.blocks.length; i++) {
    const x = a.blocks[i], y = b.blocks[i];
    if (x.id !== y.id || x.type !== y.type) return null;
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
    const html = S.mode === 'gallery' ? await api(`chapter/${S.chapter}/gallery`)
      : await api('preview', 'POST', { chapter: S.chapter, page: S.slug, edit: S.mode === 'edit', ...S.page, site: S.sitePreview || undefined });
    if (seq === previewSeq) $('#preview').srcdoc = html;
  } catch (e) { toast('Preview problem: ' + e.message); }
  frameBar();
}
const later = () => { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 450); };
function frameBar() {
  const p = S.overview?.pages.find((x) => x.slug === S.slug);
  $('#frameLabel').textContent = S.mode === 'gallery' ? 'Block gallery: every block with sample content' : S.mode === 'view' ? `Preview of “${S.page?.title || ''}” as visitors will see it after publishing` : `Editing “${S.page?.title || ''}”${p && !p.live ? ' · not published yet' : ''}`;
  $('#frameExit').hidden = S.mode === 'edit';
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
  const slug = S.slug;
  try {
    const r = await api(`chapter/${S.chapter}/page/${slug}`, 'PUT', { page: S.page, baseRev: S.rev });
    if (slug === S.slug) { S.rev = r.rev; S.draft = r.draft; S.updated = { by: r.updated_by, at: r.updated_at }; }
    S.failures = 0; S.saveError = '';
    refreshOverview(); refreshChecks();
  } catch (e) {
    if (slug === S.slug) S.dirty = true;
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
  const choice = await ask(`${cur.by || 'Someone'} saved this page ${ago(cur.at)}, while you were editing`, [
    el('p', {}, 'Pick which version to keep. The other one is saved in History, so nothing is lost.'),
  ], [{ label: `Use ${cur.by || 'their'}’s version`, value: 'theirs' }, { label: 'Keep my version', value: 'mine', class: 'primary' }]);
  if (choice === 'mine') { S.rev = cur.rev; S.conflict = false; S.dirty = true; await save(); toast('Saved your version. Theirs is in History.'); }
  else if (choice === 'theirs') {
    try { await api(`chapter/${S.chapter}/versions/${S.slug}/stash`, 'POST', { doc: S.page, name: `${S.me.name || 'My'} edits before loading ${cur.by || 'theirs'}’s` }); } catch { /* best effort */ }
    S.conflict = false; S.dirty = false;
    await loadPage(S.slug, { keepPlace: true });
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
    try { const c = await api(`chapter/${S.chapter}/checks`, 'POST', { page: S.slug }); S.checks = { page: c.page || [], site: c.site || [] }; } catch { return; }
    const errs = [...S.checks.page, ...S.checks.site].filter((x) => x.level === 'error').length, warns = [...S.checks.page, ...S.checks.site].length - errs;
    const b = $('#checksBtn');
    b.textContent = errs ? `${plural(errs, 'problem')}` : warns ? `${plural(warns, 'tip')}` : 'Checks ✓';
    b.className = errs ? 'bad' : warns ? 'warn' : '';
    if (S.panel === 'checks') drawPanel();
  }, 300);
}
async function loadPage(slug, { keepPlace = false } = {}) {
  if (!(await flush()) && !(await confirmBox("Your last changes couldn't be saved. Leave this page anyway?", 'Leave', true))) return;
  const g = await api(`chapter/${S.chapter}/page/${slug}`);
  const same = slug === S.slug;
  S.slug = slug; S.page = g.page; S.rev = g.rev; S.draft = g.draft; S.live = g.live; S.updated = { by: g.updated_by, at: g.updated_at };
  S.page.blocks.forEach((b) => (b.id ||= uid()));
  if (!(same && keepPlace)) { S.sel = -1; S.selAtom = null; S.foc = null; S.scrollY = 0; S.openItems = new Set(); }
  S.undo = []; S.redo = []; S.last = {}; S.dirty = false; S.conflict = false; S.saveError = '';
  if (S.mode === 'gallery') S.mode = 'edit';
  local.set('chapter-cms-last', `${S.chapter}/${slug}`);
  undoButtons(); pagePicker(); status(); drawPanel(); preview(); refreshChecks(); heartbeat();
}
async function loadChapter(ch, slug) {
  S.chapter = ch;
  await refreshOverview();
  const pages = S.overview.pages, home = pages.find((p) => p.home);
  await loadPage(pages.some((p) => p.slug === slug) ? slug : (home || pages[0]).slug);
}
function pagePicker() {
  const p = S.overview?.pages.find((x) => x.slug === S.slug);
  $('#pageName').textContent = p ? p.title : S.page?.title || '';
  $('#pageState').textContent = !p ? '' : !p.live ? 'Not published' : p.draft ? 'Has changes' : 'Live';
  $('#pageState').className = 'tag ' + (!p ? '' : !p.live ? 'warn' : p.draft ? 'warn' : 'ok');
  $('#cms-pages').replaceChildren(...(S.overview?.pages || []).map((x) => el('option', { value: x.home ? '/' : '/' + x.slug }, x.title)));
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
  pill.title = S.others.map((o) => `${o.name}: ${o.doc === '@site' ? 'site settings' : S.overview?.pages.find((p) => p.slug === o.doc)?.title || o.doc}`).join('\n');
  if (doc === S.slug && r.rev != null && r.rev > S.rev && !S.dirty && !S.saving && !S.conflict && S.mode === 'edit') {
    const by = S.overview?.pages.find((p) => p.slug === S.slug)?.updated_by;
    await loadPage(S.slug, { keepPlace: true });
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
  S.page.blocks.splice(i, 0, { id: uid(), type, props: clone(S.schema[type].defaults) });
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
  const col = blk.props.cols[c]; col.push({ id: uid(), type, props: clone(S.schema[type].defaults) });
  S.sel = b; S.selAtom = `${c}.${col.length - 1}`; S.openItems.add(`${b}.atom.${S.selAtom}`); structural();
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
  if (m.t === 'act') {
    if (m.a === 'layout') { const blk = S.page.blocks[m.b]; if (blk) { S.sel = m.b; setLayout(blk, m.k); } }
    else if (m.a === 'addatom') addAtom(m.b, m.c, m.type);
    else if (m.a === 'addsec') addColumns(m.k, S.page.blocks.length);
    else if (m.a === 'insert') chooseBlock(m.at);
    else if (m.a === 'move') moveNode(m.from, m.to);
    else act(m.a, m.b, m.atom);
  }
});
