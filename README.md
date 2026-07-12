# ARMERA website

Static site for [ARMERA](https://www.armera.co.uk) bathroomware. Every product, price, colour and
finish comes from the March 2026 catalogue — no invented data. All imagery, fonts-adjacent vendor
files and documents are served from Supabase Storage.

## Structure

- `data/` — the product database (one JSON file per category), site details, lifestyle captions,
  inspiration image list. **Edit prices/products here.**
- `static/` — the stylesheet and the two client scripts (site interactions, instructions page).
- `build.mjs` — zero-dependency static site generator. Reads `data/`, writes the full site to `docs/`.
- `docs/` — the built site, served by GitHub Pages from the `main` branch.
- `assets-src/` — prepared source assets (product cut-outs, lifestyle shots, swatches, inspiration
  images, brand logos, catalogue PDF). These are uploaded to Supabase Storage; the site links to
  the Supabase URLs, not to this folder.

## Building

```sh
node build.mjs                          # for a custom domain / root hosting
BASE_PATH=/armera-website node build.mjs  # for GitHub Pages project hosting
```

Commit and push; GitHub Pages serves `docs/` automatically.

## Supabase

Project: `pcouznwpyhtfrleedcsv` (ARMERA Website, London).

- Bucket `site-assets` (public) — products/, lifestyle/, swatches/, inspiration/, brand/,
  documents/, vendor/ (pdf.js used for PDF thumbnails).
- Bucket `instructions` (public) — **upload instruction PDFs here** (Supabase dashboard → Storage →
  instructions). They appear automatically on /support/instructions/, sorted by filename, each with
  a thumbnail of the first page. Prefix filenames to control order, e.g.
  `01 - Holloway furniture.pdf`, `02 - Palladium unit.pdf`. The displayed title drops the leading
  number and the `.pdf` extension.

## Custom domain

To serve at www.armera.co.uk: add the domain in the repo's Pages settings, point DNS at GitHub
Pages, then rebuild without `BASE_PATH` and push.
