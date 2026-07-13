# ARMERA website

Static site for [ARMERA](https://www.armera.co.uk) bathroomware. Every product, price, colour and
finish comes from the March 2026 catalogue — no invented data. All imagery, documents and vendor
files are served from Supabase Storage.

## How it works

- **Static pages** (home, inspiration, about, support, contact) are baked by `build.mjs` into `docs/`,
  which GitHub Pages serves from the `main` branch.
- **The /products tree** is rendered in the browser (`static/catalog.js`) from the Supabase
  `site_content` table, so catalogue edits made in the admin area appear immediately — no rebuild.
  `docs/404.html` renders any product page added after the last build, so new URLs work too.
- **Editable text blocks** on the static pages (home hero, About sections, spares line, contact
  details) carry `data-ck` attributes; `static/site.js` overlays the latest values from Supabase.
- **The admin area** at `/admin/` (discreet "Sign in" link in the footer) uses Supabase Auth.
  It edits the catalogue (ranges, products, prices, photos), page text, and instruction PDFs.

## Building

```sh
node build.mjs                            # for a custom domain / root hosting
BASE_PATH=/armera-website node build.mjs  # for GitHub Pages project hosting
```

Commit and push; GitHub Pages serves `docs/` automatically. A rebuild is only needed when the
templates/design change — content edits happen in the admin area.

## Structure

- `data/` — the original catalogue transcription (also the seed for Supabase; `seed-content.mjs`
  regenerates the seed SQL if the table ever needs resetting).
- `static/` — stylesheet and client scripts (site.js, catalog.js, instructions.js, admin.js).
- `assets-src/` — prepared source assets, mirrored to Supabase Storage.
- `docs/` — the built site.

## Supabase

Project: `pcouznwpyhtfrleedcsv` (ARMERA Website, London).

- Table `site_content` — one row per product category plus a `pages` row. Public read; signed-in
  admin write.
- Bucket `site-assets` (public) — products/, lifestyle/, swatches/, inspiration/, brand/,
  documents/, vendor/. The admin uploads new product/hero/swatch photos here.
- Bucket `instructions` (public) — instruction PDFs, listed on /support/instructions/ in filename
  order with a first-page thumbnail (pdf.js). Manage them in the admin's Instructions tab, or the
  Supabase dashboard. Prefix filenames with numbers to control order.

Admin sign-in is at `/admin/` — manage the password in the admin's Account tab.

## Custom domain

To serve at www.armera.co.uk: add the domain in the repo's Pages settings, point DNS at GitHub
Pages, then rebuild without `BASE_PATH` and push.
