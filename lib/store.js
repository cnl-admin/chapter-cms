'use strict';
// File-backed key-value store: each key is one JSON file at <root>/<chapter>/<key>.json ("page/home" ->
// data/demo/page/home.json). The CMS core (lib/cms.js) only uses get/put/del/list, so this can be swapped for
// Cloudflare KV or D1 later without touching anything else. Same interface as MemoryStore (lib/memstore.js).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { SLUG } = require('./text');
const { checkKey, prefixSegs } = require('./memstore');

class FileStore {
  constructor(root) { this.root = path.resolve(root); }
  _file(ch, key) { return path.join(this.root, ch, ...checkKey(ch, key)) + '.json'; }
  async chapters() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter((c) => SLUG.test(c) && fs.existsSync(path.join(this.root, c, 'site.json'))).sort();
  }
  async get(ch, key) {
    try { return JSON.parse(await fsp.readFile(this._file(ch, key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async put(ch, key, val) {
    const file = this._file(ch, key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(val, null, 2));
    await fsp.rename(tmp, file); // atomic replace
  }
  async del(ch, key) {
    try { await fsp.unlink(this._file(ch, key)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async list(ch, prefix) {
    const dir = path.join(this.root, ch, ...prefixSegs(ch, prefix));
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return ents.filter((d) => d.isFile() && d.name.endsWith('.json')).map((d) => prefix + d.name.slice(0, -5)).sort();
  }
}
module.exports = { FileStore, SLUG };
