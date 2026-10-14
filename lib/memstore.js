'use strict';
// In-memory store with the same interface as FileStore (lib/store.js). The tests use it, and the single-file
// demo uses it with onChange saving everything to localStorage.
//   get(chapter, key) -> value or null      put(chapter, key, value)      del(chapter, key)
//   list(chapter, 'prefix/') -> keys one level below the prefix, sorted      chapters() -> chapters with a site
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
}
module.exports = { MemoryStore, checkKey, prefixSegs };
