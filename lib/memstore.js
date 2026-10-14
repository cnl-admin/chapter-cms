'use strict';
// In-memory store with the same interface as FileStore (lib/store.js). The tests use it, and the single-file
// demo uses it with onChange saving everything to localStorage.
//   get(chapter, key) -> value or null      put(chapter, key, value)      del(chapter, key)
//   list(chapter, 'prefix/') -> keys one level below the prefix, sorted      chapters() -> chapters with a site
//   putBlob(chapter, key, bytes)      getBlob(chapter, key) -> Uint8Array or null      delBlob(chapter, key)
// Files are kept as base64 under "~<key>", which list() never returns, so the whole store stays plain JSON.
const { SLUG } = require('./text');

// Keys are slash-separated segments like "page/home" or "ver/@site/<id>".
const SEG = /^@?[A-Za-z0-9_-]{1,64}$/;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
function checkKey(chapter, key) {
  if (!SLUG.test(chapter || '')) throw bad('bad chapter');
  const segs = String(key ?? '').split('/');
  if (!segs.every((s) => SEG.test(s))) throw bad('bad key');
  return segs;
}
const prefixSegs = (chapter, prefix) => {
  if (!String(prefix).endsWith('/')) throw bad('list prefix must end with /');
  return checkKey(chapter, prefix.slice(0, -1));
};
const copy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

class MemoryStore {
  constructor(data = {}, onChange) { this.data = data; this.onChange = onChange; }
  async chapters() { return Object.keys(this.data).filter((c) => SLUG.test(c) && this.data[c].site).sort(); }
  async get(ch, key) { checkKey(ch, key); return copy(this.data[ch]?.[key]); }
  async put(ch, key, val) { checkKey(ch, key); (this.data[ch] ||= {})[key] = copy(val); this.onChange?.(this.data); }
  async del(ch, key) { checkKey(ch, key); if (this.data[ch]) delete this.data[ch][key]; this.onChange?.(this.data); }
  async list(ch, prefix) {
    prefixSegs(ch, prefix);
    return Object.keys(this.data[ch] || {}).filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).sort();
  }
  async putBlob(ch, key, bytes) { checkKey(ch, key); (this.data[ch] ||= {})['~' + key] = toB64(bytes); this.onChange?.(this.data); }
  async getBlob(ch, key) { checkKey(ch, key); const v = this.data[ch]?.['~' + key]; return v == null ? null : fromB64(v); }
  async delBlob(ch, key) { checkKey(ch, key); if (this.data[ch]) delete this.data[ch]['~' + key]; this.onChange?.(this.data); }
  // For the demo, which has no server to serve /media/ files: the stored file as a data: URL.
  dataUrl(ch, key, type) { const v = this.data[ch]?.['~' + key]; return v == null ? null : `data:${type};base64,${v}`; }
}
function toB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(v) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(v, 'base64'));
  const bin = atob(v), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
module.exports = { MemoryStore, checkKey, prefixSegs };
