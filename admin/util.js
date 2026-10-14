'use strict';
// Shared helpers for the editor. The admin scripts are plain scripts sharing one global scope, loaded in order:
// text.js (CMSText), util.js, editor.js, panel.js, screens.js, boot.js.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false && c !== '') e.append(c); });
  return e;
}
// Replace a node's children; accepts nested arrays and skips empty values (like el()).
const fill = (node, ...kids) => { node.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false && c !== '')); return node; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const local = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// Editor state, shared by every admin script.
const S = {
  schema: null, layouts: null, atoms: [], chapters: [],
  chapter: null, overview: null, slug: null,
  page: null, rev: 0, draft: false, live: false, updated: null,
  sel: -1, selAtom: null, foc: null, openItems: new Set(), insertAt: null,
  mode: 'edit', panel: 'page', settingsSection: null, device: 'desktop', phone: false, sheet: false,
  dirty: false, saving: false, saveAgain: false, failures: 0, saveError: '', conflict: false, saveTimer: 0,
  undo: [], redo: [], last: {},
  checks: { page: [], site: [] }, others: [],
  me: { name: local.get('chapter-cms-name') || '', id: Math.random().toString(36).slice(2, 12) },
  scrollY: 0,
};

async function api(path, method = 'GET', body) {
  const headers = { 'x-editor': encodeURIComponent(S.me.name || '') };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch('/admin/api/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = (r.headers.get('content-type') || '');
  const data = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error((data && (data.message || data.error)) || r.statusText), { status: r.status, data });
  return data;
}

// Times as people say them.
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute') + ' ago';
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  if (s < 7 * 86400) return plural(Math.round(s / 86400), 'day') + ' ago';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, msg), action ? el('button', { onclick: () => { t.classList.remove('on'); action.run(); } }, action.label) : '');
  t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), action ? 7000 : 3500);
}

// Dialogs. modal() uses the main dialog; ask()/confirmBox() stack a second one on top so they work over a modal.
function modal(title, kids, { wide, onClose } = {}) {
  const d = $('#dlg');
  d.className = wide ? 'wide' : '';
  const close = () => d.close();
  d.replaceChildren(el('div', { class: 'dlghead' }, el('h2', {}, title), el('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '✕')), el('div', { class: 'dlgbody' }, kids));
  d.onclose = () => { onClose?.(); };
  if (!d.open) d.showModal();
  return { close, body: d.querySelector('.dlgbody') };
}
function ask(title, kids, buttons) {
  return new Promise((resolve) => {
    const d = el('dialog', { class: 'ask' });
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(el('h2', {}, title), el('div', {}, kids), el('div', { class: 'row end' }, buttons.map((b) => el('button', { class: b.class || '', onclick: () => done(typeof b.value === 'function' ? b.value() : b.value) }, b.label))));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(d); d.showModal();
    d.querySelector('input')?.focus();
  });
}
const confirmBox = (msg, ok = 'OK', danger = false) => ask(msg, [], [{ label: 'Cancel', value: false }, { label: ok, value: true, class: danger ? 'danger solid' : 'primary' }]);
function askText(title, label, value = '', ok = 'Save') {
  const i = el('input', { type: 'text', value });
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.closest('dialog').querySelector('button.primary').click(); } });
  return ask(title, [el('label', {}, label, i)], [{ label: 'Cancel', value: null }, { label: ok, value: () => i.value, class: 'primary' }]);
}

// Word-level diff for comparing versions: [['=', text] | ['-', text] | ['+', text]].
function diffWords(a, b) {
  const A = String(a).split(/(\s+)/), B = String(b).split(/(\s+)/);
  if (A.length * B.length > 4e6) return [['-', a], ['+', b]];
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [], push = (op, t) => { if (out.length && out[out.length - 1][0] === op) out[out.length - 1][1] += t; else out.push([op, t]); };
  let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++]); else push('+', B[j++]); }
  while (i < n) push('-', A[i++]); while (j < m) push('+', B[j++]);
  return out;
}
