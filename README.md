# ARMERA website

The website for [ARMERA](https://www.armera.co.uk) bathroomware. Every product,
price, colour and finish comes from the March 2026 catalogue or from edits made
in the admin — no invented data.

**How the whole thing fits together, where data and secrets live, and how to
back up and restore: [`ARCHITECTURE.md`](ARCHITECTURE.md).**

## In one paragraph

Everything runs on Cloudflare. The pages are plain files built by `build.mjs`
and served by the `armera-website` Worker. All data — catalogue, page wording,
retailers, guarantee registrations, visit counts, staff accounts — is in the D1
database `armera`, and all files are in R2 storage; both are reached only
through the `armera-api` Worker (`cloudflare/api/`). Supabase and GitHub Pages
are no longer part of the live site.

## Publishing

```sh
./deploy.sh
```

Builds from the live content and uploads to Cloudflare. The API is deployed
separately: `cd cloudflare/api && npx wrangler deploy`.

On launch day, to let search engines in:

```sh
INDEXABLE=1 SITE_URL=https://www.armera.co.uk ./deploy.sh
```

A rebuild is only needed when the design or templates change. Edits made in the
admin appear on the site straight away.

## How content reaches a page

- **Products** (`/products/…`) are drawn in the browser by `static/catalog.js`
  from the live catalogue, so an edit shows at once. Each page also carries the
  real name, prices and links in its HTML for search engines, and `404.html`
  draws any product added since the last build.
- **Editable wording** on the other pages carries `data-ck` attributes;
  `static/site.js` overlays the latest values.
- **The admin** is at `/admin/` (not linked from the site). Sign-in is handled
  by `armera-api`; `static/armera-client.js` is the thin layer between the
  admin's code and the API.
- **Find a retailer** uses Leaflet with CARTO/OpenStreetMap map tiles and
  postcodes.io for postcode lookups — the only outside services a visitor's
  browser contacts.
- **Old addresses** from the previous website are redirected by
  `data/redirects.txt`.

## What is where

- `build.mjs` — the page generator. No dependencies.
- `static/` — stylesheet and browser scripts.
- `cloudflare/` — the two Workers and the database structure.
- `data/` — the original catalogue transcription, the redirect list, and the
  few things the admin cannot edit (inspiration page, guarantee-years table).
- `backups/` — snapshots of the editable content. Nothing personal.
- `docs/` — a second built copy for GitHub Pages. Rebuilt by `deploy.sh`,
  public pages only. Safe to stop using.

## What can and cannot damage live data

The live site reads Cloudflare, not this repository.

**Safe — these never change live data:**

- `node build.mjs` and `./deploy.sh` — they only read.
- Editing anything in `static/`, `build.mjs` or `data/`.
- `node .tools/backup.mjs` — only reads.

**Changes live data:**

- Saving anything in the admin. That is its job.
- `npx wrangler d1 execute armera --remote …` with a statement that writes.
  Take a backup first, change only the rows you mean to, and count rows before
  and after.

**Never apply the SQL printed by `seed-content.mjs`.** It was for first setup,
on the old database. It would replace the catalogue with the original
transcription and wipe every edit made in the admin since.

If the content API cannot be reached, the build **stops** rather than publish
from the stale copy in `data/`. `ALLOW_STALE=1 node build.mjs` overrides that
on purpose. A malformed catalogue also stops the build.
