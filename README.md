# Chapter CMS

A small block-based CMS for CNL chapter websites. Chapter leads edit pages by stacking pre-made sections (hero, events, endorsements, issue cards, news/media, people, text, call to action); the public site renders them in the "Yard Sign" design (option C from the CNL Chapter Sites design-directions canvas). No dependencies: just Node 20+.

## Run it

```bash
cd chapter-cms
npm start                 # http://localhost:3000  (site)   http://localhost:3000/admin  (editor)
npm test                  # unit + server tests
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

The page preview is the editor: click any text to type over it. A side panel shows prewritten options for the text you are in (tap to use), controls for the selected section (move, delete), link/date fields, and one-tap prewritten items to add (events, issues, endorsements, posts, people). Add prewritten copy in `lib/blocks.js` (`options` on a field, `presets` on a block).

## How it works

- `data/<chapter>/site.json`: name, menu, colors, logo, footer. `data/<chapter>/pages/<page>.json`: `{title, seo_*, blocks:[{id,type,props}]}`.
- `lib/blocks.js` is the block registry. Each block has a field schema (drives the admin form) and a render function. **To add a block type, add one entry there.**
- `lib/store.js` is the only module that touches disk (`get/put/pages/history/restore`). Saves are atomic, and the last 20 versions of each page are kept (History button, one-click restore). Swap this class for KV/R2/D1 when moving to Cloudflare.
- Server validates every save against the schema (unknown keys dropped), escapes all output, only allows `http(s)`, `mailto:` and relative links, whitelists slugs `[a-z0-9-]{1,40}`, requires JSON content type and same-origin on writes.
- Text fields accept `**bold**`, `*italic*`, `[link](https://…)`.
- Events use a Luma-shaped record (`id, title, start, end, location, url, cover_image, description`) plus a `luma_calendar_url` field. No sync yet; past events hide automatically.

## Not done yet (deliberately)

- Cloudflare deploy, auth per chapter lead (magic link was the earlier plan), image upload (URL fields only), draft/publish, drag-reorder (up/down buttons), creating or deleting pages from the UI.
- Events, posts, etc. live inside their block, so the home page and events page each hold their own list. A shared per-chapter list (so a Luma sync has one place to write) is the likely next step.
- Dates are stored as local wall-clock times; add the timezone offset when the Luma sync lands.
- Design: Yard Sign. Each chapter picks one color (Site settings, "Chapter color"); text and tint colors derive from it. Typekit Pragmatica Extended is not loaded, so Archivo (expanded) from Google Fonts stands in. To swap designs later, edit `static/site.css` and the wrapper in `lib/render.js`; blocks only emit class names.
