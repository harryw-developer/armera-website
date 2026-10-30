# Cloudflare

The site's data was copied from Supabase to Cloudflare on 30 Oct 2026. Supabase
is still live and still serving the site — this is a verified copy, not a
switchover. Nothing here is wired into the live site yet.

| What | Where | Contents |
|---|---|---|
| Database | D1 `armera` (`3a4d04bb-…`) | `site_content` 13 rows, `page_views` 859 rows, `guarantee_registrations` (empty, schema only) |
| Files | R2 `armera-assets` | 1,293 objects, 265.9 MB — mirror of the `site-assets` bucket |
| Files | R2 `armera-instructions` | 6 objects, 6.6 MB — mirror of the `instructions` bucket |
| Site | Worker `armera-website` | Static build, `noindex`, at `armera-website.harry-01f.workers.dev` |

`schema.sql` is the D1 schema: the Postgres `jsonb` columns become `TEXT`
holding JSON, and `timestamptz` becomes `TEXT` holding ISO-8601 UTC, which
sorts and compares correctly as a string.

## Verification done at copy time

- All 13 `site_content` documents compared by content hash after parsing — identical.
- `page_views` row count and id range identical (859 rows, 1–859).
- Every one of the 1,299 files present in R2 at the identical byte size.
- Content checksums compared for all 1,299; the two instruction PDFs whose
  Supabase etag is a multipart hash (suffix `-1`) were additionally fetched from
  both sides and compared by SHA-256 — identical.

## Re-syncing before a switchover

The copy is a point in time. Anything changed in the admin afterwards lands in
Supabase only, so re-run the copy immediately before any cutover:

```
cd cloudflare && npx wrangler deploy -c migrate.wrangler.jsonc
# then re-run the export + copy steps, then delete the worker again
```

`migrate-worker.js` is copy-only — it never deletes from either side. It is
deployed temporarily, protected by a `MIGRATE_TOKEN` secret, and deleted once a
copy is verified so no public endpoint with bucket access is left running.
