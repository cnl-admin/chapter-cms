'use strict';
// File-backed storage behind a tiny get/put/list/history interface, so it can later be
// swapped for Cloudflare KV/R2/D1 without touching the renderer or API.
const fs = require('fs');
const path = require('path');

const SLUG = /^[a-z0-9-]{1,40}$/;
const KEEP = 20;

class FileStore {
  constructor(root) { this.root = path.resolve(root); }
  _p(chapter, page) {
    if (!SLUG.test(chapter) || (page !== undefined && page !== '_site' && !SLUG.test(page))) throw Object.assign(new Error('bad slug'), { status: 400 });
    return page === undefined ? path.join(this.root, chapter) : page === '_site' ? path.join(this.root, chapter, 'site.json') : path.join(this.root, chapter, 'pages', page + '.json');
  }
  chapters() { return fs.existsSync(this.root) ? fs.readdirSync(this.root).filter((c) => SLUG.test(c) && fs.existsSync(path.join(this.root, c, 'site.json'))) : []; }
  // Drafts live beside published pages; the public site only reads published ones.
  _d(chapter, page) { this._p(chapter, page); return path.join(this._p(chapter), 'drafts', page + '.json'); }
  getDraft(chapter, page) {
    try { return JSON.parse(fs.readFileSync(this._d(chapter, page), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  putDraft(chapter, page, data) {
    const file = this._d(chapter, page);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  discardDraft(chapter, page) { try { fs.unlinkSync(this._d(chapter, page)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  drafts(chapter) {
    const d = path.join(this._p(chapter), 'drafts');
    return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  }
  // Move every draft live (snapshotting the old published version). Returns the slugs published.
  publish(chapter) {
    const slugs = this.drafts(chapter);
    for (const slug of slugs) { this.put(chapter, slug, this.getDraft(chapter, slug)); this.discardDraft(chapter, slug); }
    return slugs;
  }
  get(chapter, page) {
    try { return JSON.parse(fs.readFileSync(this._p(chapter, page), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  pages(chapter) {
    const d = path.join(this._p(chapter), 'pages');
    return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  }
  allPages(chapter) { return [...new Set([...this.pages(chapter), ...this.drafts(chapter)])]; }
  put(chapter, page, data) {
    const file = this._p(chapter, page);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) this._snapshot(file);
    const tmp = file + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic replace
  }
  _hist(file) { return path.join(path.dirname(file), '.history', path.basename(file, '.json')); }
  _snapshot(file) {
    const h = this._hist(file);
    fs.mkdirSync(h, { recursive: true });
    fs.copyFileSync(file, path.join(h, new Date().toISOString().replace(/[:.]/g, '-') + '.json'));
    fs.readdirSync(h).sort().slice(0, -KEEP).forEach((f) => fs.unlinkSync(path.join(h, f)));
  }
  history(chapter, page) {
    const h = this._hist(this._p(chapter, page));
    return fs.existsSync(h) ? fs.readdirSync(h).sort().reverse() : [];
  }
  restore(chapter, page, version) {
    if (!/^[\w-]+\.json$/.test(version)) throw Object.assign(new Error('bad version'), { status: 400 });
    const f = path.join(this._hist(this._p(chapter, page)), version);
    if (!fs.existsSync(f)) throw Object.assign(new Error('version not found'), { status: 404 });
    return JSON.parse(fs.readFileSync(f, 'utf8')); // caller decides where it goes (the editor stages it as a draft)
  }
}
module.exports = { FileStore, SLUG };
