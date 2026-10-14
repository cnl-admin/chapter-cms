'use strict';
// Page templates (B2): starting points for the pages and posts chapters make again and again. Each one is a set of
// sections plus, for collection items, starting field values. Text in [brackets] is for the lead to replace; the
// pre-publish checks won't let a [placeholder] go live.
//   kind     'page', or the collection the template creates an item in (lib/collections.js)
//   fields   starting values for the item's fields
const { blocks, defaultsFor } = require('./blocks');

const blk = (type, props = {}) => ({ type, ...((blocks[type].version || 1) > 1 ? { v: blocks[type].version } : {}), props: { ...defaultsFor(type), ...props } });
const faq = (pairs) => pairs.map(([q, a]) => ({ q, a }));

const templates = {
  campaign: {
    label: 'Campaign', kind: 'page',
    help: 'A push for one cause: what you want, why it matters and how to help.',
    blocks: () => [
      blk('hero', { heading: '[Campaign\nheadline]', subheading: '[Chapter name] campaign', intro: '[One sentence: what we want, and by when.]', button_label: 'Sign the petition', button_url: '', button2_label: '', button2_url: '' }),
      blk('text', { heading: 'Why it matters', body: '[Two or three short paragraphs on the problem and the fix.]' }),
      blk('stats', { heading: 'The numbers', items: [{ number: '[0]', label: '[what it counts]' }, { number: '[0]', label: '[what it counts]' }] }),
      blk('faq', { heading: 'Questions', items: faq([['[A question people ask]', '[The answer]']]) }),
      blk('cta', { heading: 'Pitch in.', body: 'Sign up and we will tell you how to help next.', button_label: 'Sign me up', button_url: '' }),
    ],
  },
  volunteer_drive: {
    label: 'Volunteer drive', kind: 'page',
    help: 'Recruit people for shifts: what they will do, when, and a way to ask questions.',
    blocks: () => [
      blk('hero', { heading: 'Volunteer\nwith us.', subheading: '[Chapter name]', intro: '[One sentence on what volunteers do and why it matters.]', button_label: 'Sign up for a shift', button_url: '', button2_label: '', button2_url: '' }),
      blk('text', { heading: 'What you will do', body: '- [Task one]\n- [Task two]\n- [Task three]\n\nNo experience needed. We train everyone first.' }),
      blk('events_list', { heading: 'Upcoming shifts', show: 'Upcoming', if_empty: 'Show a sign-up box', empty_text: 'New shifts are posted every week. Join the list to hear first.' }),
      blk('faq', { heading: 'Questions', items: faq([['Do I need any experience?', 'No. We pair new volunteers with someone who has done it before.'], ['How long is a shift?', '[Two to three hours.]']]) }),
      blk('contact_form', { heading: 'Questions before you sign up?' }),
    ],
  },
  voter_guide: {
    label: 'Voter guide', kind: 'page',
    help: 'Who and what to vote for, how to vote, and where.',
    blocks: () => [
      blk('hero', { heading: 'Our voter\nguide.', subheading: '[Election name and date]', intro: '[One sentence on how the chapter chose these picks.]', button_label: 'Check your registration', button_url: 'https://vote.org', button2_label: '', button2_url: '' }),
      blk('table', { heading: 'Our picks', columns: '3', h1: 'Race', h2: 'Our pick', h3: 'Why', rows: [{ c1: '[Race]', c2: '[Candidate or Yes/No]', c3: '[One line on why]', c4: '' }], note: '[Polls are open 7am to 8pm.]' }),
      blk('endorsements_list', { heading: 'Our slate', show: 'Current' }),
      blk('map', { heading: 'Where to vote', address: '', caption: '[Early voting location and hours]' }),
      blk('cta', { heading: 'Make a plan.', body: 'Tell three friends how you are voting.', button_label: 'Join the chapter', button_url: '' }),
    ],
  },
  event_recap: {
    label: 'Event recap', kind: 'posts',
    help: 'What happened at an event, with photos, a quote and the numbers.',
    fields: { type: 'Post', title: 'Recap: [event name]', excerpt: '[One sentence on what happened.]' },
    blocks: () => [
      blk('text', { heading: 'What happened', body: '[A few short paragraphs: who came, what you did, what is next.]' }),
      blk('gallery', { heading: 'Photos', images: [] }),
      blk('quote', { text: '[Something a member said]', name: '[Name]', role: '[Member since 20XX]' }),
      blk('stats', { heading: 'By the numbers', items: [{ number: '[0]', label: '[people came]' }] }),
      blk('cta', { heading: 'Come next time.', body: 'Join the list and we will invite you to the next one.', button_label: 'Join the list', button_url: '' }),
    ],
  },
  press_release: {
    label: 'Press release', kind: 'posts',
    help: 'An announcement for reporters, with the who, what, when and a contact.',
    fields: { type: 'Press release', title: '[Chapter name] [announces something]', excerpt: '[CITY, Date]: [One-sentence summary of the news.]' },
    blocks: () => [
      blk('text', { heading: '', body: '[The news in two or three short paragraphs. Lead with what happened and why it matters.]\n\n"[A quote from a chapter lead]," said [Name], [role].' }),
      blk('text', { heading: 'About the chapter', body: '[Chapter name] is the local chapter of Citizens for a New Liberalism, working for abundance, openness and government that works.' }),
      blk('text', { heading: 'Press contact', body: '[Name], [email or phone]' }),
    ],
  },
  endorsement: {
    label: 'Endorsement', kind: 'endorsements',
    help: 'A candidate or measure with the full questionnaire and why members chose them.',
    fields: { statement: '[Why we endorse, in two sentences.]' },
    blocks: () => [
      blk('quote', { text: '[A line from the candidate]', name: '[Candidate name]', role: '[Office]' }),
      blk('faq', { heading: 'Questionnaire', items: faq([['Will you vote to legalize more homes near transit?', '[Their answer]'], ['How will you make it faster to build?', '[Their answer]'], ['What will you do about transit service?', '[Their answer]']]) }),
      blk('text', { heading: 'How we decided', body: 'Members reviewed the questionnaire, interviewed the candidates and voted. [Add the vote count if you share it.]' }),
    ],
  },
  issue_explainer: {
    label: 'Issue explainer', kind: 'issues',
    help: 'The problem, the fix and the numbers behind one issue.',
    fields: { summary: '[One sentence: what we want.]' },
    blocks: () => [
      blk('text', { heading: 'The problem', body: '[What is wrong today, in plain words.]' }),
      blk('text', { heading: 'The fix', body: '[What we want changed, and who can change it.]' }),
      blk('stats', { heading: 'By the numbers', items: [{ number: '[0]', label: '[what it counts]' }] }),
      blk('faq', { heading: 'Common questions', items: faq([['[A question skeptics ask]', '[A short, friendly answer]']]) }),
    ],
  },
};
const templateList = () => Object.entries(templates).map(([id, t]) => ({ id, label: t.label, help: t.help, kind: t.kind }));

module.exports = { templates, templateList };
