# Chapter CMS

A small block-based CMS for CNL chapter websites. Chapter leads edit pages by stacking pre-made sections (hero, events, endorsements, issue cards, news and media, people, text, columns, call to action); the public site renders them in the "Yard Sign" design (option C from the CNL Chapter Sites design-directions canvas). No dependencies: just Node 20+.

## Run it

```bash
npm start                 # http://localhost:3000 (site)   http://localhost:3000/admin (editor)
npm test                  # unit, API and server tests
npm run test:visual       # screenshot checks (needs Playwright, see below)
npm run demo              # build chapter-editor-demo.html, a single-file demo that runs without a server
node new-chapter.js austin "Austin Chapter"   # copy the demo chapter as a starting point
```

In dev (`NODE_ENV` unset) the admin is open. For anything shared, set:

| Env var | Purpose |
|---|---|
| `NODE_ENV=production` | refuses to start without `ADMIN_PASSWORD` |
| `ADMIN_PASSWORD` | one shared password (HTTP Basic, any username) protecting `/admin` and the write API |
| `BASE_DOMAIN` | e.g. `cnliberalism.org`: `austin.cnliberalism.org` serves chapter `austin` |
| `DEFAULT_CHAPTER` | chapter served when no subdomain matches (default `demo`); in dev `?chapter=slug` also works |
| `DATA_DIR`, `PORT` | storage folder, port |

## How editing works

The page preview is the editor. Leads click any text to type over it, and everything else hangs off that:

- **Saving.** Edits save as a draft about a second after typing stops. The header shows "Saved · 2 unpublished" or "Saved · all live". Undo and redo cover typing, moves, deletes and settings (Ctrl+Z, Ctrl+Shift+Z).
- **Formatting.** Rich text fields get a small bar with bold, italic, link, list and subheading. Tab moves to the next field. Pasting drops outside formatting.
- **Sections.** Each section and column block has a toolbar to drag (⠿), move, duplicate or delete. "Add a section here" sits between sections and opens the block gallery.
- **Side panel.** Shows guidance for the field you're in, prewritten options, the section's settings and list items. On phones it becomes a bottom sheet, with a bar for undo, previous and next section, and publish.
- **Pages.** The Pages screen creates (optionally adding to the menu), duplicates, renames, unpublishes, deletes (to a restorable trash) and sets the homepage.
- **Settings.** Chapter basics, colors and logo, menu (with dropdowns and button-style links), announcement bar, footer links, connections (Action Network, Luma) and social links. Changes preview live and publish like pages.
- **Publishing.** The publish dialog lists every unpublished page and site change with a summary, so a lead can publish one item or everything. Pre-publish checks run first: errors (a missing required field, a broken link, an image without alt text) block publishing, and warnings (vague link text, leftover starter text, low color contrast) advise. Most issues have "Show me" and many have "Fix it".
- **History.** Every page and the site settings keep versions: who and when, named versions, compare with the current draft word by word, and restore. The site timeline can restore the whole site as it was at a past publish (restored as drafts, so nothing changes until you publish).
- **Sharing.** A preview link shows a page with its unpublished changes to anyone, for 7 days, marked noindex. Links can be revoked.
- **Two editors at once.** The header shows who else is on the page. If someone saves first, the editor asks which version to keep, and the other one is kept in History.

## How it works

- **Store.** `lib/store.js` (files) and `lib/memstore.js` (memory, used by tests and the demo) share one tiny key-value interface: `get`, `put`, `del`, `list(prefix/)`, `chapters()`. Moving to Cloudflare means writing that interface on KV, R2 or D1. Keys per chapter: `site`, `site-draft`, `page/<slug>`, `draft/<slug>`, `ver/<doc>/<id>`, `verindex/<doc>`, `trash/<id>`, `shares`. On disk a key is `data/<chapter>/<key>.json`.
- **Core.** `lib/cms.js` holds the rules: drafts, publishing, versions, trash, share links and checks. Every doc carries `rev`, `updated_at` and `updated_by`; a save sends the rev it started from and gets a 409 with the current doc when someone else saved first.
- **API.** `lib/api.js` maps `/admin/api/*` requests to the core and doesn't depend on a web server. `server.js` adds auth, CSRF checks (JSON content type and same origin on writes) and the public site. The demo calls the same `handle()` from a fetch shim.
- **Checks.** `lib/checks.js` checks a page or the site settings and returns issues with where they are and, when possible, a one-tap fix.
- **Rendering.** `lib/render.js` wraps blocks in the site chrome (announcement bar, menu, footer). Everything is escaped, and links are limited to `http(s)`, `mailto:` and relative paths. Rich text fields accept `**bold**`, `_italic_`, `[link](https://…)`, `- lists` and `### subheadings`.
- **Editor.** `admin/` is plain browser scripts with no build step: `util.js`, `editor.js` (state, autosave, undo, presence), `panel.js` (side panel and settings), `screens.js` (pages, publish, history, share), `boot.js`. `frame.js` and `frame.css` run inside the preview and talk to the editor with `postMessage`.

## Adding a block

Add one entry to `lib/blocks.js`. The entry is the whole contract: the editor, validation, checks, the block gallery and the tests all read it.

```js
volunteer_form: {
  label: 'Volunteer form',                 // name leads see
  help: 'Collect names for a shift.',      // one sentence, shown in the gallery
  fields: [
    { key: 'heading', label: 'Heading', kind: 'text', max: 50, required: true },
    { key: 'body', label: 'Intro', kind: 'textarea', rich: true, max: 400, hint: 'Say what the shift involves.' },
    { key: 'form_url', label: 'Form link', kind: 'url', fallback: 'action_network_url' },
  ],
  defaults: { heading: 'Volunteer with us', body: '', form_url: '' },
  render: (p, c) => `<section class="wrap block"><h2${c.f('heading')}>${esc(p.heading)}</h2>${body(c, c.f('body'), p.body)}</section>`,
},
```

- **Field kinds:** `text`, `textarea`, `url`, `date`, `select`, `list` (with sub-`fields`).
- **Field options:** `options` (prewritten copy), `rich`, `max`, `maxLines`, `required`, `hint`, `panel` (edit in the side panel), `fallback` (a Settings > Connections key).
- **Block options:** `presets` (one-tap list items), `sample` (gallery content), `atom: true` (can also sit inside a column).
- **Render:** escape everything with `esc`, pass links through `safeUrl`, and mark editable text with `c.f(key)` or `c.fi(list, j, key)`, which return nothing on the public site. Rich text goes through the `body(c, attrs, text)` helper.
- **Styles:** go in `static/site.css`; blocks only emit class names.

`test/blocks.test.js` runs every block through the contract, including rendering hostile text, so a new block is tested as soon as it is registered. Then run `UPDATE_SNAPSHOTS=1 npm run test:visual` to add it to the screenshot baselines.

## Tests

- `npm test` covers the block contract, the core (drafts, conflicts, publishing, versions, restore, shares, checks, presence), file-store safety and the HTTP server (auth, CSRF, attribution, share links).
- `npm run test:visual` renders the block gallery and the demo pages at desktop and phone widths in headless Chromium and compares them with `test/visual/baseline/`. It also fails if a page scrolls sideways on a phone. It needs Playwright (`npm i -D playwright && npx playwright install chromium`, or `NODE_PATH` pointing at a global install) and skips itself otherwise. Fallback fonts differ between machines, so make baselines where they're checked.

## Not done yet (deliberately)

- Cloudflare deploy, logins per chapter lead (the editor asks for a name for now), image upload (URL fields only), multisite management.
- Events, posts and so on live inside their block, so the home page and events page each hold their own list. A shared per-chapter list (so a Luma sync has one place to write) is the likely next step.
- Dates are stored as local wall-clock times; add the timezone offset when the Luma sync lands.
- Design: Yard Sign. Each chapter picks one color (Settings, "Colors and logo"); text and tint colors derive from it. Typekit Pragmatica Extended is not loaded, so Archivo (expanded) from Google Fonts stands in. To swap designs later, edit `static/site.css` and the wrapper in `lib/render.js`.
