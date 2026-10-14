#!/usr/bin/env node
// Usage: node new-chapter.js <slug> "<Chapter Name>"   -> copies data/demo as a starting point
const fs = require('fs'), path = require('path');
const { SLUG } = require('./lib/store');
const [slug, name] = process.argv.slice(2);
if (!slug || !SLUG.test(slug)) { console.error('Usage: node new-chapter.js <slug (a-z, 0-9, -)> "<Chapter Name>"'); process.exit(1); }
const root = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'));
const dest = path.join(root, slug);
if (fs.existsSync(dest)) { console.error('Chapter already exists: ' + slug); process.exit(1); }
fs.cpSync(path.join(root, 'demo'), dest, { recursive: true, filter: (s) => !s.includes('.history') });
const f = path.join(dest, 'site.json');
const site = JSON.parse(fs.readFileSync(f, 'utf8'));
site.name = name || slug; site.tagline = ''; site.contact_email = '';
fs.writeFileSync(f, JSON.stringify(site, null, 2));
console.log(`Created ${slug}. Open /admin and pick it from the chapter menu.`);
