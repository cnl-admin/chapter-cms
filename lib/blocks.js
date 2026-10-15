'use strict';
// Block registry. This is the developer contract for adding a block (see README, "Adding a block"):
//   label      - name shown to leads
//   help       - one sentence on what the block is for
//   fields     - schema: drives the editor, server-side validation, the pre-publish checks and the gallery
//                (field kinds and options are listed in lib/fields.js)
//   defaults   - starting content when a lead adds the block (must pass validation)
//   presets    - prewritten list items a lead can add with one tap (list blocks only)
//   sample     - optional content for the block gallery and visual tests (defaults + presets otherwise)
//   atom       - small block that can also sit inside a column
//   view       - the block shows a shared collection (lib/collections.js) instead of holding its own items (C1)
//   feature    - the block needs a feature switch that national can turn off per chapter (T7)
//   hidden     - not offered in the block gallery (saved sections are added from their own chooser)
//   version    - schema version (F2). Raise it when the props change shape and add migrations[n]: (props, ctx) => props
//                to upgrade content saved at version n - 1. Stored blocks carry v; blocks without v are version 1.
//                Migrations must pass already-current props through unchanged. ctx.extract(col, item) moves an inline
//                item into a collection and returns its id.
//   render     - (props, ctx) -> HTML. Wrap editable text with ctx.f(key) / ctx.fi(list, j, key) so the
//                editor can edit it in place; those helpers return '' on the public site. ctx.data holds the chapter's
//                collections, ctx.data.now the chapter-local time; ctx.site the site settings.
// Every block can also carry vis (B4): show from / until a time, only on phones or computers, or until an event ends.

const { esc, safeUrl, paras, parseDate, fmtDate, shortDate, SLUG } = require('./text');
const { clean } = require('./fields');
const { img, body, lines, btn, conn, socialLinks, SOCIALS, video, videoSrc, map, contactForm } = require('./parts');
const { collections, itemPath, isPast } = require('./collections');

const LAYOUTS = { full: ['1fr'], halves: ['1fr', '1fr'], wideL: ['2fr', '1fr'], wideR: ['1fr', '2fr'], three: ['1fr', '1fr', '1fr'] };
const LAYOUT_NAMES = { full: 'Full width', halves: 'Two halves', wideL: 'Wide left', wideR: 'Wide right', three: 'Three columns' };
const ATOMS = ['text', 'image', 'card', 'signup', 'button', 'socials', 'quote', 'video', 'divider'];

const BTN_HINT = 'Start with a verb: Join, RSVP, Donate, Read.';
const URL_HINT = 'A page on your site like /events, or a full link starting with https://';
const BUTTON_STYLES = ['Standard', 'Highlight', 'Plain'];
const BUTTON_CLASS = { Standard: '', Highlight: 'ch', Plain: 'paper' };

// ---------- shared collections in blocks (C1) and what they show when empty (R3)
const NO_DATA = { now: '', items: {}, national: { posts: [] }, features: {} };
const D = (c) => c.data || NO_DATA;
const itemsOf = (c, col) => (D(c).items?.[col] || []).slice().sort(collections[col].sort);
const off = (c, col) => D(c).features?.[collections[col].feature] === false;
const offNote = (c, col) => (c.edit ? `<section class="wrap block"><p class="cms-note">${esc(collections[col].label)} are turned off for this chapter by national, so this section is hidden.</p></section>` : '');
const openBtn = (c, col, x) => (c.edit ? `<button class="cms-open" data-open="${col}/${esc(x.id)}">Edit this ${esc(collections[col].one)}</button>` : '');
const tagged = (list, issue) => (issue ? list.filter((x) => (x.issues || []).includes(issue)) : list);
const limit = (list, n) => (parseInt(n, 10) > 0 ? list.slice(0, parseInt(n, 10)) : list);
const EMPTY = ['Show a sign-up box', 'Show national news', 'Show a message', 'Hide this section'];
const emptyFields = (text) => [
  { key: 'if_empty', label: 'When there is nothing to show', kind: 'select', options: EMPTY, hint: 'So the page never shows an empty space.' },
  { key: 'empty_text', label: 'Message when there is nothing to show', kind: 'text', panel: true, max: 160, hint: `Optional. Leave empty for: “${text}”` },
];
const ISSUE_FILTER = (what) => ({ key: 'issue', label: `Only ${what} about`, kind: 'ref', col: 'issues', hint: 'Optional. Pick an issue to show only what is tagged with it.' });
// What a view shows instead of nothing. Returns HTML, or null to hide the section.
function fallback(p, c, text) {
  const mode = EMPTY.includes(p.if_empty) ? p.if_empty : EMPTY[0], msg = p.empty_text || text;
  const note = c.edit ? `<p class="cms-note">Nothing to show here right now, so visitors ${mode === 'Hide this section' ? "don't see this section" : 'see this instead'}.</p>` : '';
  if (mode === 'Hide this section') return c.edit ? note : null;
  if (mode === 'Show a message') return `${note}<p class="emptymsg">${esc(msg)}</p>`;
  if (mode === 'Show national news') {
    const news = (D(c).national?.posts || []).slice().sort(collections.posts.sort).slice(0, 3);
    if (news.length) return `${note}<div class="emptybox news"><p class="cap">News from Citizens for a New Liberalism</p>${news.map((n) => `<p><a href="${safeUrl(n.url || 'https://cnliberalism.org')}">${esc(n.title)}</a> <span class="cap">${esc(shortDate(n.date))}</span></p>`).join('')}</div>`;
  }
  const url = conn(c, 'action_network_url');
  return `${note}<div class="emptybox"><p>${esc(msg)}</p>${url ? `<a class="btn ch" href="${safeUrl(url)}">Join the list</a>` : ''}</div>`;
}
const legacy = (p, key) => Array.isArray(p?.[key]);
const ini = (name) => (String(name || '').match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const head = (c, p) => `<h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>`;
// A drawn street map for heroes without a photo (Master Plan); Riso Zine hides it and prints the initials big.
const HERO_MAP = `<svg class="map" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice"><defs><pattern id="hmblk" width="40" height="40" patternUnits="userSpaceOnUse"><rect x="4" y="4" width="32" height="32" rx="1.5" fill="#ecd99a"/></pattern><pattern id="hmmix" width="40" height="40" patternUnits="userSpaceOnUse"><rect x="4" y="4" width="32" height="32" rx="1.5" fill="#e8b47f"/></pattern></defs><rect width="640" height="480" fill="#fbfbf8"/><rect width="640" height="480" fill="url(#hmblk)"/><rect x="280" width="80" height="480" fill="url(#hmmix)"/><rect x="364" y="84" width="112" height="72" rx="6" fill="#a9c493"/><g style="fill:var(--ch)"><rect x="404" y="244" width="32" height="32" rx="1.5"/><rect x="164" y="124" width="32" height="32" rx="1.5"/><rect x="524" y="324" width="32" height="32" rx="1.5"/></g><g fill="none" stroke="#fbfbf8" stroke-linecap="round"><path d="M302 0C296 120 312 200 302 300S290 440 306 480" stroke-width="10"/><path d="M0 196L640 204" stroke-width="9"/></g><g style="stroke:var(--navy)" stroke-width="5" fill="none"><path d="M330 0V480"/><path d="M0 320H640"/></g><g fill="#fff" style="stroke:var(--navy)" stroke-width="3"><circle cx="330" cy="60" r="6"/><circle cx="330" cy="150" r="6"/><circle cx="330" cy="320" r="8"/><circle cx="330" cy="420" r="6"/><circle cx="120" cy="320" r="6"/><circle cx="530" cy="320" r="6"/></g><path d="M150 140C200 40 440 40 500 130S566 330 470 420S220 470 150 400S100 220 150 140Z" fill="none" stroke="#4d8a3f" stroke-width="6" stroke-dasharray="14 8" stroke-linecap="round"/></svg>`;
// Hand-drawn marks for Riso Zine (other designs hide them).
const SQUIGGLE = '<svg class="squig" viewBox="0 0 200 14" aria-hidden="true"><path d="M3 9C40 4 90 3 120 6S180 11 197 5" fill="none" style="stroke:var(--ch)" stroke-width="4" stroke-linecap="round"/></svg>';
const OVAL = '<svg class="oval" viewBox="0 0 48 30" aria-hidden="true"><ellipse cx="24" cy="15" rx="21" ry="12" fill="none" style="stroke:var(--navy)" stroke-width="2.5"/><path d="M8 16l6-6M8 22l14-14M12 24l18-18M18 25l18-18M24 25l16-16M32 24l9-9" fill="none" style="stroke:var(--ch)" stroke-width="3" stroke-linecap="round"/></svg>';
const CIRCLE = '<svg viewBox="0 0 80 56" preserveAspectRatio="none" aria-hidden="true"><path d="M14 30C10 14 50 6 66 16S68 46 40 48 6 42 12 26" fill="none" style="stroke:var(--ch)" stroke-width="4" stroke-linecap="round"/></svg>';
// A month calendar with the event days circled (Riso Zine shows it beside the event list).
function monthCal(list) {
  const first = list.map((e) => parseDate(e.start)).find((d) => !isNaN(d));
  if (!first) return '';
  const y = first.getUTCFullYear(), m = first.getUTCMonth(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const hit = new Set(list.map((e) => parseDate(e.start)).filter((d) => !isNaN(d) && d.getUTCFullYear() === y && d.getUTCMonth() === m).map((d) => d.getUTCDate()));
  const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span class="dow">${d}</span>`).concat(Array(lead).fill('<span></span>'), Array.from({ length: days }, (_, i) => `<span>${i + 1}${hit.has(i + 1) ? CIRCLE : ''}</span>`));
  return `<div class="calbox" aria-hidden="true"><p class="sign calmonth">${first.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}</p><div class="cal">${cells.join('')}</div></div>`;
}
const dayParts = (iso) => {
  const d = parseDate(iso);
  if (isNaN(d)) return { day: '', date: '', time: '' };
  return { day: d.getUTCDate(), date: d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }), time: d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) };
};
const POST_LABEL = { Post: 'Chapter blog', Press: 'In the news' };

const blocks = {
  hero: {
    label: 'Hero',
    help: 'The big headline at the top of a page, with a photo or map beside it. Use one per page.',
    fields: [
      { key: 'heading', label: 'Headline', kind: 'textarea', max: 60, maxLines: 3, required: true, hint: 'Short and punchy, one idea per line. Three lines at most.', options: ['More homes.\nMore trains.\nMore neighbors.', 'Build more.\nWelcome more.\nGrow together.', 'Homes for everyone.\nTrains that come often.\nA city that works.', 'Growth, freedom,\nand a government\nthat works.'] },
      { key: 'subheading', label: 'Small line above the headline', kind: 'text', max: 60, options: ['A chapter of Citizens for a New Liberalism', 'Local chapter, national movement'] },
      { key: 'badge_text', label: 'Initials', kind: 'text', max: 3, hint: 'Two or three letters, like your city initials. Shown on the map or poster when there is no photo.' },
      { key: 'image', label: 'Photo', kind: 'image', hint: 'Optional. A photo of your city or members. Without one, the design draws a map or a poster with your initials.' },
      { key: 'intro', label: 'Intro paragraph', kind: 'textarea', max: 300, hint: 'One or two sentences on who you are and what you do.', options: [
        'We are the local chapter of Citizens for a New Liberalism. We knock doors, pack zoning hearings, endorse candidates, and throw a good happy hour.',
        'We believe in abundance, openness, and government that works. Come meet your neighbors who want the same things.',
        'New to politics? Good. We run on volunteers, curiosity, and a shared belief that our city can grow and stay affordable.'] },
      { key: 'button_label', label: 'Main button text', kind: 'text', max: 24, hint: BTN_HINT, options: ['Join the chapter', 'Come to a meetup', 'Get involved', 'Sign up'] },
      { key: 'button_url', label: 'Main button link', kind: 'url', hint: URL_HINT },
      { key: 'button2_label', label: 'Second button text', kind: 'text', max: 24, hint: 'Optional. Leave empty for one button.', options: ['Find an event', 'See our endorsements', 'Read our issues'] },
      { key: 'button2_url', label: 'Second button link', kind: 'url', hint: URL_HINT },
    ],
    defaults: { heading: 'More homes.\nMore trains.\nMore neighbors.', subheading: 'Your Chapter Name', badge_text: 'NL', image: '', intro: 'We are the local chapter of Citizens for a New Liberalism. We knock doors, pack zoning hearings, endorse candidates, and throw a good happy hour.', button_label: 'Join the chapter', button_url: '/about', button2_label: 'Find an event', button2_url: '/events' },
    render: (p, c) => `<section class="hero"><div class="wrap"><div class="herobox"><div class="herotext"><p class="cap kicker"${c.f('subheading')}>${esc(p.subheading)}</p><h1 class="sign"${c.f('heading')}>${lines(c, p.heading)}</h1><p class="lede"${c.f('intro')}>${esc(p.intro)}</p><div class="btns">${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}${p.button2_label || c.edit ? btn(c, p.button2_label, p.button2_url, 'line', c.f('button2_label')) : ''}</div></div>
<figure class="heroart"><span class="tape" aria-hidden="true"></span><span class="tape t2" aria-hidden="true"></span>${p.image ? `<div class="duo">${img(p.image, '')}</div>` : `<div class="heroph" aria-hidden="true">${HERO_MAP}<span class="sign"${c.f('badge_text')}>${esc(p.badge_text)}</span></div>`}</figure></div></div></section>`,
  },
  text: {
    label: 'Text',
    atom: true,
    help: 'A heading and a few paragraphs. Select words to make them bold, italic, a link or a list.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['About us', 'Who we are', 'What we do', 'Why we exist'] },
      { key: 'body', label: 'Text', kind: 'textarea', rich: true, max: 3000, options: [
        'We are a group of neighbors who believe in **abundance, openness, and good governance**.\n\nWe meet monthly. Learn more at [cnliberalism.org](https://cnliberalism.org).',
        'We are the local chapter of Citizens for a New Liberalism. We knock doors, pack public hearings, endorse candidates, and throw a good happy hour, all for a growing, affordable, open city.',
        'No experience needed. If you care about housing, transit, trade, and a government that works, you belong here.'] },
    ],
    defaults: { heading: 'About us', body: 'Write something here.' },
    sample: { heading: 'Who we are', body: 'We are neighbors who believe in **abundance, openness and good governance**.\n\n### What we do\n- Pack zoning hearings\n- Knock doors for good candidates\n- Throw a _very_ good happy hour\n\nLearn more at [cnliberalism.org](https://cnliberalism.org).' },
    render: (p, c) => `<div class="atomtext"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('body'), p.body)}</div>`,
  },
  image: {
    label: 'Image',
    atom: true,
    help: 'A photo with an optional caption. Upload one, take one with your phone, or pick one from the library.',
    fields: [
      { key: 'src', label: 'Image', kind: 'image', required: true, hint: 'Upload a photo or pick one from the media library.' },
      { key: 'alt', label: 'Describe the image', kind: 'text', panel: true, max: 150, hint: 'For people using screen readers, e.g. "Members holding signs at City Hall".' },
      { key: 'caption', label: 'Caption', kind: 'text', max: 120, options: ['Chapter meetup', 'Canvassing day', 'Our first anniversary'] },
    ],
    defaults: { src: '', alt: '', caption: 'Chapter meetup' },
    // With no image yet, visitors see nothing rather than an empty box (R3).
    render: (p, c) => (p.src || c.ph ? `<figure class="imgfig">${p.src ? img(p.src, p.alt || p.caption) : '<div class="imgph" aria-hidden="true"></div>'}<figcaption class="cap"${c.f('caption')}>${esc(p.caption)}</figcaption></figure>` : ''),
  },
  card: {
    label: 'Card',
    atom: true,
    help: 'A short boxed note: a candidate, a fact, a project.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', max: 60, required: true },
      { key: 'text', label: 'Text', kind: 'textarea', rich: true, max: 400 },
    ],
    defaults: { title: 'Card title', text: 'Write something short here.' },
    sample: { title: '1,200 doors', text: 'Knocked by members during the **spring canvass**.' },
    render: (p, c) => `<div class="card"><div class="pad"><h3${c.f('title')}>${esc(p.title)}</h3>${body(c, c.f('text'), p.text)}</div></div>`,
  },
  signup: {
    label: 'Email sign-up',
    atom: true,
    help: 'A box that sends people to your sign-up form (Action Network, Mailchimp, a Google Form).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Stay in the loop', 'Get our emails', 'Join the list'] },
      { key: 'blurb', label: 'Blurb', kind: 'textarea', rich: true, max: 200, options: ['One email a week, at most. Usually fewer.', 'Invites, updates, and a say in what we fight for next.'] },
      { key: 'button_label', label: 'Button text', kind: 'text', max: 24, hint: BTN_HINT, options: ['Sign up', 'Join the list', 'Count me in'] },
      { key: 'button_url', label: 'Sign-up form link', kind: 'url', required: true, fallback: 'action_network_url', hint: 'Your Action Network, Mailchimp or Google Form link. Leave empty to use the sign-up link from Settings.' },
    ],
    defaults: { heading: 'Stay in the loop', blurb: 'One email a week, at most. Usually fewer.', button_label: 'Sign up', button_url: '' },
    sample: { heading: 'Stay in the loop', blurb: 'One email a week, at most. Usually fewer.', button_label: 'Sign up', button_url: 'https://actionnetwork.org/' },
    render: (p, c) => `<div class="signupbox"><h3 class="sign"${c.f('heading')}>${esc(p.heading)}</h3>${body(c, c.f('blurb'), p.blurb)}${btn(c, p.button_label, p.button_url || conn(c, 'action_network_url'), '', c.f('button_label'))}</div>`,
  },
  button: {
    label: 'Button',
    atom: true,
    help: 'A single call-to-action button.',
    fields: [
      { key: 'label', label: 'Button text', kind: 'text', max: 24, required: true, hint: BTN_HINT, options: ['Volunteer with us', 'Join the chapter', 'Download the voter guide', 'Learn more'] },
      { key: 'url', label: 'Link', kind: 'url', required: true, hint: URL_HINT },
      { key: 'style', label: 'Style', kind: 'select', options: BUTTON_STYLES, hint: 'Highlight uses your chapter colour. The theme decides the actual colours.' },
    ],
    defaults: { label: 'Learn more', url: '/', style: 'Standard' },
    version: 2,
    // v1 stored colour names; v2 stores what the button is for (T1), so a new theme can restyle it.
    migrations: { 2: (p) => ({ ...p, style: { Navy: 'Standard', 'Chapter color': 'Highlight', Paper: 'Plain' }[p.style] || p.style }) },
    render: (p, c) => btn(c, p.label, p.url, BUTTON_CLASS[p.style] || '', c.f('label')),
  },
  socials: {
    label: 'Social links',
    atom: true,
    help: 'Links to the chapter social accounts. Handles come from Settings.',
    fields: [],
    defaults: {},
    render: (p, c) => socialLinks(c.site) || (c.edit ? '<p class="muted">Add social handles in Settings.</p>' : ''),
  },
  columns: {
    label: 'Columns',
    container: true,
    help: 'Put text, images, cards and buttons side by side. Pick a layout, then add blocks to each column.',
    fields: [{ key: 'layout', label: 'Layout', kind: 'select', options: Object.keys(LAYOUTS) }],
    defaults: { layout: 'halves', cols: [[{ id: 'a1', type: 'text', props: { heading: 'Who we are', body: 'Write something here.' } }], [{ id: 'a2', type: 'image', props: { src: '', alt: '', caption: 'Chapter meetup' } }]] },
    sample: { layout: 'halves', cols: [[{ id: 'a1', type: 'text', props: { heading: 'Who we are', body: 'Neighbors who want a city that **grows**.' } }], [{ id: 'a2', type: 'card', props: { title: 'Next meetup', text: 'First Thursday of every month.' } }, { id: 'a3', type: 'button', v: 2, props: { label: 'RSVP', url: '/events', style: 'Standard' } }]] },
    render: (p, c) => `<section class="wrap block"><div class="cols" data-layout="${esc(p.layout)}" style="grid-template-columns:${(LAYOUTS[p.layout] || LAYOUTS.halves).join(' ')}">${(p.cols || []).map((col, ci) => `<div class="scol" data-col="${ci}">${col.map((a, k) => c.atom(a, ci, k)).join('') || (c.edit ? '<p class="muted emptycol">Empty column</p>' : '')}</div>`).join('')}</div></section>`,
  },
  cta: {
    label: 'Join us band',
    help: 'Full-width band with a button (sign up, donate, join).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Join us.', 'Get involved.', 'Pitch in.'] },
      { key: 'body', label: 'Text', kind: 'textarea', rich: true, max: 300, options: ['It is free. You will get invites, a newsletter, and a say in what we fight for next.', 'Our chapter runs on volunteers. **Pitch in** wherever you can.'] },
      { key: 'button_label', label: 'Button text', kind: 'text', max: 24, hint: BTN_HINT, options: ['Sign me up', 'Join the chapter', 'Contact us'] },
      { key: 'button_url', label: 'Button link', kind: 'url', hint: URL_HINT },
    ],
    defaults: { heading: 'Join us.', body: 'It is free. You will get invites, a newsletter, and a say in what we fight for next.', button_label: 'Sign me up', button_url: '/about' },
    render: (p, c) => `<section class="block join"><div class="wrap"><div class="joinbox"><div class="jtext">${head(c, p)}${body(c, c.f('body'), p.body)}</div><div class="jact">${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}</div></div></div></section>`,
  },
  events_list: {
    label: 'Events',
    view: 'events', feature: 'events', version: 2,
    help: 'Your chapter’s events with dates and RSVP links. Add events once under Content, Events; past ones move to the archive on their own.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Show up.', 'Upcoming events', 'Next up', 'Come hang out'] },
      { key: 'show', label: 'Which events', kind: 'select', options: ['Upcoming', 'Past', 'All'] },
      ISSUE_FILTER('events'),
      { key: 'limit', label: 'Most events to show', kind: 'text', panel: true, max: 3, hint: 'A number, or leave empty to show all.' },
      { key: 'luma_calendar_url', label: 'Luma calendar link', kind: 'url', fallback: 'luma_calendar_url', hint: 'Optional. Adds a "Full calendar" link. Leave empty to use the calendar from Settings.' },
      ...emptyFields('No events on the calendar right now. Join the list and we will tell you about the next one.'),
    ],
    defaults: { heading: 'Show up.', show: 'Upcoming', issue: '', limit: '', luma_calendar_url: '', if_empty: EMPTY[0], empty_text: '' },
    migrations: {
      2: (p, ctx) => {
        if (!legacy(p, 'events')) return p;
        p.events.forEach((e) => ctx.extract('events', { ...e, luma_id: e.id || '' }));
        return { heading: p.heading, show: p.show_past === 'Yes' ? 'All' : 'Upcoming', issue: '', limit: p.limit || '', luma_calendar_url: p.luma_calendar_url || '', if_empty: EMPTY[0], empty_text: '' };
      },
    },
    render: (p, c) => {
      if (off(c, 'events')) return offNote(c, 'events');
      const now = D(c).now, all = itemsOf(c, 'events');
      let list = tagged(all, p.issue).filter((e) => p.show === 'All' || (p.show === 'Past') === isPast('events', e, now));
      if (p.show === 'Past') list.reverse();
      list = limit(list, p.limit);
      const cal = p.luma_calendar_url || conn(c, 'luma_calendar_url');
      const items = list.map((e, i) => { const d = dayParts(e.start), live = e.url && !isPast('events', e, now); return `<article class="ev"><span class="evpin" aria-hidden="true"><span>${String.fromCharCode(65 + (i % 26))}</span></span><p class="sign evday" aria-hidden="true">${d.day}</p><div class="evwhen"><p class="sign">${esc(d.date)}</p><p>${esc(d.time)}</p></div><div class="evbody">${img(e.cover_image, e.title)}<h3><a href="${itemPath('events', e.id)}">${esc(e.title)}</a></h3><p class="where"><span class="evwhen2">${esc(fmtDate(e.start))}. </span>${esc(e.location)}</p>${paras(e.description)}${openBtn(c, 'events', e)}</div>${live ? `<a class="btn line rsvp" href="${safeUrl(e.url)}" aria-label="RSVP for ${esc(e.title)}">RSVP</a>` : ''}</article>`; }).join('');
      const inner = list.length ? `<div class="evwrap">${p.show === 'Past' ? '' : monthCal(list)}<div class="evlist">${items}</div></div>` : fallback(p, c, 'No events on the calendar right now. Join the list and we will tell you about the next one.');
      if (inner == null) return '';
      const archive = p.show === 'Upcoming' && all.some((e) => isPast('events', e, now)) ? `<p class="more"><a href="/events/archive">Past events</a></p>` : '';
      return `<section class="block events"><div class="wrap"><div class="sechead">${head(c, p)}${cal ? `<a href="${safeUrl(cal)}">Full calendar on Luma</a>` : ''}</div>${inner}${archive}</div></section>`;
    },
  },
  endorsements_list: {
    label: 'Endorsements',
    view: 'endorsements', feature: 'endorsements', version: 2,
    help: 'Candidates and measures the chapter endorses, as a sample ballot. After the election they move to the results on their own.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Our slate', 'Who we endorse', 'How we are voting'] },
      { key: 'intro', label: 'Short intro', kind: 'textarea', rich: true, max: 300, hint: 'Say which election and how you chose.', options: ['Election Day is coming. Here is who we are voting for, and why.', 'Every endorsement was chosen by a member vote after a questionnaire and interview.'] },
      { key: 'ballot_title', label: 'Ballot header', kind: 'text', max: 40, options: ['Sample ballot', 'Our endorsements', 'Results'] },
      { key: 'show', label: 'Which endorsements', kind: 'select', options: ['Current', 'Results', 'All'], hint: 'Current: elections still to come. Results: past elections.' },
      { key: 'election', label: 'Only this election', kind: 'text', panel: true, max: 30, hint: 'Optional, like "Nov 2026". Leave empty for every election.' },
      ISSUE_FILTER('endorsements'),
      ...emptyFields('Our endorsements for the next election are coming soon.'),
    ],
    defaults: { heading: 'Our slate', intro: 'Election Day is coming. Here is who we are voting for, and why.', ballot_title: 'Sample ballot', show: 'Current', election: '', issue: '', if_empty: EMPTY[0], empty_text: '' },
    migrations: {
      2: (p, ctx) => {
        if (!legacy(p, 'items')) return p;
        p.items.forEach((x) => ctx.extract('endorsements', x));
        return { heading: p.heading, intro: p.intro, ballot_title: p.ballot_title, show: 'Current', election: '', issue: '', if_empty: EMPTY[0], empty_text: '' };
      },
    },
    render: (p, c) => {
      if (off(c, 'endorsements')) return offNote(c, 'endorsements');
      const now = D(c).now;
      let list = tagged(itemsOf(c, 'endorsements'), p.issue).filter((x) => p.show === 'All' || (p.show === 'Results') === isPast('endorsements', x, now));
      if (p.election) list = list.filter((x) => String(x.election).toLowerCase() === p.election.toLowerCase());
      const rows = list.map((x) => `<div class="ballotrow"><span class="ini" aria-hidden="true">${esc(ini(x.name))}</span>${OVAL}<div class="bi"><p class="cap meta2">${esc(x.office)}${x.election ? ' · ' + esc(x.election) : ''}${x.result && x.result !== 'Not decided yet' ? ` · <b class="result r-${esc(x.result.toLowerCase())}">${esc(x.result)}</b>` : ''}</p><p class="sign cand"><a href="${itemPath('endorsements', x.id)}">${esc(x.name)}</a></p><div class="why2">${paras(x.statement)}</div>${openBtn(c, 'endorsements', x)}</div></div>`).join('');
      const inner = rows || fallback(p, c, 'Our endorsements for the next election are coming soon.');
      if (inner == null) return '';
      return `<section class="block endorse"><div class="wrap"><div class="split2"><div class="slateintro">${head(c, p)}${body(c, c.f('intro'), p.intro)}</div><div class="ballot"><p class="cap ballothead"${c.f('ballot_title')}>${esc(p.ballot_title)}</p>${rows ? inner : `<div class="ballotrow">${inner}</div>`}</div></div></div></section>`;
    },
  },
  issue_cards: {
    label: 'Issues',
    view: 'issues', feature: 'issues', version: 2,
    help: 'Policy priorities, one card each, linking to each issue’s page.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ["What we're fighting for", 'Where we stand', 'Our priorities'] },
      { key: 'issues', label: 'Which issues', kind: 'tags', col: 'issues', hint: 'Optional. Pick issues to show only those, in that order. Leave empty to show every issue.' },
      ...emptyFields('Our issue pages are coming soon.'),
    ],
    defaults: { heading: "What we're fighting for", issues: [], if_empty: 'Show a message', empty_text: '' },
    migrations: {
      2: (p, ctx) => {
        if (!legacy(p, 'items')) return p;
        p.items.forEach((x) => ctx.extract('issues', { title: x.title, summary: x.summary }));
        return { heading: p.heading, issues: [], if_empty: 'Show a message', empty_text: '' };
      },
    },
    render: (p, c) => {
      if (off(c, 'issues')) return offNote(c, 'issues');
      const all = itemsOf(c, 'issues'), list = (p.issues || []).length ? p.issues.map((id) => all.find((x) => x.id === id)).filter(Boolean) : all;
      const inner = list.length ? `<div class="issuegrid">${list.map((x, k) => `<a class="issue v${k % 4}" href="${itemPath('issues', x.id)}"><span class="swatch" aria-hidden="true"></span><span class="tape" aria-hidden="true"></span><span class="sign ititle">${esc(x.title)}</span>${SQUIGGLE}<span class="why">${esc(x.summary)}</span><span class="imore">Read more</span>${openBtn(c, 'issues', x)}</a>`).join('')}</div>` : fallback(p, c, 'Our issue pages are coming soon.');
      if (inner == null) return '';
      return `<section class="block issues"><div class="wrap">${head(c, p)}${inner}</div></section>`;
    },
  },
  posts_list: {
    label: 'News & media',
    view: 'posts', feature: 'posts', version: 2,
    help: 'Posts, press releases, press coverage, videos and podcasts, newest first.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['News & media', 'In the news', 'News from the field'] },
      { key: 'show', label: 'Which kinds', kind: 'select', options: ['All', 'Posts and press releases', 'Press clippings', 'Videos and podcasts'] },
      ISSUE_FILTER('posts'),
      { key: 'limit', label: 'Most posts to show', kind: 'text', panel: true, max: 3, hint: 'A number, or leave empty to show all.' },
      ...emptyFields('Nothing posted yet. Join the list to hear from us.'),
    ],
    defaults: { heading: 'News & media', show: 'All', issue: '', limit: '', if_empty: 'Show national news', empty_text: '' },
    migrations: {
      2: (p, ctx) => {
        if (!legacy(p, 'posts')) return p;
        p.posts.forEach((x) => ctx.extract('posts', x));
        return { heading: p.heading, show: 'All', issue: '', limit: '', if_empty: 'Show national news', empty_text: '' };
      },
    },
    render: (p, c) => {
      if (off(c, 'posts')) return offNote(c, 'posts');
      const KINDS = { 'Posts and press releases': ['Post', 'Press release'], 'Press clippings': ['Press'], 'Videos and podcasts': ['Video', 'Podcast'] };
      const all = limit(tagged(itemsOf(c, 'posts'), p.issue).filter((x) => !KINDS[p.show] || KINDS[p.show].includes(x.type)), p.limit);
      const href = (x) => (x.type === 'Press' && x.url ? safeUrl(x.url) : itemPath('posts', x.id));
      const label = (x) => (x.type === 'Press' && x.outlet ? x.outlet : POST_LABEL[x.type] || x.type || 'Post') + (x.date ? ', ' + shortDate(x.date) : '');
      const card = (x) => `<article class="post">${x.image ? `<div class="duo pimg">${img(x.image, '')}</div>` : ''}<div class="pbody"><p class="cap meta">${esc(label(x))}</p><h3><a href="${href(x)}">${esc(x.title)}</a></h3>${paras(x.excerpt)}${openBtn(c, 'posts', x)}</div></article>`;
      const inner = all.length ? `<div class="postgrid">${all.map(card).join('')}</div>` : fallback(p, c, 'Nothing posted yet. Join the list to hear from us.');
      if (inner == null) return '';
      return `<section class="block posts"><div class="wrap">${head(c, p)}${inner}</div></section>`;
    },
  },
  people_grid: {
    label: 'People',
    view: 'people', feature: 'people', version: 2,
    help: 'Chapter leads and officers, each linking to their page. Past leads move to the alumni list on their own.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Our team', 'Chapter leads', 'Meet the organizers', 'Alumni'] },
      { key: 'show', label: 'Who to show', kind: 'select', options: ['Current team', 'Alumni', 'Everyone'] },
      ...emptyFields('Our team page is coming soon.'),
    ],
    defaults: { heading: 'Our team', show: 'Current team', if_empty: 'Hide this section', empty_text: '' },
    migrations: {
      2: (p, ctx) => {
        if (!legacy(p, 'people')) return p;
        p.people.forEach((x) => ctx.extract('people', x));
        return { heading: p.heading, show: 'Current team', if_empty: 'Hide this section', empty_text: '' };
      },
    },
    render: (p, c) => {
      if (off(c, 'people')) return offNote(c, 'people');
      const now = D(c).now, list = itemsOf(c, 'people').filter((x) => p.show === 'Everyone' || (p.show === 'Alumni') === isPast('people', x, now));
      const team = c.site?.identity?.team_photo;
      const inner = list.length ? `<div class="grid people">${list.map((x) => `<article class="card person">${x.photo ? img(x.photo, x.name) : `<span class="av" aria-hidden="true">${esc(ini(x.name))}</span>`}<div class="pad"><h3><a href="${itemPath('people', x.id)}">${esc(x.name)}</a></h3><p class="meta cap">${esc(x.role)}</p>${paras(x.bio)}${openBtn(c, 'people', x)}</div></article>`).join('')}</div>`
        : team && p.if_empty !== 'Hide this section' ? img(team, 'The chapter team', 'teamphoto') : fallback(p, c, 'Our team page is coming soon.');
      if (inner == null) return '';
      return `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${inner}</section>`;
    },
  },
  faq: {
    label: 'Questions and answers',
    help: 'Common questions, each opening to show its answer.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Questions', 'New here?', 'Frequently asked questions'] },
      { key: 'items', label: 'Questions', kind: 'list', itemLabel: 'q', fields: [
        { key: 'q', label: 'Question', kind: 'text', max: 140, required: true },
        { key: 'a', label: 'Answer', kind: 'textarea', rich: true, max: 1500 },
      ] },
    ],
    defaults: { heading: 'Questions', items: [] },
    presets: [
      { label: 'Do I need experience?', item: { q: 'Do I need any experience?', a: 'No. Most of our members had never been to a public hearing before they joined.' } },
      { label: 'Does it cost anything?', item: { q: 'Does it cost anything to join?', a: 'No. Joining the chapter is free.' } },
      { label: 'How often do you meet?', item: { q: 'How often do you meet?', a: 'Once a month, plus canvasses and hearings in between. Come to whatever fits your schedule.' } },
    ],
    render: (p, c) => ((p.items || []).length || c.edit ? `<section class="wrap block faq"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${(p.items || []).map((x, j) => (c.edit
      ? `<div class="faqi" data-item="${j}"><h3${c.fi('items', j, 'q')}>${esc(x.q)}</h3>${body(c, c.fi('items', j, 'a'), x.a)}</div>`
      : `<details class="faqi"><summary>${esc(x.q)}</summary>${paras(x.a)}</details>`)).join('')}</section>` : ''),
  },
  quote: {
    label: 'Quote',
    atom: true,
    help: 'A member, candidate or neighbor in their own words.',
    fields: [
      { key: 'text', label: 'Quote', kind: 'textarea', max: 400, required: true },
      { key: 'name', label: 'Who said it', kind: 'text', max: 60 },
      { key: 'role', label: 'Who they are', kind: 'text', max: 80, hint: 'Like "Member since 2024" or "Renter in District 4".' },
      { key: 'photo', label: 'Photo', kind: 'image' },
    ],
    defaults: { text: 'I came for the zoning fight and stayed for the people.', name: '', role: '', photo: '' },
    sample: { text: 'I came for the zoning fight and stayed for the people.', name: 'Dana K.', role: 'Member since 2024', photo: '' },
    render: (p, c) => `<figure class="quote">${img(p.photo, p.name, 'qphoto')}<blockquote><p${c.f('text')}>${lines(c, p.text)}</p></blockquote><figcaption><b${c.f('name')}>${esc(p.name)}</b> <span${c.f('role')}>${esc(p.role)}</span></figcaption></figure>`,
  },
  video: {
    label: 'Video',
    atom: true,
    help: 'A YouTube, Vimeo or Loom video that plays on the page.',
    fields: [
      { key: 'url', label: 'Video link', kind: 'url', required: true, hint: 'Paste the link from YouTube, Vimeo or Loom.' },
      { key: 'title', label: 'What the video is', kind: 'text', panel: true, max: 100, hint: 'For people using screen readers, like "Our candidate forum".' },
      { key: 'caption', label: 'Caption', kind: 'text', max: 140 },
    ],
    defaults: { url: '', title: '', caption: '' },
    sample: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Sample video', caption: 'Our candidate forum' },
    render: (p, c) => `<figure class="videofig">${p.url ? video(p.url, p.title || p.caption) : c.edit ? '<div class="imgph video" aria-hidden="true">Paste a video link in the side panel</div>' : ''}<figcaption class="cap"${c.f('caption')}>${esc(p.caption)}</figcaption></figure>`,
  },
  gallery: {
    label: 'Photo gallery',
    help: 'A grid of photos from an event or a campaign.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Photos', 'From the canvass', 'Scenes from the meetup'] },
      { key: 'images', label: 'Photos', kind: 'list', itemLabel: 'caption', fields: [
        { key: 'src', label: 'Photo', kind: 'image', required: true },
        { key: 'alt', label: 'Describe the photo', kind: 'text', panel: true, max: 150 },
        { key: 'caption', label: 'Caption', kind: 'text', max: 100 },
      ] },
    ],
    defaults: { heading: 'Photos', images: [] },
    sample: { heading: 'Photos', images: [{ src: '', alt: '', caption: 'Canvass kickoff' }, { src: '', alt: '', caption: 'Testifying at City Hall' }, { src: '', alt: '', caption: 'Monthly meetup' }] },
    render: (p, c) => ((p.images || []).length || c.edit ? `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="gallery">${(p.images || []).map((x, j) => (x.src || c.ph ? `<figure data-item="${j}">${x.src ? img(x.src, x.alt || x.caption) : '<div class="imgph" aria-hidden="true"></div>'}<figcaption class="cap"${c.fi('images', j, 'caption')}>${esc(x.caption)}</figcaption></figure>` : '')).join('')}</div></section>` : ''),
  },
  stats: {
    label: 'Numbers',
    help: 'Big numbers that show what the chapter has done.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Our work so far', 'By the numbers', 'This year'] },
      { key: 'items', label: 'Numbers', kind: 'list', itemLabel: 'label', fields: [
        { key: 'number', label: 'Number', kind: 'text', max: 12, required: true, hint: 'Like 1,200 or 40%.' },
        { key: 'label', label: 'What it counts', kind: 'text', max: 60, required: true },
      ] },
    ],
    defaults: { heading: 'Our work so far', items: [] },
    presets: [
      { label: 'Doors knocked', item: { number: '1,200', label: 'doors knocked' } },
      { label: 'Members', item: { number: '150', label: 'members' } },
      { label: 'Hearings', item: { number: '12', label: 'public hearings packed' } },
      { label: 'Homes', item: { number: '3,000', label: 'homes legalized by reforms we backed' } },
    ],
    render: (p, c) => ((p.items || []).length || c.edit ? `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="stats">${(p.items || []).map((x, j) => `<div class="stat" data-item="${j}"><span class="sign num"${c.fi('items', j, 'number')}>${esc(x.number)}</span><span class="cap"${c.fi('items', j, 'label')}>${esc(x.label)}</span></div>`).join('')}</div></section>` : ''),
  },
  map: {
    label: 'Map',
    help: 'A map of a place: your meeting spot, a polling place, a hearing.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Find us', 'Where we meet', 'Getting there'] },
      { key: 'address', label: 'Address', kind: 'text', max: 160, required: true, hint: 'A street address or a place name with the city.' },
      { key: 'caption', label: 'Directions', kind: 'textarea', max: 300, hint: 'Optional, like "Back room, past the bar. Two blocks from the Main St. stop."' },
    ],
    defaults: { heading: 'Find us', address: '', caption: '' },
    sample: { heading: 'Find us', address: 'Riverside Taproom, Demo City', caption: 'Back room, past the bar.' },
    render: (p, c) => `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${p.address ? map(p.address) : c.edit ? '<div class="imgph map" aria-hidden="true">Type an address in the side panel</div>' : ''}<p class="mapcap"${c.f('caption')}>${lines(c, p.caption)}</p></section>`,
  },
  divider: {
    label: 'Divider',
    atom: true,
    help: 'A line or a bit of space between sections.',
    fields: [{ key: 'style', label: 'Style', kind: 'select', options: ['Line', 'Space', 'Stars'] }],
    defaults: { style: 'Line' },
    render: (p) => `<div class="divider d-${esc(String(p.style).toLowerCase())}" role="separator">${p.style === 'Stars' ? '★ ★ ★' : ''}</div>`,
  },
  logos: {
    label: 'Logo strip',
    help: 'Partner, coalition or sponsor logos in a row.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Our coalition', 'Partners', 'With support from'] },
      { key: 'logos', label: 'Logos', kind: 'list', itemLabel: 'alt', fields: [
        { key: 'src', label: 'Logo', kind: 'image', required: true },
        { key: 'alt', label: 'Organization name', kind: 'text', max: 80, required: true },
        { key: 'url', label: 'Link', kind: 'url' },
      ] },
    ],
    defaults: { heading: 'Our coalition', logos: [] },
    sample: { heading: 'Our coalition', logos: [{ src: '', alt: 'Housing Action', url: '' }, { src: '', alt: 'Transit Riders Union', url: '' }] },
    render: (p, c) => ((p.logos || []).length || c.edit ? `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="logos">${(p.logos || []).map((x, j) => {
      const inner = x.src ? img(x.src, x.alt) : `<span class="logoname"${c.fi('logos', j, 'alt')}>${esc(x.alt)}</span>`;
      return x.url && !c.edit ? `<a href="${safeUrl(x.url)}">${inner}</a>` : `<div data-item="${j}">${inner}</div>`;
    }).join('')}</div></section>` : ''),
  },
  table: {
    label: 'Table',
    help: 'A simple table, like a voter guide, a schedule or a comparison.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'columns', label: 'Columns', kind: 'select', options: ['2', '3', '4'] },
      { key: 'h1', label: 'Column 1 heading', kind: 'text', max: 40 },
      { key: 'h2', label: 'Column 2 heading', kind: 'text', max: 40 },
      { key: 'h3', label: 'Column 3 heading', kind: 'text', max: 40 },
      { key: 'h4', label: 'Column 4 heading', kind: 'text', max: 40 },
      { key: 'rows', label: 'Rows', kind: 'list', itemLabel: 'c1', fields: [
        { key: 'c1', label: 'Column 1', kind: 'text', max: 200 },
        { key: 'c2', label: 'Column 2', kind: 'text', max: 200 },
        { key: 'c3', label: 'Column 3', kind: 'text', max: 200 },
        { key: 'c4', label: 'Column 4', kind: 'text', max: 200 },
      ] },
      { key: 'note', label: 'Note under the table', kind: 'text', max: 200 },
    ],
    defaults: { heading: 'Voter guide', columns: '3', h1: 'Race', h2: 'Our pick', h3: 'Why', h4: '', rows: [], note: '' },
    presets: [{ label: 'Row', item: { c1: '', c2: '', c3: '', c4: '' } }],
    sample: { heading: 'Voter guide', columns: '3', h1: 'Race', h2: 'Our pick', h3: 'Why', h4: '', rows: [{ c1: 'City Council, District 4', c2: 'Jordan Lee', c3: 'Led on zoning reform' }, { c1: 'Measure H', c2: 'Yes', c3: 'More homes near transit' }], note: 'Polls are open 7am to 8pm.' },
    render: (p, c) => {
      const n = Math.min(4, Math.max(2, parseInt(p.columns, 10) || 3)), cols = [1, 2, 3, 4].slice(0, n);
      return `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="tablewrap"><table><thead><tr>${cols.map((k) => `<th${c.f('h' + k)}>${esc(p['h' + k])}</th>`).join('')}</tr></thead><tbody>${(p.rows || []).map((r, j) => `<tr data-item="${j}">${cols.map((k) => `<td${c.fi('rows', j, 'c' + k)}>${esc(r['c' + k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="cap tablenote"${c.f('note')}>${esc(p.note)}</p></section>`;
    },
  },
  contact_form: {
    label: 'Contact form',
    feature: 'contact',
    help: 'A form that messages the chapter. Your email address never appears on the page.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60, options: ['Get in touch', 'Contact us', 'Questions? Ask us.'] },
      { key: 'intro', label: 'Intro', kind: 'textarea', rich: true, max: 300, options: ['We read every message and usually reply within a few days.'] },
      { key: 'button_label', label: 'Button text', kind: 'text', max: 24, options: ['Send', 'Send message'] },
    ],
    defaults: { heading: 'Get in touch', intro: 'We read every message and usually reply within a few days.', button_label: 'Send' },
    render: (p, c) => {
      if (D(c).features?.contact === false) return c.edit ? '<section class="wrap block"><p class="cms-note">Contact forms are turned off for this chapter by national, so this section is hidden.</p></section>' : '';
      return `<section class="wrap block contactblock"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('intro'), p.intro)}${contactForm('chapter', { button: p.button_label || 'Send', edit: c.edit })}</section>`;
    },
  },
  saved: {
    label: 'Saved section',
    hidden: true,
    help: 'A section saved for reuse. Edit it once and every page that uses it updates.',
    fields: [{ key: 'ref', label: 'Saved section', kind: 'ref', col: 'sections', required: true, panel: true }],
    defaults: { ref: '' },
    render: (p, c) => {
      const s = (D(c).items?.sections || []).find((x) => x.id === p.ref);
      const inner = s ? (s.blocks || []).map((b, k) => renderBlock(b, { site: c.site, data: c.data, i: k })).join('') : '';
      if (!c.edit) return inner;
      return `<div class="savedref"><div class="cms-saved"><span>${s ? `Saved section “${esc(s.title)}”. Changes to it show on every page that uses it.` : 'This saved section no longer exists.'}</span>${s ? `<button data-open="sections/${esc(s.id)}">Edit it everywhere</button>` : ''}<button data-detach="1">Turn into a separate copy</button></div>${inner}</div>`;
    },
  },
};

const defaultsFor = (type) => JSON.parse(JSON.stringify(blocks[type].defaults));
// Content shown in the block gallery: the sample if there is one, otherwise the defaults with the presets as list items.
function sampleFor(type) {
  const def = blocks[type];
  if (def.sample) return JSON.parse(JSON.stringify(def.sample));
  const p = defaultsFor(type), list = def.fields.find((f) => f.kind === 'list');
  if (list && def.presets) p[list.key] = def.presets.map((x) => JSON.parse(JSON.stringify(x.item)));
  return p;
}
// Field definition for a key on a block type, or for a key inside one of its lists.
function fieldOf(type, key, list) {
  const def = blocks[type]; if (!def) return null;
  const f = list ? def.fields.find((x) => x.key === list)?.fields?.find((x) => x.key === key) : def.fields.find((x) => x.key === key);
  return f || null;
}
const cleanId = (id, fallback) => String(id || '').replace(/[^\w-]/g, '').slice(0, 40) || fallback;

// ---------- visibility (B4): stored on the block as vis, only when set
const DEVICES = ['All', 'Phones only', 'Computers only'];
const when = (s) => (/^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(String(s || '')) ? String(s).slice(0, 16) : '');
function cleanVis(v) {
  if (!v || typeof v !== 'object') return undefined;
  const o = { from: when(v.from), until: when(v.until), device: DEVICES.includes(v.device) ? v.device : 'All', after: SLUG.test(v.after || '') ? v.after : '' };
  return o.from || o.until || o.after || o.device !== 'All' ? o : undefined;
}
// Whether a block shows right now, and if not, why (the editor labels hidden blocks with this).
function visibility(b, data = NO_DATA) {
  const v = b.vis, now = data.now || '';
  if (!v || !now) return { show: true };
  if (v.from && now < v.from) return { show: false, why: `Hidden until ${fmtDate(v.from) || v.from}` };
  if (v.until && now >= v.until) return { show: false, why: `Hidden since ${fmtDate(v.until) || v.until}` };
  if (v.after) {
    const e = (data.items?.events || []).find((x) => x.id === v.after);
    if (e && isPast('events', e, now)) return { show: false, why: `Hidden because “${e.title}” has ended` };
  }
  return { show: true };
}
const deviceClass = (b) => (b.vis?.device === 'Phones only' ? 'only-phone' : b.vis?.device === 'Computers only' ? 'only-desktop' : '');

// ---------- versioned schemas (F2): upgrade props saved by an older version of a block, then clean them
function migrateProps(type, props, v, ctx) {
  const def = blocks[type];
  let out = props && typeof props === 'object' ? props : {};
  for (let n = (+v || 1) + 1; n <= (def.version || 1); n++) if (def.migrations?.[n]) out = def.migrations[n](out, ctx);
  return out;
}
const versioned = (type) => ((blocks[type].version || 1) > 1 ? { v: blocks[type].version } : {});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// opts.extract(col, item) receives inline items that a migration moves into a collection (lib/cms.js adds them);
// opts.noSaved refuses saved-section references (a saved section can't contain another one).
function validateBlocks(list, opts = {}) {
  if (!Array.isArray(list) || list.length > 100) throw bad('blocks must be an array (max 100)');
  const ctx = { extract: opts.extract || (() => '') };
  const seen = new Set();
  const uniq = (id) => { let x = id, n = 2; while (seen.has(x)) x = `${id}-${n++}`; seen.add(x); return x; };
  return list.map((b, i) => {
    if (!b || !blocks[b.type]) throw bad(`unknown block type at position ${i + 1}`);
    if (b.type === 'saved' && opts.noSaved) throw bad("a saved section can't contain another saved section");
    const def = blocks[b.type], raw = migrateProps(b.type, b.props, b.v, ctx), props = clean(def.fields, raw);
    if (def.container) {
      if (!LAYOUTS[props.layout]) props.layout = 'halves';
      const n = LAYOUTS[props.layout].length, cols = Array.isArray(raw.cols) ? raw.cols : [];
      const atom = (a, ci, k) => {
        if (!a || !ATOMS.includes(a.type)) throw bad(`unknown block type in column ${ci + 1}`);
        return { id: uniq(cleanId(a.id, `a${i}x${ci}x${k}`)), type: a.type, ...versioned(a.type), props: clean(blocks[a.type].fields, migrateProps(a.type, a.props, a.v, ctx)) };
      };
      props.cols = Array.from({ length: n }, (_, ci) => (Array.isArray(cols[ci]) ? cols[ci] : []).slice(0, 30).map((a, k) => atom(a, ci, k)));
      // blocks from columns that no longer exist move into the last column
      cols.slice(n).flat().forEach((a, k) => { if (props.cols[n - 1].length < 30) props.cols[n - 1].push(atom(a, n - 1, 100 + k)); });
    }
    const vis = cleanVis(b.vis);
    return { id: uniq(cleanId(b.id, `b${i}`)), type: b.type, ...versioned(b.type), props, ...(vis ? { vis } : {}) };
  });
}

// ctx: { edit, i, site, data } where i is the block's index on the page (used in data-f paths).
function renderBlock(b, { edit = false, i = 0, site = {}, prefix, nested = false, data, sample = false } = {}) {
  const def = blocks[b.type];
  if (!def) return '';
  const pre = prefix ?? String(i);
  // In edit mode every editable element carries its path plus the guidance the editor shows while typing.
  const attrs = (path, f, fallback) => {
    if (!edit) return '';
    const label = f?.label || String(fallback).replace(/_/g, ' ');
    let a = ` data-f="${esc(path)}" data-fl="${esc(label)}" data-ph="${esc(f?.required ? label + ' (required)' : label)}"`;
    if (f?.max) a += ` data-max="${f.max}"`;
    if (f?.maxLines) a += ` data-maxlines="${f.maxLines}"`;
    if (f?.kind === 'textarea') a += f.rich ? ' data-ml="1" data-rich="1"' : ' data-ml="1"';
    return a;
  };
  const c = {
    edit,
    ph: edit || sample, // show placeholders for missing photos (the editor and the block gallery)
    site,
    data,
    f: (key) => attrs(`${pre}.${key}`, fieldOf(b.type, key), key),
    fi: (list, j, key) => attrs(`${pre}.${list}.${j}.${key}`, fieldOf(b.type, key, list), key),
    atom: (a, ci, k) => {
      const inner = renderBlock(a, { edit, sample, site, data, prefix: `${pre}.cols.${ci}.${k}`, nested: true });
      return edit ? `<div class="atom" data-atom="${ci}.${k}" data-label="${esc(blocks[a.type]?.label || '')}">${inner}</div>` : inner;
    },
  };
  const html = def.render(b.props || {}, c);
  return def.atom && !nested ? `<section class="wrap block">${html}</section>` : html;
}
const schema = () => ({
  blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, { label: v.label, help: v.help, fields: v.fields, defaults: v.defaults, presets: v.presets || [], atom: !!v.atom, container: !!v.container, view: v.view || null, feature: v.feature || null, hidden: !!v.hidden, version: v.version || 1 }])),
  layouts: LAYOUT_NAMES,
  atoms: ATOMS,
  devices: DEVICES,
});

module.exports = { LAYOUTS, LAYOUT_NAMES, ATOMS, DEVICES, BUTTON_STYLES, socialLinks, SOCIALS, blocks, esc, safeUrl, paras, defaultsFor, sampleFor, fieldOf, validateBlocks, renderBlock, visibility, deviceClass, cleanVis, schema, videoSrc };
