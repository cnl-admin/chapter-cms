'use strict';
// Block registry. This is the developer contract for adding a block (see README, "Adding a block"):
//   label    - name shown to leads
//   help     - one sentence on what the block is for
//   fields   - schema: drives the editor, server-side validation, the pre-publish checks and the gallery
//   defaults - starting content when a lead adds the block (must pass validation)
//   presets  - prewritten list items a lead can add with one tap (list blocks only)
//   sample   - optional content for the block gallery and visual tests (defaults + presets otherwise)
//   atom     - small block that can also sit inside a column
//   render   - (props, ctx) -> HTML. Wrap editable text with ctx.f(key) / ctx.fi(list, j, key) so the
//              editor can edit it in place; those helpers return '' on the public site.
// Field kinds: text, textarea, url, date (datetime-local), select, list (of sub-fields).
// Field options (all optional):
//   options  - prewritten copy shown in the side panel while the text is focused (select: the allowed values)
//   rich     - textarea edited with the formatting toolbar (stored as the markdown subset in text.js)
//   max      - soft character limit: a counter while typing and a warning in the pre-publish checks
//   maxLines - soft line limit for multi-line plain text
//   required - must be filled in before the page can be published
//   hint     - one line of guidance or an example, shown under the field
//   panel    - edit in the side panel even though it is text (ids, alt text)
//   fallback - a Settings > Connections key used when the field is left empty (satisfies required)

const { esc, safeUrl, paras, parseDate, fmtDate, shortDate } = require('./text');

const img = (u, alt = '') => (u ? `<img src="${safeUrl(u)}" alt="${esc(alt)}" loading="lazy">` : '');
const ROT = ['-1.6deg', '1.2deg', '-0.8deg'];

// Editable text helpers. In edit mode rich fields render as formatted HTML that the editor turns back into markdown.
const body = (c, attrs, text) => (c.edit ? `<div class="rich"${attrs}>${paras(text)}</div>` : paras(text));
const lines = (c, text) => (c.edit ? esc(text) : esc(text).replace(/\n/g, '<br>'));
const btn = (c, label, url, cls, attrs) => {
  if (c.edit) return `<a class="btn ${cls || ''}" href="#"><span${attrs}>${esc(label)}</span></a>`;
  return label && url ? `<a class="btn ${cls || ''}" href="${safeUrl(url)}">${esc(label)}</a>` : '';
};
const conn = (c, key) => String(c.site?.connections?.[key] || '');
const view = (c, list, keepSorted) => (c.edit ? list.map((x, j) => ({ x, j })) : keepSorted(list.map((x, j) => ({ x, j }))));

const LAYOUTS = { full: ['1fr'], halves: ['1fr', '1fr'], wideL: ['2fr', '1fr'], wideR: ['1fr', '2fr'], three: ['1fr', '1fr', '1fr'] };
const LAYOUT_NAMES = { full: 'Full width', halves: 'Two halves', wideL: 'Wide left', wideR: 'Wide right', three: 'Three columns' };
const ATOMS = ['text', 'image', 'card', 'signup', 'button', 'socials'];
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

const BTN_HINT = 'Start with a verb: Join, RSVP, Donate, Read.';
const URL_HINT = 'A page on your site like /events, or a full link starting with https://';

const blocks = {
  hero: {
    label: 'Yard sign hero',
    help: 'The big sign at the top of a page. Use one per page.',
    fields: [
      { key: 'heading', label: 'Sign headline', kind: 'textarea', max: 60, maxLines: 3, required: true, hint: 'Short and punchy, one idea per line. Three lines at most.', options: ['More homes.\nMore trains.\nMore neighbors.', 'Build more.\nWelcome more.\nGrow together.', 'Homes for everyone.\nTrains that come often.\nA city that works.', 'Growth, freedom,\nand a government\nthat works.'] },
      { key: 'subheading', label: 'Small line under the headline', kind: 'text', max: 60, options: ['A chapter of Citizens for a New Liberalism', 'Local chapter, national movement'] },
      { key: 'badge_text', label: 'Round badge text', kind: 'text', max: 3, hint: 'Two or three letters, like your city initials.' },
      { key: 'image', label: 'Round badge image link', kind: 'url', hint: 'Optional. A square logo works best; it replaces the badge text.' },
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
    render: (p, c) => `<section class="signhero"><div class="wrap signwrap"><div class="signpost" style="--rot:${ROT[2]}"><div class="signpanel"><h1 class="sign"${c.f('heading')}>${lines(c, p.heading)}</h1><p class="cap signcap"${c.f('subheading')}>${esc(p.subheading)}</p></div><div class="badge">${p.image ? img(p.image) : `<span class="sign"${c.f('badge_text')}>${esc(p.badge_text)}</span>`}</div><span class="stake" style="left:30%"></span><span class="stake" style="right:30%"></span></div></div></section>
<section class="wrap intro"><p${c.f('intro')}>${esc(p.intro)}</p><div class="btns">${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}${p.button2_label || c.edit ? btn(c, p.button2_label, p.button2_url, '', c.f('button2_label')) : ''}</div></section>`,
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
    help: 'A photo with an optional caption. Paste a link to the image for now; uploads come in a later update.',
    fields: [
      { key: 'src', label: 'Image link', kind: 'url', required: true, hint: 'A link to a photo that ends in .jpg, .png or .webp.' },
      { key: 'alt', label: 'Describe the image', kind: 'text', panel: true, max: 150, hint: 'For people using screen readers, e.g. "Members holding signs at City Hall".' },
      { key: 'caption', label: 'Caption', kind: 'text', max: 120, options: ['Chapter meetup', 'Canvassing day', 'Our first anniversary'] },
    ],
    defaults: { src: '', alt: '', caption: 'Chapter meetup' },
    render: (p, c) => `<figure class="imgfig">${p.src ? img(p.src, p.alt || p.caption) : '<div class="imgph" aria-hidden="true"></div>'}<figcaption class="cap"${c.f('caption')}>${esc(p.caption)}</figcaption></figure>`,
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
      { key: 'style', label: 'Color', kind: 'select', options: ['Navy', 'Chapter color', 'Paper'] },
    ],
    defaults: { label: 'Learn more', url: '/', style: 'Navy' },
    render: (p, c) => btn(c, p.label, p.url, p.style === 'Chapter color' ? 'ch' : p.style === 'Paper' ? 'paper' : '', c.f('label')),
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
    sample: { layout: 'halves', cols: [[{ id: 'a1', type: 'text', props: { heading: 'Who we are', body: 'Neighbors who want a city that **grows**.' } }], [{ id: 'a2', type: 'card', props: { title: 'Next meetup', text: 'First Thursday of every month.' } }, { id: 'a3', type: 'button', props: { label: 'RSVP', url: '/events', style: 'Navy' } }]] },
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
    render: (p, c) => `<section class="band navy joinband"><div class="wrap"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('body'), p.body)}${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}</div></section>`,
  },
  events_list: {
    label: 'Events (flyers)',
    help: 'Upcoming events as tear-off flyers. Past events hide on their own. Fields mirror Luma so a later sync can fill this in.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Show up.', 'Upcoming events', 'Next up', 'Come hang out'] },
      { key: 'luma_calendar_url', label: 'Luma calendar link', kind: 'url', fallback: 'luma_calendar_url', hint: 'Optional. Adds a "Full calendar" link. Leave empty to use the calendar from Settings.' },
      { key: 'show_past', label: 'Show past events?', kind: 'select', options: ['No', 'Yes'] },
      { key: 'limit', label: 'Most events to show', kind: 'text', panel: true, hint: 'A number, or leave empty to show all.' },
      {
        key: 'events', label: 'Events', kind: 'list', itemLabel: 'title', fields: [
          { key: 'id', label: 'Luma event ID', kind: 'text', panel: true, hint: 'Optional. Filled in by the Luma sync later.' },
          { key: 'title', label: 'Event name', kind: 'text', max: 80, required: true, options: ['Monthly meetup', 'Book club', 'Canvass', 'Voter registration drive', 'Happy hour'] },
          { key: 'start', label: 'Starts', kind: 'date', required: true, hint: 'Local time.' },
          { key: 'end', label: 'Ends', kind: 'date', hint: 'Optional. Local time.' },
          { key: 'location', label: 'Location', kind: 'text', max: 80 },
          { key: 'url', label: 'RSVP link', kind: 'url', hint: 'Usually the Luma event page.' },
          { key: 'cover_image', label: 'Cover image link', kind: 'url' },
          { key: 'description', label: 'Description', kind: 'textarea', rich: true, max: 300, options: ['Casual drinks and conversation. New faces welcome, no experience needed.', 'Knock doors for our endorsed candidates. We will train you first.', 'Help your neighbors get registered before the deadline.', 'Part of our read-through. New faces welcome, skimmers too.'] },
        ],
      },
    ],
    defaults: { heading: 'Show up.', luma_calendar_url: '', show_past: 'No', limit: '', events: [] },
    presets: [
      { label: 'Monthly meetup', item: { id: '', title: 'Monthly meetup', start: '', end: '', location: '[Venue]', url: '', cover_image: '', description: 'Casual drinks and conversation. New faces welcome, no experience needed.' } },
      { label: 'Book club', item: { id: '', title: 'Book club', start: '', end: '', location: '[Venue]', url: '', cover_image: '', description: 'Part of our read-through. New faces welcome, skimmers too.' } },
      { label: 'Canvass', item: { id: '', title: 'Canvass for our slate', start: '', end: '', location: '[Meeting spot]', url: '', cover_image: '', description: 'Knock doors for our endorsed candidates. We will train you first.' } },
      { label: 'Voter registration drive', item: { id: '', title: 'Voter registration drive', start: '', end: '', location: '[Location]', url: '', cover_image: '', description: 'Help your neighbors get registered before the deadline.' } },
      { label: 'Election night party', item: { id: '', title: 'Election night party', start: '', end: '', location: '[Venue]', url: '', cover_image: '', description: 'Watch the returns with the chapter.' } },
    ],
    sample: { heading: 'Show up.', luma_calendar_url: '', show_past: 'Yes', limit: '', events: [
      { id: '', title: 'Monthly meetup', start: '2030-03-05T18:30', end: '', location: 'Riverside Taproom', url: 'https://lu.ma/', cover_image: '', description: 'Casual drinks and conversation. **New faces welcome.**' },
      { id: '', title: 'Canvass for our slate', start: '2030-03-14T10:00', end: '', location: 'Main St. library', url: 'https://lu.ma/', cover_image: '', description: 'Knock doors for our endorsed candidates. We will train you first.' }] },
    render: (p, c) => {
      const cutoff = new Date(Date.now() - 864e5).toISOString().slice(0, 16); // keep today's events visible
      const list = view(c, p.events || [], (a) => {
        let r = a.sort((x, y) => String(x.x.start).localeCompare(String(y.x.start)));
        if (p.show_past !== 'Yes') r = r.filter((e) => !e.x.start || String(e.x.start) >= cutoff);
        return parseInt(p.limit, 10) > 0 ? r.slice(0, parseInt(p.limit, 10)) : r;
      });
      const tabs = '<span class="tab cap">RSVP</span>'.repeat(6);
      return `<section class="band navy"><div class="wrap"><div class="bandhead"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${p.luma_calendar_url || conn(c, 'luma_calendar_url') ? `<a href="${safeUrl(p.luma_calendar_url || conn(c, 'luma_calendar_url'))}">Full calendar on Luma</a>` : ''}</div><div class="flyers">${list.map(({ x: e, j }, i) => `<article class="flyer" data-item="${j}" style="--rot:${ROT[i % 3]}"><span class="pin" aria-hidden="true"></span>${img(e.cover_image, e.title)}<div class="fbody"><p class="cap meta">${esc(fmtDate(e.start)) || (c.edit ? 'Pick a date in the side panel' : '')}</p><h3 class="sign"${c.fi('events', j, 'title')}>${esc(e.title)}</h3>${body(c, c.fi('events', j, 'description'), e.description)}<p${c.fi('events', j, 'location')}>${esc(e.location)}</p></div>${e.url || c.edit ? `<a class="tear" href="${safeUrl(e.url)}" aria-label="RSVP for ${esc(e.title)}">${tabs}</a>` : ''}</article>`).join('') || '<p class="onnavy">No events scheduled yet. Check back soon!</p>'}</div></div></section>`;
    },
  },
  endorsements_list: {
    label: 'Endorsements (ballot)',
    help: 'Candidates and measures the chapter endorses, as a sample ballot.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Our slate', 'Who we endorse', 'How we are voting'] },
      { key: 'intro', label: 'Short intro', kind: 'textarea', rich: true, max: 300, hint: 'Say which election and how you chose.', options: ['Election Day is coming. Here is who we are voting for, and why.', 'Every endorsement was chosen by a member vote after a questionnaire and interview.'] },
      { key: 'ballot_title', label: 'Ballot header', kind: 'text', max: 40, options: ['Sample ballot', 'Our endorsements'] },
      {
        key: 'items', label: 'Endorsements', kind: 'list', itemLabel: 'name', fields: [
          { key: 'name', label: 'Candidate or measure', kind: 'text', max: 60, required: true },
          { key: 'office', label: 'Office or race', kind: 'text', max: 60, options: ['City Council', 'Mayor', 'State House', 'State Senate', 'County Commission', 'School Board', 'Ballot measure'] },
          { key: 'election', label: 'Election', kind: 'text', max: 30, hint: 'For example "Nov 2026".' },
          { key: 'photo', label: 'Photo link', kind: 'url' },
          { key: 'statement', label: 'Why we endorse', kind: 'textarea', rich: true, max: 300, options: ['Backed by our members after a questionnaire, an interview, and a chapter vote.', 'Has led on zoning reform and transit funding.', 'Will legalize more homes and keep the city affordable.'] },
          { key: 'url', label: 'Campaign link', kind: 'url' },
        ],
      },
    ],
    defaults: { heading: 'Our slate', intro: 'Election Day is coming. Here is who we are voting for, and why.', ballot_title: 'Sample ballot', items: [] },
    presets: [
      { label: 'Candidate', item: { name: '[Candidate name]', office: '[Office]', election: 'Nov 2026', photo: '', statement: 'Backed by our members after a questionnaire, an interview, and a chapter vote.', url: '' } },
      { label: 'Ballot measure', item: { name: 'Yes on [Measure]', office: 'Ballot measure', election: 'Nov 2026', photo: '', statement: 'Allows more homes near transit.', url: '' } },
    ],
    sample: { heading: 'Our slate', intro: 'Election Day is coming. Here is who we are voting for, and why.', ballot_title: 'Sample ballot', items: [
      { name: 'Jordan Rivera', office: 'City Council, District 4', election: 'Nov 2030', photo: '', statement: 'Has led on **zoning reform** and transit funding.', url: '' },
      { name: 'Yes on Measure H', office: 'Ballot measure', election: 'Nov 2030', photo: '', statement: 'Allows more homes near transit.', url: '' }] },
    render: (p, c) => `<section class="band tint"><div class="wrap split2"><div class="slateintro"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('intro'), p.intro)}</div><div class="ballot"><p class="cap ballothead"${c.f('ballot_title')}>${esc(p.ballot_title)}</p>${(p.items || []).map((i, j) => `<div class="ballotrow" data-item="${j}"><span class="oval" aria-hidden="true"></span><div><p class="cap meta2"><span${c.fi('items', j, 'office')}>${esc(i.office)}</span>${i.election || c.edit ? ' · ' : ''}<span${c.fi('items', j, 'election')}>${esc(i.election)}</span></p><p class="cand">${i.url && !c.edit ? `<a href="${safeUrl(i.url)}">${esc(i.name)}</a>` : `<span${c.fi('items', j, 'name')}>${esc(i.name)}</span>`}</p><div class="why2">${body(c, c.fi('items', j, 'statement'), i.statement)}</div></div></div>`).join('') || '<p class="ballotrow">No endorsements yet.</p>'}</div></div></section>`,
  },
  issue_cards: {
    label: 'Issue stickers',
    help: 'Policy priorities, one sticker each.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ["What we're fighting for", 'Where we stand', 'Our priorities'] },
      {
        key: 'items', label: 'Issues', kind: 'list', itemLabel: 'title', fields: [
          { key: 'title', label: 'Issue', kind: 'text', max: 40, required: true },
          { key: 'summary', label: 'Summary', kind: 'textarea', max: 160, hint: 'One sentence.' },
          { key: 'url', label: 'Learn more link', kind: 'url' },
        ],
      },
    ],
    defaults: { heading: "What we're fighting for", items: [] },
    presets: [
      { label: 'Legalize housing', item: { title: 'Legalize housing', summary: 'Homes of every size near jobs and transit, from backyard cottages to apartments.', url: '' } },
      { label: 'Frequent transit', item: { title: 'Frequent transit', summary: 'Trains and buses so frequent that nobody needs a schedule.', url: '' } },
      { label: 'Tariffs are taxes', item: { title: 'Tariffs are taxes', summary: 'Open trade keeps prices down for working families.', url: '' } },
      { label: 'Welcome immigrants', item: { title: 'Welcome immigrants', summary: 'The people who build our cities deserve a faster legal path.', url: '' } },
      { label: 'Clean energy', item: { title: 'Build clean energy', summary: 'Permit solar, wind, nuclear, and the grid that connects them.', url: '' } },
      { label: 'State capacity', item: { title: 'Government that works', summary: 'Government should be able to build things and deliver results.', url: '' } },
    ],
    render: (p, c) => `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="stickers">${(p.items || []).map((i, k) => { const tag = i.url && !c.edit ? 'a' : 'div'; return `<${tag} class="sticker v${k % 4}" data-item="${k}" style="--rot:${ROT[(k + 1) % 3]}"${tag === 'a' ? ` href="${safeUrl(i.url)}"` : ''}><span class="sign"${c.fi('items', k, 'title')}>${esc(i.title)}</span><span class="why"${c.fi('items', k, 'summary')}>${esc(i.summary)}</span></${tag}>`; }).join('') || '<p class="muted">Issues coming soon.</p>'}</div></section>`,
  },
  posts_list: {
    label: 'News & media',
    help: 'Articles, videos and podcasts. Items of type Press show as newspaper clippings on the side.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['News & media', 'In the news', 'News from the field'] },
      {
        key: 'posts', label: 'Posts', kind: 'list', itemLabel: 'title', fields: [
          { key: 'title', label: 'Title', kind: 'text', max: 100, required: true },
          { key: 'date', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'select', options: ['Post', 'Press', 'Video', 'Podcast'] },
          { key: 'image', label: 'Image link', kind: 'url' },
          { key: 'excerpt', label: 'Body or excerpt', kind: 'textarea', rich: true, max: 600 },
          { key: 'url', label: 'Link', kind: 'url', hint: 'Optional, e.g. the article, video or episode.' },
        ],
      },
    ],
    defaults: { heading: 'News & media', posts: [] },
    presets: [
      { label: 'Chapter blog post', item: { title: 'What we told City Council', date: '', type: 'Post', image: '', excerpt: 'Our members signed up to testify. Here is the case we made.', url: '' } },
      { label: 'Press clipping', item: { title: 'Chapter lead quoted on the housing plan', date: '', type: 'Press', image: '', excerpt: '', url: '' } },
      { label: 'Video', item: { title: 'Watch: our candidate forum', date: '', type: 'Video', image: '', excerpt: 'Full recording of the forum.', url: '' } },
      { label: 'Podcast', item: { title: 'Chapter lead on the local podcast', date: '', type: 'Podcast', image: '', excerpt: 'Listen to the conversation.', url: '' } },
    ],
    sample: { heading: 'News & media', posts: [
      { title: 'What we told City Council', date: '2030-02-10T12:00', type: 'Post', image: '', excerpt: 'Our members signed up to testify. Here is **the case we made**.', url: '' },
      { title: 'Chapter lead quoted on the housing plan', date: '2030-02-02T12:00', type: 'Press', image: '', excerpt: '', url: '' }] },
    render: (p, c) => {
      const all = view(c, p.posts || [], (a) => a.sort((x, y) => String(y.x.date).localeCompare(String(x.x.date))));
      const press = all.filter(({ x }) => x.type === 'Press'), rest = all.filter(({ x }) => x.type !== 'Press');
      const row = ({ x, j }) => `<article class="post" data-item="${j}"><div class="date" aria-hidden="true"><div class="cap">${esc(parseDate(x.date).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).replace('Invalid Date', ''))}</div><div class="sign">${isNaN(parseDate(x.date)) ? '' : parseDate(x.date).getUTCDate()}</div></div><div>${img(x.image, x.title)}<p class="cap meta">${esc(x.type || 'Post')}${x.date ? ' · ' + esc(shortDate(x.date)) : ''}</p><h3${c.fi('posts', j, 'title')}>${x.url && !c.edit ? `<a href="${safeUrl(x.url)}">${esc(x.title)}</a>` : esc(x.title)}</h3>${body(c, c.fi('posts', j, 'excerpt'), x.excerpt)}</div></article>`;
      const clip = ({ x, j }, i) => `<div class="clipwrap" data-item="${j}" style="transform:rotate(${ROT[i % 3]})"><article class="clip"><p class="outlet">${esc(x.type)}${x.date ? ' · ' + esc(shortDate(x.date)) : ''}</p><h3${c.fi('posts', j, 'title')}>${x.url && !c.edit ? `<a href="${safeUrl(x.url)}">${esc(x.title)}</a>` : esc(x.title)}</h3>${body(c, c.fi('posts', j, 'excerpt'), x.excerpt)}</article></div>`;
      return `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="split"><div class="rows">${rest.map(row).join('') || (press.length ? '' : '<p class="muted">Nothing posted yet.</p>')}</div>${press.length ? `<aside class="clips"><h3 class="cap">Clippings</h3>${press.map(clip).join('')}</aside>` : ''}</div></section>`;
    },
  },
  people_grid: {
    label: 'People',
    help: 'Chapter leads and officers.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 40, options: ['Our team', 'Chapter leads', 'Meet the organizers'] },
      {
        key: 'people', label: 'People', kind: 'list', itemLabel: 'name', fields: [
          { key: 'name', label: 'Name', kind: 'text', max: 60, required: true },
          { key: 'role', label: 'Role', kind: 'text', max: 40, options: ['Chapter lead', 'Events lead', 'Communications lead', 'Treasurer', 'Volunteer coordinator'] },
          { key: 'photo', label: 'Photo link', kind: 'url' },
          { key: 'bio', label: 'Short bio', kind: 'textarea', rich: true, max: 300, options: ['Organizing with the chapter since the beginning.', 'Keeps the meetups running and the calendar full.'] },
        ],
      },
    ],
    defaults: { heading: 'Our team', people: [] },
    presets: [
      { label: 'Chapter lead', item: { name: '[Name]', role: 'Chapter lead', photo: '', bio: 'Organizing with the chapter since the beginning.' } },
      { label: 'Events lead', item: { name: '[Name]', role: 'Events lead', photo: '', bio: 'Keeps the meetups running and the calendar full.' } },
      { label: 'Communications lead', item: { name: '[Name]', role: 'Communications lead', photo: '', bio: 'Runs our newsletter and social accounts.' } },
    ],
    sample: { heading: 'Our team', people: [
      { name: 'Sam Okafor', role: 'Chapter lead', photo: '', bio: 'Organizing with the chapter since the beginning.' },
      { name: 'Priya Shah', role: 'Events lead', photo: '', bio: 'Keeps the meetups running and the calendar full.' }] },
    render: (p, c) => `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="grid">${(p.people || []).map((x, j) => `<article class="card" data-item="${j}">${img(x.photo, x.name)}<div class="pad"><h3${c.fi('people', j, 'name')}>${esc(x.name)}</h3><p class="meta cap"${c.fi('people', j, 'role')}>${esc(x.role)}</p>${body(c, c.fi('people', j, 'bio'), x.bio)}</div></article>`).join('')}</div></section>`,
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

// Strip unknown keys and coerce to strings so saved JSON always matches the schema.
function clean(fields, input) {
  const out = {};
  for (const f of fields) {
    const v = input?.[f.key];
    if (f.kind === 'list') {
      out[f.key] = (Array.isArray(v) ? v : []).slice(0, 200).map((it) => clean(f.fields, it));
    } else {
      let s = typeof v === 'string' ? v : v == null ? '' : String(v);
      if (f.kind === 'select' && !f.options.includes(s)) s = f.options[0];
      out[f.key] = s.slice(0, 20000);
    }
  }
  return out;
}
const cleanId = (id, fallback) => String(id || '').replace(/[^\w-]/g, '').slice(0, 40) || fallback;

function validateBlocks(list) {
  if (!Array.isArray(list) || list.length > 100) throw Object.assign(new Error('blocks must be an array (max 100)'), { status: 400 });
  const seen = new Set();
  const uniq = (id) => { let x = id, n = 2; while (seen.has(x)) x = `${id}-${n++}`; seen.add(x); return x; };
  return list.map((b, i) => {
    if (!b || !blocks[b.type]) throw Object.assign(new Error(`unknown block type at position ${i + 1}`), { status: 400 });
    const def = blocks[b.type], props = clean(def.fields, b.props);
    if (def.container) {
      if (!LAYOUTS[props.layout]) props.layout = 'halves';
      const n = LAYOUTS[props.layout].length, cols = Array.isArray(b.props?.cols) ? b.props.cols : [];
      const atom = (a, ci, k) => {
        if (!a || !ATOMS.includes(a.type)) throw Object.assign(new Error(`unknown block type in column ${ci + 1}`), { status: 400 });
        return { id: uniq(cleanId(a.id, `a${i}x${ci}x${k}`)), type: a.type, props: clean(blocks[a.type].fields, a.props) };
      };
      props.cols = Array.from({ length: n }, (_, ci) => (Array.isArray(cols[ci]) ? cols[ci] : []).slice(0, 30).map((a, k) => atom(a, ci, k)));
      // blocks from columns that no longer exist move into the last column
      cols.slice(n).flat().forEach((a, k) => { if (props.cols[n - 1].length < 30) props.cols[n - 1].push(atom(a, n - 1, 100 + k)); });
    }
    return { id: uniq(cleanId(b.id, `b${i}`)), type: b.type, props };
  });
}

// ctx: { edit, i, site } where i is the block's index on the page (used in data-f paths).
function renderBlock(b, { edit = false, i = 0, site = {}, prefix, nested = false } = {}) {
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
    site,
    f: (key) => attrs(`${pre}.${key}`, fieldOf(b.type, key), key),
    fi: (list, j, key) => attrs(`${pre}.${list}.${j}.${key}`, fieldOf(b.type, key, list), key),
    atom: (a, ci, k) => {
      const inner = renderBlock(a, { edit, site, prefix: `${pre}.cols.${ci}.${k}`, nested: true });
      return edit ? `<div class="atom" data-atom="${ci}.${k}" data-label="${esc(blocks[a.type]?.label || '')}">${inner}</div>` : inner;
    },
  };
  const html = def.render(b.props || {}, c);
  return def.atom && !nested ? `<section class="wrap block">${html}</section>` : html;
}
const schema = () => ({
  blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, { label: v.label, help: v.help, fields: v.fields, defaults: v.defaults, presets: v.presets || [], atom: !!v.atom, container: !!v.container }])),
  layouts: LAYOUT_NAMES,
  atoms: ATOMS,
});

module.exports = { LAYOUTS, LAYOUT_NAMES, ATOMS, socialLinks, SOCIALS, blocks, esc, safeUrl, paras, defaultsFor, sampleFor, fieldOf, validateBlocks, renderBlock, schema };
