'use strict';
// Shared chapter collections (C1): events, posts, people, endorsements and issues are entered once per chapter and
// shown by any number of sections (the "view" blocks in lib/blocks.js), each item with its own page and clean link
// (C2), like /events/zoning-hearing. Saved sections (B3) are a collection too, without public pages.
// Each entry is the whole contract for a collection, like a block entry:
//   label, one        plural and singular names leads see
//   path              URL prefix of the item pages (/events/<id>); null for no public page
//   feature           the feature switch (T7) that turns the collection on or off for a chapter
//   fields            the item's fields (kinds and options in lib/fields.js); titleKey names the title field
//   body              items can also hold sections below their fields (true unless false)
//   sort              default order; past(item, now) for items that are over (R2)
//   detail(item, c)   the top of the item's page; c.f(key) marks editable text like a block's c.f
//   related(item)     sections shown under the item's page (an issue lists what is tagged with it, C3)
//   after(item, c)    HTML after the body (a person's contact form)
const { esc, safeUrl, fmtDate, shortDate, addHours } = require('./text');
const { img, body, btn, video, mapLink, contactForm } = require('./parts');

const ISSUE_TAGS = { key: 'issues', label: 'Issues', kind: 'tags', col: 'issues', hint: 'Tag the issues this is about. Each issue page lists everything tagged with it.' };
const ORDER = { key: 'order', label: 'Order', kind: 'text', panel: true, max: 4, hint: 'Optional number. Lower numbers come first; the rest follow by name.' };
const byOrder = (key) => (a, b) => (parseFloat(a.order) || 999) - (parseFloat(b.order) || 999) || String(a[key]).localeCompare(String(b[key]));
const byDateDesc = (key) => (a, b) => String(b[key]).localeCompare(String(a[key]));

// Shared pieces of item pages.
const back = (col, label) => `<p class="cap back"><a href="/${col.path}">← ${esc(label)}</a></p>`;
function tagLinks(item, c) {
  const all = c.data?.items?.issues || [];
  const tags = (item.issues || []).map((id) => all.find((x) => x.id === id)).filter(Boolean);
  return tags.length ? `<p class="tags cap">${tags.map((t) => `<a href="/issues/${esc(t.id)}">${esc(t.title)}</a>`).join('')}</p>` : '';
}
const when = (start, end) => {
  const s = fmtDate(start);
  if (!s) return '';
  if (!end) return s;
  return end.slice(0, 10) === String(start).slice(0, 10) ? `${s} to ${fmtDate(end).replace(/^.*, /, '')}` : `${s} to ${fmtDate(end)}`;
};
const year = (d) => String(d || '').slice(0, 4);

const collections = {
  events: {
    label: 'Events', one: 'event', path: 'events', feature: 'events',
    help: 'Meetups, canvasses and hearings. Every Events section shows them, and each gets its own page.',
    titleKey: 'title', dateKey: 'start', imageKey: 'cover_image', summaryKey: 'description',
    fields: [
      { key: 'title', label: 'Event name', kind: 'text', max: 80, required: true, options: ['Monthly meetup', 'Book club', 'Canvass', 'Voter registration drive', 'Happy hour'] },
      { key: 'start', label: 'Starts', kind: 'date', required: true, hint: 'Local time.' },
      { key: 'end', label: 'Ends', kind: 'date', hint: 'Optional. Local time.' },
      { key: 'location', label: 'Location', kind: 'text', max: 80 },
      { key: 'address', label: 'Street address', kind: 'text', panel: true, max: 160, hint: 'Optional. Adds an "Open in maps" link.' },
      { key: 'url', label: 'RSVP link', kind: 'url', hint: 'Usually the Luma event page.' },
      { key: 'cover_image', label: 'Cover image', kind: 'image' },
      { key: 'description', label: 'Short description', kind: 'textarea', rich: true, max: 300, options: ['Casual drinks and conversation. New faces welcome, no experience needed.', 'Knock doors for our endorsed candidates. We will train you first.', 'Help your neighbors get registered before the deadline.'] },
      ISSUE_TAGS,
      { key: 'luma_id', label: 'Luma event ID', kind: 'text', panel: true, hint: 'Optional. Filled in by the Luma sync later.' },
    ],
    defaults: { title: 'New event', start: '', end: '', location: '', address: '', url: '', cover_image: '', description: '', issues: [], luma_id: '' },
    sort: (a, b) => String(a.start).localeCompare(String(b.start)),
    past: (e, now) => !!e.start && (e.end || addHours(e.start, 3)) < now,
    archive: { slug: 'archive', title: 'Past events' },
    detail: (e, c) => {
      const past = collections.events.past(e, c.data.now);
      return `<section class="wrap block detail">${back(collections.events, 'All events')}${past ? '<p class="note">This event has passed.</p>' : ''}
<h1 class="sign"${c.f('title')}>${esc(e.title)}</h1><p class="cap meta">${esc(when(e.start, e.end)) || (c.edit ? 'Pick a date in the side panel' : '')}</p>
${e.location || c.edit ? `<p class="where"><span${c.f('location')}>${esc(e.location)}</span>${e.address ? ` · <a href="${esc(mapLink(e.address))}">Open in maps</a>` : ''}</p>` : ''}
${img(e.cover_image, e.title, 'cover')}${body(c, c.f('description'), e.description)}${!past && (e.url || c.edit) ? btn(c, 'RSVP', e.url, 'ch') : ''}${tagLinks(e, c)}</section>`;
    },
  },
  posts: {
    label: 'News and posts', one: 'post', path: 'news', feature: 'posts',
    help: 'Blog posts, press releases, press clippings, videos and podcasts. Every News section shows them.',
    titleKey: 'title', dateKey: 'date', imageKey: 'image', summaryKey: 'excerpt',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', max: 100, required: true },
      { key: 'type', label: 'Type', kind: 'select', options: ['Post', 'Press release', 'Press', 'Video', 'Podcast'], hint: 'Press is coverage elsewhere (shown with the outlet name); Video and Podcast link to the recording.' },
      { key: 'date', label: 'Date', kind: 'date', required: true },
      { key: 'author', label: 'Author', kind: 'text', max: 60, options: [] },
      { key: 'image', label: 'Featured image', kind: 'image' },
      { key: 'excerpt', label: 'Excerpt', kind: 'textarea', rich: true, max: 400, hint: 'A sentence or two, shown in lists and link previews.' },
      { key: 'outlet', label: 'Outlet', kind: 'text', panel: true, max: 60, hint: 'For press clippings: the paper, station or site.' },
      { key: 'url', label: 'Link', kind: 'url', hint: 'For press, video and podcasts: the article, video or episode. Video links from YouTube, Vimeo or Loom play on the page.' },
      ISSUE_TAGS,
    ],
    defaults: { title: 'New post', type: 'Post', date: '', author: '', image: '', excerpt: '', outlet: '', url: '', issues: [] },
    sort: byDateDesc('date'),
    detail: (x, c) => `<section class="wrap block detail">${back(collections.posts, 'All news')}
<p class="cap meta">${esc(x.type === 'Press' && x.outlet ? x.outlet : x.type)}${x.date ? ' · ' + esc(shortDate(x.date)) : ''}${x.author || c.edit ? ` · <span${c.f('author')}>${esc(x.author)}</span>` : ''}</p>
<h1 class="sign"${c.f('title')}>${esc(x.title)}</h1>${x.type === 'Video' ? video(x.url, x.title) : img(x.image, x.title, 'cover')}<div class="lede">${body(c, c.f('excerpt'), x.excerpt)}</div>
${x.url && x.type === 'Press' ? btn(c, `Read it${x.outlet ? ' at ' + x.outlet : ''}`, x.url) : x.url && x.type === 'Podcast' ? btn(c, 'Listen to the episode', x.url) : ''}${tagLinks(x, c)}</section>`,
  },
  people: {
    label: 'People', one: 'person', path: 'people', feature: 'people',
    help: 'Chapter leads and officers with their roles and terms. Past leads move to the alumni list on their own.',
    titleKey: 'name', dateKey: 'term_start', imageKey: 'photo', summaryKey: 'bio',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', max: 60, required: true },
      { key: 'role', label: 'Role', kind: 'text', max: 40, options: ['Chapter lead', 'Co-lead', 'Events lead', 'Communications lead', 'Treasurer', 'Volunteer coordinator'] },
      { key: 'photo', label: 'Photo', kind: 'image' },
      { key: 'bio', label: 'Short bio', kind: 'textarea', rich: true, max: 400 },
      { key: 'term_start', label: 'Started', kind: 'date', dateOnly: true },
      { key: 'term_end', label: 'Stepped down', kind: 'date', dateOnly: true, hint: 'Leave empty while they are on the team. After this day they show in the alumni list.' },
      { key: 'email', label: 'Email for the contact form', kind: 'text', panel: true, private: true, max: 120, hint: 'Private. Messages from their contact form go here; the address is never shown on the site.' },
      ORDER,
    ],
    defaults: { name: 'New person', role: '', photo: '', bio: '', term_start: '', term_end: '', email: '', order: '' },
    sort: byOrder('name'),
    past: (p, now) => !!p.term_end && p.term_end < now.slice(0, 10),
    detail: (p, c) => {
      const alum = collections.people.past(p, c.data.now);
      const term = p.term_start ? `${year(p.term_start)}${p.term_end ? '–' + year(p.term_end) : ' to now'}` : '';
      return `<section class="wrap block detail person">${back(collections.people, 'Our team')}${img(p.photo, p.name, 'portrait')}
<h1 class="sign"${c.f('name')}>${esc(p.name)}</h1><p class="cap meta"><span${c.f('role')}>${esc(p.role)}</span>${term ? ' · ' + esc(term) : ''}${alum ? ' · Alumni' : ''}</p>${body(c, c.f('bio'), p.bio)}</section>`;
    },
    after: (p, c) => (p.email && c.data.features?.contact !== false && !collections.people.past(p, c.data.now) ? `<section class="wrap block">${contactForm('person:' + p.id, { heading: `Send ${p.name.split(' ')[0]} a message`, edit: c.edit })}</section>` : ''),
  },
  endorsements: {
    label: 'Endorsements', one: 'endorsement', path: 'endorsements', feature: 'endorsements',
    help: 'Candidates and ballot measures. After the election they move to the results list on their own.',
    titleKey: 'name', dateKey: 'election_date', imageKey: 'photo', summaryKey: 'statement',
    fields: [
      { key: 'name', label: 'Candidate or measure', kind: 'text', max: 60, required: true },
      { key: 'office', label: 'Office or race', kind: 'text', max: 60, options: ['City Council', 'Mayor', 'State House', 'State Senate', 'County Commission', 'School Board', 'Ballot measure'] },
      { key: 'election', label: 'Election', kind: 'text', max: 30, hint: 'As people say it, like "Nov 2026".' },
      { key: 'election_date', label: 'Election day', kind: 'date', dateOnly: true, hint: 'After this day the endorsement moves to the results list.' },
      { key: 'result', label: 'Result', kind: 'select', options: ['Not decided yet', 'Won', 'Lost', 'Passed', 'Failed'] },
      { key: 'photo', label: 'Photo', kind: 'image' },
      { key: 'statement', label: 'Why we endorse', kind: 'textarea', rich: true, max: 400, options: ['Backed by our members after a questionnaire, an interview, and a chapter vote.', 'Has led on zoning reform and transit funding.'] },
      { key: 'url', label: 'Campaign link', kind: 'url' },
      ISSUE_TAGS,
    ],
    defaults: { name: 'New endorsement', office: '', election: '', election_date: '', result: 'Not decided yet', photo: '', statement: '', url: '', issues: [] },
    sort: (a, b) => String(a.election_date || '9').localeCompare(String(b.election_date || '9')) || String(a.name).localeCompare(String(b.name)),
    past: (x, now) => (!!x.election_date && x.election_date < now.slice(0, 10)) || (!!x.result && x.result !== 'Not decided yet'),
    archive: { slug: 'results', title: 'Past endorsements and results' },
    detail: (x, c) => `<section class="wrap block detail">${back(collections.endorsements, 'All endorsements')}${img(x.photo, x.name, 'portrait')}
<p class="cap meta"><span${c.f('office')}>${esc(x.office)}</span>${x.election || c.edit ? ' · ' : ''}<span${c.f('election')}>${esc(x.election)}</span></p><h1 class="sign"${c.f('name')}>${esc(x.name)}</h1>
${x.result && x.result !== 'Not decided yet' ? `<p class="result r-${esc(x.result.toLowerCase())} cap">${esc(x.result)}</p>` : ''}${body(c, c.f('statement'), x.statement)}${x.url && !c.edit ? `<p><a href="${safeUrl(x.url)}">Campaign website</a></p>` : ''}${tagLinks(x, c)}</section>`,
  },
  issues: {
    label: 'Issues', one: 'issue', path: 'issues', feature: 'issues',
    help: 'Policy priorities. Each issue page lists the events, posts and endorsements tagged with it.',
    titleKey: 'title', imageKey: 'image', summaryKey: 'summary',
    fields: [
      { key: 'title', label: 'Issue', kind: 'text', max: 40, required: true },
      { key: 'summary', label: 'Summary', kind: 'textarea', max: 160, hint: 'One sentence.' },
      { key: 'image', label: 'Image', kind: 'image' },
      ORDER,
    ],
    defaults: { title: 'New issue', summary: '', image: '', order: '' },
    sort: byOrder('title'),
    detail: (x, c) => `<section class="wrap block detail">${back(collections.issues, 'All issues')}<h1 class="sign"${c.f('title')}>${esc(x.title)}</h1><p class="lede"${c.f('summary')}>${esc(x.summary)}</p>${img(x.image, x.title, 'cover')}</section>`,
    related: (x) => [
      { type: 'events_list', props: { heading: 'Upcoming events', show: 'Upcoming', issue: x.id, if_empty: 'Hide this section' } },
      { type: 'posts_list', props: { heading: 'News', show: 'All', issue: x.id, limit: '6', if_empty: 'Hide this section' } },
      { type: 'endorsements_list', props: { heading: 'Endorsements', ballot_title: 'Our endorsements', show: 'All', issue: x.id, if_empty: 'Hide this section' } },
    ],
  },
  sections: {
    label: 'Saved sections', one: 'saved section', path: null, feature: null,
    help: 'Sections you reuse on several pages. Edit one once and every page that uses it updates.',
    titleKey: 'title',
    fields: [{ key: 'title', label: 'Name', kind: 'text', max: 60, required: true, panel: true, hint: 'Only editors see this name.' }],
    defaults: { title: 'Saved section' },
    sort: (a, b) => String(a.title).localeCompare(String(b.title)),
  },
};
const COLS = Object.keys(collections);
const titleOf = (col, item) => String(item?.[collections[col]?.titleKey] ?? '') || 'Untitled';
const itemPath = (col, id) => (collections[col]?.path ? `/${collections[col].path}/${id}` : '');
const colByPath = (prefix) => COLS.find((k) => collections[k].path === prefix) || null;
const isPast = (col, item, now) => !!collections[col].past?.(item, now);

module.exports = { collections, COLS, titleOf, itemPath, colByPath, isPast, when };
