'use strict';
// Screens that open over the editor: add-a-section chooser (block gallery), pages, page settings, publish,
// history, share links, the editor's name.

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

// ---------- add a section (B7): every block with what it is for, plus columns by layout and the full gallery
function chooseBlock(at) {
  S.insertAt = at;
  const secs = Object.entries(S.schema).filter(([, v]) => !v.atom && !v.container), singles = Object.entries(S.schema).filter(([, v]) => v.atom);
  const card = ([k, v]) => el('button', { class: 'blockcard', onclick: () => { m.close(); addBlock(k, at); } }, el('b', {}, v.label), el('span', {}, v.help));
  const m = modal('Add a section', [
    el('h3', {}, 'Sections'), el('div', { class: 'cards' }, secs.map(card)),
    el('h3', {}, 'Single blocks'), el('p', { class: 'hint' }, 'These also fit inside columns.'), el('div', { class: 'cards' }, singles.map(card)),
    el('h3', {}, 'Columns'), el('p', { class: 'hint' }, 'Put text, images, cards and buttons side by side.'),
    el('div', { class: 'chips' }, Object.entries(S.layouts).map(([k, name]) => el('button', { onclick: () => { m.close(); addColumns(k, at); } }, name))),
    el('p', {}, el('button', { class: 'linkish', onclick: () => { m.close(); setMode('gallery'); } }, 'See every block filled with sample content →')),
  ], { wide: true });
}

// ---------- page settings
function pageSettings() {
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
    fieldInput({ key: 'seo_image', label: 'Image for link previews', kind: 'url', hint: 'Optional. Shown when someone shares the page on social media.' }, S.page.seo_image, set('seo_image')),
    p.live && p.draft ? el('p', {}, sbtn('Undo all unpublished changes to this page', async () => {
      if (!(await confirmBox('Go back to the published version of this page? Your unpublished changes will be lost (they stay in History).', 'Go back', true))) return;
      await flush(); await api(`chapter/${S.chapter}/page/${S.slug}/discard`, 'POST', {}); $('#dlg').close(); await refreshOverview(); await loadPage(S.slug); toast('Back to the published version');
    }, 'danger')) : '',
  ]);
}

// ---------- pages (E6)
async function pagesScreen() {
  if (!(await flush())) return;
  const o = await refreshOverview();
  const rowFor = (p) => {
    const chips = [p.home ? el('span', { class: 'tag' }, 'Homepage') : '', p.live ? el('span', { class: 'tag ok' }, 'Live') : el('span', { class: 'tag warn' }, 'Not published'), p.live && p.draft ? el('span', { class: 'tag warn' }, 'Unpublished changes') : '', p.inMenu ? el('span', { class: 'tag' }, 'In menu') : el('span', { class: 'tag muted' }, 'Not in menu')];
    const doThen = (fn, msg) => async () => { try { await fn(); await afterSiteChange(); toast(msg); pagesScreen(); } catch (e) { toast(e.message); } };
    return el('div', { class: 'pagerow' + (p.slug === S.slug ? ' cur' : '') },
      el('div', { class: 'grow' }, el('button', { class: 'linkish big', onclick: () => { m.close(); loadPage(p.slug); } }, p.title), el('div', { class: 'mono small' }, p.home ? '/' : '/' + p.slug), el('div', { class: 'chips' }, chips),
        el('div', { class: 'hint' }, p.updated_at ? `Edited by ${p.updated_by || 'someone'} ${ago(p.updated_at)}` : p.published_at ? `Published ${ago(p.published_at)}` : '')),
      el('div', { class: 'actions' },
        sbtn('Open', () => { m.close(); loadPage(p.slug); }),
        sbtn('Rename', async () => { const t = await askText('Rename page', 'Page title', p.title); if (t) doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/rename`, 'POST', { title: t }), 'Renamed')().then(() => p.slug === S.slug && loadPage(S.slug, { keepPlace: true })); }),
        sbtn('Duplicate', doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/duplicate`, 'POST', {}), 'Copy created as a new draft page')),
        p.inMenu ? '' : sbtn('Add to menu', doThen(() => addToMenu(p), 'Added to the menu (goes live when you publish)')),
        p.home ? '' : sbtn('Make homepage', doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/home`, 'POST', {}), 'Will become the homepage when you publish')),
        sbtn('Share preview', () => { m.close(); shareDialog(p.slug); }),
        p.live && !p.home ? sbtn('Unpublish', async () => { if (await confirmBox(`Take “${p.title}” off the live site now? It stays here as a draft and is removed from the menu.`, 'Unpublish', true)) doThen(() => api(`chapter/${S.chapter}/page/${p.slug}/unpublish`, 'POST', {}), 'Unpublished. It is a draft again.')(); }, 'danger') : '',
        p.home ? '' : sbtn('Delete', async () => {
          if (!(await confirmBox(`Delete “${p.title}”?${p.live ? ' It comes off the live site now.' : ''} You can restore it from Recently deleted for 30 days.`, 'Delete', true))) return;
          try { await api(`chapter/${S.chapter}/page/${p.slug}/delete`, 'POST', {}); await afterSiteChange(); if (p.slug === S.slug) await loadPage(S.overview.pages.find((x) => x.home)?.slug || S.overview.pages[0].slug); toast('Page deleted'); pagesScreen(); } catch (e) { toast(e.message); }
        }, 'danger')));
  };
  const title = el('input', { type: 'text', placeholder: 'For example: Volunteer', 'aria-label': 'New page title' }), inMenu = el('input', { type: 'checkbox', checked: true, id: 'newInMenu' });
  const create = async () => {
    try { const r = await api(`chapter/${S.chapter}/pages`, 'POST', { title: title.value, addToMenu: inMenu.checked }); m.close(); await afterSiteChange(); await loadPage(r.slug); toast('New page created as a draft'); } catch (e) { toast(e.message); }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  const m = modal('Pages', [
    el('div', { class: 'newpage' }, el('label', {}, 'New page', title), el('label', { class: 'check' }, inMenu, ' Add it to the menu'), el('button', { class: 'primary', onclick: create }, 'Create page')),
    el('div', { class: 'pagelist' }, o.pages.map(rowFor)),
    o.trash.length ? [el('h3', {}, 'Recently deleted'), el('p', { class: 'hint' }, 'Kept for 30 days. Restoring brings a page back as a draft.'),
      o.trash.map((t) => el('div', { class: 'pagerow' }, el('div', { class: 'grow' }, el('b', {}, t.title), el('div', { class: 'hint' }, `Deleted by ${t.by} ${ago(t.at)}`)), sbtn('Restore', async () => { try { const r = await api(`chapter/${S.chapter}/trash/${t.id}/restore`, 'POST', {}); await afterSiteChange(); toast('Restored as a draft'); m.close(); loadPage(r.slug); } catch (e) { toast(e.message); } })))] : '',
  ], { wide: true });
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
        return el('div', { class: 'pubitem' + (chosen.has(x.id) ? '' : ' off') }, el('label', { class: 'row nowrap' }, cb, el('b', {}, x.title), el('span', { class: 'tag ' + (x.isNew ? 'warn' : '') }, x.kind === 'site' ? 'Settings' : x.isNew ? 'New page' : 'Changes')),
          el('p', { class: 'hint' }, `${x.summary}. Last edit by ${x.by || 'someone'} ${ago(x.at)}.`),
          chosen.has(x.id) ? [...e, ...w].map((c) => el('div', { class: 'issue ' + c.level }, el('span', {}, c.msg), sbtn('Show me', async () => { m.close(); if (x.kind === 'site') return openSettings(c.section); if (x.slug !== S.slug) await loadPage(x.slug); S.panel = 'checks'; sheet(true); refreshChecks(); setTimeout(() => showIssue(c), 400); }))) : '');
      }),
      el('div', { class: 'row end' }, errs.length ? el('span', { class: 'bad' }, `Fix ${plural(errs.length, 'problem')} to publish`) : '',
        el('button', { class: 'primary', disabled: !!errs.length || !chosen.size, onclick: go }, `Publish ${plural(chosen.size, 'item')}`)));
  };
  const go = async () => {
    try {
      const r = await api(`chapter/${S.chapter}/publish`, 'POST', { items: [...chosen] });
      m.close(); await refreshOverview(); await loadPage(S.slug, { keepPlace: true });
      toast(`Published ${plural(r.published.length, 'item')}. It's live.`, { label: 'Undo', run: () => historyDialog('site') });
    } catch (e) { if (e.data?.items) { data = { items: e.data.items }; draw(); } toast(e.message); }
  };
  draw();
}

// ---------- history (W6): who changed what, name a version, compare any two, restore a page, settings or the whole site
async function historyDialog(tab = 'page') {
  if (!(await flush())) return;
  const m = modal('History', [el('div', { class: 'seg', role: 'tablist' }, [['page', 'This page'], ['@site', 'Site settings'], ['site', 'Whole site']].map(([k, t]) => el('button', { class: k === tab ? 'on' : '', onclick: () => historyDialog(k) }, t))), el('div', { id: 'histBody' }, el('p', { class: 'hint' }, 'Loading…'))], { wide: true });
  const body = $('#histBody');
  const KIND = { edit: 'Edited', publish: 'Published', restore: 'Restored', create: 'Created', unpublish: 'Unpublished' };
  if (tab === 'site') {
    const t = await api(`chapter/${S.chapter}/timeline`);
    fill(body, el('p', { class: 'hint' }, 'Every time something was published. Restoring the site brings back every page and the settings as they were live at that moment, as drafts, so you can check them before publishing again. Pages created since then are left alone.'),
      t.length ? t.map((b) => el('div', { class: 'ver' }, el('div', { class: 'grow' }, el('b', {}, when(b.at)), el('span', { class: 'hint' }, ` · ${b.by} published ${b.items.join(', ')}`)),
        sbtn('Restore site to this point', async () => {
          if (!(await confirmBox(`Restore the whole site to how it was on ${when(b.at)}? Everything comes back as drafts; nothing goes live until you publish.`, 'Restore as drafts'))) return;
          const r = await api(`chapter/${S.chapter}/restore-site`, 'POST', { at: b.at }); m.close(); await afterSiteChange(); await loadPage(S.slug, { keepPlace: true });
          toast(`Restored ${plural(r.restored.length, 'item')} as drafts. Review, then publish.`);
        }))) : el('p', {}, 'Nothing has been published from this editor yet.'));
    return;
  }
  const doc = tab === 'page' ? S.slug : '@site';
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
          if (!(await confirmBox(`Restore ${doc === '@site' ? 'the settings' : 'this page'} to ${label(v)}? It becomes a draft; nothing goes live until you publish.`, 'Restore as draft'))) return;
          await flush(); await api(`chapter/${S.chapter}/versions/${doc}/${v.id}/restore`, 'POST', {}); m.close();
          if (doc === '@site') await afterSiteChange(); else { await refreshOverview(); await loadPage(S.slug, { keepPlace: true }); }
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
  out.push(['Page title', doc.title || '']);
  (doc.blocks || []).forEach((b, i) => {
    const def = S.schema[b.type], name = `${i + 1}. ${def?.label || b.type}`;
    const props = (type, p, pre) => (S.schema[type]?.fields || []).forEach((f) => {
      if (f.kind === 'list') (p[f.key] || []).forEach((it, j) => f.fields.forEach((sf) => out.push([`${pre} › ${it[f.itemLabel] || f.label + ' ' + (j + 1)} › ${sf.label}`, String(it[sf.key] ?? '')])));
      else if (f.key !== 'layout') out.push([`${pre} › ${f.label}`, String(p[f.key] ?? '')]);
    });
    if (b.type === 'columns') (b.props.cols || []).forEach((col, c) => col.forEach((a) => props(a.type, a.props, `${name} › Column ${c + 1} › ${S.schema[a.type]?.label}`)));
    else props(b.type, b.props || {}, name);
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

// ---------- share links (E7)
async function shareDialog(slug = S.slug) {
  await flush();
  const p = S.overview.pages.find((x) => x.slug === slug) || { title: S.page.title };
  const base = location.origin + '/preview/', dev = /^(localhost|127\.)/.test(location.hostname) ? `?chapter=${S.chapter}` : '';
  const m = modal(`Share a preview of “${p.title}”`, [el('div', { id: 'shareBody' })]);
  const draw = async () => {
    const items = (await api(`chapter/${S.chapter}/shares`)).filter((x) => x.slug === slug);
    fill($('#shareBody'),
      el('p', {}, 'Anyone with the link can see this page with its unpublished changes, without logging in. Handy for getting a second opinion before publishing. Links stop working after 7 days, and search engines are told to ignore them.'),
      window.__DEMO ? el('p', { class: 'note' }, 'In this demo the links are created but cannot open, because there is no server behind it.') : '',
      items.map((x) => { const url = base + x.token + dev; const inp = el('input', { type: 'text', value: url, readonly: true }); return el('div', { class: 'item' }, inp, el('div', { class: 'row' }, el('span', { class: 'hint grow' }, `Made by ${x.by} ${ago(x.at)}, works until ${when(x.expires)}`), sbtn('Copy', async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { inp.select(); toast('Press Ctrl+C to copy'); } }), sbtn('Turn off', async () => { await api(`chapter/${S.chapter}/shares/${x.token}/revoke`, 'POST', {}); draw(); }, 'danger'))); }),
      el('p', {}, el('button', { class: 'primary', onclick: async () => { await api(`chapter/${S.chapter}/page/${slug}/share`, 'POST', {}); draw(); } }, items.length ? 'Make another link' : 'Make a preview link')));
  };
  draw().catch((e) => toast(e.message));
  return m;
}

// ---------- who is editing (until real logins)
async function askName(force) {
  if (S.me.name && !force) return;
  const i = el('input', { type: 'text', value: S.me.name, placeholder: 'First name is fine', autocomplete: 'given-name' });
  const n = await ask('What should we call you?', [el('p', { class: 'hint' }, 'Your name is shown in History and to anyone else editing at the same time.'), el('label', {}, 'Your name', i)], [{ label: 'Save', value: () => i.value, class: 'primary' }]);
  S.me.name = String(n || '').trim().slice(0, 40) || S.me.name || 'Someone';
  local.set('chapter-cms-name', S.me.name);
}
