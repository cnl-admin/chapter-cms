'use strict';
// Screens that open over the editor: add-a-section chooser (block gallery), content (pages and collections), page
// settings, publish and schedules, history, share links, the media library, messages, national settings, the
// editor's name.

async function afterSiteChange() {
  await refreshOverview();
  if (S.panel === 'settings') { const g = await api(`chapter/${S.chapter}/site`); S.site = g.site; S.siteRev = g.rev; S.sitePreview = S.site; drawPanel(); }
  preview();
}
function setMode(m) {
  S.mode = m;
  $('#viewBtn').textContent = m === 'view' ? 'Back to editing' : 'Preview';
  if (m !== 'edit') { S.sel = -1; S.foc = null; S.selAtom = null; }
  if (S.panel !== 'page') S.panel = 'page';
  drawPanel(); preview();
}

// ---------- add a section (B7): every block with what it is for, lists from shared content, saved sections, columns
function chooseBlock(at) {
  S.insertAt = at;
  const feats = S.overview?.features || {}, ok = ([, v]) => !v.hidden && !(v.feature && feats[v.feature] === false);
  const all = Object.entries(S.schema).filter(ok);
  const secs = all.filter(([, v]) => !v.atom && !v.container && !v.view), views = all.filter(([, v]) => v.view), singles = all.filter(([, v]) => v.atom);
  const inSection = S.kind === 'item' && S.col === 'sections';
  const saved = inSection ? [] : (S.lists.sections || []);
  const card = ([k, v]) => el('button', { class: 'blockcard', onclick: () => { m.close(); addBlock(k, at); } }, el('b', {}, v.label), el('span', {}, v.help));
  const m = modal('Add a section', [
    el('h3', {}, 'Sections'), el('div', { class: 'cards' }, secs.map(card)),
    views.length ? [el('h3', {}, 'Lists of your content'), el('p', { class: 'hint' }, 'Show events, news, people, issues or endorsements you enter once under Content. They stay up to date on their own.'), el('div', { class: 'cards' }, views.map(card))] : '',
    saved.length ? [el('h3', {}, 'Saved sections'), el('p', { class: 'hint' }, 'Sections your chapter reuses. Edit one once and every page that uses it updates.'),
      el('div', { class: 'cards' }, saved.map((x) => el('button', { class: 'blockcard', onclick: () => { m.close(); addSaved(x.id, at); } }, el('b', {}, x.title), el('span', {}, x.usedOn?.length ? `Used on ${x.usedOn.join(', ')}` : 'Not used yet'))))] : '',
    el('h3', {}, 'Single blocks'), el('p', { class: 'hint' }, 'These also fit inside columns.'), el('div', { class: 'cards' }, singles.map(card)),
    el('h3', {}, 'Columns'), el('p', { class: 'hint' }, 'Put text, images, cards and buttons side by side.'),
    el('div', { class: 'chips' }, Object.entries(S.layouts).map(([k, name]) => el('button', { onclick: () => { m.close(); addColumns(k, at); } }, name))),
    el('p', {}, el('button', { class: 'linkish', onclick: () => { m.close(); setMode('gallery'); } }, 'See every block filled with sample content →')),
  ], { wide: true });
}

// ---------- page settings (and an item's web address)
function pageSettings() {
  if (S.kind === 'item') return itemSettings();
  const p = S.overview.pages.find((x) => x.slug === S.slug) || {};
  const set = (k) => (v) => { record('type', 'page.' + k); S.page[k] = v; changed(); later(); };
  const slugIn = el('input', { type: 'text', value: S.slug, disabled: p.live, 'aria-label': 'Web address' });
  modal('Page settings', [
    fieldInput({ key: 'title', label: 'Page title', kind: 'text', max: 60, required: true, hint: 'Shown in the browser tab and search results.' }, S.page.title, set('title')),
    el('div', { class: 'field' }, el('label', {}, 'Web address'), el('div', { class: 'row nowrap' }, el('span', { class: 'mono' }, '/'), slugIn, p.live ? '' : sbtn('Change', async () => {
      const v = slugIn.value.trim().toLowerCase();
      try { if (!(await flush())) return; const r = await api(`chapter/${S.chapter}/page/${S.slug}/rename`, 'POST', { slug: v }); S.slug = r.slug; await afterSiteChange(); await loadPage(r.slug, { keepPlace: true }); toast('Web address changed'); } catch (e) { toast(e.message); }
    })), el('p', { class: 'hint' }, p.live ? "This page is published, so its address stays the same (links to it would break)." : 'Lowercase letters, numbers and dashes. You can change it until the page is first published.')),
    el('h3', {}, 'Search and sharing'),
    fieldInput({ key: 'seo_title', label: 'Title in search results', kind: 'text', max: 60, hint: 'Optional. Leave empty to use the page title and chapter name.' }, S.page.seo_title, set('seo_title')),
    fieldInput({ key: 'seo_description', label: 'Description in search results and link previews', kind: 'textarea', max: 160 }, S.page.seo_description, set('seo_description')),
    fieldInput({ key: 'seo_image', label: 'Image for link previews', kind: 'image', hint: 'Optional. Shown when someone shares the page on social media. Without one, the chapter’s share image is used.' }, S.page.seo_image, set('seo_image')),
    p.live && p.draft ? el('p', {}, sbtn('Undo all unpublished changes to this page', async () => {
      if (!(await confirmBox('Go back to the published version of this page? Your unpublished changes will be lost (they stay in History).', 'Go back', true))) return;
      await flush(); await api(`chapter/${S.chapter}/page/${S.slug}/discard`, 'POST', {}); $('#dlg').close(); await refreshOverview(); await loadPage(S.slug); toast('Back to the published version');
    }, 'danger')) : '',
  ]);
}
function itemSettings() {
  const cd = colDef(), idIn = el('input', { type: 'text', value: S.id, disabled: S.live, 'aria-label': 'Web address' });
  modal(`${cd.one[0].toUpperCase() + cd.one.slice(1)} settings`, [
    cd.path ? el('div', { class: 'field' }, el('label', {}, 'Web address'), el('div', { class: 'row nowrap' }, el('span', { class: 'mono' }, `/${cd.path}/`), idIn, S.live ? '' : sbtn('Change', async () => {
      try { if (!(await flush())) return; const r = await api(`chapter/${S.chapter}/${docPath()}/rename`, 'POST', { id: idIn.value.trim().toLowerCase() }); await loadLists([S.col]); await loadItem(r.col, r.id, { keepPlace: true }); $('#dlg').close(); toast('Web address changed'); } catch (e) { toast(e.message); }
    })), el('p', { class: 'hint' }, S.live ? 'Published, so the address stays the same (links to it would break).' : 'Lowercase letters, numbers and dashes. You can change it until it is first published.')) : '',
    el('p', { class: 'hint' }, `Search engines and link previews use the ${cd.one}’s own title, summary and image.`),
    el('div', { class: 'row' }, sbtn('Schedule…', () => scheduleDialog(`item:${S.col}/${S.id}`, docTitle())), sbtn('Share a preview link…', () => shareDialog()), sbtn('History…', () => historyDialog())),
    S.live && S.draft ? el('p', {}, sbtn(`Undo all unpublished changes to this ${cd.one}`, async () => {
      if (!(await confirmBox(`Go back to the published version? Your unpublished changes will be lost (they stay in History).`, 'Go back', true))) return;
      await flush(); await api(`chapter/${S.chapter}/${docPath()}/discard`, 'POST', {}); $('#dlg').close(); await refreshOverview(); await reloadDoc(); toast('Back to the published version');
    }, 'danger')) : '',
  ]);
}

// ---------- content (E6, C1): pages, and each shared collection, with what is live, drafts and the trash
const pagesScreen = () => contentScreen(S.kind === 'item' ? S.col : 'pages');
async function contentScreen(tab = 'pages') {
  if (!(await flush())) return;
  const [o] = await Promise.all([refreshOverview(), loadLists()]);
  const feats = o.features || {}, cols = Object.entries(S.collections).filter(([, c]) => !(c.feature && feats[c.feature] === false));
  if (tab !== 'pages' && !cols.some(([k]) => k === tab)) tab = 'pages';
  const tabs = el('div', { class: 'seg tabs', role: 'tablist' }, el('button', { class: tab === 'pages' ? 'on' : '', onclick: () => contentScreen('pages') }, `Pages (${o.pages.length})`),
    cols.map(([k, c]) => el('button', { class: tab === k ? 'on' : '', onclick: () => contentScreen(k) }, `${c.label} (${(S.lists[k] || []).length})`)));
  const off = Object.entries(S.collections).filter(([, c]) => c.feature && feats[c.feature] === false).map(([, c]) => c.label);
  const m = modal('Content', [tabs, tab === 'pages' ? pagesTab(o, () => m) : collectionTab(tab, o, () => m), off.length ? el('p', { class: 'hint' }, `${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} turned off for this chapter by national.`) : ''], { wide: true });
}
const chipsFor = (x) => [x.home ? el('span', { class: 'tag' }, 'Homepage') : '', x.live ? el('span', { class: 'tag ok' }, 'Live') : el('span', { class: 'tag warn' }, 'Not published'), x.live && x.draft ? el('span', { class: 'tag warn' }, 'Unpublished changes') : '',
  ...(x.scheduled || []).map((s) => el('span', { class: 'tag' }, `${s.action === 'publish' ? 'Publishes' : 'Unpublishes'} ${CMSText.shortDate(s.at)} ${s.at.slice(11)}`))];
function trashList(o, col, m) {
  const items = o.trash.filter((t) => (t.col || 'pages') === col);
  if (!items.length) return '';
  return [el('h3', {}, 'Recently deleted'), el('p', { class: 'hint' }, 'Kept for 30 days. Restoring brings it back as a draft.'),
    items.map((t) => el('div', { class: 'pagerow' }, el('div', { class: 'grow' }, el('b', {}, t.title), el('div', { class: 'hint' }, `Deleted by ${t.by} ${ago(t.at)}`)), sbtn('Restore', async () => {
      try { const r = await api(`chapter/${S.chapter}/trash/${t.id}/restore`, 'POST', {}); m().close(); await afterSiteChange(); toast('Restored as a draft'); if (r.col) { await loadLists([r.col]); loadItem(r.col, r.id); } else loadPage(r.slug); } catch (e) { toast(e.message); }
    })))];
}
function pagesTab(o, m) {
  const rowFor = (p) => {
    const chips = [...chipsFor(p), p.inMenu ? el('span', { class: 'tag' }, 'In menu') : el('span', { class: 'tag muted' }, 'Not in menu')];
    const doThen = (fn, msg) => async () => { try { await fn(); await afterSiteChange(); toast(msg); contentScreen('pages'); } catch (e) { toast(e.message); } };
    return el('div', { class: 'pagerow' + (S.kind === 'page' && p.slug === S.slug ? ' cur' : '') },
      el('div', { class: 'grow' }, el('button', { class: 'linkish big', onclick: () => { m().close(); loadPage(p.slug); } }, p.title), el('div', { class: 'mono small' }, p.home ? '/' : '/' + p.slug), el('div', { class: 'chips' }, chips),
        el('div', { class: 'hint' }, p.updated_at ? `Edited by ${p.updated_by || 'someone'} ${ago(p.updated_at)}` : p.published_at ? `Published ${ago(p.published_at)}` : '')),
      el('div', { class: 'actions' },
        sbtn('Open', () => { m().close(); loadPage(p.slug); }),
        sbtn('Rename', async () => { const t = await askText('Rename page', 'Page title', p.title); if (t) doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/rename`, 'POST', { title: t }), 'Renamed')().then(() => S.kind === 'page' && p.slug === S.slug && loadPage(S.slug, { keepPlace: true })); }),
        sbtn('Duplicate', doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/duplicate`, 'POST', {}), 'Copy created as a new draft page')),
        p.inMenu ? '' : sbtn('Add to menu', doThen(() => addToMenu(p), 'Added to the menu (goes live when you publish)')),
        p.home ? '' : sbtn('Make homepage', doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/home`, 'POST', {}), 'Will become the homepage when you publish')),
        sbtn('Share preview', () => { m().close(); shareDialog({ kind: 'page', slug: p.slug, title: p.title }); }),
        sbtn('Schedule…', () => scheduleDialog('page:' + p.slug, p.title, () => contentScreen('pages'))),
        p.live && !p.home ? sbtn('Unpublish', async () => { if (await confirmBox(`Take “${p.title}” off the live site now? It stays here as a draft and is removed from the menu.`, 'Unpublish', true)) doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/unpublish`, 'POST', {}), 'Unpublished. It is a draft again.')(); }, 'danger') : '',
        p.home ? '' : sbtn('Delete', async () => {
          if (!(await confirmBox(`Delete “${p.title}”?${p.live ? ' It comes off the live site now.' : ''} You can restore it from Recently deleted for 30 days.`, 'Delete', true))) return;
          try { await api(`chapter/${S.chapter}/page/${p.slug}/delete`, 'POST', {}); await afterSiteChange(); if (S.kind === 'page' && p.slug === S.slug) await loadPage(S.overview.pages.find((x) => x.home)?.slug || S.overview.pages[0].slug); toast('Page deleted'); contentScreen('pages'); } catch (e) { toast(e.message); }
        }, 'danger')));
  };
  const title = el('input', { type: 'text', placeholder: 'For example: Volunteer', 'aria-label': 'New page title' }), inMenu = el('input', { type: 'checkbox', checked: true });
  const tpl = templatePicker('page');
  const create = async () => {
    try { const r = await api(`chapter/${S.chapter}/pages`, 'POST', { title: title.value, addToMenu: inMenu.checked, template: tpl.value || undefined }); m().close(); await afterSiteChange(); await loadPage(r.slug); toast('New page created as a draft'); } catch (e) { toast(e.message); }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  return [el('div', { class: 'newpage' }, el('label', {}, 'New page', title), el('label', {}, 'Start from', tpl), el('label', { class: 'check' }, inMenu, ' Add it to the menu'), el('button', { class: 'primary', onclick: create }, 'Create page')),
    el('div', { class: 'pagelist' }, o.pages.map(rowFor)), trashList(o, 'pages', m)];
}
// Page templates (B2) for a new page or a new item of a collection.
function templatePicker(kind) {
  const list = S.templates.filter((t) => t.kind === kind);
  const s = el('select', { 'aria-label': 'Template', hidden: !list.length }, el('option', { value: '' }, kind === 'page' ? 'A blank page' : 'Blank'), list.map((t) => el('option', { value: t.id, title: t.help }, t.label)));
  return s;
}
function collectionTab(col, o, m) {
  const cd = S.collections[col], list = S.lists[col] || [];
  const doThen = (fn, msg) => async () => { try { await fn(); await refreshOverview(); await loadLists([col]); toast(msg); contentScreen(col); } catch (e) { toast(e.message); } };
  const base = (x) => `chapter/${S.chapter}/item/${col}/${x.id}`;
  const meta = (x) => {
    const d = cd.dateKey && x[cd.dateKey];
    if (col === 'events') return [d ? CMSText.fmtDate(d) : 'No date yet', x.location].filter(Boolean).join(' · ');
    if (col === 'posts') return [x.type, d ? CMSText.shortDate(d) : '', x.author].filter(Boolean).join(' · ');
    if (col === 'people') return [x.role, x.term_end ? `Stepped down ${CMSText.shortDate(x.term_end)}` : ''].filter(Boolean).join(' · ');
    if (col === 'endorsements') return [x.office, x.election, x.result !== 'Not decided yet' ? x.result : ''].filter(Boolean).join(' · ');
    if (col === 'sections') return x.usedOn?.length ? `Used on ${x.usedOn.join(', ')}` : 'Not used on any page yet';
    return x.summary || '';
  };
  const rowFor = (x) => el('div', { class: 'pagerow' + (S.kind === 'item' && S.col === col && S.id === x.id ? ' cur' : '') },
    el('div', { class: 'grow' }, el('button', { class: 'linkish big', onclick: () => { m().close(); loadItem(col, x.id); } }, x.title), x.path ? el('div', { class: 'mono small' }, x.path) : '', el('div', { class: 'small' }, meta(x)), el('div', { class: 'chips' }, chipsFor(x)),
      el('div', { class: 'hint' }, x.updated_at ? `Edited by ${x.updated_by || 'someone'} ${ago(x.updated_at)}` : '')),
    el('div', { class: 'actions' },
      sbtn('Open', () => { m().close(); loadItem(col, x.id); }),
      sbtn('Duplicate', doThen(() => api(`${base(x)}/duplicate`, 'POST', {}), 'Copy created as a draft')),
      cd.path ? sbtn('Share preview', () => { m().close(); shareDialog({ kind: 'item', col, id: x.id, title: x.title }); }) : '',
      sbtn('Schedule…', () => scheduleDialog(`item:${col}/${x.id}`, x.title, () => contentScreen(col))),
      x.live ? sbtn('Unpublish', async () => { if (await confirmBox(`Take “${x.title}” off the live site now? It stays here as a draft.`, 'Unpublish', true)) doThen(() => api(`${base(x)}/unpublish`, 'POST', {}), 'Unpublished. It is a draft again.')(); }, 'danger') : '',
      sbtn('Delete', async () => {
        if (!(await confirmBox(`Delete “${x.title}”?${x.live ? ' It comes off the live site now.' : ''} You can restore it from Recently deleted for 30 days.`, 'Delete', true))) return;
        doThen(() => api(`${base(x)}/delete`, 'POST', {}), 'Deleted')().then(() => { if (S.kind === 'item' && S.col === col && S.id === x.id) loadPage(S.overview.pages.find((p) => p.home)?.slug || S.overview.pages[0].slug); });
      }, 'danger')));
  const title = el('input', { type: 'text', placeholder: cd.defaults[cd.titleKey] || '', 'aria-label': `New ${cd.one}` });
  const tpl = templatePicker(col);
  const create = async () => {
    try { const r = await api(`chapter/${S.chapter}/items/${col}`, 'POST', { title: title.value, template: tpl.value || undefined }); m().close(); await refreshOverview(); await loadLists([col]); await loadItem(r.col, r.id); toast(`New ${cd.one} created as a draft. Fill in the details, then publish.`); } catch (e) { toast(e.message); }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  const past = list.filter((x) => x.past), current = list.filter((x) => !x.past);
  return [el('p', { class: 'hint' }, cd.help),
    el('div', { class: 'newpage' }, el('label', {}, `New ${cd.one}`, title), tpl.hidden ? '' : el('label', {}, 'Start from', tpl), el('button', { class: 'primary', onclick: create }, `Create ${cd.one}`)),
    list.length ? '' : el('p', {}, `No ${cd.label.toLowerCase()} yet.`),
    el('div', { class: 'pagelist' }, current.map(rowFor)),
    past.length ? [el('h3', {}, col === 'events' ? 'Past events' : col === 'people' ? 'Alumni' : 'Past'), el('p', { class: 'hint' }, col === 'events' ? 'Moved here on their own once they ended. They stay on the site in the past events list.' : col === 'people' ? 'Moved here on their own after they stepped down.' : 'Moved here on their own after the election or once a result is in.'), el('div', { class: 'pagelist' }, past.map(rowFor))] : '',
    trashList(o, col, m)];
}
async function addToMenu(p) {
  const g = await api(`chapter/${S.chapter}/site`);
  g.site.nav.push({ label: p.title.slice(0, 40), path: p.home ? '/' : '/' + p.slug, style: 'link' });
  await api(`chapter/${S.chapter}/site`, 'PUT', { site: g.site, baseRev: g.rev });
}
async function setHome(slug) {
  try { await api(`chapter/${S.chapter}/page/${slug}/home`, 'POST', {}); await afterSiteChange(); toast('Homepage changed. It goes live when you publish.'); } catch (e) { toast(e.message); }
}

// ---------- publish (W4): what goes live, with the checks for each item
async function publishDialog() {
  if (!(await flush())) return toast("Your last changes haven't saved yet. Try again in a moment.");
  if (S.siteDirty) await saveSite();
  let data;
  try { data = await api(`chapter/${S.chapter}/pending`); } catch (e) { return toast(e.message); }
  if (!data.items.length) { toast('Everything is already live'); return; }
  const chosen = new Set(data.items.map((x) => x.id));
  const m = modal('Publish', [el('div', { id: 'pubBody' })], { wide: true });
  const draw = () => {
    const errs = data.items.filter((x) => chosen.has(x.id)).flatMap((x) => x.checks.filter((c) => c.level === 'error'));
    fill($('#pubBody'),
      el('p', { class: 'hint' }, 'These changes are saved but not on the live site yet. Untick anything you want to keep working on.'),
      ...data.items.map((x) => {
        const cb = el('input', { type: 'checkbox', checked: chosen.has(x.id), 'aria-label': 'Publish ' + x.title });
        cb.onchange = async () => { cb.checked ? chosen.add(x.id) : chosen.delete(x.id); data = await api(`chapter/${S.chapter}/pending`, 'POST', { items: [...chosen] }); draw(); };
        const e = x.checks.filter((c) => c.level === 'error'), w = x.checks.filter((c) => c.level !== 'error');
        const what = x.kind === 'site' ? 'Settings' : `${x.isNew ? 'New' : 'Changed'} ${x.kind === 'item' ? x.label : 'page'}`;
        const here = x.kind === 'page' ? S.kind === 'page' && S.slug === x.slug : x.kind === 'item' && S.kind === 'item' && S.col === x.col && S.id === x.slug;
        return el('div', { class: 'pubitem' + (chosen.has(x.id) ? '' : ' off') }, el('label', { class: 'row nowrap' }, cb, el('b', {}, x.title), el('span', { class: 'tag ' + (x.isNew ? 'warn' : '') }, what)),
          el('p', { class: 'hint' }, `${x.summary}. Last edit by ${x.by || 'someone'} ${ago(x.at)}.`),
          x.scheduled?.length ? el('p', { class: 'hint' }, x.scheduled.map((s) => `${s.action === 'publish' ? 'Scheduled to publish' : 'Scheduled to unpublish'} ${CMSText.fmtDate(s.at)} by ${s.by}`).join('. ')) : '',
          chosen.has(x.id) ? [...e, ...w].map((c) => el('div', { class: 'issue ' + c.level }, el('span', {}, c.msg), sbtn('Show me', async () => {
            m.close(); if (x.kind === 'site') return openSettings(c.section);
            if (!here) await (x.kind === 'item' ? loadItem(x.col, x.slug) : loadPage(x.slug));
            S.panel = 'checks'; sheet(true); refreshChecks(); setTimeout(() => showIssue(c), 400);
          }))) : '');
      }),
      el('details', { class: 'later', open: later.open }, el('summary', {}, 'Publish later instead'),
        el('p', { class: 'hint' }, `Pick when these go live, in your chapter’s time (${S.overview.site.timezone}). What you see now is what goes live then; edits you make in the meantime wait for the next publish.`), at,
        el('div', { class: 'row end' }, el('button', { disabled: !!errs.length || !chosen.size, onclick: () => go(at.value) }, `Schedule ${plural(chosen.size, 'item')}`))),
      el('div', { class: 'row end' }, errs.length ? el('span', { class: 'bad' }, `Fix ${plural(errs.length, 'problem')} to publish`) : '',
        el('button', { class: 'primary', disabled: !!errs.length || !chosen.size, onclick: () => go() }, `Publish ${plural(chosen.size, 'item')} now`)));
    $('#pubBody details.later').addEventListener('toggle', (ev) => { later.open = ev.target.open; });
  };
  const later = { open: false }, at = el('input', { type: 'datetime-local', 'aria-label': 'When to publish' });
  const go = async (when) => {
    if (when === '') return toast('Pick a date and time first.');
    try {
      const r = await api(`chapter/${S.chapter}/publish`, 'POST', { items: [...chosen], at: when || undefined });
      m.close(); await refreshOverview(); await loadLists(); await reloadDoc();
      if (r.scheduled) toast(`Scheduled ${plural(r.scheduled.length, 'item')} for ${CMSText.fmtDate(when)}.`, { label: 'See schedule', run: scheduledScreen });
      else toast(`Published ${plural(r.published.length, 'item')}. It's live.`, { label: 'Undo', run: () => historyDialog('site') });
    } catch (e) { if (e.data?.items) { data = { items: e.data.items }; draw(); } toast(e.message); }
  };
  draw();
}

// ---------- history (W6): who changed what, name a version, compare any two, restore a page, settings or the whole site
async function historyDialog(tab = 'page') {
  if (!(await flush())) return;
  const m = modal('History', [el('div', { class: 'seg', role: 'tablist' }, [['page', `This ${docWord()}`], ['@site', 'Site settings'], ['site', 'Whole site']].map(([k, t]) => el('button', { class: k === tab ? 'on' : '', onclick: () => historyDialog(k) }, t))), el('div', { id: 'histBody' }, el('p', { class: 'hint' }, 'Loading…'))], { wide: true });
  const body = $('#histBody');
  const KIND = { edit: 'Edited', publish: 'Published', restore: 'Restored', create: 'Created', unpublish: 'Unpublished' };
  if (tab === 'site') {
    const t = await api(`chapter/${S.chapter}/timeline`);
    fill(body, el('p', { class: 'hint' }, 'Every time something was published. Restoring the site brings back every page and the settings as they were live at that moment, as drafts, so you can check them before publishing again. Pages created since then are left alone.'),
      t.length ? t.map((b) => el('div', { class: 'ver' }, el('div', { class: 'grow' }, el('b', {}, when(b.at)), el('span', { class: 'hint' }, ` · ${b.by} published ${b.items.join(', ')}`)),
        sbtn('Restore site to this point', async () => {
          if (!(await confirmBox(`Restore the whole site to how it was on ${when(b.at)}? Everything comes back as drafts; nothing goes live until you publish.`, 'Restore as drafts'))) return;
          const r = await api(`chapter/${S.chapter}/restore-site`, 'POST', { at: b.at }); m.close(); await afterSiteChange(); await loadLists(); await reloadDoc();
          toast(`Restored ${plural(r.restored.length, 'item')} as drafts. Review, then publish.`);
        }))) : el('p', {}, 'Nothing has been published from this editor yet.'));
    return;
  }
  const doc = tab === 'page' ? curDoc() : '@site';
  const list = await api(`chapter/${S.chapter}/versions/${doc}`);
  const picked = [];
  const label = (v) => `${v.name ? `“${v.name}” · ` : ''}${KIND[v.kind] || v.kind} by ${v.by}, ${when(v.at)}`;
  const compareBtn = el('button', { class: 'primary', disabled: true, onclick: () => compare(doc, picked.map((id) => list.find((v) => v.id === id))) }, 'Compare the two ticked');
  fill(body,
    el('p', { class: 'hint' }, `Saved automatically as you edit (one entry per person every 10 minutes), plus every publish. Tick two to compare them${doc === '@site' ? '' : ', or one to compare with the current draft'}.`),
    list.length ? list.map((v) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Pick ' + label(v) });
      cb.onchange = () => { if (cb.checked) picked.push(v.id); else picked.splice(picked.indexOf(v.id), 1); if (picked.length > 2) { const drop = picked.shift(); const other = body.querySelector(`[data-v="${drop}"] input`); if (other) other.checked = false; } compareBtn.disabled = !picked.length; compareBtn.textContent = picked.length === 1 ? 'Compare with now' : 'Compare the two ticked'; };
      return el('div', { class: 'ver', 'data-v': v.id }, cb, el('div', { class: 'grow' }, v.name ? el('b', {}, v.name + ' · ') : '', el('span', { class: 'tag ' + (v.kind === 'publish' ? 'ok' : '') }, KIND[v.kind] || v.kind), ` by ${v.by} · ${when(v.at)} (${ago(v.at)})`),
        sbtn(v.name ? 'Rename' : 'Name it', async () => { const n = await askText('Name this version', 'Name', v.name || '', 'Save'); if (n != null) { await api(`chapter/${S.chapter}/versions/${doc}/${v.id}/name`, 'POST', { name: n }); historyDialog(tab); } }),
        sbtn('Restore', async () => {
          if (!(await confirmBox(`Restore ${doc === '@site' ? 'the settings' : `this ${docWord()}`} to ${label(v)}? It becomes a draft; nothing goes live until you publish.`, 'Restore as draft'))) return;
          await flush(); await api(`chapter/${S.chapter}/versions/${doc}/${v.id}/restore`, 'POST', {}); m.close();
          if (doc === '@site') await afterSiteChange(); else { await refreshOverview(); await reloadDoc(); }
          toast('Restored as a draft');
        }));
    }) : el('p', {}, 'No history yet. It builds up as you edit and publish.'),
    list.length ? el('div', { class: 'row end' }, compareBtn) : '');
}
// Text of a page or the settings, as labelled lines, for comparing.
function docLines(doc, isSite) {
  const out = [];
  const flat = (o, pre) => Object.entries(o || {}).forEach(([k, v]) => (v && typeof v === 'object' ? flat(v, `${pre}${k} › `) : out.push([pre + k, String(v ?? '')])));
  if (isSite) { flat(doc, ''); return out; }
  const cd = colDef();
  if (cd) cd.fields.forEach((f) => out.push([f.label, Array.isArray(doc[f.key]) ? doc[f.key].map((id) => (S.lists[f.col] || []).find((x) => x.id === id)?.title || id).join(', ') : String(doc[f.key] ?? '')]));
  else out.push(['Page title', doc.title || '']);
  (doc.blocks || []).forEach((b, i) => {
    const def = S.schema[b.type], name = `${i + 1}. ${def?.label || b.type}`;
    const props = (type, p, pre) => (S.schema[type]?.fields || []).forEach((f) => {
      if (f.kind === 'list') (p[f.key] || []).forEach((it, j) => f.fields.forEach((sf) => out.push([`${pre} › ${it[f.itemLabel] || f.label + ' ' + (j + 1)} › ${sf.label}`, String(it[sf.key] ?? '')])));
      else if (f.key !== 'layout') out.push([`${pre} › ${f.label}`, String(p[f.key] ?? '')]);
    });
    if (b.type === 'columns') (b.props.cols || []).forEach((col, c) => col.forEach((a) => props(a.type, a.props, `${name} › Column ${c + 1} › ${S.schema[a.type]?.label}`)));
    else props(b.type, b.props || {}, name);
    if (b.vis) out.push([`${name} › When to show`, [b.vis.from && `from ${b.vis.from}`, b.vis.until && `until ${b.vis.until}`, b.vis.device !== 'All' && b.vis.device, b.vis.after && `until event ${b.vis.after} ends`].filter(Boolean).join(', ')]);
  });
  return out;
}
async function compare(doc, picked) {
  const isSite = doc === '@site';
  const load = async (v) => (await api(`chapter/${S.chapter}/versions/${doc}/${v.id}`)).doc;
  const older = picked.length === 2 ? (picked[0].at < picked[1].at ? picked[0] : picked[1]) : picked[0];
  const newer = picked.length === 2 ? (older === picked[0] ? picked[1] : picked[0]) : null;
  const a = await load(older), b = newer ? await load(newer) : isSite ? S.site || (await api(`chapter/${S.chapter}/site`)).site : S.page;
  const A = new Map(docLines(a, isSite)), B = new Map(docLines(b, isSite));
  const keys = [...new Set([...A.keys(), ...B.keys()])].filter((k) => (A.get(k) ?? '') !== (B.get(k) ?? ''));
  modal('Compare versions', [
    el('p', { class: 'hint' }, `From ${when(older.at)} (${older.by}) to ${newer ? `${when(newer.at)} (${newer.by})` : 'the current draft'}. Removed text is struck through, added text is highlighted.`),
    keys.length ? keys.map((k) => el('div', { class: 'diff' }, el('p', { class: 'meta' }, k), el('p', {}, diffWords(A.get(k) ?? '', B.get(k) ?? '').map(([op, t]) => (op === '=' ? t : el(op === '+' ? 'ins' : 'del', {}, t)))))) : el('p', {}, 'No differences.'),
    el('p', {}, sbtn('Back to history', () => historyDialog(isSite ? '@site' : 'page'))),
  ], { wide: true });
}

// ---------- share links (E7): a page or an item, with its unpublished changes
async function shareDialog(ref = docRef()) {
  await flush();
  const item = ref.kind === 'item', path = item ? `item/${ref.col}/${ref.id}` : `page/${ref.slug}`;
  const base = location.origin + '/preview/', dev = /^(localhost|127\.)/.test(location.hostname) ? `?chapter=${S.chapter}` : '';
  const m = modal(`Share a preview of “${ref.title}”`, [el('div', { id: 'shareBody' })]);
  const draw = async () => {
    const items = (await api(`chapter/${S.chapter}/shares`)).filter((x) => (item ? x.col === ref.col && x.slug === ref.id : !x.col && x.slug === ref.slug));
    fill($('#shareBody'),
      el('p', {}, `Anyone with the link can see this ${item ? S.collections[ref.col].one : 'page'} with its unpublished changes, without logging in. Handy for getting a second opinion before publishing. Links stop working after 7 days, and search engines are told to ignore them.`),
      window.__DEMO ? el('p', { class: 'note' }, 'In this demo the links are created but cannot open, because there is no server behind it.') : '',
      items.map((x) => { const url = base + x.token + dev; const inp = el('input', { type: 'text', value: url, readonly: true }); return el('div', { class: 'item' }, inp, el('div', { class: 'row' }, el('span', { class: 'hint grow' }, `Made by ${x.by} ${ago(x.at)}, works until ${when(x.expires)}`), sbtn('Copy', async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { inp.select(); toast('Press Ctrl+C to copy'); } }), sbtn('Turn off', async () => { await api(`chapter/${S.chapter}/shares/${x.token}/revoke`, 'POST', {}); draw(); }, 'danger'))); }),
      el('p', {}, el('button', { class: 'primary', onclick: async () => { await api(`chapter/${S.chapter}/${path}/share`, 'POST', {}); draw(); } }, items.length ? 'Make another link' : 'Make a preview link')));
  };
  draw().catch((e) => toast(e.message));
  return m;
}

// ---------- schedules (W5): publish or unpublish a page or an item at a set time
function scheduleDialog(doc, title, after) {
  const at = el('input', { type: 'datetime-local', 'aria-label': 'When' }), action = el('select', { 'aria-label': 'What to do' }, el('option', { value: 'publish' }, 'Publish its unpublished changes'), el('option', { value: 'unpublish' }, 'Take it off the live site'));
  const d = stackModal(`Schedule “${title}”`, [el('div', { id: 'schedBody' })], { wide: false });
  const draw = async () => {
    const list = (await api(`chapter/${S.chapter}/schedule`)).items.filter((x) => x.doc === doc);
    fill(d.body, el('p', { class: 'hint' }, `Times are in your chapter’s time zone (${S.overview.site.timezone}). Publishing goes live with the changes as they are now; anything you edit later waits for the next publish.`),
      list.map((x) => el('div', { class: 'item row' }, el('span', { class: 'grow' }, `${x.action === 'publish' ? 'Publishes' : 'Unpublishes'} ${CMSText.fmtDate(x.at)} (set by ${x.by})`), sbtn('Cancel', async () => { await api(`chapter/${S.chapter}/schedule/${x.id}/cancel`, 'POST', {}); draw(); after?.(); }, 'danger'))),
      el('label', {}, 'What to do', action), el('label', {}, 'When', at),
      el('div', { class: 'row end' }, el('button', { class: 'primary', onclick: async () => {
        await flush();
        try { await api(`chapter/${S.chapter}/schedule`, 'POST', { doc, action: action.value, at: at.value }); toast('Scheduled'); await refreshOverview(); draw(); after?.(); } catch (e) { toast(e.message); }
      } }, 'Schedule')));
  };
  draw().catch((e) => toast(e.message));
}
async function scheduledScreen() {
  let s; try { s = await api(`chapter/${S.chapter}/schedule`); } catch (e) { return toast(e.message); }
  const m = modal('Scheduled changes', [
    el('p', { class: 'hint' }, `Publishes and unpublishes waiting for their time, in your chapter’s time zone (${S.overview.site.timezone}). The announcement bar has its own start and end dates in Settings, and sections can be shown for a while under “When to show this section”.`),
    s.items.length ? s.items.map((x) => el('div', { class: 'pagerow' }, el('div', { class: 'grow' }, el('b', {}, x.title || x.doc), el('div', { class: 'hint' }, `${x.action === 'publish' ? 'Publishes' : 'Unpublishes'} ${CMSText.fmtDate(x.at)}. Set by ${x.by} ${ago(x.created)}.`)),
      sbtn('Cancel', async () => { await api(`chapter/${S.chapter}/schedule/${x.id}/cancel`, 'POST', {}); await refreshOverview(); m.close(); scheduledScreen(); }, 'danger'))) : el('p', {}, 'Nothing scheduled.'),
    s.done.length ? [el('h3', {}, 'Recently done'), s.done.map((x) => el('div', { class: 'ver' }, el('span', { class: 'grow' }, `${x.title || x.doc}: ${x.action === 'publish' ? 'published' : 'unpublished'} ${CMSText.fmtDate(x.at)}`), el('span', { class: 'tag ' + (x.result === 'Done' ? 'ok' : 'warn') }, x.result || '')))] : '',
  ], { wide: true });
}

// ---------- media library (M2): the chapter's images and the national library
function mediaLibrary({ pick, tab = 'chapter' } = {}) {
  const d = stackModal(pick ? 'Pick an image' : 'Media library', []);
  const draw = async () => {
    const nat = tab === 'national', path = nat ? 'national/media' : `chapter/${S.chapter}/media`;
    const list = await api(path);
    const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    file.onchange = async () => { for (const f of file.files) { try { await uploadImage(f, nat ? 'national' : S.chapter); } catch (e) { toast(e.message); } } draw(); };
    const use = (x) => { d.close(); pick(x); };
    fill(d.body,
      el('div', { class: 'seg' }, [['chapter', 'This chapter'], ['national', 'National library']].map(([k, t]) => el('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(); } }, t))),
      el('p', { class: 'hint' }, nat ? 'Photos and graphics national shares with every chapter.' : 'Images your chapter uploaded. Photos shrink before they upload, so pages stay fast on phones.'),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => file.click() }, nat ? 'Upload to the national library' : 'Upload images'), file),
      list.length ? el('div', { class: 'media' }, list.map((x) => el('div', { class: 'mitem' },
        el('button', { class: 'mthumb', title: pick ? 'Use this image' : x.name, onclick: pick ? () => use(x) : null }, el('img', { src: mediaSrc(x.url), alt: x.alt || '', loading: 'lazy' })),
        el('input', { type: 'text', value: x.alt, placeholder: 'Describe it (for screen readers)', 'aria-label': 'Image description', onchange: async (e) => { try { await api(`${path}/${x.id}`, 'POST', { alt: e.target.value }); x.alt = e.target.value; toast('Description saved'); } catch (er) { toast(er.message); } } }),
        el('div', { class: 'row' }, el('span', { class: 'hint grow' }, `${x.w || '?'}×${x.h || '?'} · ${Math.max(1, Math.round(x.size / 1024))} KB`), pick ? sbtn('Use', () => use(x)) : '',
          sbtn('Delete', async () => { if (!(await confirmBox(`Delete “${x.name || 'this image'}”?`, 'Delete', true))) return; try { await api(`${path}/${x.id}/delete`, 'POST', {}); draw(); } catch (e) { toast(e.message); } }, 'danger'))))) : el('p', {}, 'No images yet.'));
  };
  draw().catch((e) => toast(e.message));
}

// ---------- messages from contact forms (C5)
async function inboxScreen() {
  let list; try { list = await api(`chapter/${S.chapter}/inbox`); } catch (e) { return toast(e.message); }
  const upd = async (x, b) => { await api(`chapter/${S.chapter}/inbox/${encodeURIComponent(x.id)}`, 'POST', b); await refreshOverview(); inboxScreen(); };
  modal('Messages', [
    el('p', { class: 'hint' }, 'Sent through the contact forms on your site. Visitors never see anyone’s email address; reply from your own email.'),
    window.__DEMO ? el('p', { class: 'note' }, 'In this demo, forms can’t be sent from the preview, so this list starts empty.') : '',
    list.length ? list.map((x) => el('div', { class: 'item' + (x.done ? ' done' : '') }, el('div', { class: 'row' }, el('strong', {}, x.name), el('span', { class: 'hint' }, `to ${x.toName} · ${ago(x.at)}`)),
      el('p', { class: 'msg' }, x.message), el('div', { class: 'row' }, el('a', { href: `mailto:${x.email}?subject=${encodeURIComponent('Re: your message to ' + (S.overview.site.name || 'the chapter'))}` }, `Reply to ${x.email}`), el('span', { class: 'grow' }),
        sbtn(x.done ? 'Mark as new' : 'Mark as handled', () => upd(x, { done: !x.done })), sbtn('Delete', async () => { if (await confirmBox('Delete this message?', 'Delete', true)) upd(x, { remove: true }); }, 'danger')))) : el('p', {}, 'No messages yet.'),
  ], { wide: true });
}

// ---------- national settings (T2, T5, T7): approved looks, feature switches per chapter, logo approvals
async function nationalScreen() {
  let n; try { n = await api('national'); } catch (e) { return toast(e.message); }
  const cfg = clone(n.config), feats = Object.entries(n.features);
  if (!cfg.palettes.length) cfg.palettes = clone(n.palettes);
  if (!cfg.fonts.length) cfg.fonts = n.fonts.map((f) => f.id);
  const m = modal('National settings', [el('div', { id: 'natBody' })], { wide: true });
  const save = async () => {
    try { await api('national', 'PUT', cfg); toast('National settings saved. Chapters see them right away.'); await refreshOverview(); preview(); m.close(); nationalScreen(); } catch (e) { toast(e.message); }
  };
  const effective = (ch) => ({ ...Object.fromEntries(feats.map(([k]) => [k, !['endorsements', 'custom_colors'].includes(k)])), ...cfg.defaults, ...(cfg.features[ch] || {}) });
  const draw = () => fill($('#natBody'),
    el('p', { class: 'note' }, 'For national staff. Until logins arrive, anyone with editor access can open this screen. Changes apply to every chapter as soon as you save, without publishing.'),
    el('h3', {}, 'Logo approvals'),
    n.chapters.filter((c) => c.logo_request).length ? n.chapters.filter((c) => c.logo_request).map((c) => el('div', { class: 'pagerow' }, el('img', { class: 'thumb', src: mediaSrc(c.logo_request), alt: `New logo for ${c.name}` }), el('div', { class: 'grow' }, el('b', {}, c.name), el('div', { class: 'hint' }, c.logo ? 'Replaces their current logo.' : 'Their first logo.')),
      sbtn('Approve', async () => { await api(`national/logo/${c.chapter}`, 'POST', { approve: true }); toast('Approved. It shows on their site now.'); m.close(); nationalScreen(); }),
      sbtn('Turn down', async () => { await api(`national/logo/${c.chapter}`, 'POST', { approve: false }); toast('Turned down. They keep their current logo.'); m.close(); nationalScreen(); }, 'danger'))) : el('p', { class: 'hint' }, 'No logos waiting.'),
    el('h3', {}, 'Approved colour sets'),
    el('p', { class: 'hint' }, 'Chapters pick from these. A set whose dark colour is too light to read can’t be approved.'),
    cfg.palettes.map((p, i) => el('div', { class: 'item row' }, el('span', { class: 'sw2' }, el('i', { style: `background:${p.primary}` }), el('i', { style: `background:${p.accent}` })),
      el('input', { type: 'text', value: p.name, 'aria-label': 'Name', style: 'max-width:10rem', oninput: (e) => { p.name = e.target.value; } }),
      el('input', { type: 'text', value: p.primary, 'aria-label': 'Dark colour', style: 'max-width:7rem', onchange: (e) => { p.primary = e.target.value.trim(); draw(); } }),
      el('input', { type: 'text', value: p.accent, 'aria-label': 'Chapter colour', style: 'max-width:7rem', onchange: (e) => { p.accent = e.target.value.trim(); draw(); } }),
      sbtn('✕', () => { cfg.palettes.splice(i, 1); draw(); }, 'danger'))),
    sbtn('+ Add a colour set', () => { cfg.palettes.push({ id: 'set-' + Math.random().toString(36).slice(2, 6), name: 'New set', primary: '#2C3659', accent: '#C23B4F' }); draw(); }),
    el('h3', {}, 'Approved fonts'),
    n.fonts.map((f) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: cfg.fonts.includes(f.id), onchange: (e) => { cfg.fonts = e.target.checked ? [...cfg.fonts, f.id] : cfg.fonts.filter((x) => x !== f.id); } }), ' ', f.name)),
    el('h3', {}, 'Features for every chapter'),
    el('p', { class: 'hint' }, 'Turn whole parts of the CMS on or off. A chapter’s own switch below wins over these.'),
    el('div', { class: 'feats' }, feats.map(([k, [label, help]]) => el('label', { class: 'check', title: help }, el('input', { type: 'checkbox', checked: effective('')[k], onchange: (e) => { cfg.defaults[k] = e.target.checked; draw(); } }), ' ', label))),
    el('h3', {}, 'Features per chapter'),
    el('div', { class: 'tablewrap' }, el('table', { class: 'feattable' }, el('tr', {}, el('th', {}, 'Chapter'), feats.map(([, [label]]) => el('th', {}, label))),
      n.chapters.map((c) => el('tr', {}, el('td', {}, c.name || c.chapter), feats.map(([k]) => el('td', {}, el('input', { type: 'checkbox', 'aria-label': `${feats.find((f) => f[0] === k)[1][0]} for ${c.name}`, checked: effective(c.chapter)[k], onchange: (e) => { (cfg.features[c.chapter] ||= {})[k] = e.target.checked; } }))))))),
    el('h3', {}, 'National media library'),
    el('p', {}, sbtn('Open the national library', () => mediaLibrary({ tab: 'national' }))),
    el('div', { class: 'row end' }, el('button', { class: 'primary', onclick: save }, 'Save national settings')));
  draw();
}

// ---------- who is editing (until real logins)
async function askName(force) {
  if (S.me.name && !force) return;
  const i = el('input', { type: 'text', value: S.me.name, placeholder: 'First name is fine', autocomplete: 'given-name' });
  const n = await ask('What should we call you?', [el('p', { class: 'hint' }, 'Your name is shown in History and to anyone else editing at the same time.'), el('label', {}, 'Your name', i)], [{ label: 'Save', value: () => i.value, class: 'primary' }]);
  S.me.name = String(n || '').trim().slice(0, 40) || S.me.name || 'Someone';
  local.set('chapter-cms-name', S.me.name);
}
