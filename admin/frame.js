// Runs inside the editor's preview frame. Makes the page editable in place and reports everything to the editor
// (admin/editor.js) with postMessage; the editor owns the data, history and saving.
// Needs /admin/text.js (CMSText) loaded first. window.__CMS (atoms, layouts) is written by lib/render.js.
(function () {
  'use strict';
  const P = window.parent, CMS = window.__CMS || { atoms: [], layouts: {} }, T = window.CMSText;
  const post = (m) => P.postMessage(m, '*');
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const plainOnly = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; } catch (e) { /* unsupported */ } return d.contentEditable === 'plaintext-only'; })();
  const LAY = { full: [1], halves: [1, 1], wideL: [2, 1], wideR: [1, 2], three: [1, 1, 1] };
  const icon = (k) => `<span class="lay">${LAY[k].map((n) => `<i style="flex:${n}"></i>`).join('')}</span>`;
  const isField = (n) => n && n.closest && n.closest('[data-f]');
  const visibleFields = () => $$('[data-f]').filter((f) => f.offsetParent !== null || f.getClientRects().length);

  // ---------- reading a field back out: plain text, or the markdown subset for rich fields
  const escMd = (s) => s.replace(/ /g, ' ').replace(/[\\*_[\]]/g, '\\$&');
  function wrap(inner, m) {
    return inner.split('\n').map((line) => {
      const lead = line.match(/^\s*/)[0], trail = line.match(/\s*$/)[0], core = line.trim();
      return core ? `${lead}${m}${core}${m}${trail}` : line;
    }).join('\n');
  }
  function inl(node) {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += escMd(c.data); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === 'BR') s += '\n';
      else if (t === 'B' || t === 'STRONG') s += wrap(inl(c), '**');
      else if (t === 'I' || t === 'EM') s += wrap(inl(c), '_');
      else if (t === 'A') { const txt = inl(c).replace(/\n/g, ' '), core = txt.trim(), href = (c.getAttribute('href') || '').trim().replace(/\s/g, '%20').replace(/\)/g, '%29'); s += core && href ? `${txt.match(/^\s*/)[0]}[${core}](${href})${txt.match(/\s*$/)[0]}` : txt; }
      else if (/^(P|DIV|LI|H[1-6]|UL|OL)$/.test(t)) s += (s && !s.endsWith('\n') ? '\n' : '') + inl(c) + '\n';
      else s += inl(c);
    }
    return s;
  }
  const lineSafe = (text) => text.split('\n').map((l) => l.replace(/^(\s*)(-\s|#)/, '$1\\$2')).join('\n').replace(/\n+$/, '').replace(/^\n+/, '');
  function blocksOf(root) {
    const out = []; let cur = '';
    const flush = () => { if (cur.trim()) out.push(lineSafe(cur)); cur = ''; };
    for (const n of root.childNodes) {
      if (n.nodeType === 3) { cur += escMd(n.data); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') { cur += '\n'; continue; }
      if (t === 'P' || t === 'DIV') { flush(); if ([...n.children].some((k) => /^(P|DIV|UL|OL|H[1-6])$/.test(k.tagName))) out.push(...blocksOf(n)); else { const x = inl(n); if (x.trim()) out.push(lineSafe(x)); } continue; }
      if (/^H[1-6]$/.test(t)) { flush(); const x = inl(n).replace(/\n/g, ' ').trim(); if (x) out.push('### ' + x); continue; }
      if (t === 'UL' || t === 'OL') { flush(); const items = $$(':scope>li', n).map((li) => inl(li).replace(/\n+/g, ' ').trim()).filter(Boolean).map((x) => '- ' + x); if (items.length) out.push(items.join('\n')); continue; }
      cur += inl(n);
    }
    flush();
    return out;
  }
  const toMd = (el) => blocksOf(el).join('\n\n');
  const valueOf = (el) => (el.dataset.rich ? toMd(el) : el.innerText.replace(/ /g, ' ').replace(/\n$/, ''));
  const textOf = (el) => (el.dataset.rich ? T.plain(toMd(el)) : valueOf(el));

  for (const el of $$('[data-f]')) {
    el.contentEditable = el.dataset.rich || !plainOnly ? 'true' : 'plaintext-only';
    el.spellcheck = true;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', el.dataset.fl || 'Text');
    if (el.dataset.ml) el.setAttribute('aria-multiline', 'true');
  }

  // ---------- selection
  function mark(b, atom) {
    $$('.blk').forEach((x) => x.classList.toggle('sel', +x.dataset.b === b));
    $$('.atom').forEach((x) => x.classList.toggle('sel', !!atom && +x.closest('.blk').dataset.b === b && x.dataset.atom === atom));
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.preventDefault();
    if (e.target.closest('#cms-bar,.tb,.ins,.addsec,.addatom')) return;
    // "Edit this event" on a list, "Edit it everywhere" on a saved section, "Turn into a separate copy"
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); e.stopPropagation(); post({ t: 'open', ref: open.dataset.open }); return; }
    const det = e.target.closest('[data-detach]');
    if (det) { e.preventDefault(); e.stopPropagation(); post({ t: 'act', a: 'detach', b: +det.closest('.blk').dataset.b }); return; }
    const site = e.target.closest('[data-site]');
    if (site) { post({ t: 'site', section: site.dataset.site }); return; }
    const bl = e.target.closest('.blk'), it = e.target.closest('[data-item]'), f = isField(e.target), at = e.target.closest('.atom');
    const b = bl ? +bl.dataset.b : -1;
    mark(b, at ? at.dataset.atom : null);
    post({ t: 'select', b, f: f ? f.dataset.f : null, item: it ? +it.dataset.item : null, atom: at ? at.dataset.atom : null });
  }, true);

  // ---------- the field bar: name, counter and (for rich text) formatting buttons
  const bar = document.createElement('div');
  bar.id = 'cms-bar'; bar.setAttribute('contenteditable', 'false');
  document.body.appendChild(bar);
  let cur = null, savedRange = null;
  const RT = [['b', 'B', 'Bold (Ctrl+B)', '<b>B</b>'], ['i', 'I', 'Italic (Ctrl+I)', '<i>I</i>'], ['link', 'Link', 'Link (Ctrl+K)', 'Link'], ['ul', 'List', 'Bulleted list', '• List'], ['h', 'Sub', 'Subheading', 'Sub']];
  function counter(el) {
    const text = textOf(el), max = +el.dataset.max || 0, ml = +el.dataset.maxlines || 0;
    const lines = text.split('\n').length, overC = max && text.length > max, overL = ml && lines > ml;
    el.classList.toggle('over', !!(overC || overL));
    bar.classList.toggle('over', !!(overC || overL));
    let s = max ? `${text.length}/${max}` : '';
    if (ml) s += `${s ? ' · ' : ''}${lines}/${ml} lines`;
    if (overC) s += ' · too long'; else if (overL) s += ' · too many lines';
    const ct = bar.querySelector('.ct'); if (ct) ct.textContent = s;
  }
  function drawBar(el) {
    const req = /\(required\)$/.test(el.dataset.ph || '');
    bar.innerHTML = `<span class="nm"></span>${req ? '<span class="req">Required</span>' : ''}${el.dataset.rich ? '<span class="sep"></span>' + RT.map(([k, , title, label]) => `<button type="button" data-rt="${k}" title="${title}" aria-label="${title}">${label}</button>`).join('') : ''}<span class="ct"></span>`;
    bar.querySelector('.nm').textContent = el.dataset.fl || 'Text';
    counter(el); placeBar(el);
    bar.style.display = 'flex';
  }
  function placeBar(el) {
    const r = el.getBoundingClientRect(), h = bar.offsetHeight || 32;
    const top = r.top + scrollY - h - 8 < scrollY + 4 ? r.bottom + scrollY + 8 : r.top + scrollY - h - 8;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(8, Math.min(r.left + scrollX, scrollX + innerWidth - bar.offsetWidth - 8)) + 'px';
  }
  function refreshState() {
    if (!cur || !cur.dataset.rich) return;
    for (const [k, cmd] of [['b', 'bold'], ['i', 'italic'], ['ul', 'insertUnorderedList']]) { const btn = bar.querySelector(`[data-rt="${k}"]`); if (btn) btn.classList.toggle('on', document.queryCommandState(cmd)); }
    const h = bar.querySelector('[data-rt="h"]'); if (h) h.classList.toggle('on', /^h\d$/i.test(document.queryCommandValue('formatBlock')));
  }
  // fmt: a formatting command, which the editor keeps as its own undo step
  const emit = (el, fmt) => { post({ t: 'edit', f: el.dataset.f, v: valueOf(el), fmt: !!fmt }); counter(el); };

  document.addEventListener('focusin', (e) => {
    const f = isField(e.target);
    if (!f) return;
    cur = f; drawBar(f);
    const bl = f.closest('.blk'), at = f.closest('.atom'), b = bl ? +bl.dataset.b : -1; // -1: an item's own field
    mark(b, at ? at.dataset.atom : null);
    post({ t: 'focus', f: f.dataset.f, b, atom: at ? at.dataset.atom : null });
  });
  document.addEventListener('focusout', (e) => {
    setTimeout(() => { if (!isField(document.activeElement) && !bar.contains(document.activeElement)) { bar.style.display = 'none'; cur = null; } }, 0);
  });
  document.addEventListener('input', (e) => { const f = isField(e.target); if (f) emit(f); });
  document.addEventListener('selectionchange', refreshState);
  addEventListener('scroll', () => { if (cur) placeBar(cur); }, { passive: true });
  addEventListener('resize', () => { if (cur) placeBar(cur); });

  function linkBox() {
    const sel = getSelection();
    if (!cur || !sel.rangeCount) return;
    savedRange = sel.getRangeAt(0).cloneRange();
    const a = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('a');
    bar.innerHTML = '<span class="nm">Link to</span><input type="text" placeholder="https://… or /events" aria-label="Link address"><button type="button" data-lk="ok">Add</button>' + (a ? '<button type="button" data-lk="rm">Remove link</button>' : '') + '<button type="button" data-lk="x">Cancel</button>';
    const inp = bar.querySelector('input');
    inp.value = a ? a.getAttribute('href') || '' : '';
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(inp.value); } if (e.key === 'Escape') { e.preventDefault(); closeLink(); } });
    inp.focus();
  }
  function restore() { cur.focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); if (savedRange) s.addRange(savedRange); }
  function closeLink() { const el = cur; restore(); drawBar(el); }
  function applyLink(url) {
    url = String(url || '').trim();
    const el = cur; restore();
    if (url && !/^(https?:\/\/|mailto:|\/|#)/i.test(url)) url = /@/.test(url) ? 'mailto:' + url : 'https://' + url;
    if (url) {
      if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${T.esc(url)}">${T.esc(url.replace(/^mailto:|^https?:\/\//, ''))}</a>`);
      else document.execCommand('createLink', false, url);
    }
    drawBar(el); emit(el, true);
  }
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !cur) return;
    const el = cur, k = b.dataset.rt, lk = b.dataset.lk;
    if (lk === 'ok') return applyLink(bar.querySelector('input').value);
    if (lk === 'rm') { restore(); document.execCommand('unlink'); drawBar(el); return emit(el, true); }
    if (lk === 'x') return closeLink();
    if (k === 'b') document.execCommand('bold');
    if (k === 'i') document.execCommand('italic');
    if (k === 'ul') document.execCommand('insertUnorderedList');
    if (k === 'h') document.execCommand('formatBlock', false, /^h\d$/i.test(document.queryCommandValue('formatBlock')) ? '<p>' : '<h3>');
    if (k === 'link') return linkBox();
    emit(el, true); refreshState();
  });

  // ---------- keyboard: Tab between fields, Enter ends one-line fields, undo/redo go to the editor, Ctrl+K links
  function moveFocus(from, dir) {
    const list = visibleFields(), i = list.indexOf(from), next = list[i + dir];
    if (!next) return;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const r = document.createRange(); r.selectNodeContents(next); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      if (e.target.closest && e.target.closest('#cms-bar input')) return;
      e.preventDefault(); post({ t: (k === 'y' || e.shiftKey) ? 'redo' : 'undo' }); return;
    }
    if (mod && k === 's') { e.preventDefault(); post({ t: 'save' }); return; }
    const f = isField(e.target);
    if (!f) return;
    if (mod && k === 'k' && f.dataset.rich) { e.preventDefault(); linkBox(); return; }
    if (e.key === 'Tab') { e.preventDefault(); moveFocus(f, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { f.blur(); return; }
    if (e.key === 'Enter' && !f.dataset.ml) { e.preventDefault(); f.blur(); }
  });
  // Forms (sign-up, contact) never send from the editor.
  document.addEventListener('submit', (e) => e.preventDefault(), true);
  // Paste and drop as plain text: formatting comes only from the toolbar, so pages stay consistent.
  document.addEventListener('paste', (e) => {
    const f = isField(e.target); if (!f) return;
    e.preventDefault();
    let text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!f.dataset.ml) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });

  // ---------- section and block toolbars
  const tbFor = (x, atom) => {
    const t = document.createElement('div');
    t.className = 'tb'; t.setAttribute('contenteditable', 'false');
    const reuse = !atom && x.dataset.type !== 'saved' && !CMS.inSection ? '<button data-a="reuse" title="Save for reuse on other pages" aria-label="Save for reuse on other pages">☆</button>' : '';
    t.innerHTML = `<span class="grip" draggable="true" title="Drag to move" data-grip="1">⠿</span><b></b><button data-a="up" title="Move up" aria-label="Move up">↑</button><button data-a="down" title="Move down" aria-label="Move down">↓</button><button data-a="dup" title="Duplicate" aria-label="Duplicate">⧉</button>${reuse}<button data-a="rm" title="Delete" aria-label="Delete">✕</button>`;
    t.querySelector('b').textContent = x.dataset.label || '';
    x.insertBefore(t, x.firstChild);
  };
  $$('.blk').forEach((x) => tbFor(x)); $$('.atom').forEach((x) => tbFor(x, true));
  $$('.blk').forEach((x) => {
    const c = x.querySelector('.cols[data-layout]'), tb = x.querySelector(':scope>.tb');
    if (!c || !tb) return;
    tb.querySelector('b').insertAdjacentHTML('afterend', `<span class="lays">${Object.keys(LAY).map((k) => `<button data-lay="${k}" title="${CMS.layouts[k] || k}" aria-label="${CMS.layouts[k] || k}" class="${k === c.dataset.layout ? 'on' : ''}">${icon(k)}</button>`).join('')}</span>`);
  });
  document.addEventListener('click', (e) => {
    const bt = e.target.closest('.tb button[data-a]');
    if (bt) { e.stopPropagation(); const at = bt.closest('.atom'), bl = bt.closest('.blk'); post({ t: 'act', a: bt.dataset.a, b: +bl.dataset.b, atom: at ? at.dataset.atom : null }); return; }
    const l = e.target.closest('button[data-lay]');
    if (l) { e.stopPropagation(); post({ t: 'act', a: 'layout', b: +l.closest('.blk').dataset.b, k: l.dataset.lay }); return; }
    const ins = e.target.closest('[data-ins]');
    if (ins) { e.stopPropagation(); post({ t: 'act', a: 'insert', at: +ins.dataset.ins }); return; }
    const a = e.target.closest('button[data-addsec]');
    if (a) { e.stopPropagation(); post({ t: 'act', a: 'addsec', k: a.dataset.addsec }); }
  }, true);
  // add a block to a column
  $$('.scol').forEach((col) => {
    const s = document.createElement('select');
    s.className = 'addatom'; s.setAttribute('contenteditable', 'false'); s.setAttribute('aria-label', 'Add a block to this column');
    s.innerHTML = '<option value="">＋ Add a block</option>' + CMS.atoms.map((a) => `<option value="${a[0]}">${T.esc(a[1])}</option>`).join('');
    s.dataset.c = col.dataset.col; s.dataset.b = col.closest('.blk').dataset.b;
    col.appendChild(s);
  });
  document.addEventListener('change', (e) => { const s = e.target.closest('.addatom'); if (s && s.value) post({ t: 'act', a: 'addatom', b: +s.dataset.b, c: +s.dataset.c, type: s.value }); });
  // "add a section here" between sections, and at the end
  const main = document.querySelector('main');
  if (main) {
    $$('.blk').forEach((x) => x.insertAdjacentHTML('beforebegin', `<div class="ins" contenteditable="false"><button data-ins="${x.dataset.b}">＋ Add a section here</button></div>`));
    const as = document.createElement('div');
    as.className = 'addsec'; as.setAttribute('contenteditable', 'false');
    as.innerHTML = `<div class="chips"><button class="main" data-ins="${$$('.blk').length}">＋ Add a section</button></div><div style="margin-top:12px">Or start a row of columns:</div><div class="chips">${Object.keys(LAY).map((k) => `<button data-addsec="${k}">${icon(k)} ${T.esc(CMS.layouts[k] || k)}</button>`).join('')}</div>`;
    main.appendChild(as);
  }

  // ---------- drag and drop: sections between sections, blocks between columns (also in and out of columns)
  const drop = document.createElement('div'); drop.id = 'cms-drop'; document.body.appendChild(drop);
  let drag = null, target = null;
  // The grip is the drag handle (buttons can't start a drag in every browser); the whole block is the drag image.
  document.addEventListener('dragstart', (e) => {
    const g = e.target.closest && e.target.closest('[data-grip]');
    if (!g) return;
    const host = g.closest('.atom') || g.closest('.blk');
    const bl = host.closest('.blk');
    drag = host.classList.contains('atom') ? { kind: 'atom', b: +bl.dataset.b, c: +host.dataset.atom.split('.')[0], k: +host.dataset.atom.split('.')[1] } : { kind: 'blk', b: +bl.dataset.b, atomType: CMS.atoms.some((a) => a[0] === bl.dataset.type) };
    drag.el = host;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'cms-block');
    try { e.dataTransfer.setDragImage(host, 24, 16); } catch { /* old browsers */ }
    setTimeout(() => host.classList.add('dragging'), 0);
  });
  const line = (r, before) => { drop.style.display = 'block'; drop.style.left = r.left + scrollX + 'px'; drop.style.width = r.width + 'px'; drop.style.top = (before ? r.top : r.bottom) + scrollY - 2 + 'px'; };
  document.addEventListener('dragover', (e) => {
    if (!drag) return;
    target = null;
    const canCol = drag.kind === 'atom' || drag.atomType;
    const atom = e.target.closest('.atom'), col = e.target.closest('.scol'), bl = e.target.closest('.blk');
    if (canCol && atom && atom !== drag.el && !drag.el.contains(atom)) {
      const r = atom.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2, [c, k] = atom.dataset.atom.split('.').map(Number);
      target = { kind: 'col', b: +atom.closest('.blk').dataset.b, c, at: before ? k : k + 1 }; line(r, before);
    } else if (canCol && col && !(drag.kind === 'blk' && drag.el.contains(col))) {
      const r = col.getBoundingClientRect(), n = col.querySelectorAll(':scope>.atom').length;
      target = { kind: 'col', b: +col.closest('.blk').dataset.b, c: +col.dataset.col, at: n }; line(r, false);
    } else if (bl && !(drag.kind === 'blk' && bl === drag.el)) {
      const r = bl.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
      target = { kind: 'blk', at: +bl.dataset.b + (before ? 0 : 1) }; line(r, before);
    } else drop.style.display = 'none';
    if (target) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  document.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    if (target) { const { el, ...from } = drag; post({ t: 'act', a: 'move', from, to: target }); }
    endDrag();
  });
  function endDrag() { if (drag) drag.el.classList.remove('dragging'); drag = null; target = null; drop.style.display = 'none'; }
  document.addEventListener('dragend', endDrag);

  // ---------- messages from the editor
  addEventListener('message', (e) => {
    if (e.source !== P) return;
    const m = e.data || {};
    if (m.t === 'set') {
      const el = document.querySelector(`[data-f="${m.f}"]`);
      if (el) { if (el.dataset.rich) el.innerHTML = T.paras(m.v); else el.innerText = m.v; if (el === cur) counter(el); }
    }
    if (m.t === 'scroll') scrollTo(0, m.y);
    if (m.t === 'select') mark(m.b, m.atom);
    if (m.t === 'focus') { const el = document.querySelector(`[data-f="${m.f}"]`); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center' }); } }
    if (m.t === 'goto') { const bb = document.querySelector(`.blk[data-b="${m.b}"]`); if (bb) bb.scrollIntoView({ behavior: m.instant ? 'auto' : 'smooth', block: 'start' }); }
    if (m.t === 'mode') document.documentElement.classList.toggle('cms-phone', !!m.phone);
    if (m.t === 'flash') {
      const el = (m.f && document.querySelector(`[data-f="${m.f}"]`)) || document.querySelector(`.blk[data-b="${m.b}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.remove('cms-flash'); void el.offsetWidth; el.classList.add('cms-flash'); }
    }
  });
  post({ t: 'ready' });
})();
