#!/usr/bin/env node
// Usage: node new-chapter.js <slug> "<Chapter Name>"   -> copies the demo chapter's settings and pages as a start
const fs = require('fs'), path = require('path');
const { SLUG } = require('./lib/text');
const [slug, name] = process.argv.slice(2);
if (!slug || !SLUG.test(slug)) { console.error('Usage: node new-chapter.js <slug (a-z, 0-9, -)> "<Chapter Name>"'); process.exit(1); }
const root = process.env.DATA_DIR || path.join(__dirname, 'data');
const dest = path.join(root, slug);
if (fs.existsSync(dest)) { console.error('Chapter already exists: ' + slug); process.exit(1); }
// published pages and settings only: no drafts, history, trash or share links
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, 'demo', 'page'), path.join(dest, 'page'), { recursive: true });
const site = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'site.json'), 'utf8'));
Object.assign(site, { name: name || slug, tagline: '', contact_email: '', footer_links: [], announcement: { on: false, text: '', link_label: '', url: '', until: '' } });
delete site.rev; delete site.updated_at; delete site.updated_by; delete site.published_at; delete site.published_by;
fs.writeFileSync(path.join(dest, 'site.json'), JSON.stringify(site, null, 2));
console.log(`Created ${slug}. Open /admin and pick it from the chapter menu.`);
