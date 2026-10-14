'use strict';
// Starts the editor and wires the header, the phone action bar, keyboard shortcuts and the More menu.

function deviceWidth(w) {
  S.device = w;
  $$('#deviceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.w === w));
  $('#frameWrap').dataset.device = w;
}
function phoneMode(on) {
  S.phone = on;
  document.body.classList.toggle('phone', on);
  if (!on) sheet(false);
  say({ t: 'mode', phone: on });
}
function moreMenu(anchor) {
  const menu = $('#menu');
  if (!menu.hidden) { menu.hidden = true; return; }
  const item = (label, fn) => el('button', { role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, label);
  fill(menu,
    item('Pages…', pagesScreen), item('Page settings…', pageSettings), item('Site settings', () => openSettings()), item('Share a preview link…', () => shareDialog()),
    item('History…', () => historyDialog()), item('Checks', openChecks), item(S.mode === 'view' ? 'Back to editing' : 'Preview as visitors see it', () => setMode(S.mode === 'view' ? 'edit' : 'view')),
    item('Block gallery', () => setMode('gallery')), item(`Your name: ${S.me.name || 'not set'}`, () => askName(true).then(heartbeat)),
    S.chapters.length > 1 ? el('div', { class: 'menulabel' }, 'Chapter') : '', S.chapters.length > 1 ? S.chapters.map((c) => item((c === S.chapter ? '✓ ' : '') + c, () => switchChapter(c))) : '');
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px'; menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
  menu.hidden = false;
  menu.querySelector('button')?.focus();
}
async function switchChapter(c) {
  if (!(await flush())) return;
  $('#chapter').value = c;
  await loadChapter(c);
}

(async () => {
  const sc = await api('schema');
  S.schema = sc.blocks; S.layouts = sc.layouts; S.atoms = sc.atoms;
  S.chapters = await api('chapters');
  $('#chapter').replaceChildren(...S.chapters.map((c) => el('option', { value: c }, c)));
  $('#chapter').onchange = (e) => switchChapter(e.target.value);
  // header
  $('#pagesBtn').onclick = pagesScreen;
  $('#status').onclick = () => { if (S.overview?.pending) publishDialog(); };
  $('#publishBtn').onclick = publishDialog; $('#pbPublish').onclick = publishDialog;
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo; $('#pbUndo').onclick = undo; $('#pbRedo').onclick = redo;
  $('#checksBtn').onclick = openChecks;
  $('#settingsBtn').onclick = () => openSettings();
  $('#viewBtn').onclick = () => setMode(S.mode === 'view' ? 'edit' : 'view');
  $('#frameExit').onclick = () => setMode('edit');
  $('#moreBtn').onclick = (e) => moreMenu(e.currentTarget);
  $('#deviceSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) deviceWidth(b.dataset.w); };
  // phone action bar: one section at a time
  $('#pbPrev').onclick = () => step(-1); $('#pbNext').onclick = () => step(1);
  $('#pbSection').onclick = () => { S.panel = 'page'; drawPanel(); sheet(!S.sheet); };
  document.addEventListener('click', (e) => { const menu = $('#menu'); if (!menu.hidden && !menu.contains(e.target) && e.target !== $('#moreBtn')) menu.hidden = true; });
  // keyboard: undo/redo outside text boxes (inside them the browser's own undo works), save, close
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (mod && k === 's') { e.preventDefault(); save(); toast('Saved'); }
    else if (mod && !typing && (k === 'z' || k === 'y')) { e.preventDefault(); (k === 'y' || e.shiftKey) ? redo() : undo(); }
    else if (e.key === 'Escape') $('#menu').hidden = true;
  });
  const mq = matchMedia('(max-width: 700px)');
  phoneMode(mq.matches); mq.addEventListener('change', (e) => phoneMode(e.matches));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
  deviceWidth('desktop');
  await askName();
  const [lastCh, lastSlug] = String(local.get('chapter-cms-last') || '').split('/');
  const ch = S.chapters.includes(lastCh) ? lastCh : S.chapters[0];
  $('#chapter').value = ch;
  await loadChapter(ch, lastSlug);
})().catch((e) => { $('#status').textContent = 'Error: ' + e.message; $('#status').className = 'pill bad'; console.error(e); });
