'use strict';
// HTML pieces shared by blocks (lib/blocks.js) and detail pages (lib/collections.js). Every value is escaped here or by
// the caller; links go through safeUrl. In edit mode (c.edit) text renders so the editor can turn it back into markdown.
const { esc, safeUrl, paras } = require('./text');

const img = (u, alt = '', cls = '') => (u ? `<img src="${safeUrl(u)}" alt="${esc(alt)}" loading="lazy"${cls ? ` class="${cls}"` : ''}>` : '');
const ROT = ['-1.6deg', '1.2deg', '-0.8deg'];
const body = (c, attrs, text) => (c.edit ? `<div class="rich"${attrs}>${paras(text)}</div>` : paras(text));
const lines = (c, text) => (c.edit ? esc(text) : esc(text).replace(/\n/g, '<br>'));
const btn = (c, label, url, cls, attrs) => {
  if (c.edit) return `<a class="btn ${cls || ''}" href="#"><span${attrs || ''}>${esc(label)}</span></a>`;
  return label && url ? `<a class="btn ${cls || ''}" href="${safeUrl(url)}">${esc(label)}</a>` : '';
};
const conn = (c, key) => String(c.site?.connections?.[key] || '');

const SOCIALS = [
  ['x', 'X / Twitter', (h) => `https://x.com/${h.replace(/^@/, '')}`],
  ['ig', 'Instagram', (h) => `https://instagram.com/${h.replace(/^@/, '')}`],
  ['bsky', 'Bluesky', (h) => `https://bsky.app/profile/${h.replace(/^@/, '')}`],
  ['fb', 'Facebook', (h) => (/^https?:/.test(h) ? h : `https://facebook.com/${h.replace(/^@/, '')}`)],
];
const socialLinks = (site) => {
  const s = (site && site.social) || {};
  const links = SOCIALS.filter(([k]) => s[k]).map(([k, label, url]) => `<a href="${safeUrl(url(String(s[k])))}">${label}</a>`);
  return links.length ? `<p class="socials cap">${links.join('')}</p>` : '';
};

// Video links from the big hosts become privacy-friendly embeds; anything else is a plain link.
function videoSrc(url) {
  const u = String(url || '').trim();
  let m = u.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,15})/i);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = u.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/i);
  if (m) return `https://player.vimeo.com/video/${m[1]}?dnt=1`;
  m = u.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{20,40})/i);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  return '';
}
const video = (url, title) => {
  const src = videoSrc(url);
  if (src) return `<div class="embed"><iframe src="${esc(src)}" title="${esc(title || 'Video')}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  return url ? `<p><a href="${safeUrl(url)}">Watch the video</a></p>` : '';
};
const mapLink = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const map = (address, title) => (address ? `<div class="embed map"><iframe src="${esc(`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`)}" title="${esc(title || 'Map: ' + address)}" loading="lazy" referrerpolicy="no-referrer"></iframe></div><p class="cap maplink"><a href="${esc(mapLink(address))}">Open in maps</a></p>` : '');

// Contact form (C5). Posts to the chapter's /contact handler, which files the message for the chapter or a person
// without their email address ever appearing on the page. "website" is a honeypot that people never see.
const contactForm = (to, { heading = '', button = 'Send', edit = false } = {}) => `<form class="contact" method="post" action="/contact" id="contact">${heading ? `<h2 class="sign">${esc(heading)}</h2>` : ''}<input type="hidden" name="to" value="${esc(to)}">
<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Your email<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
<label>Message<textarea name="message" required maxlength="3000" rows="5"></textarea></label><label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button class="btn" type="submit"${edit ? ' disabled' : ''}>${esc(button)}</button></form>`;

module.exports = { img, ROT, body, lines, btn, conn, SOCIALS, socialLinks, videoSrc, video, map, mapLink, contactForm };
