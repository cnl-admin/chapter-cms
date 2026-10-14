'use strict';
// Block registry. Each block type defines:
//   fields   - schema (drives the side panel and server-side validation)
//   defaults - starting content
//   presets  - prewritten list items a lead can add with one click (list blocks)
//   render   - (props, ctx) -> HTML. ctx.f/ctx.fi add data-f attributes in edit mode so the
//              editor can make the text editable in place; they return '' on the public site.
// Field kinds: text, textarea, url, date (datetime-local), select, list (of sub-fields).
// A field may carry `options`: prewritten copy shown in the side panel when that text is focused.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');

// Tiny escaped markdown: **bold**, *italic*, [text](url). Paragraphs split on blank lines.
const inline = (t) => esc(t)
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => `<a href="${safeUrl(url.replace(/&amp;/g, '&'))}">${txt}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
const paras = (t) => String(t ?? '').split(/\n{2,}/).filter(Boolean).map((p) => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`).join('');
const parseDate = (iso) => new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(iso || '') ? iso : (iso || '') + 'Z'); // wall-clock unless an offset is given
const fmtDate = (iso) => {
  const d = parseDate(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};
const shortDate = (iso) => fmtDate(iso).replace(/^\w+, /, '').replace(/, \d+:\d+ [AP]M$/, '');
const img = (u, alt = '') => (u ? `<img src="${safeUrl(u)}" alt="${esc(alt)}" loading="lazy">` : '');
const ROT = ['-1.6deg', '1.2deg', '-0.8deg'];

// Editable text helpers. In edit mode, multi-line fields show raw text (markdown visible) so what is typed is what is saved.
const body = (c, attrs, text) => (c.edit ? `<div class="raw"${attrs}>${esc(text)}</div>` : paras(text));
const lines = (c, text) => (c.edit ? esc(text) : esc(text).replace(/\n/g, '<br>'));
const btn = (c, label, url, cls, attrs) => {
  if (c.edit) return `<a class="btn ${cls || ''}" href="#"><span${attrs}>${esc(label)}</span></a>`;
  return label && url ? `<a class="btn ${cls || ''}" href="${safeUrl(url)}">${esc(label)}</a>` : '';
};
const view = (c, list, keepSorted) => (c.edit ? list.map((x, j) => ({ x, j })) : keepSorted(list.map((x, j) => ({ x, j }))));

const LAYOUTS = { full: ['1fr'], halves: ['1fr', '1fr'], wideL: ['2fr', '1fr'], wideR: ['1fr', '2fr'], three: ['1fr', '1fr', '1fr'] };
const LAYOUT_NAMES = { full: 'Full width', halves: 'Two halves', wideL: 'Wide left', wideR: 'Wide right', three: 'Three columns' };
const ATOMS = ['text', 'image', 'card', 'signup', 'button', 'socials'];
const SOCIALS = [['x', 'X / Twitter', (h) => `https://x.com/${h.replace(/^@/, '')}`], ['ig', 'Instagram', (h) => `https://instagram.com/${h.replace(/^@/, '')}`], ['bsky', 'Bluesky', (h) => `https://bsky.app/profile/${h.replace(/^@/, '')}`]];
const socialLinks = (site) => {
  const s = (site && site.social) || {};
  const links = SOCIALS.filter(([k]) => s[k]).map(([k, label, url]) => `<a href="${safeUrl(url(String(s[k])))}">${label}</a>`);
  return links.length ? `<p class="socials cap">${links.join('')}</p>` : '';
};

const blocks = {
  hero: {
    label: 'Yard sign hero',
    help: 'The big sign at the top of a page.',
    fields: [
      { key: 'heading', label: 'Sign headline (one line per row)', kind: 'textarea', options: ['More homes.\nMore trains.\nMore neighbors.', 'Build more.\nWelcome more.\nGrow together.', 'Homes for everyone.\nTrains that come often.\nA city that works.', 'Growth, freedom,\nand a government\nthat works.'] },
      { key: 'subheading', label: 'Small line under the headline', kind: 'text', options: ['A chapter of Citizens for a New Liberalism', 'Local chapter, national movement'] },
      { key: 'badge_text', label: 'Round badge text (2 to 3 letters)', kind: 'text' },
      { key: 'image', label: 'Round badge image URL (optional, e.g. logo)', kind: 'url' },
      { key: 'intro', label: 'Intro paragraph', kind: 'textarea', options: [
        'We are the local chapter of Citizens for a New Liberalism. We knock doors, pack zoning hearings, endorse candidates, and throw a good happy hour.',
        'We believe in abundance, openness, and government that works. Come meet your neighbors who want the same things.',
        'New to politics? Good. We run on volunteers, curiosity, and a shared belief that our city can grow and stay affordable.'] },
      { key: 'button_label', label: 'Main button text', kind: 'text', options: ['Join the chapter', 'Come to a meetup', 'Get involved', 'Sign up'] },
      { key: 'button_url', label: 'Main button link', kind: 'url' },
      { key: 'button2_label', label: 'Second button text (optional)', kind: 'text', options: ['Find an event', 'See our endorsements', 'Read our issues'] },
      { key: 'button2_url', label: 'Second button link', kind: 'url' },
    ],
    defaults: { heading: 'More homes.\nMore trains.\nMore neighbors.', subheading: 'Your Chapter Name', badge_text: 'NL', image: '', intro: 'We are the local chapter of Citizens for a New Liberalism. We knock doors, pack zoning hearings, endorse candidates, and throw a good happy hour.', button_label: 'Join the chapter', button_url: '/about', button2_label: 'Find an event', button2_url: '/events' },
    render: (p, c) => `<section class="signhero"><div class="wrap signwrap"><div class="signpost" style="--rot:${ROT[2]}"><div class="signpanel"><h1 class="sign"${c.f('heading', 1)}>${lines(c, p.heading)}</h1><p class="cap signcap"${c.f('subheading')}>${esc(p.subheading)}</p></div><div class="badge">${p.image ? img(p.image) : `<span class="sign"${c.f('badge_text')}>${esc(p.badge_text)}</span>`}</div><span class="stake" style="left:30%"></span><span class="stake" style="right:30%"></span></div></div></section>
<section class="wrap intro"><p${c.f('intro', 1)}>${esc(p.intro)}</p><div class="btns">${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}${p.button2_label || c.edit ? btn(c, p.button2_label, p.button2_url, '', c.f('button2_label')) : ''}</div></section>`,
  },
  text: {
    label: 'Text',
    atom: true,
    help: 'A heading and paragraphs. Blank line = new paragraph.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['About us', 'Who we are', 'What we do', 'Why we exist'] },
      { key: 'body', label: 'Text', kind: 'textarea', options: [
        'We are a group of neighbors who believe in **abundance, openness, and good governance**.\n\nWe meet monthly. Learn more at [cnliberalism.org](https://cnliberalism.org).',
        'We are the local chapter of the Center for New Liberalism. We knock doors, pack public hearings, endorse candidates, and throw a good happy hour, all for a growing, affordable, open city.',
        'No experience needed. If you care about housing, transit, trade, and a government that works, you belong here.'] },
    ],
    defaults: { heading: 'About us', body: 'Write something here.' },
    render: (p, c) => `<div class="atomtext"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('body', 1), p.body)}</div>`,
  },
  image: {
    label: 'Image',
    atom: true,
    help: 'A photo with an optional caption. Paste a link to the image.',
    fields: [
      { key: 'src', label: 'Image URL', kind: 'url' },
      { key: 'alt', label: 'Describe the image (for screen readers)', kind: 'text', panel: true },
      { key: 'caption', label: 'Caption', kind: 'text', options: ['Chapter meetup', 'Canvassing day', 'Our first anniversary'] },
    ],
    defaults: { src: '', alt: '', caption: 'Chapter meetup' },
    render: (p, c) => `<figure class="imgfig">${p.src ? img(p.src, p.alt || p.caption) : '<div class="imgph" aria-hidden="true"></div>'}<figcaption class="cap"${c.f('caption')}>${esc(p.caption)}</figcaption></figure>`,
  },
  card: {
    label: 'Card',
    atom: true,
    help: 'A short boxed note: a candidate, a fact, a project.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'text', label: 'Text', kind: 'textarea' },
    ],
    defaults: { title: 'Card title', text: 'Write something short here.' },
    render: (p, c) => `<div class="card"><div class="pad"><h3${c.f('title')}>${esc(p.title)}</h3>${body(c, c.f('text', 1), p.text)}</div></div>`,
  },
  signup: {
    label: 'Email sign-up',
    atom: true,
    help: 'A box that sends people to your sign-up form (Action Network, Mailchimp, a Google Form).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['Stay in the loop', 'Get our emails', 'Join the list'] },
      { key: 'blurb', label: 'Blurb', kind: 'textarea', options: ['One email a week, at most. Usually fewer.', 'Invites, updates, and a say in what we fight for next.'] },
      { key: 'button_label', label: 'Button text', kind: 'text', options: ['Sign up', 'Join the list', 'Count me in'] },
      { key: 'button_url', label: 'Sign-up form link', kind: 'url' },
    ],
    defaults: { heading: 'Stay in the loop', blurb: 'One email a week, at most. Usually fewer.', button_label: 'Sign up', button_url: '' },
    render: (p, c) => `<div class="signupbox"><h3 class="sign"${c.f('heading')}>${esc(p.heading)}</h3>${body(c, c.f('blurb', 1), p.blurb)}${btn(c, p.button_label, p.button_url, '', c.f('button_label'))}</div>`,
  },
  button: {
    label: 'Button',
    atom: true,
    help: 'A single call-to-action button.',
    fields: [
      { key: 'label', label: 'Button text', kind: 'text', options: ['Volunteer with us', 'Join the chapter', 'Download the voter guide', 'Learn more'] },
      { key: 'url', label: 'Link', kind: 'url' },
      { key: 'style', label: 'Color', kind: 'select', options: ['Navy', 'Chapter color', 'Paper'] },
    ],
    defaults: { label: 'Learn more', url: '/', style: 'Navy' },
    render: (p, c) => btn(c, p.label, p.url, p.style === 'Chapter color' ? 'ch' : p.style === 'Paper' ? 'paper' : '', c.f('label')),
  },
  socials: {
    label: 'Social links',
    atom: true,
    help: 'Links to the chapter social accounts. Handles come from Site settings.',
    fields: [],
    defaults: {},
    render: (p, c) => socialLinks(c.site) || (c.edit ? '<p class="muted">Add social handles in Site settings.</p>' : ''),
  },
  columns: {
    label: 'Columns',
    container: true,
    help: 'Put text, images, cards and buttons side by side. Pick a layout, then add blocks to each column.',
    fields: [{ key: 'layout', label: 'Layout', kind: 'select', options: Object.keys(LAYOUTS) }],
    defaults: { layout: 'halves', cols: [[{ id: 'a1', type: 'text', props: { heading: 'Who we are', body: 'Write something here.' } }], [{ id: 'a2', type: 'image', props: { src: '', alt: '', caption: 'Chapter meetup' } }]] },
    render: (p, c) => `<section class="wrap block"><div class="cols" data-layout="${esc(p.layout)}" style="grid-template-columns:${(LAYOUTS[p.layout] || LAYOUTS.halves).join(' ')}">${(p.cols || []).map((col, ci) => `<div class="scol" data-col="${ci}">${col.map((a, k) => c.atom(a, ci, k)).join('') || (c.edit ? '<p class="muted emptycol">Empty column</p>' : '')}</div>`).join('')}</div></section>`,
  },
  cta: {
    label: 'Join us band',
    help: 'Full-width band with a button (sign up, donate, join).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['Join us.', 'Get involved.', 'Pitch in.'] },
      { key: 'body', label: 'Text', kind: 'textarea', options: ['It is free. You will get invites, a newsletter, and a say in what we fight for next.', 'Our chapter runs on volunteers. **Pitch in** wherever you can.'] },
      { key: 'button_label', label: 'Button text', kind: 'text', options: ['Sign me up', 'Join the chapter', 'Contact us'] },
      { key: 'button_url', label: 'Button link', kind: 'url' },
    ],
    defaults: { heading: 'Join us.', body: 'It is free. You will get invites, a newsletter, and a say in what we fight for next.', button_label: 'Sign me up', button_url: '/about' },
    render: (p, c) => `<section class="band navy joinband"><div class="wrap"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('body', 1), p.body)}${btn(c, p.button_label, p.button_url, 'ch', c.f('button_label'))}</div></section>`,
  },
  events_list: {
    label: 'Events (flyers)',
    help: 'Upcoming events as tear-off flyers. Fields mirror Luma so a later sync can fill this in.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['Show up.', 'Upcoming events', 'Next up', 'Come hang out'] },
      { key: 'luma_calendar_url', label: 'Luma calendar URL (for future sync)', kind: 'url' },
      { key: 'show_past', label: 'Show past events?', kind: 'select', options: ['No', 'Yes'] },
      { key: 'limit', label: 'Max events to show (blank = all)', kind: 'text', panel: true },
      {
        key: 'events', label: 'Events', kind: 'list', itemLabel: 'title', fields: [
          { key: 'id', label: 'ID (Luma event id, optional)', kind: 'text', panel: true },
          { key: 'title', label: 'Title', kind: 'text', options: ['Monthly meetup', 'Book club', 'Canvass', 'Voter registration drive', 'Happy hour'] },
          { key: 'start', label: 'Starts (local time)', kind: 'date' },
          { key: 'end', label: 'Ends (local time)', kind: 'date' },
          { key: 'location', label: 'Location', kind: 'text' },
          { key: 'url', label: 'RSVP / Luma link', kind: 'url' },
          { key: 'cover_image', label: 'Cover image URL', kind: 'url' },
          { key: 'description', label: 'Description', kind: 'textarea', options: ['Casual drinks and conversation. New faces welcome, no experience needed.', 'Knock doors for our endorsed candidates. We will train you first.', 'Help your neighbors get registered before the deadline.', 'Part of our read-through. New faces welcome, skimmers too.'] },
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
    render: (p, c) => {
      const cutoff = new Date(Date.now() - 864e5).toISOString().slice(0, 16); // keep today's events visible
      const list = view(c, p.events || [], (a) => {
        let r = a.sort((x, y) => String(x.x.start).localeCompare(String(y.x.start)));
        if (p.show_past !== 'Yes') r = r.filter((e) => !e.x.start || String(e.x.start) >= cutoff);
        return parseInt(p.limit, 10) > 0 ? r.slice(0, parseInt(p.limit, 10)) : r;
      });
      const tabs = '<span class="tab cap">RSVP</span>'.repeat(6);
      return `<section class="band navy"><div class="wrap"><div class="bandhead"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${p.luma_calendar_url ? `<a href="${safeUrl(p.luma_calendar_url)}">Full calendar on Luma</a>` : ''}</div><div class="flyers">${list.map(({ x: e, j }, i) => `<article class="flyer" data-item="${j}" style="--rot:${ROT[i % 3]}"><span class="pin" aria-hidden="true"></span>${img(e.cover_image, e.title)}<div class="fbody"><p class="cap meta">${esc(fmtDate(e.start)) || (c.edit ? 'Pick a date in the side panel' : '')}</p><h3 class="sign"${c.fi('events', j, 'title')}>${esc(e.title)}</h3>${body(c, c.fi('events', j, 'description', 1), e.description)}<p${c.fi('events', j, 'location')}>${esc(e.location)}</p></div>${e.url || c.edit ? `<a class="tear" href="${safeUrl(e.url)}" aria-label="RSVP for ${esc(e.title)}">${tabs}</a>` : ''}</article>`).join('') || '<p class="onnavy">No events scheduled yet. Check back soon!</p>'}</div></div></section>`;
    },
  },
  endorsements_list: {
    label: 'Endorsements (ballot)',
    help: 'Candidates and measures the chapter endorses, as a sample ballot.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['Our slate', 'Who we endorse', 'How we are voting'] },
      { key: 'intro', label: 'Short intro (e.g. election date)', kind: 'textarea', options: ['Election Day is coming. Here is who we are voting for, and why.', 'Every endorsement was chosen by a member vote after a questionnaire and interview.'] },
      { key: 'ballot_title', label: 'Ballot header', kind: 'text', options: ['Sample ballot', 'Our endorsements'] },
      {
        key: 'items', label: 'Endorsements', kind: 'list', itemLabel: 'name', fields: [
          { key: 'name', label: 'Candidate / measure', kind: 'text' },
          { key: 'office', label: 'Office / race', kind: 'text', options: ['City Council', 'Mayor', 'State House', 'State Senate', 'County Commission', 'School Board', 'Ballot measure'] },
          { key: 'election', label: 'Election (e.g. Nov 2026)', kind: 'text' },
          { key: 'photo', label: 'Photo URL', kind: 'url' },
          { key: 'statement', label: 'Why we endorse', kind: 'textarea', options: ['Backed by our members after a questionnaire, an interview, and a chapter vote.', 'Has led on zoning reform and transit funding.', 'Will legalize more homes and keep the city affordable.'] },
          { key: 'url', label: 'Campaign link', kind: 'url' },
        ],
      },
    ],
    defaults: { heading: 'Our slate', intro: 'Election Day is coming. Here is who we are voting for, and why.', ballot_title: 'Sample ballot', items: [] },
    presets: [
      { label: 'Candidate', item: { name: '[Candidate name]', office: '[Office]', election: 'Nov 2026', photo: '', statement: 'Backed by our members after a questionnaire, an interview, and a chapter vote.', url: '' } },
      { label: 'Ballot measure', item: { name: 'Yes on [Measure]', office: 'Ballot measure', election: 'Nov 2026', photo: '', statement: 'Allows more homes near transit.', url: '' } },
    ],
    render: (p, c) => `<section class="band tint"><div class="wrap split2"><div class="slateintro"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('intro', 1), p.intro)}</div><div class="ballot"><p class="cap ballothead"${c.f('ballot_title')}>${esc(p.ballot_title)}</p>${(p.items || []).map((i, j) => `<div class="ballotrow" data-item="${j}"><span class="oval" aria-hidden="true"></span><div><p class="cap meta2"><span${c.fi('items', j, 'office')}>${esc(i.office)}</span>${i.election || c.edit ? ' · ' : ''}<span${c.fi('items', j, 'election')}>${esc(i.election)}</span></p><p class="cand">${i.url && !c.edit ? `<a href="${safeUrl(i.url)}">${esc(i.name)}</a>` : `<span${c.fi('items', j, 'name')}>${esc(i.name)}</span>`}</p><div class="why2">${body(c, c.fi('items', j, 'statement', 1), i.statement)}</div></div></div>`).join('') || '<p class="ballotrow">No endorsements yet.</p>'}</div></div></section>`,
  },
  issue_cards: {
    label: 'Issue stickers',
    help: 'Policy priorities, one sticker each.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ["What we're fighting for", 'Where we stand', 'Our priorities'] },
      {
        key: 'items', label: 'Issues', kind: 'list', itemLabel: 'title', fields: [
          { key: 'title', label: 'Issue', kind: 'text' },
          { key: 'summary', label: 'Summary', kind: 'textarea' },
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
    render: (p, c) => `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="stickers">${(p.items || []).map((i, k) => { const tag = i.url && !c.edit ? 'a' : 'div'; return `<${tag} class="sticker v${k % 4}" data-item="${k}" style="--rot:${ROT[(k + 1) % 3]}"${tag === 'a' ? ` href="${safeUrl(i.url)}"` : ''}><span class="sign"${c.fi('items', k, 'title')}>${esc(i.title)}</span><span class="why"${c.fi('items', k, 'summary', 1)}>${esc(i.summary)}</span></${tag}>`; }).join('') || '<p class="muted">Issues coming soon.</p>'}</div></section>`,
  },
  posts_list: {
    label: 'News & media',
    help: 'Articles, videos and podcasts. Items of type Press show as newspaper clippings on the side.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['News & media', 'In the news', 'News from the field'] },
      {
        key: 'posts', label: 'Posts', kind: 'list', itemLabel: 'title', fields: [
          { key: 'title', label: 'Title', kind: 'text' },
          { key: 'date', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'select', options: ['Post', 'Press', 'Video', 'Podcast'] },
          { key: 'image', label: 'Image URL', kind: 'url' },
          { key: 'excerpt', label: 'Body / excerpt', kind: 'textarea' },
          { key: 'url', label: 'Link (optional, e.g. video or article)', kind: 'url' },
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
    render: (p, c) => {
      const all = view(c, p.posts || [], (a) => a.sort((x, y) => String(y.x.date).localeCompare(String(x.x.date))));
      const press = all.filter(({ x }) => x.type === 'Press'), rest = all.filter(({ x }) => x.type !== 'Press');
      const row = ({ x, j }) => `<article class="post" data-item="${j}"><div class="date" aria-hidden="true"><div class="cap">${esc(parseDate(x.date).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).replace('Invalid Date', ''))}</div><div class="sign">${isNaN(parseDate(x.date)) ? '' : parseDate(x.date).getUTCDate()}</div></div><div>${img(x.image, x.title)}<p class="cap meta">${esc(x.type || 'Post')}${x.date ? ' · ' + esc(shortDate(x.date)) : ''}</p><h3${c.fi('posts', j, 'title')}>${x.url && !c.edit ? `<a href="${safeUrl(x.url)}">${esc(x.title)}</a>` : esc(x.title)}</h3>${body(c, c.fi('posts', j, 'excerpt', 1), x.excerpt)}</div></article>`;
      const clip = ({ x, j }, i) => `<div class="clipwrap" data-item="${j}" style="transform:rotate(${ROT[i % 3]})"><article class="clip"><p class="outlet">${esc(x.type)}${x.date ? ' · ' + esc(shortDate(x.date)) : ''}</p><h3${c.fi('posts', j, 'title')}>${x.url && !c.edit ? `<a href="${safeUrl(x.url)}">${esc(x.title)}</a>` : esc(x.title)}</h3>${body(c, c.fi('posts', j, 'excerpt', 1), x.excerpt)}</article></div>`;
      return `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="split"><div class="rows">${rest.map(row).join('') || (press.length ? '' : '<p class="muted">Nothing posted yet.</p>')}</div>${press.length ? `<aside class="clips"><h3 class="cap">Clippings</h3>${press.map(clip).join('')}</aside>` : ''}</div></section>`;
    },
  },
  people_grid: {
    label: 'People',
    help: 'Chapter leads and officers.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', options: ['Our team', 'Chapter leads', 'Meet the organizers'] },
      {
        key: 'people', label: 'People', kind: 'list', itemLabel: 'name', fields: [
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'role', label: 'Role', kind: 'text', options: ['Chapter lead', 'Events lead', 'Communications lead', 'Treasurer', 'Volunteer coordinator'] },
          { key: 'photo', label: 'Photo URL', kind: 'url' },
          { key: 'bio', label: 'Short bio', kind: 'textarea', options: ['Organizing with the chapter since the beginning.', 'Keeps the meetups running and the calendar full.'] },
        ],
      },
    ],
    defaults: { heading: 'Our team', people: [] },
    presets: [
      { label: 'Chapter lead', item: { name: '[Name]', role: 'Chapter lead', photo: '', bio: 'Organizing with the chapter since the beginning.' } },
      { label: 'Events lead', item: { name: '[Name]', role: 'Events lead', photo: '', bio: 'Keeps the meetups running and the calendar full.' } },
      { label: 'Communications lead', item: { name: '[Name]', role: 'Communications lead', photo: '', bio: 'Runs our newsletter and social accounts.' } },
    ],
    render: (p, c) => `<section class="wrap block"><h2 class="sign"${c.f('heading')}>${esc(p.heading)}</h2><div class="grid">${(p.people || []).map((x, j) => `<article class="card" data-item="${j}">${img(x.photo, x.name)}<div class="pad"><h3${c.fi('people', j, 'name')}>${esc(x.name)}</h3><p class="meta cap"${c.fi('people', j, 'role')}>${esc(x.role)}</p>${body(c, c.fi('people', j, 'bio', 1), x.bio)}</div></article>`).join('')}</div></section>`,
  },
};

const defaultsFor = (type) => JSON.parse(JSON.stringify(blocks[type].defaults));

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

function validateBlocks(list) {
  if (!Array.isArray(list) || list.length > 100) throw new Error('blocks must be an array (max 100)');
  return list.map((b, i) => {
    if (!b || !blocks[b.type]) throw new Error(`unknown block type at position ${i + 1}`);
    const def = blocks[b.type], props = clean(def.fields, b.props);
    if (def.container) {
      if (!LAYOUTS[props.layout]) props.layout = 'halves';
      const n = LAYOUTS[props.layout].length, cols = Array.isArray(b.props?.cols) ? b.props.cols : [];
      props.cols = Array.from({ length: n }, (_, ci) => (Array.isArray(cols[ci]) ? cols[ci] : []).slice(0, 30).map((a, k) => {
        if (!a || !ATOMS.includes(a.type)) throw new Error(`unknown block type in column ${ci + 1}`);
        return { id: String(a.id || `a${Date.now().toString(36)}${ci}${k}`).replace(/[^\w-]/g, '').slice(0, 40), type: a.type, props: clean(blocks[a.type].fields, a.props) };
      }));
      // blocks from columns that no longer exist move into the last column
      cols.slice(n).flat().forEach((a) => { if (a && ATOMS.includes(a.type) && props.cols[n - 1].length < 30) props.cols[n - 1].push({ id: String(a.id || '').replace(/[^\w-]/g, '').slice(0, 40) || `a${Date.now().toString(36)}`, type: a.type, props: clean(blocks[a.type].fields, a.props) }); });
    }
    return { id: String(b.id || `b${Date.now().toString(36)}${i}`).replace(/[^\w-]/g, '').slice(0, 40), type: b.type, props };
  });
}

// ctx: { edit, i, site } where i is the block's index on the page (used in data-f paths).
function renderBlock(b, { edit = false, i = 0, site = {}, prefix, nested = false } = {}) {
  const def = blocks[b.type];
  if (!def) return '';
  const pre = prefix ?? String(i);
  const ph = (k) => esc(String(k).replace(/_/g, ' '));
  const c = {
    edit,
    site,
    f: (key, ml) => (edit ? ` data-f="${pre}.${key}" data-ph="${ph(key)}"${ml ? ' data-ml="1"' : ''}` : ''),
    fi: (list, j, key, ml) => (edit ? ` data-f="${pre}.${list}.${j}.${key}" data-ph="${ph(key)}"${ml ? ' data-ml="1"' : ''}` : ''),
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

module.exports = { LAYOUTS, LAYOUT_NAMES, ATOMS, socialLinks, SOCIALS, blocks, esc, safeUrl, paras, defaultsFor, validateBlocks, renderBlock, schema };
